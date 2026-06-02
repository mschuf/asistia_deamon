# Output — Ejemplos de salida por consola

El daemon imprime por `console.log` (a través de `Logger` de NestJS) tres tipos de mensajes: arranque, ciclo, y decisión. Este documento muestra ejemplos reales.

---

## 1. Arranque

```
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [NestFactory] Starting Nest application...
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [InstanceLoader] AppModule dependencies initialized
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [InstanceLoader] ConfigHostModule dependencies initialized
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [InstanceLoader] DiscoveryModule dependencies initialized
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [InstanceLoader] ConfigModule dependencies initialized
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [InstanceLoader] ScheduleModule dependencies initialized
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [InstanceLoader] GeminiModule dependencies initialized
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [InstanceLoader] MicrosoftModule dependencies initialized
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [InstanceLoader] DaemonModule dependencies initialized
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [MicrosoftAuthService] Credencial ClientSecret de Microsoft inicializada
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [GeminiService] Gemini inicializado con modelo gemini-3-flash-preview
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [EmailDaemonService] Daemon programado cada 60s. Primer ciclo inmediato...
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [EmailDaemonService] Buscando correos no leídos...
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [Bootstrap] Asistia daemon iniciado
```

Si ves todas las líneas en orden, todo inicializó bien.

---

## 2. Ciclo normal (bandeja vacía)

```
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [EmailDaemonService] Buscando correos no leídos...
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [EmailDaemonService] No hay correos no leídos
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [EmailDaemonService] Ciclo finalizado en 234ms
```

---

## 3. Caso A — Correo requiere ticket (problema de soporte)

**Mail entrante**: *"No puedo acceder al VPN"* de `juan.perez@grupopettengill.com.py`

**Log**:
```
[Nest] 1234  - 01/06/2026, 10:05:00     LOG [EmailDaemonService] Buscando correos no leídos...
[Nest] 1234  - 01/06/2026, 10:05:01     LOG [EmailDaemonService] Encontrados 1 correo(s) no leído(s)
[Nest] 1234  - 01/06/2026, 10:05:01     LOG [EmailDaemonService] Procesando [AAMkAGI2TG93...] No puedo acceder al VPN (conv=AAQkAGI2TG93...)
[Nest] 1234  - 01/06/2026, 10:05:02     LOG [EmailDaemonService] Hilo de [AAMkAGI2TG93...] No puedo acceder al VPN -> 1 mensaje(s)
═══════════════════════════════════════════════════════════════
[TICKET] REQUIERE ticket -> crear en sistema externo
Mensaje: No puedo acceder al VPN (juan.perez@grupopettengill.com.py)
Ticket a crear: {
  "titulo": "Sin acceso a VPN corporativo",
  "descripcion": "El usuario Juan Pérez (juan.perez@grupopettengill.com.py) reporta que desde la mañana no puede conectarse al VPN. Ya reinició la laptop y la aplicación. El cliente devuelve 'Authentication failed'.",
  "prioridad": "Alta",
  "solicitante": "juan.perez@grupopettengill.com.py"
}
Estructura completa: {
  "event": "email.processed",
  "timestamp": "2026-06-01T13:05:02.345Z",
  "mailbox_message_id": "AAMkAGI2TG93...",
  "conversation_id": "AAQkAGI2TG93...",
  "subject": "No puedo acceder al VPN",
  "from": {
    "name": "Juan Pérez",
    "address": "juan.perez@grupopettengill.com.py"
  },
  "received_at": "2026-05-31T14:23:11Z",
  "thread_length": 1,
  "decision": {
    "requiere_ticket": true,
    "motivo": "El usuario reporta un problema técnico (sin acceso a VPN) que impide realizar sus tareas laborales. Requiere intervención del equipo de soporte.",
    "ticket_data": {
      "titulo": "Sin acceso a VPN corporativo",
      "descripcion": "El usuario Juan Pérez (juan.perez@grupopettengill.com.py) reporta que desde la mañana no puede conectarse al VPN. Ya reinició la laptop y la aplicación. El cliente devuelve 'Authentication failed'.",
      "prioridad": "Alta",
      "solicitante": "juan.perez@grupopettengill.com.py"
    }
  }
}
═══════════════════════════════════════════════════════════════
[Nest] 1234  - 01/06/2026, 10:05:02     LOG [EmailDaemonService] Ciclo finalizado en 1823ms
```

**Para parsear este output programáticamente**: el bloque `Estructura completa: { ... }` es JSON puro. Cualquier log parser puede leerlo.

