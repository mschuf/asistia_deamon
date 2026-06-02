# Operación — Cómo correr, monitorear y resolver problemas

Guía para alguien de operaciones que tiene que poner el daemon en producción, monitorearlo y resolver problemas.

---

## 1. Correr el daemon

### Requisitos

- Node.js 22 LTS
- Variables de entorno completas (ver [docs/SETUP.md](./SETUP.md))
- Permisos de red saliente a:
  - `https://graph.microsoft.com` (Microsoft Graph)
  - `https://generativelanguage.googleapis.com` (Gemini)

### Comandos

| Comando | Cuándo usarlo |
| --- | --- |
| `npm install` | Una vez, o cuando cambien las dependencias |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm run start:prod` | Arranca el daemon en modo producción (con `dist/`) |
| `npm run start:dev` | Arranca con hot-reload (ideal para desarrollar) |

### Como servicio de Windows

El proyecto está pensado para correr en una VM Windows (por el `working directory` del path). Para dejarlo como servicio:

1. **Opción A — NSSM (recomendado):**
   - Descargar [NSSM](https://nssm.cc/)
   - `nssm install AsistiaDaemon`
   - Application path: `C:\Program Files\nodejs\node.exe`
   - Startup directory: `C:\Users\carlos.morteira\Documents\asistiaDaemon`
   - Arguments: `dist/main.js`
   - En la pestaña "Environment" agregar las env vars (sin archivo .env) **o** dejar el `.env` en su lugar
   - `nssm start AsistiaDaemon`

2. **Opción B — Task Scheduler:**
   - Crear tarea que se ejecute al inicio
   - Action: `node.exe C:\...\asistiaDaemon\dist\main.js`
   - Trigger: At system startup
   - Conditions: "Start only if AC power" off, "Wake the computer" off
   - Settings: "If the task fails, restart every 1 minute"

3. **Opción C — PM2:**
   - `npm install -g pm2`
   - `pm2 start dist/main.js --name asistia-daemon`
   - `pm2 save && pm2 startup` (para que arranque con el sistema)

### Logs

Por defecto los logs van a **stdout/stderr**. Si lo corrés como servicio, redirigir a archivos:

- NSSM: en la pestaña "I/O" definir `C:\...\logs\out.log` y `C:\...\logs\err.log`
- PM2: `pm2 start ... --output C:\...\logs\out.log --error C:\...\logs\err.log`
- Manual: `node dist/main.js > out.log 2> err.log`

Recomendado: rotar los logs con una herramienta externa o con `pm2-logrotate` si usás PM2.

---

## 2. Qué mirar en los logs

### 2.1. Logs normales

```
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [InstanceLoader] AppModule dependencies initialized
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [MicrosoftAuthService] Credencial ClientSecret de Microsoft inicializada
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [GeminiService] Gemini inicializado con modelo gemini-3-flash-preview
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [EmailDaemonService] Daemon programado cada 60s. Primer ciclo inmediato...
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [EmailDaemonService] Buscando correos no leídos...
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [EmailDaemonService] No hay correos no leídos
[Nest] 1234  - 01/06/2026, 10:00:00     LOG [EmailDaemonService] Ciclo finalizado en 234ms
[Nest] 1234  - 01/06/2026, 10:00:01     LOG [Bootstrap] Asistia daemon iniciado
```

### 2.2. Logs de procesamiento

Por cada correo procesado, vas a ver dos líneas de info más el bloque de decisión:

```
[Nest] 1234  - 01/06/2026, 10:05:00     LOG [EmailDaemonService] Buscando correos no leídos...
[Nest] 1234  - 01/06/2026, 10:05:01     LOG [EmailDaemonService] Encontrados 1 correo(s) no leído(s)
[Nest] 1234  - 01/06/2026, 10:05:01     LOG [EmailDaemonService] Procesando [AAMkAGI2...] No puedo acceder al VPN (conv=AAQkAGI2...)
[Nest] 1234  - 01/06/2026, 10:05:02     LOG [EmailDaemonService] Hilo de [AAMkAGI2...] No puedo acceder al VPN -> 3 mensaje(s)
═══════════════════════════════════════════════════════════════
[TICKET] REQUIERE ticket -> crear en sistema externo
Mensaje: No puedo acceder al VPN (juan.perez@grupopettengill.com.py)
Ticket a crear: { ... }
═══════════════════════════════════════════════════════════════
[Nest] 1234  - 01/06/2026, 10:05:02     LOG [EmailDaemonService] Ciclo finalizado en 1823ms
```

Ver [docs/OUTPUT.md](./OUTPUT.md) para ejemplos completos de cada caso.

### 2.3. Logs de error (no fatales)

```
[Nest] 1234  - 01/06/2026, 10:10:00  ERROR [EmailDaemonService] Error en ciclo del daemon: ...
```

El proceso **no muere**. El próximo ciclo se intenta de nuevo.

---

## 3. Troubleshooting

### 3.1. El proceso arranca pero se cierra solo

**Síntoma**: `npm run start:prod` arranca, loguea unas líneas y se cierra.

**Causas comunes**:

1. **Faltan variables de entorno.** Vas a ver:
   ```
   Error: Faltan variables de Microsoft Graph (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET)
   ```
   Solución: revisar el `.env` o las variables de entorno del servicio.

2. **Variables mal formadas.** Si el `MS_TENANT_ID` no es un GUID, vas a ver:
   ```
   AuthenticationRequiredError: AADSTS700016 - Application identifier ... is not valid
   ```
   Solución: validar el GUID (formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

3. **Confundir el "Value" con el "Secret ID" en Azure.** El client secret tiene dos campos. Solo el "Value" sirve.

### 3.2. `Mail.Read` no está consented

**Síntoma**: en cada ciclo aparece un 403 con texto `Authorization_IdentityNotFound` o `Insufficient privileges`.

**Solución**:
1. Azure Portal → App registrations → tu app → **API permissions**
2. Confirmar que `Mail.Read` (Application, **no** Delegated) está listado
3. Confirmar que la columna "Status" dice ✅ **Granted for {tenant}**
4. Si no, click **Grant admin consent for {tenant}**

### 3.3. Buzón compartido sin permiso

**Síntoma**: 403 con `ApplicationAccessPolicyError` o `ErrorAccessDenied`.

**Solución**: ver [docs/SETUP.md §1.5](./SETUP.md). Conectarse a Exchange Online PowerShell y correr:

```powershell
Add-MailboxPermission -Identity "TI.soporte@grupopettengill.com.py" -User "{MS_CLIENT_ID}" -AccessRights FullAccess
```

### 3.4. Gemini devuelve error 400/404

**Síntoma**: en cada ciclo aparece:
```
[Nest] ... ERROR [EmailDaemonService] Error en ciclo: [GoogleGenerativeAI Error]: Error fetching from ...
```
o `models/gemini-3-flash-preview is not found`.

**Solución**:
1. Verificar que la API key es válida.
2. Si el modelo no existe, cambiar a uno disponible: `GEMINI_MODEL=gemini-2.5-flash`.
3. Si la key tiene restricciones de API (HTTP referrer, IP), agregar la IP del servidor o relajar la restricción.

### 3.5. Gemini devuelve HTML en lugar de JSON

**Síntoma**: el log muestra `Gemini devolvió una respuesta no-JSON` con un stack trace.

**Causa**: muy raro, pero puede pasar si el modelo devuelve el schema como string en lugar de aplicarlo. Casi siempre es un problema del schema declarado en el código.

**Solución**:
1. Verificar que `responseSchema` en `gemini.service.ts` es exactamente como se documenta en [docs/GEMINI-PROMPT.md](./GEMINI-PROMPT.md).
2. Probar con `temperature=0` para descartar randomness.
3. Probar el prompt en AI Studio con el mismo input para comparar.

### 3.6. Los correos no se marcan como leídos

**Síntoma**: el daemon procesa el correo (ves el log de decisión) pero al siguiente ciclo vuelve a procesar el mismo correo.

**Causa**: el `PATCH isRead: true` está fallando silenciosamente. Buscar en los logs:
```
WARN [OutlookService] No se pudo marcar como leído AAMkAGI2...: ...
```

**Solución**:
1. Verificar que el mensaje todavía existe (no lo movieron de carpeta).
2. Verificar permisos (`Mail.Read` debería alcanzar; si no, probar con `Mail.ReadWrite`).

### 3.7. Rate limit de Microsoft Graph (429)

**Síntoma**: errores intermitentes `TooManyRequests` o `Retry-After` headers.

**Causa**: con la config default (60s, 20 correos) no debería pasar, pero si subiste mucho la frecuencia, podés chocar el límite.

**Solución**:
1. Bajar `DAEMON_MAX_EMAILS` y/o subir `DAEMON_INTERVAL_SECONDS`.
2. Si necesitás más caudal, ver [docs/EXTENDING.md](./EXTENDING.md) para agregar backoff exponencial.

### 3.8. El proceso consume mucha memoria

**Síntoma**: el uso de RAM crece con el tiempo.

**Causa probable**: las respuestas de Graph se descartan después de procesar, así que no debería haber leak. Si pasa, puede ser un problema de `Node` con `experimentalDecorators` o un memory leak del SDK de Graph.

**Solución**:
1. Reiniciar el proceso periódicamente (cron en Windows o `pm2 restart`).
2. Reportar el issue con un heap dump (`node --inspect dist/main.js`).

---

## 4. Monitoreo recomendado

Como todavía no hay endpoint HTTP, las opciones son:

### 4.1. Logs a un sistema centralizado

Recomendado: redirigir stdout a un file y forwardear a:
- **Windows**: NXLog → Graylog/Elastic
- **Cloud**: CloudWatch Agent (si está en AWS)
- **Genérico**: cualquier collector que lea archivos (Fluent Bit, Filebeat, etc.)

Métricas que vale la pena trackear:
- `EmailDaemonService] Encontrados N correo(s)` → volumen de correos
- `EmailDaemonService] Ciclo finalizado en Xms` → latencia del ciclo
- `EmailDaemonService] Error en ciclo` → errores
- `EmailDaemonService] Falló el procesamiento de` → errores por correo

### 4.2. Healthcheck externo

Como el daemon no expone HTTP, una opción simple es:
- Hacer un `GET /users/{mb}/mailFolders/inbox/messages?$top=1` desde otro proceso cada 5 minutos. Si Graph responde 200, la app está sana.
- O exponer un puerto debug (ver [docs/EXTENDING.md](./EXTENDING.md)).

### 4.3. Alertas sugeridas

| Condición | Alerta |
| --- | --- |
| `grep "Error en ciclo del daemon" log.out \| wc -l > 5` en 5 min | Slack/Email |
| `grep "Encontrados 0 correo" log.out` ausente por 24h | Posible problema con Graph o mailbox |
| Proceso caído (no hay logs en 5 min) | NSSM auto-restart o monitor externo |
| `Gemini devolvió una respuesta no-JSON` | Slack |

---

## 5. Backups y recuperación

El daemon no persiste estado (excepto el `.env` con secretos). Si se pierde el `.env`:
1. Volver a generar el client secret en Azure (el viejo deja de funcionar)
2. Regenerar la API key de Gemini
3. Llenar `.env` con los nuevos valores
4. Reiniciar el servicio

No hay base de datos, no hay cache persistente. Cero estado.

---

## 6. Actualizaciones

Para actualizar el código:

```bash
cd C:\...\asistiaDaemon
git pull                       # o como traigas los cambios
npm install                    # si cambió package.json
npm run build
# Reiniciar el servicio
```

Si el cambio toca `systemInstruction` o `responseSchema` (prompt o schema de Gemini), **no hace falta tocar `.env`**.

Si el cambio toca una variable de entorno nueva, **sí hay que actualizar `.env`** y reiniciar.

---

## 7. Comandos útiles para debugging

### Probar la conexión con Microsoft Graph a mano

```bash
# Obtener token
curl -X POST "https://login.microsoftonline.com/$MS_TENANT_ID/oauth2/v2.0/token" \
  -d "grant_type=client_credentials&client_id=$MS_CLIENT_ID&client_secret=$MS_CLIENT_SECRET&scope=https://graph.microsoft.com/.default"
