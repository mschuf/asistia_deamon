# Asistia Daemon

Daemon NestJS que monitorea la casilla de soporte `TI.soporte@grupopettengill.com.py`, interpreta cada correo (junto con su historial) con **Gemini 3 Flash** y determina si corresponde generar un ticket. Por ahora, la decisión se imprime por consola. En el futuro, el mismo JSON se enviará al sistema de tickets.

---

## Tabla de contenidos

| Documento | Contenido |
| --- | --- |
| [README.md](./README.md) | Este archivo. Overview, arquitectura de alto nivel, quick start. |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Componentes internos, flujo de datos por ciclo, modelo de datos, estructura del proyecto. |
| [docs/SETUP.md](./docs/SETUP.md) | Paso a paso para crear la App Registration en Azure AD, permisos del buzón y API key de Gemini. |
| [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) | Todas las variables de entorno, defaults, valores sugeridos. |
| [docs/GRAPH-ENDPOINTS.md](./docs/GRAPH-ENDPOINTS.md) | Endpoints de Microsoft Graph que consume el daemon, query strings, permisos requeridos. |
| [docs/GEMINI-PROMPT.md](./docs/GEMINI-PROMPT.md) | Prompt completo, `systemInstruction`, `responseSchema`, ejemplos de respuesta. |
| [docs/OPERATIONS.md](./docs/OPERATIONS.md) | Cómo arrancarlo, logs, manejo de errores, troubleshooting, retry/backoff. |
| [docs/OUTPUT.md](./docs/OUTPUT.md) | Ejemplos reales de salida por consola para cada caso. |
| [docs/EXTENDING.md](./docs/EXTENDING.md) | Cómo conectar con el sistema de tickets real, agregar un endpoint HTTP, etc. |
| [docs/SECURITY.md](./docs/SECURITY.md) | Manejo de secretos, PII, mailbox permissions, consideraciones. |

---

## ¿Qué hace?

1. Cada N segundos (configurable) consulta el buzón `TI.soporte@grupopettengill.com.py` vía Microsoft Graph.
2. Para cada correo **no leído** trae el **hilo completo** (todos los mensajes del mismo `conversationId`, ordenados del más nuevo al más viejo).
3. Envía el hilo a **Gemini 3 Flash** con un prompt que obliga a responder JSON estructurado (`responseSchema`).
4. Imprime por consola:
   - `[TICKET] NO requiere ticket` + motivo, **o**
   - `[TICKET] REQUIERE ticket` + la estructura `ticket_data` lista para crear en el sistema externo.
5. Marca el correo como leído para no reprocesarlo.

---

## Arquitectura de alto nivel

```
                        ┌──────────────────────────────────────────┐
                        │       NestJS ApplicationContext         │
                        │                                          │
  ┌────────────┐        │  ┌────────────────────────────────┐      │
  │  Microsoft │◀──────▶│  │ MicrosoftModule                │      │
  │  Graph API │        │  │  ├─ MicrosoftAuthService       │      │
  └────────────┘        │  │  │   (ClientSecretCredential)    │      │
                        │  │  └─ OutlookService             │      │
                        │  │      (unread + thread + PATCH) │      │
                        │  └────────────────────────────────┘      │
                        │                │                        │
                        │                ▼                        │
                        │  ┌────────────────────────────────┐      │
                        │  │ GeminiModule                   │      │
                        │  │  └─ GeminiService              │◀────▶│ Google Gemini
                        │  │      (gemini-3-flash-preview)  │      │ 3 Flash
                        │  └────────────────────────────────┘      │
                        │                │                        │
                        │                ▼                        │
                        │  ┌────────────────────────────────┐      │
                        │  │ DaemonModule                   │      │
                        │  │  ├─ EmailDaemonService         │      │
                        │  │  │   (SchedulerRegistry, ciclo) │      │
                        │  │  └─ TicketDecisionService      │──▶ console.log
                        │  └────────────────────────────────┘      │
                        │                                          │
                        └──────────────────────────────────────────┘
```

Diagrama de flujo de un ciclo (ver [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) para más detalle):

