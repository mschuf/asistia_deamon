# Microsoft Graph — Endpoints consumidos

Lista exhaustiva de los endpoints de la API de Microsoft Graph que usa el daemon, con los query strings exactos, los permisos requeridos y la respuesta esperada.

Base URL: `https://graph.microsoft.com/v1.0` (versión estable, no beta).

Autenticación: **Client Credentials** con `ClientSecretCredential` (`@azure/identity`). Token scope: `https://graph.microsoft.com/.default`.

---

## Resumen

| # | Operación | Método | Endpoint | Permiso |
| --- | --- | --- | --- | --- |
| 1 | Listar no leídos | `GET` | `/users/{mailbox}/mailFolders/{folder}/messages` | `Mail.Read` |
| 2 | Listar mensajes de un hilo | `GET` | `/users/{mailbox}/messages` (con `$filter` por `conversationId`) | `Mail.Read` |
| 3 | Marcar como leído | `PATCH` | `/users/{mailbox}/messages/{messageId}` | `Mail.Read` |

> No usamos `/me` porque el daemon es una **aplicación con identidad propia** (no impersona a un usuario). Por eso el path es siempre `/users/{mailbox}/...`.

---

## 1. `getUnreadEmails()`

### Request

```
GET https://graph.microsoft.com/v1.0/users/TI.soporte@grupopettengill.com.py/mailFolders/inbox/messages
  ?$filter=isRead eq false
  &$orderby=receivedDateTime desc
  &$top=20
  &$select=id,conversationId,subject,bodyPreview,receivedDateTime,from,isRead,body
Authorization: Bearer {token}
```

### Query string detalle

| Param | Valor | Por qué |
| --- | --- | --- |
| `$filter` | `isRead eq false` | Solo no leídos. Sin esto traeríamos toda la bandeja. |
| `$orderby` | `receivedDateTime desc` | Procesar primero los correos más nuevos. |
| `$top` | `{DAEMON_MAX_EMAILS}` (default 20) | Límite duro por empresa para no traer miles. |
| `$select` | (ver arriba) | Solo los campos que necesitamos. **Importante**: el `body` no viene por default, hay que pedirlo explícitamente. |

### Response (200 OK)

```json
{
  "value": [
    {
      "id": "AAMkAGI2...",
      "conversationId": "AAQkAGI2...",
      "subject": "No puedo acceder al VPN",
      "bodyPreview": "Hola, desde esta mañana...",
      "receivedDateTime": "2026-05-31T14:23:11Z",
      "from": {
        "emailAddress": {
          "name": "Juan Pérez",
          "address": "juan.perez@grupopettengill.com.py"
        }
      },
      "isRead": false,
      "body": {
        "contentType": "HTML",
        "content": "<html><body><p>Hola, ...</p></body></html>"
      }
    }
  ],
  "@odata.nextLink": null
}
```

Si hay más resultados (paginación), Graph devuelve `@odata.nextLink` con la URL del siguiente page. **Hoy no lo manejamos** porque `$top=DAEMON_MAX_EMAILS` ya limita. Si se quiere más de 20, agregar paginación en `outlook.service.ts`.

### Errores comunes

| Status | Código | Causa | Solución |
| --- | --- | --- | --- |
| 401 | `AuthenticationRequiredError` | Token inválido o expirado | El SDK renueva el token automáticamente. Si persiste, revisar `MS_TENANT_ID`/`MS_CLIENT_ID`/`MS_CLIENT_SECRET`. |
| 403 | `Authorization_IdentityNotFound` | La app no tiene permiso sobre este buzón | Ver [docs/SETUP.md §1.5](./SETUP.md) — `Add-MailboxPermission` si es buzón compartido. |
| 403 | `ApplicationAccessPolicyError` | Hay una `ApplicationAccessPolicy` que bloquea | `Test-ApplicationAccessPolicy` para validar. |
| 404 | `ErrorItemNotFound` | El buzón no existe o el folder no existe | Revisar `MS_MAILBOX` y `MS_MAIL_FOLDER`. El folder es case-sensitive (`inbox` no `Inbox`). |
| 429 | `TooManyRequests` | Rate limit | Backoff exponencial. Hoy no lo manejamos explícitamente — el daemon lo loguea y reintenta en el próximo ciclo. |

---

## 2. `getThread(conversationId)`

