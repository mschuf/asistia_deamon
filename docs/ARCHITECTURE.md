# Arquitectura

Documento técnico de la arquitectura interna del daemon: componentes, responsabilidades, flujo de datos, modelo de datos y estructura del proyecto.

---

## 1. Visión general

El proceso es un **NestJS ApplicationContext** (no expone HTTP — es un daemon de larga duración). Tiene un único `cron` que se dispara cada N segundos. Por cada ciclo:

1. Pregunta a Microsoft Graph qué correos no leídos hay en la bandeja de entrada.
2. Por cada uno, pide el hilo completo.
3. Le pasa el hilo a Gemini 3 Flash con un prompt + schema que fuerza JSON estructurado.
4. Imprime la decisión por consola.
5. Marca el correo como leído.

Si algo falla en un correo (por ejemplo, Graph devuelve 500 o Gemini devuelve algo que no es JSON), el error se loguea, el correo **no se marca como leído** y el ciclo continúa con el siguiente. El proceso **nunca muere por un error individual** (hay `unhandledRejection` y `uncaughtException` handlers en `main.ts`).

---

## 2. Estructura del proyecto

```
asistiaDaemon/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── .env.example
├── README.md                              ← overview + quick start
├── docs/
│   ├── ARCHITECTURE.md                    ← este documento
│   ├── SETUP.md
│   ├── CONFIGURATION.md
│   ├── GRAPH-ENDPOINTS.md
│   ├── GEMINI-PROMPT.md
│   ├── OPERATIONS.md
│   ├── OUTPUT.md
│   ├── EXTENDING.md
│   └── SECURITY.md
└── src/
    ├── main.ts                            ← entrypoint
    ├── app.module.ts                      ← módulo raíz
    ├── config/
    │   └── configuration.ts               ← carga y tipa las env vars
    ├── microsoft/
    │   ├── microsoft.module.ts
    │   ├── microsoft-auth.service.ts      ← ClientSecretCredential
    │   ├── outlook.service.ts             ← Graph SDK (unread, thread, patch)
    │   └── types.ts                       ← tipos de Graph y mapeos
    ├── gemini/
    │   ├── gemini.module.ts
    │   └── gemini.service.ts              ← prompt + responseSchema
    └── daemon/
        ├── daemon.module.ts
        ├── email-daemon.service.ts        ← scheduler + ciclo
        └── ticket-decision.service.ts     ← reporter (console.log)
```

---

## 3. Módulos y responsabilidades

### 3.1 `MicrosoftModule`

| Servicio | Responsabilidad |
| --- | --- |
| `MicrosoftAuthService` | Crea un `ClientSecretCredential` con `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`. Expone un método que devuelve un `Client` de Microsoft Graph con un `authProvider` que en cada request pide un token nuevo. |
| `OutlookService` | Encapsula todas las llamadas a Graph: `getUnreadEmails()`, `getThread(conversationId)`, `markAsRead(messageId)`. Mapea el JSON crudo de Graph a tipos internos limpios y hace un `htmlToText` básico para los cuerpos HTML. |

Decisión: **no usar `isomorphic-fetch` global**. El SDK de Graph trae su propio `fetch` polyfill vía la dep. `isomorphic-fetch` está importado explícitamente en `microsoft-auth.service.ts` para que el `Client` de Graph tenga un `fetch` global en Node 22 (algunas versiones del SDK lo requieren).

### 3.2 `GeminiModule`

| Servicio | Responsabilidad |
| --- | --- |
| `GeminiService` | Inicializa `GoogleGenerativeAI` con `GEMINI_API_KEY`. Construye el prompt con el hilo completo y un `responseSchema` que fuerza la estructura `{requiere_ticket, motivo, ticket_data}`. Llama a `model.generateContent()` y devuelve `GeminiDecision`. |

Decisión: usar `responseMimeType: 'application/json'` + `responseSchema` (no pedirle al modelo que "responda en JSON" y esperar). Eso garantiza que la respuesta sea parseable sin regex ni limpieza.

### 3.3 `DaemonModule`

| Servicio | Responsabilidad |
| --- | --- |
| `EmailDaemonService` | Implementa `OnApplicationBootstrap`. En el bootstrap registra un `setInterval` en `SchedulerRegistry` con `DAEMON_INTERVAL_SECONDS` (mínimo 5s) y dispara un primer ciclo inmediato. Cada ciclo llama a `OutlookService` y procesa los no leídos uno por uno. |
| `TicketDecisionService` | Recibe la decisión de Gemini y la imprime por consola. Hoy solo loguea; mañana hará el POST al sistema de tickets. |

Decisión: **un solo ciclo en vuelo a la vez**. Si el ciclo anterior todavía no terminó cuando se dispara el próximo tick, el nuevo tick se descarta (hay un flag `running`). Esto evita "tormentas" si Gemini se pone lento y los correos se acumulan.

---

## 4. Flujo de un ciclo en detalle

### 4.1 Bootstrap

