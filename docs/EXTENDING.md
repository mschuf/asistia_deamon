# Extending — Cómo conectar al sistema de tickets real y otros agregados

Recetas concretas para extender el daemon. Cada sección es autocontenida: podés aplicar una sola sin tocar el resto.

---

## 1. Conectar con el sistema de tickets (caso más común)

Hoy `TicketDecisionService.report()` solo loguea. Para enviar el ticket al sistema externo, modificar el método.

### 1.1. Estructura actual de la decisión

`GeminiService.interpretThread()` devuelve:

```ts
{
  requiere_ticket: boolean,
  motivo: string,
  ticket_data: {
    titulo: string,
    descripcion: string,
    prioridad: 'Alta' | 'Media' | 'Baja',
    solicitante: string,
  }
}
```

Esa estructura es la que el sistema de tickets debería consumir. Si tu sistema espera otros campos, mapeá en el reporter.

### 1.2. Implementación con `@nestjs/axios`

```bash
npm install @nestjs/axios axios
```

Agregar el módulo en `daemon.module.ts`:

```ts
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [MicrosoftModule, GeminiModule, HttpModule],
  providers: [EmailDaemonService, TicketDecisionService],
  exports: [EmailDaemonService],
})
export class DaemonModule {}
```

Modificar `ticket-decision.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EmailMessage, EmailThread } from '../microsoft/types';
import { GeminiDecision } from '../gemini/gemini.service';

@Injectable()
export class TicketDecisionService {
  private readonly logger = new Logger(TicketDecisionService.name);
  private readonly ticketsUrl: string;
  private readonly ticketsApiKey: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.ticketsUrl = this.config.get<string>('tickets.url') || '';
    this.ticketsApiKey = this.config.get<string>('tickets.apiKey') || '';
  }

  async report(
    unreadMessage: EmailMessage,
    thread: EmailThread,
    decision: GeminiDecision,
  ): Promise<void> {
    const header = {
      event: 'email.processed',
      timestamp: new Date().toISOString(),
      mailbox_message_id: unreadMessage.id,
      conversation_id: unreadMessage.conversationId,
      subject: thread.subject,
      from: unreadMessage.from,
      received_at: unreadMessage.receivedDateTime,
      thread_length: thread.messages.length,
    };

    if (!decision.requiere_ticket) {
      this.logger.log(`[TICKET] NO requiere ticket: ${decision.motivo}`);
      this.logger.log(JSON.stringify({ ...header, decision }, null, 2));
      return;
    }

    try {
      const { data } = await firstValueFrom(
        this.http.post(
          this.ticketsUrl,
          {
            ...decision.ticket_data,
            metadata: {
              mailbox_message_id: unreadMessage.id,
              conversation_id: unreadMessage.conversationId,
              received_at: unreadMessage.receivedDateTime,
            },
          },
          {
            headers: {
              'X-Api-Key': this.ticketsApiKey,
              'Content-Type': 'application/json',
            },
            timeout: 10_000,
          },
        ),
      );

      this.logger.log(
        `[TICKET] CREADO en sistema externo: id=${data.id} ${JSON.stringify(decision.ticket_data)}`,
      );
      this.logger.log(JSON.stringify({ ...header, decision, ticket_id: data.id }, null, 2));
    } catch (err) {
      this.logger.error(
        `[TICKET] Falló POST a ${this.ticketsUrl}: ${(err as Error).message}`,
      );
      this.logger.log(JSON.stringify({ ...header, decision, error: (err as Error).message }, null, 2));
    }
  }
}
```

Variables de entorno nuevas:

```env
TICKETS_URL=https://tickets.grupopettengill.com.py/api/v1/tickets
TICKETS_API_KEY=...
```

Y agregalas en `src/config/configuration.ts`:

```ts
tickets: {
  url: process.env.TICKETS_URL || '',
  apiKey: process.env.TICKETS_API_KEY || '',
},
```

### 1.3. Mapeo al sistema real

Si el sistema de tickets que usan (Jira, GLPI, Freshdesk, etc.) tiene una estructura distinta, agregar un `mapper` antes del POST. Ejemplo para Jira:

```ts
const jiraPayload = {
  fields: {
    project: { key: 'TI' },
    summary: decision.ticket_data.titulo,
    description: decision.ticket_data.descripcion,
    issuetype: { name: 'Soporte' },
    priority: { name: { Alta: 'High', Media: 'Medium', Baja: 'Low' }[decision.ticket_data.prioridad] },
    reporter: { emailAddress: { address: decision.ticket_data.solicitante } },
  },
};
```

---

## 2. Persistir decisiones (evitar reprocesar al fallar `markAsRead`)

Hoy, si `markAsRead` falla, el correo se reprocesa en el próximo ciclo. Para evitar el duplicado, persistir los IDs ya procesados en una mini-tabla.

### 2.1. Versión simple con SQLite

```bash
npm install better-sqlite3
```