### Request

```
GET https://graph.microsoft.com/v1.0/users/TI.soporte@grupopettengill.com.py/messages
  ?$filter=conversationId eq 'AAQkAGI2...'
  &$select=id,conversationId,subject,bodyPreview,receivedDateTime,from,isRead,body
Authorization: Bearer {token}
```

### Detalles

- Filtramos por `conversationId` (string) en OData. Las comillas simples del valor van escapadas como `''` por seguridad (lo hace `outlook.service.ts`).
- Pedimos el mismo `body` que en la operación 1 para tener el contenido completo.
- No pedimos `$orderby` en Graph para esta consulta: en algunos buzones, combinar `conversationId` con ordenamiento devuelve `The restriction or sort order is too complex for this operation`.
- En el código, después del GET, **ordenamos** por `receivedDateTime` descendente en memoria.

### Por qué no usar `/conversations/{id}/threads`

Microsoft expone un endpoint alternativo:

```
GET /users/{mb}/conversations/{conversationId}/threads
```

Más pesado, devuelve más metadata, y requiere permisos de **Exchange** adicionales para buzones compartidos. `conversationId` con `$filter` es la forma soportada oficialmente para casos de app-only.

### Response

Igual que en operación 1, pero con `value` siendo todos los mensajes del hilo (los nuestros + los del cliente + los que respondieron).

### Errores comunes

Igual que operación 1. Adicional:

| Status | Código | Causa | Solución |
| --- | --- | --- | --- |
| 400 | `InvalidFilter` | El `conversationId` tiene caracteres raros | El código escapa comillas. Si ves este error, probablemente el `id` tiene un `'` literal — revisar. |

---

## 3. `markAsRead(messageId)`

### Request

```
PATCH https://graph.microsoft.com/v1.0/users/TI.soporte@grupopettengill.com.py/messages/AAMkAGI2...
Content-Type: application/json
Authorization: Bearer {token}

{ "isRead": true }
```

### Detalles

- `PATCH` con un body mínimo (solo el campo que cambia).
- `Mail.Read` (Application) **sí permite** modificar `isRead`. Si en algún momento necesitamos modificar otros campos, hay que escalar a `Mail.ReadWrite`.
- Si la operación falla, el código loguea un warning pero **no hace rollback de la decisión de Gemini**. Razón: la decisión ya fue logueada; si re-procesamos, Gemini va a decir "no requiere ticket" otra vez, así que no se pierde info.

### Response

`204 No Content` si todo OK. Cualquier otro status se considera fallo y se loguea.

### Errores comunes

| Status | Código | Causa | Solución |
| --- | --- | --- | --- |
| 404 | `ErrorItemNotFound` | El mensaje ya no existe (lo borraron, lo movieron, etc.) | Ignorable, se loguea como warning. |
| 403 | `ErrorAccessDenied` | Token no tiene permiso de escritura | Confirmar `Mail.Read` (no `Mail.ReadBasic`). |

---

## Throttling

Microsoft Graph tiene un throttling agresivo. Si venís de hacer muchas requests por minuto podés recibir 429. El daemon hoy **no hace backoff explícito** — si pasa, se loguea y se reintenta en el próximo ciclo. En la práctica con `DAEMON_INTERVAL_SECONDS=60` y `DAEMON_MAX_EMAILS=20` no se llega a los límites.

Si en el futuro se necesita, agregar lógica de retry con backoff exponencial en `outlook.service.ts` (ver [docs/EXTENDING.md](./EXTENDING.md)).

---

## Versiones de la API

Usamos `v1.0` (estable). Si en algún momento necesitamos un endpoint que solo está en beta (por ejemplo, `extendedProperties`), cambiar la constante en el cliente Graph:

```ts
this.client = Client.initWithMiddleware({
  authProvider: ...,
  defaultVersion: 'beta',
});
```

No es necesario hoy.

---

## Referencias oficiales

- [List messages in a mail folder](https://learn.microsoft.com/en-us/graph/api/user-list-messages)
- [List messages with $filter](https://learn.microsoft.com/en-us/graph/query-parameters#filter-parameter)
- [Update message (PATCH)](https://learn.microsoft.com/en-us/graph/api/message-update)
- [Application permissions for mail](https://learn.microsoft.com/en-us/graph/permissions-reference#mail-permissions)
- [Throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)
