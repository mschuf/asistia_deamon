import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { EmailMessage } from '../microsoft/types';
import {
  AiInteractionStatus,
  AppLogLevel,
  CompanyConfig,
  DaemonRunStatus,
  EmailProcessingStatus,
} from './database.types';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.pool = new Pool({
      host: this.config.get<string>('database.host'),
      port: this.config.get<number>('database.port'),
      database: this.config.get<string>('database.name'),
      user: this.config.get<string>('database.user'),
      password: this.config.get<string>('database.password'),
      max: this.config.get<number>('database.poolMax') ?? 10,
      ssl: this.config.get<boolean>('database.ssl')
        ? { rejectUnauthorized: false }
        : false,
    });

    this.logger.log(
      `PostgreSQL configurado en ${this.config.get<string>('database.host')}:${this.config.get<number>('database.port')}/${this.config.get<string>('database.name')}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async query<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async withClient<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  async getActiveCompanies(): Promise<CompanyConfig[]> {
    const rows = await this.query<{
      id: string;
      name: string;
      ms_tenant_id: string;
      ms_client_id: string;
      ms_client_secret: string;
      ms_mailbox: string;
      ms_mail_folder: string;
      gemini_model: string;
      prompt_id: string;
      system_instruction: string;
      prompt_template: string;
    }>(
      `
      SELECT
        c.id,
        c.name,
        c.ms_tenant_id,
        c.ms_client_id,
        c.ms_client_secret,
        c.ms_mailbox,
        c.ms_mail_folder,
        c.gemini_model,
        p.id AS prompt_id,
        p.system_instruction,
        p.prompt_template
      FROM companies c
      JOIN prompt p ON p.company_id = c.id
      WHERE c.is_active = TRUE
      ORDER BY c.name ASC
      `,
    );

    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      msTenantId: row.ms_tenant_id,
      msClientId: row.ms_client_id,
      msClientSecret: row.ms_client_secret,
      msMailbox: row.ms_mailbox,
      msMailFolder: row.ms_mail_folder,
      geminiModel: row.gemini_model,
      prompt: {
        id: Number(row.prompt_id),
        systemInstruction: row.system_instruction,
        promptTemplate: row.prompt_template,
      },
    }));
  }

  async createRun(
    company: CompanyConfig,
    maxEmailsConfigured: number,
  ): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `
      INSERT INTO daemon_runs (company_id, max_emails_configured)
      VALUES ($1, $2)
      RETURNING id
      `,
      [company.id, maxEmailsConfigured],
    );
    return Number(rows[0].id);
  }

  async finishRun(
    runId: number,
    input: {
      status: DaemonRunStatus;
      startedAt: number;
      emailsLoaded: number;
      emailsProcessed: number;
      successCount: number;
      errorCount: number;
      error?: Error;
    },
  ): Promise<void> {
    await this.query(
      `
      UPDATE daemon_runs
      SET
        status = $2,
        finished_at = now(),
        duration_ms = $3,
        emails_loaded = $4,
        emails_processed = $5,
        success_count = $6,
        error_count = $7,
        error_message = $8,
        error_stack = $9
      WHERE id = $1
      `,
      [
        runId,
        input.status,
        Date.now() - input.startedAt,
        input.emailsLoaded,
        input.emailsProcessed,
        input.successCount,
        input.errorCount,
        input.error?.message ?? null,
        input.error?.stack ?? null,
      ],
    );
  }

  async upsertMailMessage(
    company: CompanyConfig,
    message: EmailMessage,
  ): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `
      INSERT INTO mail_messages (
        company_id,
        graph_message_id,
        conversation_id,
        mailbox,
        mail_folder,
        subject,
        from_name,
        from_address,
        received_at,
        is_read_at_fetch,
        body_preview
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (company_id, graph_message_id)
      DO UPDATE SET
        conversation_id = EXCLUDED.conversation_id,
        mailbox = EXCLUDED.mailbox,
        mail_folder = EXCLUDED.mail_folder,
        subject = EXCLUDED.subject,
        from_name = EXCLUDED.from_name,
        from_address = EXCLUDED.from_address,
        received_at = EXCLUDED.received_at,
        is_read_at_fetch = EXCLUDED.is_read_at_fetch,
        body_preview = EXCLUDED.body_preview,
        last_seen_at = now(),
        seen_count = mail_messages.seen_count + 1
      RETURNING id
      `,
      [
        company.id,
        message.id,
        message.conversationId,
        company.msMailbox,
        company.msMailFolder,
        message.subject,
        message.from.name,
        message.from.address,
        message.receivedDateTime,
        message.isRead,
        message.bodyPreview,
      ],
    );
    return Number(rows[0].id);
  }

  async createProcessingAttempt(input: {
    companyId: number;
    runId: number;
    mailMessageId: number;
  }): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `
      INSERT INTO email_processing_attempts (
        company_id,
        run_id,
        mail_message_id,
        status
      )
      VALUES ($1, $2, $3, 'processing')
      RETURNING id
      `,
      [input.companyId, input.runId, input.mailMessageId],
    );
    return Number(rows[0].id);
  }

  async finishProcessingAttempt(input: {
    attemptId: number;
    startedAt: number;
    status: EmailProcessingStatus;
    requiresTicket?: boolean;
    decisionJson?: unknown;
    error?: Error;
  }): Promise<void> {
    await this.query(
      `
      UPDATE email_processing_attempts
      SET
        status = $2,
        finished_at = now(),
        duration_ms = $3,
        requires_ticket = $4,
        decision_json = $5,
        error_message = $6,
        error_stack = $7
      WHERE id = $1
      `,
      [
        input.attemptId,
        input.status,
        Date.now() - input.startedAt,
        input.requiresTicket ?? null,
        input.decisionJson ? JSON.stringify(input.decisionJson) : null,
        input.error?.message ?? null,
        input.error?.stack ?? null,
      ],
    );
  }

  /**
   * true si ya existe evidencia de que el ticket de este correo fue creado.
   * Sirve para no crear tickets duplicados cuando, en modo test, el mismo
   * correo se reprocesa en cada ciclo porque no se marca como leido.
   *
   * Se consultan DOS fuentes para cerrar la ventana de "dual-write":
   *  - email_processing_attempts.decision_json.ticket_result.sent = true
   *    (se persiste al finalizar el intento, despues del POST).
   *  - app_logs con event = 'ticket.created' (se escribe en TicketService
   *    inmediatamente despues de un POST exitoso; es append-only y el daemon
   *    nunca lo sobrescribe, por lo que sobrevive aunque falle el guardado
   *    posterior del intento).
   */
  async hasTicketBeenCreated(mailMessageId: number): Promise<boolean> {
    const rows = await this.query<{ exists: boolean }>(
      `
      SELECT (
        EXISTS (
          SELECT 1
          FROM email_processing_attempts
          WHERE mail_message_id = $1
            AND decision_json -> 'ticket_result' ->> 'sent' = 'true'
        )
        OR EXISTS (
          SELECT 1
          FROM app_logs
          WHERE mail_message_id = $1
            AND event = 'ticket.created'
        )
      ) AS exists
      `,
      [mailMessageId],
    );
    return rows[0]?.exists === true;
  }

  async createAiInteraction(input: {
    companyId: number;
    runId: number;
    attemptId: number;
    mailMessageId: number;
    promptId: number;
    model: string;
    systemInstruction: string;
    promptText: string;
    promptSummary: string;
  }): Promise<number> {
    const rows = await this.query<{ id: string }>(
      `
      INSERT INTO ai_interactions (
        company_id,
        run_id,
        email_processing_attempt_id,
        mail_message_id,
        prompt_id,
        model,
        status,
        system_instruction,
        prompt_text,
        prompt_summary
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
      RETURNING id
      `,
      [
        input.companyId,
        input.runId,
        input.attemptId,
        input.mailMessageId,
        input.promptId,
        input.model,
        input.systemInstruction,
        input.promptText,
        input.promptSummary,
      ],
    );
    return Number(rows[0].id);
  }

  async finishAiInteraction(input: {
    aiInteractionId: number;
    startedAt: number;
    status: AiInteractionStatus;
    responseText?: string;
    parsedDecisionJson?: unknown;
    error?: Error;
  }): Promise<void> {
    await this.query(
      `
      UPDATE ai_interactions
      SET
        status = $2,
        finished_at = now(),
        duration_ms = $3,
        response_text = $4,
        parsed_decision_json = $5,
        error_message = $6,
        error_stack = $7
      WHERE id = $1
      `,
      [
        input.aiInteractionId,
        input.status,
        Date.now() - input.startedAt,
        input.responseText ?? null,
        input.parsedDecisionJson
          ? JSON.stringify(input.parsedDecisionJson)
          : null,
        input.error?.message ?? null,
        input.error?.stack ?? null,
      ],
    );
  }

  async logApp(input: {
    companyId: number;
    level: AppLogLevel;
    component: string;
    event: string;
    message: string;
    runId?: number;
    mailMessageId?: number;
    attemptId?: number;
    aiInteractionId?: number;
    details?: unknown;
    error?: Error;
  }): Promise<void> {
    await this.query(
      `
      INSERT INTO app_logs (
        company_id,
        run_id,
        mail_message_id,
        email_processing_attempt_id,
        ai_interaction_id,
        level,
        component,
        event,
        message,
        details,
        error_message,
        error_stack
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        input.companyId,
        input.runId ?? null,
        input.mailMessageId ?? null,
        input.attemptId ?? null,
        input.aiInteractionId ?? null,
        input.level,
        input.component,
        input.event,
        input.message,
        JSON.stringify(input.details ?? {}),
        input.error?.message ?? null,
        input.error?.stack ?? null,
      ],
    );
  }
}