```ts
// src/daemon/processed-messages.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as path from 'path';

@Injectable()
export class ProcessedMessagesService implements OnModuleInit {
  private db!: Database.Database;
  private markStmt!: Database.Statement;
  private hasStmt!: Database.Statement;

  onModuleInit() {
    this.db = new Database(path.join(process.cwd(), 'processed.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed (
        message_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL,
        decision TEXT NOT NULL
      );
    `);
    this.markStmt = this.db.prepare(
      `INSERT OR IGNORE INTO processed (message_id, processed_at, decision) VALUES (?, ?, ?)`,
    );
    this.hasStmt = this.db.prepare(
      `SELECT 1 FROM processed WHERE message_id = ?`,
    );
  }

  has(messageId: string): boolean {
    return !!this.hasStmt.get(messageId);
  }

  mark(messageId: string, decisionJson: string): void {
    this.markStmt.run(messageId, new Date().toISOString(), decisionJson);
  }
}
```

Modificar `OutlookService.getUnreadEmails()` para filtrar los ya procesados, y `EmailDaemonService.processOne()` para marcar después de procesar.

### 2.2. Versión con Redis (si ya tienen Redis en la infra)

```bash
npm install ioredis
```

```ts
@Injectable()
export class ProcessedMessagesService {
  constructor(private readonly redis: Redis) {}

  async has(id: string) { return !!(await this.redis.exists(`proc:${id}`)); }
  async mark(id: string, decision: string) {
    await this.redis.set(`proc:${id}`, decision, 'EX', 60 * 60 * 24 * 7);  // 7 días
  }
}
```

---

## 3. Exponer un endpoint HTTP de debug

Para desarrollo, agregar un controller HTTP en `main.ts` y un endpoint que dispare un ciclo manualmente.

### 3.1. Modificar `main.ts`

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { EmailDaemonService } from './daemon/email-daemon.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Si DEBUG_HTTP_PORT está definido, levantar HTTP
  if (process.env.DEBUG_HTTP_PORT) {
    const app = await NestFactory.create(AppModule);
    await app.listen(Number(process.env.DEBUG_HTTP_PORT));
    logger.log(`Debug HTTP en puerto ${process.env.DEBUG_HTTP_PORT}`);
    return;
  }

  // Modo daemon normal
  const app = await NestFactory.createApplicationContext(AppModule);
  // ... resto del código actual
}
```

### 3.2. Agregar controller

```ts
// src/daemon/daemon.controller.ts
import { Controller, Post } from '@nestjs/common';
import { EmailDaemonService } from './email-daemon.service';

@Controller('debug')
export class DaemonDebugController {
  constructor(private readonly daemon: EmailDaemonService) {}

  @Post('run-cycle')
  async runCycle() {
    await this.daemon.forceRun();
    return { ok: true };
  }
}
```

```ts
// src/daemon/daemon.module.ts
@Module({
  imports: [MicrosoftModule, GeminiModule, HttpModule],
  controllers: [DaemonDebugController],
  providers: [EmailDaemonService, TicketDecisionService],
  exports: [EmailDaemonService],
})
export class DaemonModule {}
```

Agregar método `forceRun()` en `EmailDaemonService`:

```ts
async forceRun(): Promise<void> {
  await this.runCycle();
}
```

Uso:

```bash
curl -X POST http://localhost:3000/debug/run-cycle
```

**Importante**: dejar `DEBUG_HTTP_PORT` sin definir en producción. El controller no debería estar expuesto fuera de la red interna.

---

## 4. Cambiar de polling a webhooks de Graph

Hoy el daemon pregunta cada N segundos. Microsoft Graph permite **subscriptions**: vos registrás un webhook y Graph te avisa cuando hay cambios en la carpeta.

### 4.1. Trade-offs

| Polling (actual) | Webhooks (subscriptions) |
| --- | --- |
| Simple, sin estado | Más eficiente, casi tiempo real |
| Latencia = intervalo | Latencia = segundos |
| No requiere exponer HTTP | Requiere HTTP público accesible por Graph |
| Funciona detrás de NAT/firewall | Requiere HTTPS válido, dominio público |

### 4.2. Cómo migrar

1. Reemplazar `setInterval` en `EmailDaemonService` por un controller HTTP en `/webhook/graph`.
2. En el bootstrap, llamar a Graph:
   ```
   POST /subscriptions
   {
     "changeType": "created",
     "notificationUrl": "https://asistia.grupopettengill.com.py/webhook/graph",
     "resource": "/users/TI.soporte@grupopettengill.com.py/mailFolders/inbox/messages",
     "expirationDateTime": "<60 minutos en el futuro>",
     "clientState": "asistia-secret"
   }
   ```
3. Renovar la subscription cada 50 minutos (vida útil máx ~60min para mails).
4. El handler de webhook **no procesa directamente** — Graph envía notificaciones muy livianas. El handler mete el `messageId` en una cola in-memory y `EmailDaemonService` la procesa con la misma lógica de `processOne`.