```
main()
  └─ NestFactory.createApplicationContext(AppModule)
        ├─ ConfigModule loads .env
        ├─ ScheduleModule.forRoot()
        ├─ MicrosoftAuthService.onModuleInit()  → crea ClientSecretCredential
        ├─ GeminiService.onModuleInit()         → crea GoogleGenerativeAI
        └─ AppModule listo
  └─ EmailDaemonService.onApplicationBootstrap()
        ├─ crea setInterval(DAEMON_INTERVAL_SECONDS * 1000)
        ├─ schedulerRegistry.addInterval(...)
        └─ runCycle()  (primer ciclo inmediato, no bloquea el event loop)
```

### 4.2 Un ciclo (ciclo N)

```
EmailDaemonService.runCycle()
  │
  ├─ OutlookService.getUnreadEmails()
  │     └─ Graph: GET /users/{mailbox}/mailFolders/inbox/messages
  │            ?$filter=isRead eq false
  │            &$orderby=receivedDateTime desc
  │            &$top={DAEMON_MAX_EMAILS}
  │            &$select=id,conversationId,subject,bodyPreview,
  │                     receivedDateTime,from,isRead,body
  │
  ├─ for each unread message M:
  │     │
  │     ├─ OutlookService.getThread(M.conversationId)
  │     │     └─ Graph: GET /users/{mailbox}/messages
  │     │            ?$filter=conversationId eq '{M.conversationId}'
  │     │            sin &$orderby; ordena en memoria desc
  │     │            &$select=...
  │     │     └─ Ordena del más nuevo al más viejo y devuelve EmailThread
  │     │
  │     ├─ GeminiService.interpretThread(thread)
  │     │     └─ Construye prompt con thread completo
  │     │     └─ model.generateContent(prompt) con responseSchema
  │     │     └─ JSON.parse(response.text()) → GeminiDecision
  │     │
  │     ├─ TicketDecisionService.report(M, thread, decision)
  │     │     └─ console.log con formato (ver docs/OUTPUT.md)
  │     │
  │     └─ OutlookService.markAsRead(M.id)
  │           └─ Graph: PATCH /users/{mailbox}/messages/{M.id}
  │                  { isRead: true }
  │
  └─ log "Ciclo finalizado en Xms"
```

### 4.3 Manejo de errores

| Punto de fallo | Comportamiento |
| --- | --- |
| `getUnreadEmails()` falla | Se loguea el error, el ciclo termina, se reintenta en el próximo tick. |
| `getThread()` falla para un correo | Se loguea, se continúa con el siguiente correo. El correo no queda marcado como leído, así que se reintenta en el próximo ciclo (cuidado: si la API está rota para una conversationId puntual, vamos a fallar en bucle hasta que se arregle). |
| `interpretThread()` falla (Gemini) | Se loguea, se continúa. Igual que arriba, el correo no se marca como leído. |
| `markAsRead()` falla | Se loguea como warning pero el correo **ya fue procesado** (la decisión ya se logueó). Se va a reprocesar en el próximo ciclo y Gemini probablemente diga "no requiere ticket" otra vez, pero no se pierde la decisión. |
| Excepción no atrapada en cualquier punto | El handler global en `main.ts` loguea con stack. El proceso sigue vivo. |

---

## 5. Modelo de datos

### 5.1 Tipos de Microsoft Graph (crudos, en `microsoft/types.ts`)

Solo declaramos los campos que usamos. Graph devuelve muchos más.

```ts
GraphMessage {
  id: string
  conversationId: string
  subject: string
  bodyPreview: string
  receivedDateTime: string   // ISO 8601
  sentDateTime: string
  from: { emailAddress: { name: string, address: string } }
  toRecipients: Array<{ emailAddress: { name, address } }>
  isRead: boolean
  hasAttachments: boolean
  body: { contentType: 'html' | 'text', content: string }
}
```

### 5.2 Tipos internos (mapeo limpio, en `microsoft/types.ts`)

```ts
EmailMessage {
  id: string                    // Graph message id
  conversationId: string        // para agrupar en hilos
  subject: string
  from: { name: string, address: string }
  receivedDateTime: string      // ISO 8601
  bodyPreview: string           // fallback
  body: string                  // siempre texto plano (htmlToText si hacía falta)
  isRead: boolean
}

EmailThread {
  conversationId: string
  subject: string
  messages: EmailMessage[]      // ordenados del más nuevo al más viejo
  latestMessage: EmailMessage   // messages[0]
}
```

### 5.3 Tipo de salida de Gemini (en `gemini/gemini.service.ts`)

```ts
TicketData {
  titulo: string                // resumen conciso
  descripcion: string           // detalle limpio
  prioridad: 'Alta' | 'Media' | 'Baja'
  solicitante: string           // email del usuario (no del buzón soporte)
}

GeminiDecision {
  requiere_ticket: boolean
  motivo: string                // explicación humana
  ticket_data: TicketData       // si requiere_ticket=false, queda con defaults
}
```

---

## 6. ¿Por qué `conversationId` y no `thread` Graph?

Microsoft Graph expone dos formas de representar un hilo:

