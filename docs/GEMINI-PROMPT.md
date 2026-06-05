# Gemini — Prompt, schema y configuración

Detalle exacto de lo que se le envía a Gemini 3 Flash en cada llamada, y de la respuesta esperada.

---

## Configuración del modelo

```ts
{
  model: 'gemini-3-flash-preview',  // o el que esté en GEMINI_MODEL
  systemInstruction: '...',          // ver abajo
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: { ... },         // ver abajo
    temperature: 0.2,
  },
}
```

| Campo | Valor | Razón |
| --- | --- | --- |
| `temperature` | `0.2` | Baja para que las clasificaciones sean consistentes. No queremos creatividad acá. |
| `responseMimeType` | `application/json` | Obliga al modelo a devolver JSON. |
| `responseSchema` | (ver §3) | Obliga al modelo a devolver **exactamente** esa estructura. Sin schema, podría agregar texto alrededor, comentarios, etc. |
| `systemInstruction` | (ver §1) | Reglas de negocio persistentes. |

---

## 1. `systemInstruction`

```
Sos un asistente que clasifica correos electrónicos de una casilla de soporte de TI.
Devolvés exclusivamente JSON válido con la estructura solicitada.

Si el correo es un mensaje automático, un agradecimiento, una notificación de sistema,
un correo masivo/newsletters o no describe un problema concreto que requiera intervención
del equipo de soporte, indicá requiere_ticket=false.

Si describe una falla, un pedido de acceso, una solicitud de cambio o un pedido de soporte,
indicá requiere_ticket=true y completá ticket_data con datos útiles y concisos.
```

**Por qué está en `systemInstruction` y no en el prompt:** el `systemInstruction` se cachea del lado de Gemini y reduce tokens facturables. Además, separa la "política" del "dato a evaluar".

---

## 2. Prompt (user content)

Se construye dinámicamente en `GeminiService.buildPrompt(thread)` con este formato:

```
Analizá el siguiente hilo de correos electrónicos (en orden descendente,
del más nuevo al más viejo, incluyendo el último mensaje no leído
que disparó esta evaluación).

Determiná si el usuario está reportando una falla, solicitando un acceso
o requiriendo soporte técnico que requiera la apertura de un ticket en
el sistema de mesa de ayuda.

Hilo completo:
"""
Asunto: {thread.subject}
ConversationId: {thread.conversationId}

--- Mensaje 1 ---
Fecha: 2026-05-30T08:15:00.000Z
De: Juan Pérez <juan.perez@grupopettengill.com.py>
Asunto: No puedo acceder al VPN

Hola equipo,
Desde esta mañana no puedo conectarme al VPN corporativo. Ya reinicié
la laptop y la aplicación. El cliente me tira "Authentication failed".
Necesito trabajar con unos archivos del servidor, ¿pueden ayudarme?
Gracias.

--- Mensaje 2 ---
Fecha: 2026-05-30T08:42:00.000Z
De: TI Soporte <TI.soporte@grupopettengill.com.py>
Asunto: RE: No puedo acceder al VPN

Hola Juan,
¿Podés confirmarnos tu usuario de dominio y si tu licencia de VPN está
al día?

--- Mensaje 3 ---
Fecha: 2026-05-30T09:05:00.000Z
De: Juan Pérez <juan.perez@grupopettengill.com.py>
Asunto: RE: No puedo acceder al VPN

Usuario: jperez
Licencia: recién la renové en marzo.
"""

Email del solicitante (último mensaje relevante): juan.perez@grupopettengill.com.py
Recordá: el campo "solicitante" en ticket_data debe ser el email del usuario
que reporta el problema (no del buzón de soporte).
```

**Por qué pasamos el hilo completo, no solo el último mensaje:** el caso típico es "el usuario escribió un mail inicial con el problema, el soporte le pidió datos, el usuario respondió → en el mail no leído más reciente a veces no está toda la info". Pasarle toda la conversación le da a Gemini el contexto que necesita para entender el problema.

**Por qué resaltamos "último mensaje relevante":** en un hilo donde el último mensaje es del soporte (no del usuario), Gemini podría confundirse y poner `solicitante = TI.soporte@...`. La instrucción explícita lo corrige.

---

## 3. `responseSchema`

El schema exacto que se le pasa a Gemini:

```ts
{
  type: SchemaType.OBJECT,
  properties: {
    requiere_ticket: {
      type: SchemaType.BOOLEAN,
      description: 'true si el correo requiere apertura de un ticket de soporte, false en caso contrario',
    },
    motivo: {
      type: SchemaType.STRING,
      description: 'Breve explicación de por qué sí o por qué no requiere ticket',
    },
    ticket_data: {
      type: SchemaType.OBJECT,
      properties: {
        titulo: {
          type: SchemaType.STRING,
          description: 'Resumen conciso del problema',
        },
        descripcion: {
          type: SchemaType.STRING,
          description: 'Detalle limpio de la solicitud',
        },
        prioridad: {
          type: SchemaType.STRING,
          enum: ['Alta', 'Media', 'Baja'],
          description: 'Nivel de prioridad sugerido',
          format: 'enum',
        },
        solicitante: {
          type: SchemaType.STRING,
          description: 'Email del solicitante (from.emailAddress.address del último mensaje del usuario)',
        },
        categoria_id: {
          type: SchemaType.INTEGER,
          description: 'Id de la categoría del catálogo (65..71). Si ninguna aplica con claridad, 66.',
        },
        categoria_nombre: {
          type: SchemaType.STRING,
          description: 'Nombre exacto de la categoría elegida',
        },
      },
      required: ['titulo', 'descripcion', 'prioridad', 'solicitante', 'categoria_id'],
    },
  },
  required: ['requiere_ticket', 'motivo', 'ticket_data'],
}
```

### Catálogo de categorías

La IA elige `ticket_data.categoria_id` entre estas categorías (el catálogo va embebido en el `prompt_template` de la tabla `prompt`):

| id | nombre |
| --- | --- |
| 65 | Software: Office, Windows, SAP, Aplicaciones |
| 66 | Hardware: PC, notebook, conectores **(default)** |
| 67 | Internet, red, cableados, accesos |
| 68 | Servidor, Switch, AD, Forti, Enlaces, Cloud |
| 69 | Telefonía móvil, fija, internos |
| 70 | CCTV, cámaras, DVR, TV, proyectores |
| 71 | Impresoras, papel, tóner, conexión |

Si la IA no devuelve un id válido del catálogo, el daemon usa el default (`66`, configurable con `TICKET_DEFAULT_CATEGORY_ID`). El catálogo vive en código en [src/ticket/categories.ts](../src/ticket/categories.ts) y debe mantenerse alineado con el prompt.

> **Importante**: aunque `requiere_ticket` sea `false`, Gemini va a devolver `ticket_data` igual (con lo que considere). El código no rompe — simplemente no loguea `ticket_data` cuando `requiere_ticket=false`.

---

## 4. Respuestas esperadas (ejemplos)

### Caso A — Reporte de falla (debe crear ticket)

```json
{
  "requiere_ticket": true,
  "motivo": "El usuario reporta un problema técnico (no puede acceder al VPN) con impacto en su trabajo, requiere intervención del equipo de soporte.",
  "ticket_data": {
    "titulo": "Sin acceso a VPN corporativo",
    "descripcion": "El usuario Juan Pérez (jperez) reporta que desde la mañana del 30/05 no puede conectarse al VPN. Ya reinició la laptop y el cliente, recibe 'Authentication failed'. Renovó licencia en marzo. Necesita acceso a archivos del servidor.",
    "prioridad": "Alta",
    "solicitante": "juan.perez@grupopettengill.com.py"
  }
}
```

### Caso B — Pedido de acceso (debe crear ticket)

```json
{
  "requiere_ticket": true,
  "motivo": "El usuario solicita acceso a un sistema (SAP), requiere gestión de permisos.",
  "ticket_data": {
    "titulo": "Pedido de acceso a SAP - módulo FI",
    "descripcion": "La usuaria María González (mgonzalez) solicita acceso al módulo FI de SAP por reasignación de tareas. Manager aprobador: Laura Sosa.",
    "prioridad": "Media",
    "solicitante": "maria.gonzalez@grupopettengill.com.py"
  }
}
```

### Caso C — Correo informativo / marketing (no requiere)

```json
{
  "requiere_ticket": false,
  "motivo": "Correo informativo de marketing sobre un nuevo beneficio, no es un pedido de soporte.",
  "ticket_data": {
    "titulo": "",
    "descripcion": "",
    "prioridad": "Media",
    "solicitante": "noreply@marketing.com.py"
  }
}
```

### Caso D — Notificación automática del sistema (no requiere)

```json
{
  "requiere_ticket": false,
  "motivo": "Notificación automática de Microsoft (resumen de buzón de voz), no requiere intervención.",
  "ticket_data": {
    "titulo": "",
    "descripcion": "",
    "prioridad": "Baja",
    "solicitante": "noreply@exchange.grupopettengill.com.py"
  }
}
```

### Caso E — Respuesta a un hilo (debe crear ticket nuevo con info consolidada)

```json
{
  "requiere_ticket": true,
  "motivo": "El usuario confirma en su respuesta que renovó la licencia en marzo y aporta su usuario de dominio. Con esta información el equipo de soporte puede avanzar.",
  "ticket_data": {
    "titulo": "Sin acceso a VPN - usuario jperez con licencia renovada",
    "descripcion": "Usuario jperez reporta imposibilidad de conectar al VPN corporativo (mensaje original). En la respuesta confirma usuario de dominio 'jperez' y que la licencia fue renovada en marzo. Continúa con error 'Authentication failed' tras reinicio de laptop y aplicación.",
    "prioridad": "Alta",
    "solicitante": "juan.perez@grupopettengill.com.py"
  }
}
```