---

## 4. Caso B — No requiere ticket (mail marketing)

**Mail entrante**: *"Felicitaciones por el aniversario!"* de `noreply@marketing.com.py`

**Log**:
```
[Nest] 1234  - 01/06/2026, 10:10:00     LOG [EmailDaemonService] Buscando correos no leídos...
[Nest] 1234  - 01/06/2026, 10:10:01     LOG [EmailDaemonService] Encontrados 1 correo(s) no leído(s)
[Nest] 1234  - 01/06/2026, 10:10:01     LOG [EmailDaemonService] Procesando [AAMkAGI2TG94...] Felicitaciones por el aniversario! (conv=AAQkAGI2TG94...)
[Nest] 1234  - 01/06/2026, 10:10:02     LOG [EmailDaemonService] Hilo de [AAMkAGI2TG94...] Felicitaciones por el aniversario! -> 1 mensaje(s)
═══════════════════════════════════════════════════════════════
[TICKET] NO requiere ticket
Mensaje: Felicitaciones por el aniversario! (noreply@marketing.com.py)
Motivo: Es un correo informativo de marketing, no describe un problema ni un pedido de soporte.
Detalle: {
  "event": "email.processed",
  "timestamp": "2026-06-01T13:10:02.123Z",
  "mailbox_message_id": "AAMkAGI2TG94...",
  "conversation_id": "AAQkAGI2TG94...",
  "subject": "Felicitaciones por el aniversario!",
  "from": {
    "name": "Marketing",
    "address": "noreply@marketing.com.py"
  },
  "received_at": "2026-05-31T14:30:00Z",
  "thread_length": 1,
  "decision": {
    "requiere_ticket": false,
    "motivo": "Es un correo informativo de marketing, no describe un problema ni un pedido de soporte.",
    "ticket_data": {
      "titulo": "",
      "descripcion": "",
      "prioridad": "Media",
      "solicitante": "noreply@marketing.com.py"
    }
  }
}
═══════════════════════════════════════════════════════════════
[Nest] 1234  - 01/06/2026, 10:10:02     LOG [EmailDaemonService] Ciclo finalizado en 934ms
```

---

## 5. Caso C — Hilo con respuestas (interpretación consolidada)

**Hilo**:
- Mensaje 1 (30/05 08:15): Juan reporta problema con VPN
- Mensaje 2 (30/05 08:42): Soporte pide usuario de dominio
- Mensaje 3 (30/05 09:05, **no leído**): Juan responde con su usuario

**Log**:
```
[Nest] 1234  - 01/06/2026, 11:00:00     LOG [EmailDaemonService] Buscando correos no leídos...
[Nest] 1234  - 01/06/2026, 11:00:01     LOG [EmailDaemonService] Encontrados 1 correo(s) no leído(s)
[Nest] 1234  - 01/06/2026, 11:00:01     LOG [EmailDaemonService] Procesando [AAMkAGI2TG95...] RE: No puedo acceder al VPN (conv=AAQkAGI2TG90...)
[Nest] 1234  - 01/06/2026, 11:00:02     LOG [EmailDaemonService] Hilo de [AAMkAGI2TG95...] RE: No puedo acceder al VPN -> 3 mensaje(s)
═══════════════════════════════════════════════════════════════
[TICKET] REQUIERE ticket -> crear en sistema externo
Mensaje: RE: No puedo acceder al VPN (juan.perez@grupopettengill.com.py)
Ticket a crear: {
  "titulo": "Sin acceso a VPN - usuario jperez, licencia renovada en marzo",
  "descripcion": "Hilo del 30/05. Juan Pérez (jperez) no puede conectar al VPN corporativo. Recibió 'Authentication failed' tras reiniciar. En respuesta a consulta de soporte, confirma usuario 'jperez' y que renovó la licencia en marzo. Soporte debe verificar el estado de la cuenta/licencia en el backend.",
  "prioridad": "Alta",
  "solicitante": "juan.perez@grupopettengill.com.py"
}
Estructura completa: { ... }
═══════════════════════════════════════════════════════════════
```

**Nota clave**: el `subject` que se loguea es el del mensaje no leído (`RE: No puedo acceder al VPN`), pero el `ticket_data.titulo` consolidado lo arma Gemini mirando todo el hilo.

---

## 6. Caso D — Pedido de acceso (ticket Medio)

**Mail entrante**: *"Necesito acceso a SAP FI"* de `maria.gonzalez@grupopettengill.com.py`