```
  ┌─────────┐   1. unread  ┌─────────────┐  2. conversationId ┌──────────────┐
  │  Ciclo  │──────────────▶│  Outlook    │───────────────────▶│  Outlook     │
  │  N s    │               │  Service    │                    │  Service     │
  └─────────┘               └─────────────┘                    └──────────────┘
       ▲                          │                                   │
       │                          │ 3. thread (todos los msgs)        │
       │                          ▼                                   │
       │                    ┌─────────────┐                           │
       │                    │  Gemini     │◀──────────────────────────┘
       │                    │  Service    │
       │                    └─────────────┘
       │                          │ 4. JSON decisión
       │                          ▼
       │                    ┌─────────────┐
       │                    │  Reporter   │──▶ console.log
       │                    └─────────────┘
       │                          │
       │                          │ 5. PATCH isRead=true
       │                          ▼
       │                    ┌─────────────┐
       └────────────────────│  Outlook    │
            siguiente ciclo │  Service    │
                           └─────────────┘
```

---

## Stack

| Capa | Tecnología |
| --- | --- |
| Runtime | Node.js 22 LTS |
| Framework | NestJS 10 (`@nestjs/core` + `@nestjs/schedule`) |
| Auth Microsoft | `@azure/identity` (`ClientSecretCredential`) |
| API Microsoft | `@microsoft/microsoft-graph-client` + `isomorphic-fetch` |
| AI | `@google/generative-ai` — modelo `gemini-3-flash-preview` |
| Config | `@nestjs/config` + `dotenv` |
| Lenguaje | TypeScript 5 (strict) |

---

## Datos necesarios para funcionar

Antes de arrancar el daemon necesitás conseguir 5 valores (más info paso a paso en [docs/SETUP.md](./docs/SETUP.md)):

| Dato | Variable de entorno | De dónde sale |
| --- | --- | --- |
| Tenant de Entra ID | `MS_TENANT_ID` | Azure Portal → Entra ID → App registration → Overview → *Directory (tenant) ID* |
| Client ID de la app | `MS_CLIENT_ID` | Azure Portal → Entra ID → App registration → Overview → *Application (client) ID* |
| Client Secret de la app | `MS_CLIENT_SECRET` | Azure Portal → Entra ID → App registration → Certificates & secrets → *Value* (solo se muestra al crearlo) |
| Mailbox a leer | `MS_MAILBOX` | UPN o email del buzón (acá: `TI.soporte@grupopettengill.com.py`) |
| API key de Gemini | `GEMINI_API_KEY` | https://aistudio.google.com/apikey |

Datos opcionales (con defaults razonables):

- `GEMINI_MODEL` (default `gemini-3-flash-preview`)
- `DAEMON_INTERVAL_SECONDS` (default `60`, mínimo 5)
- `DAEMON_MAX_EMAILS` (default `20`, por empresa en cada ciclo)
- `MS_MAIL_FOLDER` (default `inbox`)

---

## Quick start

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables
cp .env.example .env
# editar .env y completar los 5 valores obligatorios

# 3. Compilar
npm run build

# 4. Arrancar en producción
npm run start:prod

# O desarrollo con hot-reload
npm run start:dev
```

Detener el proceso: `Ctrl+C` (manda `SIGINT` y se cierra limpio).

---

## Salida por consola (resumen)

El formato completo está documentado en [docs/OUTPUT.md](./docs/OUTPUT.md). Resumen rápido:

**Caso 1 — No requiere ticket:**
```
═══════════════════════════════════════════════════════════════
[TICKET] NO requiere ticket
Mensaje: Felicitaciones por el aniversario! (info@marketing.com.py)
Motivo: Es un correo informativo/marketing, no requiere soporte.
Detalle: { "event": "email.processed", ... "decision": { "requiere_ticket": false, ... } }
═══════════════════════════════════════════════════════════════
```

**Caso 2 — Requiere ticket:**
```
═══════════════════════════════════════════════════════════════
[TICKET] REQUIERE ticket -> crear en sistema externo
Mensaje: No puedo acceder al VPN (juan.perez@grupopettengill.com.py)
Ticket a crear: {
  "titulo": "Sin acceso a VPN corporativo",
  "descripcion": "El usuario reporta que desde esta mañana no puede conectar al cliente VPN...",
  "prioridad": "Alta",
  "solicitante": "juan.perez@grupopettengill.com.py"
}
Estructura completa: { "event": "email.processed", ... "decision": { "requiere_ticket": true, "ticket_data": {...} } }
═══════════════════════════════════════════════════════════════
```

---

## Siguiente paso natural

Reemplazar el `console.log` de `TicketDecisionService.report()` por una llamada HTTP al endpoint del sistema de tickets, manteniendo exactamente el mismo JSON que ya produce Gemini. Ver [docs/EXTENDING.md](./docs/EXTENDING.md).

---

## Licencia

Uso interno — Grupo Pettengill / Asistia.