---

## 5. Validación post-respuesta

Después de recibir la respuesta, el código:

1. Hace `JSON.parse(response.text())`. Si falla, **se loguea el texto crudo** y se considera que el correo no se pudo procesar.
2. Valida que `requiere_ticket` sea booleano.
3. Si `requiere_ticket=true` y a Gemini se le "olvidó" completar algún campo de `ticket_data`, **rellenamos con defaults**:
   - `titulo` ← `thread.subject`
   - `descripcion` ← `latestMessage.body` o `bodyPreview`
   - `prioridad` ← `'Media'` (si no es uno de los 3 valores válidos)
   - `solicitante` ← `lastUserMessage.from.address` o `'desconocido@local'`
   - `categoria_id` ← `66` (si no es un id válido del catálogo 65..71); `categoria_nombre` se recalcula a partir del id resuelto

Esto hace que el JSON resultante **siempre sea utilizable** por el sistema de tickets downstream, aunque el modelo alucine.

---

## 5.b Creación del ticket en el backend

Cuando `requiere_ticket=true`, el daemon llama al backend de tickets:

```
POST {TICKET_API_BASE_URL}{TICKET_API_SEND_PATH}   →   http://192.168.10.88:5173/api/v1/mail/send
Content-Type: application/json

{
  "email": "<ticket_data.solicitante>",
  "description": "<ticket_data.titulo + '\\n\\n' + ticket_data.descripcion>",
  "categoryId": <ticket_data.categoria_id resuelto>
}
```

- El mapeo lo arma `TicketService.buildPayload()` en [src/ticket/ticket.service.ts](../src/ticket/ticket.service.ts).
- La respuesta del backend (`sent`, `requester`, `category`, …) se guarda en `email_processing_attempts.decision_json.ticket_result` y se registra en `app_logs` con evento `ticket.created` / `ticket.error`.
- **Idempotencia**: antes de crear, el daemon consulta `hasTicketBeenCreated(mailMessageId)`, que mira dos fuentes: un intento con `decision_json.ticket_result.sent = true` **o** un `app_logs` con `event = 'ticket.created'` (señal append-only escrita apenas el POST tiene éxito, que el daemon nunca sobrescribe). Si alguna existe, no vuelve a crear (evita duplicados en modo test, donde el correo no se marca como leído y se reprocesa cada ciclo). Evento `ticket.skipped`. Además, si el ticket se creó pero un paso posterior falla, el `catch` preserva `ticket_result` en `decision_json`.
- Si la llamada falla (red/HTTP/timeout), se guarda `sent=false` con el error y el correo se reintenta en el próximo ciclo.

---

## 6. Tweakear el prompt / schema

Todo el comportamiento de Gemini vive en **un solo archivo**: `src/gemini/gemini.service.ts`. Para tunear:

| Querés... | Editá |
| --- | --- |
| Cambiar las reglas de clasificación | `systemInstruction` (línea ~80) |
| Cambiar el formato del prompt al modelo | `buildPrompt()` (línea ~35) |
| Cambiar la estructura del JSON de salida | `responseSchema` (línea ~55) |
| Cambiar la temperatura u otros parámetros | `generationConfig` (línea ~95) |
| Cambiar el modelo | `GEMINI_MODEL` en `.env` |

---

## 7. Costos y límites

Con `gemini-3-flash-preview` (precios orientativos a la fecha de escritura):

- **Input**: ~$0.075 por millón de tokens
- **Output**: ~$0.30 por millón de tokens

Cada correo procesado usa aproximadamente:
- 1.000–3.000 tokens de input (el prompt + el cuerpo del correo)
- 100–300 tokens de output (el JSON)

Para 100 correos/día → menos de 1 centavo USD/día. Prácticamente gratis en free tier.

### Tokens facturables vs tokens cacheados

Gemini cachea automáticamente prefijos comunes de prompts. El `systemInstruction` se cachea. Si mantenés el mismo `systemInstruction` entre ciclos, los siguientes requests aprovechan el caché. No hay que hacer nada para activarlo.

---

## 8. Privacidad

Los correos se envían a la API de Gemini para su procesamiento. **Los datos salen del perímetro de Grupo Pettengill hacia Google**.

- El contrato estándar de Gemini (Google Cloud Terms) cubre que los datos **no se usan para entrenar** modelos.
- Si tu equipo de seguridad requiere on-prem, hay que cambiar a un modelo local (Ollama, vLLM, etc.) y adaptar `GeminiService`. La interfaz `interpretThread(thread): Promise<GeminiDecision>` se mantiene.

Ver [docs/SECURITY.md](./SECURITY.md) para más detalle.