```
═══════════════════════════════════════════════════════════════
[TICKET] REQUIERE ticket -> crear en sistema externo
Mensaje: Necesito acceso a SAP - módulo FI (maria.gonzalez@grupopettengill.com.py)
Ticket a crear: {
  "titulo": "Pedido de acceso a SAP - módulo FI",
  "descripcion": "La usuaria María González solicita acceso al módulo FI de SAP por reasignación de tareas desde el 01/06. Indica que su manager aprobador es Laura Sosa (lsosa@grupopettengill.com.py).",
  "prioridad": "Media",
  "solicitante": "maria.gonzalez@grupopettengill.com.py"
}
═══════════════════════════════════════════════════════════════
```

---

## 7. Caso E — Notificación automática (no requiere)

**Mail entrante**: *"Su contraseña caducará en 5 días"* de `noreply@microsoft.com`

```
═══════════════════════════════════════════════════════════════
[TICKET] NO requiere ticket
Mensaje: Su contraseña caducará en 5 días (noreply@microsoft.com)
Motivo: Es una notificación automática de sistema (Microsoft), el usuario debe cambiar su contraseña por sí mismo.
Detalle: { ... }
═══════════════════════════════════════════════════════════════
```

---

## 8. Caso F — Mail malformado (Gemini no responde JSON)

**Log**:
```
[Nest] 1234  - 01/06/2026, 12:00:00     LOG [EmailDaemonService] Procesando [AAMkAGI2TG99...] Asunto raro (conv=AAQkAGI2TG99...)
[Nest] 1234  - 01/06/2026, 12:00:01     LOG [EmailDaemonService] Hilo de [AAMkAGI2TG99...] Asunto raro -> 1 mensaje(s)
[Nest] 1234  - 01/06/2026, 12:00:03  ERROR [GeminiService] Respuesta de Gemini no es JSON válido: Lo siento, no puedo...
[Nest] 1234  - 01/06/2026, 12:00:03  ERROR [EmailDaemonService] Falló el procesamiento de [AAMkAGI2TG99...] Asunto raro: Gemini devolvió una respuesta no-JSON
[Nest] 1234  - 01/06/2026, 12:00:03     LOG [EmailDaemonService] Ciclo finalizado en 3421ms
```

**Comportamiento**: el correo **no se marca como leído** (queda pendiente para el próximo ciclo, donde se reintentará).

---

## 9. Caso G — `markAsRead` falla después de procesar

```
[Nest] 1234  - 01/06/2026, 13:00:00     LOG [EmailDaemonService] Procesando [AAMkAGI2TGA0...] Ticket prueba (conv=AAQkAGI2TGA0...)
[Nest] 1234  - 01/06/2026, 13:00:01     LOG [EmailDaemonService] Hilo de [AAMkAGI2TGA0...] Ticket prueba -> 1 mensaje(s)
═══════════════════════════════════════════════════════════════
[TICKET] REQUIERE ticket -> crear en sistema externo
...
═══════════════════════════════════════════════════════════════
[Nest] 1234  - 01/06/2026, 13:00:03   WARN [OutlookService] No se pudo marcar como leído AAMkAGI2TGA0...: ErrorItemNotFound
[Nest] 1234  - 01/06/2026, 13:00:03     LOG [EmailDaemonService] Ciclo finalizado en 3245ms
```

**Comportamiento**: la decisión **ya fue logueada** (caso A). El mail **se va a reprocesar** en el próximo ciclo, pero como `requiere_ticket=true` se va a loguear otra vez. Si te molesta el duplicado, ver [docs/EXTENDING.md](./EXTENDING.md) para agregar persistencia de "ya procesados".

---

## 10. Convenciones del log

| Elemento | Significado |
| --- | --- |
| `[Nest] 1234` | PID del proceso |
| `01/06/2026, 10:05:01` | Timestamp |
| `LOG` / `WARN` / `ERROR` | Nivel |
| `[Context]` | Nombre del Logger (servicio) |
| `+1823ms` | Tiempo de carga (solo en InstanceLoader) |

El prefijo `[TICKET]` y los `════` se agregan desde `TicketDecisionService` para que sea fácil de `grep` en los logs:

```bash
# Ver solo decisiones de tickets
grep "\[TICKET\]" out.log

# Ver solo "requiere ticket"
grep "\[TICKET\] REQUIERE" out.log

# Extraer el JSON de cada decisión
grep -A 1000 "Estructura completa:" out.log | grep -B 1000 "^════" | head -n -1
```