`processOne(messageId)` es **exactamente** la función que tenés que llamar desde el handler.

---

## 5. Backoff exponencial para 429 de Graph

Si recibís muchos `429 TooManyRequests`, agregar retry con backoff en `OutlookService`:

```ts
private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (err?.statusCode === 429 && attempt < maxRetries - 1) {
        const wait = Math.min(2 ** attempt * 1000, 30_000);
        this.logger.warn(`429 recibido, esperando ${wait}ms antes de reintentar`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
```

Usar:

```ts
const response = await this.withRetry(() =>
  this.client.api(path).query({...}).get(),
);
```

---

## 6. Múltiples buzones

Hoy hay un solo buzón (`MS_MAILBOX`). Para monitorear varios, cambiar la arquitectura:

1. Reemplazar la constante única por un array en `.env`:
   ```env
   MS_MAILBOXES=ti.soporte@empresa.com.py,soporte.rrhh@empresa.com.py
   ```
2. Modificar `OutlookService` para que reciba un buzón como parámetro en cada llamada.
3. En `EmailDaemonService`, iterar sobre el array.

La forma más limpia es un patrón `MailboxProcessorService` que se instancia por buzón, registrado con un factory provider.

---

## 7. Cambiar el modelo de IA (alternativas a Gemini)

`GeminiService` es la única dependencia de Gemini. Para usar otro modelo, mantener la misma interfaz (`interpretThread(thread): Promise<GeminiDecision>`) y crear un nuevo servicio:

```ts
// src/openai/openai.service.ts
@Injectable()
export class OpenAiService {
  async interpretThread(thread: EmailThread): Promise<GeminiDecision> { ... }
}
```

Y en `daemon.module.ts`:

```ts
{
  provide: GeminiService,
  useClass: process.env.AI_PROVIDER === 'openai' ? OpenAiService : GeminiService,
}
```

Modelos que funcionan para clasificación de texto con salida JSON estructurada:
- Gemini 1.5/2.5/3 Flash (actual)
- GPT-4o-mini (OpenAI) con `response_format: { type: 'json_schema', ... }`
- Claude 3.5 Haiku (Anthropic) con tool use
- Modelos locales con Ollama (Llama 3.1 8B) — los JSON son menos confiables, hay que validar más

---

## 8. Agregar adjuntos al ticket

Hoy los adjuntos se ignoran. Para incluirlos en la descripción del ticket:

1. En `OutlookService.getThread()`, agregar `$expand=attachments` en el query.
2. Para cada mensaje, descargar los adjuntos:
   ```
   GET /users/{mb}/messages/{id}/attachments/{attachId}/$value
   ```
3. Subirlos al sistema de tickets o a un storage intermedio (S3, Azure Blob).
4. Agregar las URLs en `ticket_data.descripcion` o como campo aparte.

Como el daemon no persiste nada, los adjuntos tienen que subirse **en el mismo ciclo** donde se procesa el correo. Si tu sistema de tickets acepta adjuntos en el POST inicial, perfecto. Si no, hay que subirlos a un storage primero y referenciarlos.

---

## 9. Métricas Prometheus

```bash
npm install @willsoto/nestjs-prometheus prom-client
```

Crear un módulo de métricas:

```ts
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
    }),
  ],
})
export class MetricsModule {}
```

Y en `EmailDaemonService`, inyectar contadores:

```ts
constructor(private readonly counters: Counter[]) {
  this.counters = {
    cycles: new Counter({ name: 'asistia_cycles_total', help: 'Ciclos ejecutados' }),
    emails: new Counter({ name: 'asistia_emails_total', help: 'Emails procesados', labelNames: ['decision'] }),
    errors: new Counter({ name: 'asistia_errors_total', help: 'Errores', labelNames: ['stage'] }),
  };
}
```

Y exponer un puerto HTTP con `/metrics` (ver §3).

---

## 10. Tests automatizados

Recomendación mínima:

| Test | Qué cubre |
| --- | --- |
| Unit: `GeminiService.interpretThread()` con mock del SDK | Que arma el prompt y parsea la respuesta |
| Unit: `OutlookService.htmlToText()` | Que limpia HTML básico |
| Unit: `TicketDecisionService.report()` con `console.log` mockeado | Que loguea el JSON correcto en cada caso |
| Integration: `EmailDaemonService` end-to-end con Graph y Gemini mockeados | Que el ciclo completo procesa N correos y maneja errores |
| E2E manual: mandar un mail real, ver la decisión en logs | Sanity check final antes de producción |

Frameworks:
- Jest (default de NestJS): `npm i -D @nestjs/testing jest @types/jest ts-jest`
- Configurar en `package.json`:
  ```json
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$"
  }
  ```
- Agregar script: `"test": "jest"`

Para E2E con Graph real, considerar `nock` o `msw` para mockear las respuestas HTTP sin pegarle a Azure.
