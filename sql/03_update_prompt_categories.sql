-- =====================================================================
-- 03_update_prompt_categories.sql
-- ---------------------------------------------------------------------
-- Reemplaza el prompt EXISTENTE (no inserta uno nuevo) para que la IA:
--   1) Siga decidiendo si el correo requiere ticket (requiere_ticket).
--   2) Cuando requiere ticket, elija una categoria del catalogo y la
--      devuelva en ticket_data.categoria_id (con su categoria_nombre).
--      Si ninguna categoria aplica con claridad, debe usar 66.
--
-- El daemon valida igualmente el categoria_id contra el catalogo y, si
-- no es valido, usa el default (66 / TICKET_DEFAULT_CATEGORY_ID).
--
-- Ejecucion:
--   psql -U postgres -d asistia_back -f sql/03_update_prompt_categories.sql
--
-- Se usa dollar-quoting ($sys$...$sys$ y $tpl$...$tpl$) para no tener que
-- escapar comillas dentro del texto del prompt.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Paso 0 (opcional): ver los prompts actuales antes de reemplazarlos.
-- ---------------------------------------------------------------------
-- SELECT id, company_id, left(system_instruction, 60) AS sys_preview, updated_at
-- FROM prompt
-- ORDER BY company_id;

BEGIN;

-- ---------------------------------------------------------------------
-- Paso 1: reemplazar el contenido del/los prompt(s) existentes.
--
-- Por defecto actualiza TODAS las filas de la tabla prompt (una por
-- empresa). Si solo queres actualizar una empresa puntual, descomenta
-- el bloque WHERE del final del UPDATE.
-- ---------------------------------------------------------------------
UPDATE prompt
SET
  system_instruction = $sys$Sos un asistente que clasifica correos electronicos de una casilla de soporte de TI y prepara los datos para crear un ticket.
Devolves exclusivamente JSON valido con la estructura solicitada, sin texto adicional.

Cuando NO requiere ticket (requiere_ticket=false):
- Correos automaticos, rebotes, notificaciones de sistema, newsletters o correos masivos.
- Agradecimientos, confirmaciones o respuestas sin un pedido nuevo.
- Mensajes que no describen un problema concreto que necesite intervencion del equipo de soporte.

Cuando SI requiere ticket (requiere_ticket=true):
- Una falla, un pedido de acceso, una solicitud de cambio o un pedido de soporte.
- Completa ticket_data con datos utiles y concisos.
- ticket_data.solicitante debe ser el email de la persona que reporta el problema, nunca el buzon de soporte.
- ticket_data.categoria_id debe ser uno de los ids del catalogo de categorias que figura en el mensaje. Elegi la categoria que mejor describe el problema. Si ninguna aplica con claridad, usa 66.
- ticket_data.categoria_nombre debe ser el nombre exacto de la categoria elegida.$sys$,
  prompt_template = $tpl$Analiza el siguiente hilo de correos electronicos.
El hilo viene en orden descendente: {{message_order}}.
El primer mensaje listado es el mas reciente.
Empresa: {{company_name}}
Buzon monitoreado: {{mailbox}}
Asunto: {{thread_subject}}
ConversationId: {{conversation_id}}

Hilo completo:
"""
{{thread_messages}}
"""

Email del solicitante mas reciente relevante: {{requester_email}}

Catalogo de categorias (elegi una para ticket_data.categoria_id):
- 65: Software: Office, Windows, SAP, Aplicaciones
- 66: Hardware: PC, notebook, conectores
- 67: Internet, red, cableados, accesos
- 68: Servidor, Switch, AD, Forti, Enlaces, Cloud
- 69: Telefonia movil, fija, internos
- 70: CCTV, camaras, DVR, TV, proyectores
- 71: Impresoras, papel, toner, conexion

Recorda:
- ticket_data.solicitante debe ser el email del usuario que reporta el problema, no el buzon de soporte.
- Si el correo es un rebote, notificacion automatica, respuesta de sistema o confirmacion sin pedido nuevo, usa requiere_ticket=false.
- Si requiere ticket, el titulo debe ser breve y la descripcion debe resumir el problema con contexto suficiente para que el equipo de soporte pueda actuar.
- Elegi ticket_data.categoria_id del catalogo de arriba. Si ninguna categoria aplica con claridad, usa 66. Devolve tambien ticket_data.categoria_nombre con el nombre exacto de la categoria elegida.$tpl$
-- WHERE company_id = (SELECT id FROM companies WHERE name = 'Grupo Pettengill')
;

-- ---------------------------------------------------------------------
-- Paso 2: verificar el resultado (debe mostrar 1 fila por empresa, con
-- updated_at recien actualizado). Revisa esto ANTES de confirmar.
-- ---------------------------------------------------------------------
SELECT
  id,
  company_id,
  left(system_instruction, 70) AS sys_preview,
  left(prompt_template, 70)    AS tpl_preview,
  updated_at
FROM prompt
ORDER BY company_id;

-- ---------------------------------------------------------------------
-- Paso 3: si la verificacion es correcta, confirma la transaccion.
-- Si algo salio mal, ejecuta ROLLBACK; en lugar de COMMIT;
-- ---------------------------------------------------------------------
COMMIT;
