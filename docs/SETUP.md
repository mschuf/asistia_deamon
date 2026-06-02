# Setup — Todo lo que necesitás conseguir antes de arrancar

Esta guía explica **de dónde sale cada valor** que va en `.env`. Está orientada a un admin de TI que no necesariamente conoce la API de Microsoft Graph ni Google AI Studio.

---

## Resumen de lo que necesitás

| # | Recurso | Quién lo da | Costo |
| --- | --- | --- | --- |
| 1 | Tenant de Microsoft Entra ID | El admin del tenant ya lo tiene | — |
| 2 | App Registration con `Mail.Read` (Application) | Lo creás vos (admin) o pedís al admin | — |
| 3 | Client Secret | Lo generás vos en la App Registration | — |
| 4 | Permiso sobre el buzón `TI.soporte@...` | El admin de Exchange | — |
| 5 | API key de Gemini | Lo generás vos en Google AI Studio | Free tier disponible |

Tiempo total estimado: 15–30 minutos (depende de si necesitás coordinar con el admin de Microsoft).

---

## 1. Microsoft Entra ID — App Registration

### 1.1. Crear la app

1. Ir a https://portal.azure.com
2. **Microsoft Entra ID** (antes "Azure Active Directory")
3. Menú lateral → **App registrations** → **+ New registration**
4. Llenar:
   - **Name**: `asistia-daemon` (o lo que prefieras)
   - **Supported account types**: `Accounts in this organizational directory only (Single tenant)` ← importante
   - **Redirect URI**: dejar vacío (es una app background, no web)
5. Click **Register**

### 1.2. Copiar el Tenant ID y el Client ID

En la página **Overview** de la app recién creada vas a ver:

| Campo | Valor | Variable de entorno |
| --- | --- | --- |
| **Directory (tenant) ID** | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | `MS_TENANT_ID` |
| **Application (client) ID** | `yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy` | `MS_CLIENT_ID` |

Anotá ambos.

### 1.3. Crear un Client Secret

1. Menú lateral → **Certificates & secrets**
2. Pestaña **Client secrets** → **+ New client secret**
3. Llenar:
   - **Description**: `asistia-daemon-prod` (o el entorno)
   - **Expires**: 12 meses / 24 meses (lo que permita tu política)
4. Click **Add**
5. **Copiar inmediatamente el campo "Value"** (no el "Secret ID"). El Value solo se muestra al crearlo.

⚠️ **Si no lo copiaste, tenés que borrarlo y crear uno nuevo.** No se puede volver a ver.

| Campo | Valor | Variable de entorno |
| --- | --- | --- |
| **Value** (columna) | `aBc8~xyz...` | `MS_CLIENT_SECRET` |

### 1.4. Asignar el permiso `Mail.Read` (Application)

1. Menú lateral → **API permissions**
2. **+ Add a permission**
3. Pestaña **Microsoft Graph**
4. Sección **Application permissions** (no "Delegated")
5. Buscar y tildar:
   - ✅ **Mail.Read** (lectura de correo de cualquier buzón del tenant)
6. Click **Add permissions**
7. **Grant admin consent for {tenant}** (botón arriba de la tabla) → confirmar

Verificar que la columna "Status" diga ✅ **Granted for {tenant}**.

| Permiso | Tipo | Por qué |
| --- | --- | --- |
| `Mail.Read` | Application | Leer mensajes y threads del buzón. Ya incluye el `PATCH isRead` que usamos. |

> Nota: si más adelante querés **mover** o **eliminar** correos, agregás `Mail.ReadWrite` (Application). Hoy no lo necesitamos.

### 1.5. ¿El buzón `TI.soporte@grupopettengill.com.py` es compartido?

Si es un **buzón compartido** (no tiene licencia propia, tipo "Shared Mailbox" en Exchange), hay un paso extra: la App Registration tiene que tener permiso explícito sobre ese buzón.

Conectarse a **Exchange Online PowerShell** (no Azure Portal) y correr:

```powershell
# Instalar el módulo la primera vez
Install-Module ExchangeOnlineManagement -Scope CurrentUser

# Conectar
Connect-ExchangeOnline -UserPrincipalName admin@grupopettengill.com.py

# Dar permiso a la app
Add-MailboxPermission `
  -Identity "TI.soporte@grupopettengill.com.py" `
  -User "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy" `   ← el MS_CLIENT_ID
  -AccessRights FullAccess `
  -AutoMapping $false
```