# (usar el access_token de la respuesta)

# Listar mensajes
curl -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/users/TI.soporte@grupopettengill.com.py/mailFolders/inbox/messages?\$top=1"
```

### Probar Gemini a mano

```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Decime OK"}]}]}'
```

### Ver el JSON que sale del daemon sin esperar al próximo ciclo

No hay endpoint HTTP todavía. La forma rápida es:
1. Bajar `DAEMON_INTERVAL_SECONDS=5` en el `.env`
2. Reiniciar
3. Mandar un mail de prueba a `TI.soporte@grupopettengill.com.py`
4. Esperar 5–10 segundos y leer los logs

Para una mejor DX, ver [docs/EXTENDING.md](./EXTENDING.md) para agregar un endpoint de debug.

---

## 8. Performance

Tiempos típicos con la config default:

| Operación | Latencia esperada |
| --- | --- |
| `getUnreadEmails()` | 200–500 ms |
| `getThread()` (1–5 mensajes) | 300–800 ms |
| `interpretThread()` (Gemini) | 1.5–3 s |
| `markAsRead()` | 150–300 ms |
| **Total por correo** | **2.5–5 s** |

Con 20 correos máximo por ciclo, el peor caso es ~100s. Con 60s de intervalo, los ciclos se superponen levemente. Como el código tiene un flag `running` que descarta ciclos solapados, no se acumula.

Si Gemini se pone lento (>5s por llamada), bajar `DAEMON_MAX_EMAILS` para acotar.
