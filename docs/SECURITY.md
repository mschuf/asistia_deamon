# Seguridad — Secretos, PII, permisos, consideraciones

Recolección de todo lo que hay que tener en cuenta desde el punto de vista de seguridad para correr este daemon en producción.

---

## 1. Secretos

### 1.1. Qué se considera secreto

| Secreto | Variable de entorno | Criticidad |
| --- | --- | --- |
| Client secret de Azure | `MS_CLIENT_SECRET` | **Alta** — acceso al buzón completo |
| API key de Gemini | `GEMINI_API_KEY` | **Media** — acceso a la API de Gemini, posible abuso de quota |
| (futuro) API key del sistema de tickets | `TICKETS_API_KEY` | Alta |

El `MS_CLIENT_ID` y `MS_TENANT_ID` no son sensibles por sí solos (son identificadores públicos de la app), pero igual los trato como información no pública en este documento.

### 1.2. Cómo NO manejar los secretos

- ❌ Commitear el `.env` al repositorio (ya está en `.gitignore`).
- ❌ Pegar el client secret en un ticket, email, chat.
- ❌ Dejar el `.env` con permisos world-readable en el filesystem.
- ❌ Loguear las variables de entorno al arrancar.
- ❌ Imprimir el `MS_CLIENT_SECRET` en ningún log, ni siquiera parcial.

### 1.3. Cómo SÍ manejar los secretos

| Entorno | Método recomendado |
| --- | --- |
| **Desarrollo local** | `.env` con permisos `chmod 600` (Linux) o propiedades NTFS restrictivas (Windows). |
| **Producción en VM Windows** | NSSM con "Environment" en la configuración del servicio (no usar `.env` en el filesystem de prod). |
| **Producción en Linux** | Variables de entorno del systemd unit (`Environment=` en el `.service`), o un secret manager (HashiCorp Vault, Azure Key Vault, AWS Secrets Manager). |
| **Producción en Docker** | Docker secrets o `env_file:` con permisos restrictivos. |
| **Producción en Kubernetes** | `Secret` montado como variable de entorno o como volume. |

### 1.4. Rotación

- **Client secret de Azure**: rotar cada 6–12 meses (o según política de la empresa). Generar el nuevo, actualizar la env var del servicio, reiniciar. El viejo se puede eliminar después de confirmar que todo funciona.
- **API key de Gemini**: rotar si hay sospecha de compromiso. La free tier permite hasta 2 keys activas por proyecto.
- **`.env.example`**: nunca tiene valores reales. Solo placeholders. Asegurarse en cada PR de que sigue así.

---

## 2. Datos personales (PII)

### 2.1. Qué PII procesa el daemon

| Dato | Origen | Dónde va |
| --- | --- | --- |
| Dirección de email del remitente | `from.emailAddress.address` (Graph) | Log local + prompt de Gemini |
| Nombre del remitente | `from.emailAddress.name` (Graph) | Log local + prompt de Gemini |
| Asunto del correo | Graph | Log local + prompt de Gemini |
| Cuerpo del correo | Graph | Prompt de Gemini (no se loguea por default, pero podría en errores) |
| Email de todos los participantes del hilo | Graph | Prompt de Gemini |
| `conversationId`, `messageId` | Graph | Log local |

### 2.2. Dónde terminan los datos

| Destino | Datos enviados | Persistencia del lado del proveedor |
| --- | --- | --- |
| Microsoft Graph API | (origen) | Según la política de Microsoft / del tenant |
| Google Gemini API | Hilo completo del correo | Según los términos de Google. Por default **no se usa para entrenar**. Google retiene por hasta 55 días para abuse monitoring. |
| Logs locales del daemon | Asunto, remitente, decisión de Gemini | Mientras el archivo de log exista. |
| Sistema de tickets (futuro) | `ticket_data` (título, descripción, prioridad, solicitante) | Según el sistema (Jira, GLPI, etc.) |

### 2.3. Consideraciones