1. `conversationId` (campo de cada mensaje): agrupa mensajes de la misma conversación lógica (incluye los que vos enviaste, los que te respondieron, forwards, etc.). Es estable y no cambia cuando se mueven mensajes entre carpetas.
2. `threads` (`/me/messages/{id}/threads` o `/me/conversations/{id}/threads`): un endpoint que devuelve un hilo a partir de un mensaje. Más pesado y no siempre disponible en buzones compartidos con permisos de aplicación.

Usamos `conversationId` + filtro OData. Es más liviano, no requiere endpoint extra y agrupa correctamente las respuestas.

---

## 7. ¿Por qué `Client Credentials Flow` y no `Device Code`?

| Flujo | Ventaja | Desventaja |
| --- | --- | --- |
| **Client Credentials** (lo que usamos) | Sin interacción humana, ideal para daemons. Token fresco en cada request. | Requiere que el admin del tenant consienta permisos de tipo **Application** (no Delegated). No soporta MFA interactivo. |
| Device Code | Un usuario inicia sesión una vez. Funciona con permisos Delegated. | Requiere refresh token persistente en disco. Se rompe si al usuario le vence la sesión, cambia la password, etc. |

Para un daemon de TI de una sola empresa, Client Credentials con `Mail.Read` (Application) es el patrón estándar. Ver [docs/SETUP.md](./SETUP.md) para los pasos exactos.

---

## 8. ¿Por qué `gemini-3-flash-preview` con `responseSchema`?

- `3 Flash` es la familia rápida y barata, ideal para clasificación de texto como esta.
- `responseSchema` (en `responseMimeType: 'application/json'`) hace que Gemini devuelva **solo JSON válido que cumple el schema**. No hace falta regex, no hace falta pedirle "responde solo en JSON sin texto alrededor". El parser es `JSON.parse` directo.
- Si tu proyecto GCP todavía no tiene `gemini-3-flash-preview` habilitado, cambiá `GEMINI_MODEL` a `gemini-2.5-flash` o `gemini-1.5-flash`. El schema es compatible.

---

## 9. Diagrama de secuencia de extremo a extremo

```
        AsistiaDaemon                Microsoft Graph              Gemini 3 Flash
              │                            │                            │
              │ 1. getUnreadEmails()       │                            │
              │──────────────────────────▶│                            │
              │   GET /users/{mb}/         │                            │
              │   mailFolders/inbox/       │                            │
              │   messages?$filter=        │                            │
              │   isRead eq false          │                            │
              │◀──────────────────────────│                            │
              │  [M1, M2, M3]              │                            │
              │                            │                            │
              │ ─── para M1 ───            │                            │
              │                            │                            │
              │ 2. getThread(M1.convId)    │                            │
              │──────────────────────────▶│                            │
              │   GET /users/{mb}/         │                            │
              │   messages?$filter=        │                            │
              │   conversationId eq ...    │                            │
              │◀──────────────────────────│                            │
              │  [H0, H1, M1]              │                            │
              │                            │                            │
              │ 3. interpretThread(thread) │                            │
              │────────────────────────────────────────────────────────▶│
              │   POST generativelanguage...:generateContent           │
              │   body: { contents, systemInstruction,                  │
              │           generationConfig: { responseSchema } }        │
              │◀────────────────────────────────────────────────────────│
              │  { requiere_ticket, motivo, ticket_data }              │
              │                            │                            │
              │ 4. report(M1, thread, decision)                        │
              │   console.log(...)         │                            │
              │                            │                            │
              │ 5. markAsRead(M1.id)       │                            │
              │──────────────────────────▶│                            │
              │   PATCH /users/{mb}/       │                            │
              │   messages/{M1.id}         │                            │
              │   { isRead: true }         │                            │
              │◀──────────────────────────│                            │
              │                            │                            │
              │ ─── repetir para M2, M3 ──                             │
              │                            │                            │
              │ 6. log "Ciclo finalizado en Xms"                      │
              │                            │                            │
              │ ── esperar DAEMON_INTERVAL_SECONDS ──                  │
```

---

## 10. Puntos de extensión (para más adelante)

| Necesidad | Dónde tocar |
| --- | --- |
| Cambiar el prompt o el schema de Gemini | `src/gemini/gemini.service.ts` (`buildPrompt`, `responseSchema`, `systemInstruction`) |
| Agregar otro filtro de Graph (por ejemplo, solo correos con adjuntos) | `src/microsoft/outlook.service.ts` (`getUnreadEmails`, agregar `$filter`) |
| Persistir decisiones en una base | Inyectar un nuevo servicio en `TicketDecisionService.report()` y guardar antes/después de loguear |
| Enviar el ticket al sistema externo | `src/daemon/ticket-decision.service.ts` — reemplazar `console.log` por `fetch` / `HttpService` |
| Exponer métricas Prometheus | Crear un `MetricsModule` y un controller HTTP separado, levantando `NestFactory.create` con `app.connectMicroservice` o un segundo puerto |
| Mover a una cola (RabbitMQ, SQS) en vez de polling | Reemplazar `SchedulerRegistry` por un consumer de la cola; el resto del pipeline queda igual |
| Webhook de Graph (en vez de polling) | Configurar `subscription` resource en Graph y reemplazar el `setInterval` por un handler HTTP de webhooks |
