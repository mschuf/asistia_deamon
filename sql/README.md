# PostgreSQL schema

Base de datos: `asistia_back`.

Ejecucion:

```bash
psql -U postgres -f sql/00_create_database.sql
psql -U postgres -d asistia_back -f sql/01_create_schema.sql
```

Si ya tenes la base creada y solo queres quitar la configuracion de daemon desde `companies`:

```bash
psql -U postgres -d asistia_back -f sql/02_drop_company_daemon_config.sql
```

Para **reemplazar el prompt existente** por la version que elige categoria de ticket
(`ticket_data.categoria_id`) sin recrear el esquema:

```bash
psql -U postgres -d asistia_back -f sql/03_update_prompt_categories.sql
```

Para actualizar el prompt a la version que ademas devuelve `ticket_data.type`
con `request` o `incident`:

```bash
psql -U postgres -d asistia_back -f sql/04_update_prompt_ticket_type.sql
```

Hace `UPDATE prompt` (no inserta filas nuevas), corre dentro de una transaccion y muestra
una verificacion antes del `COMMIT`. El texto base esta en `prompts/default-ticket-classifier.md`.

Tablas principales:

- `companies`: empresas/clientes, con su propia conexion Microsoft Graph.
- `prompt`: prompt activo por empresa para Gemini.
- `daemon_runs`: cada ciclo del daemon por empresa.
- `mail_messages`: identificadores y datos basicos del correo para poder buscarlo despues.
- `email_processing_attempts`: resultado de procesar un correo.
- `ai_interactions`: prompt enviado a Gemini, resumen, respuesta cruda y decision parseada.
- `app_logs`: logs estructurados de exito/error con `company_id`.

Ejemplo de alta de empresa:

```sql
INSERT INTO companies (
  name,
  ms_tenant_id,
  ms_client_id,
  ms_client_secret,
  ms_mailbox,
  ms_mail_folder
) VALUES (
  'Grupo Pettengill',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  'guardar-cifrado-o-usar-secrets-manager',
  'TI.soporte@grupopettengill.com.py',
  'inbox'
);
```

Luego insertar un prompt para esa empresa. El texto base esta en
`prompts/default-ticket-classifier.md`.

```sql
INSERT INTO prompt (
  company_id,
  system_instruction,
  prompt_template
)
SELECT
  id,
  'PEGAR ACA EL BLOQUE system_instruction DEL MARKDOWN',
  'PEGAR ACA EL BLOQUE prompt_template DEL MARKDOWN'
FROM companies
WHERE name = 'Grupo Pettengill';
```

El daemon solamente toma empresas activas que tengan un prompt cargado.

## Por que no hay `slug`

No hace falta para el daemon: no exponemos una API publica ni rutas amigables por empresa. Para identificar una empresa internamente alcanza con `companies.id`; para mostrarla en logs alcanza con `companies.name`. Si despues se agrega una API web o panel administrativo, ahi si puede tener sentido volver a agregar un `slug`.

Nota de seguridad: `ms_client_secret`, `prompt_text`, `response_text` y los JSON de decision pueden contener datos sensibles. En produccion conviene cifrar secretos antes de guardarlos y definir una politica de retencion para prompts/respuestas.