> `FullAccess` da control total. Si tu política de seguridad es estricta, `ReadPermission` es suficiente para lo que hacemos hoy, pero el permiso de aplicación Mail.Read internamente necesita FullAccess para que Graph pueda listar mensajes en buzones compartidos. **Usá FullAccess** salvo que tu equipo de seguridad diga lo contrario.

Si el buzón **sí tiene licencia** (es un usuario normal con mailbox), este paso no hace falta.

### 1.6. (Opcional) Restringir la app a un buzón específico

Por seguridad, podés crear un **Application Access Policy** en Exchange Online que limite la app a **solo** el buzón `TI.soporte@...`:

```powershell
New-ApplicationAccessPolicy `
  -AppId "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy" `
  -PolicyScopeGroupId "TI.soporte@grupopettengill.com.py" `
  -AccessRight RestrictAccess `
  -Description "Asistia daemon"
```

Después de creado, validar:

```powershell
Test-ApplicationAccessPolicy `
  -AppId "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy" `
  -Identity "TI.soporte@grupopettengill.com.py"
```

Tiene que devolver `AccessCheckResult: Allowed`.

---

## 2. Google Gemini — API key

### 2.1. Obtener la key

1. Ir a https://aistudio.google.com/apikey (requiere login con cuenta Google)
2. Click **Create API key**
3. Elegir (o crear) un proyecto GCP. Si todavía no tenés ninguno, Google te deja crear uno con la API habilitada en un click.
4. Copiar la key

| Campo | Valor | Variable de entorno |
| --- | --- | --- |
| API key | `AIzaSy...` | `GEMINI_API_KEY` |

### 2.2. Verificar que el modelo esté disponible

El daemon usa por defecto `gemini-3-flash-preview`. Para confirmar que tu proyecto lo tiene habilitado, podés hacer un test con curl:

```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Responde solo OK"}]}]}'
```

Si devuelve JSON con `"candidates"`, está habilitado. Si devuelve 404 con `models/gemini-3-flash-preview is not found`, hay que cambiar a otro modelo:

| Modelo | Disponibilidad | Costo aprox. (input) |
| --- | --- | --- |
| `gemini-3-flash-preview` | Nuevos proyectos | El más económico |
| `gemini-2.5-flash` | Estable, широко disponible | Bajo |
| `gemini-1.5-flash` | Legacy, todos los proyectos tienen | Bajo |

Cambiar con `GEMINI_MODEL=gemini-2.5-flash` en `.env`.

### 2.3. Rate limits

Free tier: ~15 RPM (requests por minuto), 1 M TPM (tokens por minuto). Más que suficiente para un daemon que corre cada 60s con 20 correos máximo por ciclo.

Si en el futuro hacen falta más RPM, habilitar facturación en https://console.cloud.google.com/billing.

---

## 3. Llenar el `.env`

Una vez que tenés los 5 valores, copiar `.env.example` a `.env` y completar:

```env
# Microsoft Graph
MS_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MS_CLIENT_ID=yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
MS_CLIENT_SECRET=aBc8~xyz123...
MS_MAILBOX=TI.soporte@grupopettengill.com.py
MS_MAIL_FOLDER=inbox

# Google Gemini
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-3-flash-preview

# Daemon
DAEMON_INTERVAL_SECONDS=60
DAEMON_MAX_EMAILS=20
```

> El `.env` está en `.gitignore`. **Nunca commitearlo.** El `.env.example` sí está commiteado y debe tener los mismos keys con valores vacíos o placeholders.

---

## 4. Checklist de validación

Antes de arrancar el daemon por primera vez, confirmar:

- [ ] `MS_TENANT_ID` es un GUID válido (formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- [ ] `MS_CLIENT_ID` es un GUID válido
- [ ] `MS_CLIENT_SECRET` tiene el formato `xxx~xxxxx` (no confundir con el "Secret ID")
- [ ] En **API permissions** de la app: `Mail.Read` está listado y dice **Granted**
- [ ] Si el buzón es compartido: `Add-MailboxPermission` se ejecutó sin error
- [ ] (Recomendado) `Test-ApplicationAccessPolicy` devuelve **Allowed**
- [ ] `MS_MAILBOX` es exactamente `TI.soporte@grupopettengill.com.py` (sin espacios, mayúsculas ok)
- [ ] `GEMINI_API_KEY` responde OK al test de curl
- [ ] `GEMINI_MODEL` es un modelo que tu proyecto tiene habilitado

Si todo está bien, `npm run build && npm run start:prod` debería arrancar y empezar a loguear ciclos (la primera ejecución devuelve "No hay correos no leídos" si la bandeja está vacía).