- **Cumplimiento**: si Grupo Pettengill tiene políticas de PII / GDPR / ley de datos personales de Paraguay (Ley 1682/2001, Ley 6534/2020), tener en cuenta que el contenido de los correos se envía a Google. Consultar con legal si esto requiere disclosure o consentimiento.
- **Logs**: los logs quedan en disco. Si se forwardean a un sistema centralizado (Graylog, CloudWatch), el contenido viaja. **Recomendado**: sanitizar el `body` antes de loguear errores (hoy el código loguea el error pero no el cuerpo del correo).
- **Acceso al log**: limitar quién puede ver los archivos de log a personal autorizado de TI.

---

## 3. Permisos de la App Registration (principio de menor privilegio)

Hoy la app tiene `Mail.Read` (Application). Eso le da **acceso a leer TODOS los buzones del tenant**, no solo el de soporte. Para limitar:

### 3.1. `ApplicationAccessPolicy` (recomendado)

Ya documentado en [docs/SETUP.md §1.6](./SETUP.md). Con esto la app solo puede leer el buzón `TI.soporte@...` y nada más.

```powershell
New-ApplicationAccessPolicy `
  -AppId "{MS_CLIENT_ID}" `
  -PolicyScopeGroupId "TI.soporte@grupopettengill.com.py" `
  -AccessRight RestrictAccess
