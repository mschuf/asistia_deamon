# Configuración — Variables de entorno

Referencia completa de todas las variables que lee el daemon. Las obligatorias están marcadas con 🔴.

---

## Microsoft Graph

| Variable | Tipo | Default | Obligatoria | Descripción |
| --- | --- | --- | --- | --- |
| 🔴 `MS_TENANT_ID` | UUID | — | sí | Tenant de Microsoft Entra ID. En Azure Portal → Entra ID → App registration → Overview → *Directory (tenant) ID*. Formato: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. |
| 🔴 `MS_CLIENT_ID` | UUID | — | sí | Application (client) ID de la App Registration. Misma página → *Application (client) ID*. |
| 🔴 `MS_CLIENT_SECRET` | string | — | sí | Value del Client Secret. Solo se muestra al crearlo. Formato típico: `aBc8~xxxxx`. |
| `MS_MAILBOX` | string | `TI.soporte@grupopettengill.com.py` | no* | UPN o email del buzón a leer. *El default ya está apuntando al buzón de soporte, pero podés cambiarlo.* |
| `MS_MAIL_FOLDER` | string | `inbox` | no | Nombre de la carpeta a leer. Valores comunes: `inbox`, `junkemail`, `archive`, `sentitems`. **Case-sensitive** según el `well-known name` de Graph. |

### Validación de formato (lo que valida el código al iniciar)

```ts
if (!tenantId || !clientId || !clientSecret) {
  throw new Error('Faltan variables de Microsoft Graph (...)');
}
```

No valida que el GUID sea "real" — eso lo valida Azure AD al pedir el token. Si el formato está mal, vas a ver un error `AADSTS700016 Application identifier ... is not valid`.

### Permisos requeridos en Azure AD (Application)

| Permiso | Usado para |
| --- | --- |
| `Mail.Read` | `GET /users/{mb}/mailFolders/.../messages` y `GET /users/{mb}/messages` (filtro por conversationId) |
| `Mail.Read` (también cubre) | `PATCH /users/{mb}/messages/{id} { isRead: true }` |

No se necesita `Mail.ReadWrite` salvo que en el futuro queramos mover o eliminar correos.

---

## Google Gemini

| Variable | Tipo | Default | Obligatoria | Descripción |
| --- | --- | --- | --- | --- |
| 🔴 `GEMINI_API_KEY` | string | — | sí | API key de Google AI Studio. https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | string | `gemini-3-flash-preview` | no | Modelo a usar. Si `3 Flash` no está disponible, usar `gemini-2.5-flash` o `gemini-1.5-flash`. |

### Validación

```ts
if (!apiKey) throw new Error('Falta GEMINI_API_KEY en las variables de entorno');
```

### Parámetros del modelo (hardcodeados en el código)

| Parámetro | Valor | Por qué |
| --- | --- | --- |
| `responseMimeType` | `application/json` | Fuerza JSON como salida |
| `responseSchema` | (ver [docs/GEMINI-PROMPT.md](./GEMINI-PROMPT.md)) | Garantiza estructura |
| `temperature` | `0.2` | Clasificación determinística, no creativa |
| `systemInstruction` | (ver doc) | Reglas de negocio |

Si querés experimentar, esos están en `src/gemini/gemini.service.ts`.

---

## Daemon

| Variable | Tipo | Default | Obligatoria | Descripción |
| --- | --- | --- | --- | --- |
| `DAEMON_INTERVAL_SECONDS` | int | `60` | no | Cada cuántos segundos se ejecuta el ciclo. **Mínimo efectivo: 5** (valores menores se redondean a 5). |
| `DAEMON_MAX_EMAILS` | int | `20` | no | Máximo de correos no leídos a procesar **por empresa** en cada ciclo. Sirve para no quedar atrapado si alguien manda 500 correos de golpe. |

### Tiempos orientativos

| Intervalo | Comportamiento esperado |
| --- | --- |
| `5–10` | Casi tiempo real. Útil para testing. Puede gastar quota de Gemini. |
| `30–60` | **Default recomendado.** Balance entre latencia y consumo. |
| `120–300` | Aceptable para soporte que no es crítico en minutos. |
| `>600` | Solo si el SLA es de horas. |

### Procesamiento de acumulados

Si llegan 50 correos a una empresa en un ciclo y `DAEMON_MAX_EMAILS=20`, **se procesan 20 de esa empresa y los otros 30 quedan para el próximo ciclo**. No se pierden — siguen como `isRead=false`. El ciclo siguiente los agarra (aunque se hayan mandado hace 2 minutos).

Si querés evitar ese "retraso" cuando llega un pico, subí `DAEMON_MAX_EMAILS` o bajá `DAEMON_INTERVAL_SECONDS`.

---

## Archivo `.env` de ejemplo

El archivo `.env.example` commiteado en el repo tiene:

```env
MS_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MS_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MS_CLIENT_SECRET=your_client_secret_value
MS_MAILBOX=TI.soporte@grupopettengill.com.py
MS_MAIL_FOLDER=inbox
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3-flash-preview
DAEMON_INTERVAL_SECONDS=60
DAEMON_MAX_EMAILS=20
```

Tu `.env` local debe tener los mismos keys con los valores reales. Ver [docs/SETUP.md](./SETUP.md) para conseguirlos.

---

## Tipos TypeScript generados

El archivo `src/config/configuration.ts` exporta el tipo `AppConfig`. Si querés autocompletado en VSCode de las env vars, importá el tipo:

```ts
import { AppConfig } from './config/configuration';
```

Pero no hace falta tocar el código para agregar/quitar variables — solo editar `configuration.ts` y el `.env`.

---

## Carga de la configuración

`@nestjs/config` carga el `.env` automáticamente al iniciar, antes de instanciar cualquier servicio. El `forRoot` está en `app.module.ts`:

```ts
ConfigModule.forRoot({
  isGlobal: true,
  load: [configuration],
})
```

- `isGlobal: true` → no hay que importar `ConfigModule` en cada submódulo
- `load: [configuration]` → nuestra función que retorna el objeto tipado

Para acceder:

```ts
constructor(private config: ConfigService) {
  const mailbox = this.config.get<string>('microsoft.mailbox');
}
```

Los paths siguen la estructura del objeto retornado: `microsoft.tenantId`, `gemini.model`, `daemon.intervalSeconds`.