```

### 3.2. Permisos que NO se necesitan (y no se deben pedir)

- `Mail.ReadWrite` — no modificamos contenido, solo `isRead`. No lo agregues.
- `Mail.Send` — el daemon no envía mails.
- `Mail.ReadBasic` — versión "lite" que no incluye `body`. No nos sirve.
- `User.Read.All`, `Directory.Read.All` — no leemos info de usuarios, solo mails.

### 3.3. Audit logging

Microsoft 365 Unified Audit Log registra todas las operaciones de la app. Si tienen el log activado, van a poder ver qué leíó la app, cuándo y desde qué IP. Útil para detectar accesos indebidos.

Ver: https://learn.microsoft.com/en-us/microsoft-365/compliance/audit-log-retention-policies

---

## 4. Permisos del buzón

Si el buzón es compartido, el paso de `Add-MailboxPermission` (ver [docs/SETUP.md §1.5](./SETUP.md)) le da a la app acceso al buzón. Esos permisos son auditables en Exchange.

`FullAccess` da control total (incluyendo borrar). `ReadPermission` es más restrictivo pero Microsoft Graph internamente requiere FullAccess para algunas operaciones en buzones compartidos. La elección depende de la política de seguridad de la empresa.

---

## 5. Seguridad del transporte

- Toda la comunicación con **Microsoft Graph** va sobre HTTPS. TLS 1.2+.
- Toda la comunicación con **Gemini** va sobre HTTPS. TLS 1.2+.
- El daemon no acepta conexiones entrantes (es ApplicationContext, no HTTP server) — superficie de ataque mínima.
- Si en el futuro se agrega el endpoint de debug HTTP (ver [docs/EXTENDING.md §3](./EXTENDING.md)), **no exponerlo a internet**. Solo accesible desde la red interna.

---

## 6. Dependencias

El proyecto tiene ~15 dependencias transitivas. Para mantenerlas actualizadas:

```bash
npm outdated
npm update
npm audit
npm audit fix
```

Recomendaciones:
- Correr `npm audit` en cada build de producción
- Suscribirse a GitHub Security Advisories del repo
- Considerar **Dependabot** (GitHub) o **Renovate** para PRs automáticos de updates
- En producción, lockear versiones con `package-lock.json` (ya está)

### Pin de versiones

`package.json` actual usa `^` (caret), que permite minor updates automáticos. Para producción crítica, cambiar a versiones fijas:

```json
"@nestjs/common": "10.4.15",
```

Esto evita que un update menor rompa algo en producción. Update manualmente con `npm install <pkg>@latest`.

---

## 7. Logs y auditoría

### 7.1. Qué se loguea hoy

- IDs de mensajes y conversaciones (no PII directa)
- Asunto del correo (PII)
- Email y nombre del remitente (PII)
- Decisión de Gemini (incluye resumen que puede contener info del correo)
- Duración de cada ciclo

### 7.2. Qué NO se loguea

- El `MS_CLIENT_SECRET` ni ninguna credencial
- El cuerpo completo del correo (solo en errores catastróficos de Gemini, que se loguea como `[GoogleGenerativeAI Error]: ...` — revisar si la librería incluye el prompt en el error)

### 7.3. Recomendaciones

- No subir logs a repositorios.
- Si se comparte un log para debugging, **redactar** emails, nombres, asuntos, y bodies.
- Implementar **log retention** (rotar / borrar logs viejos, ej. 90 días).
- Para auditoría más estricta, considerar un logger estructurado (Winston + formato JSON) que se pueda ingestar en SIEM.

---

## 8. Rate limiting y abuso

- **Microsoft Graph**: throttling de Microsoft. Ver [docs/GRAPH-ENDPOINTS.md](./GRAPH-ENDPOINTS.md). El daemon no implementa backoff hoy, pero con la config default (60s, 20 correos) está muy lejos de los límites.
- **Gemini**: 15 RPM en free tier. El daemon hace máximo 20 requests por minuto (si todos los correos son no leídos y todos se procesan en paralelo). Con el flag `running` que descarta ciclos solapados, está OK, pero en el peor caso podría acercarse al límite. Si se pasa, agregar un `setTimeout` entre correos.
- **Costos**: el daemon puede gastar créditos de Gemini si alguien manda 1000 correos. Monitorear con https://aistudio.google.com/usage.

---

## 9. Manejo de errores que podrían filtrar info

- Los mensajes de error de Graph SDK pueden incluir el `resource` que se pidió. Si el resource incluye el `conversationId` (no es PII per se, pero es metadata), aceptable.
- Los mensajes de error de Gemini pueden incluir el prompt enviado. **Esto SÍ es PII**. Hoy no logueamos la respuesta cruda salvo cuando falla el JSON parse, en cuyo caso se loguea el texto (que NO debería incluir el prompt, pero podría según la versión del SDK). Para estar seguros:

```ts
// En gemini.service.ts, donde se loguea el error:
this.logger.error(`Respuesta de Gemini no es JSON válido: ${text.slice(0, 500)}`);
```

Considerar truncar más agresivamente o hashear el contenido para debugging sin exponer.

---

## 10. Compliance checklist (resumen)

Antes de producción, verificar:

- [ ] `.env` en `.gitignore` y no commiteado
- [ ] `.env` con permisos restrictivos en el server
- [ ] Client secret rotado según política de la empresa
- [ ] `Mail.Read` (Application) **sin `Mail.ReadWrite`**, `Mail.Send`, etc.
- [ ] `ApplicationAccessPolicy` creado (recomendado)
- [ ] Audit log activado en el tenant de Microsoft 365
- [ ] Logs con retention definida (no eternos en disco)
- [ ] Si aplica: consentimiento legal para envío de correos a Gemini
- [ ] `npm audit` sin vulnerabilidades críticas
- [ ] Variables de entorno del servicio sin valores por default que funcionen (es decir, si alguien borra el `.env` el proceso debe fallar al arrancar, no arrancar con config vacía)

---

## 11. Reportar incidentes

Si se sospecha compromiso de una credencial:

1. **Inmediato**:
   - Revocar el secret en Azure: App Registration → Certificates & secrets → Delete
   - Regenerar la API key de Gemini: https://aistudio.google.com/apikey
   - Revisar audit logs de M365 para ver qué hizo la app
2. **Corto plazo**:
   - Generar nuevas credenciales
   - Actualizar las env vars del servicio
   - Reiniciar el daemon
3. **Post-mortem**:
   - ¿Cómo se filtró?
   - ¿Qué datos fueron accedidos?
   - ¿Notificar a legal / DPO si aplica?
