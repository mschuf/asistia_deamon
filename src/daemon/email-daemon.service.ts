import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { CompanyConfig, DaemonRunStatus } from '../database/database.types';
import { GeminiService } from '../gemini/gemini.service';
import { OutlookService } from '../microsoft/outlook.service';
import { EmailMessage } from '../microsoft/types';
import { TicketDecisionService } from './ticket-decision.service';

@Injectable()
export class EmailDaemonService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(EmailDaemonService.name);
  private readonly intervalName = 'email-poller';
  private readonly maxEmails: number;
  private currentBatch: EmailMessage[] = [];
  private running = false;
  private cycleInProgress = false;

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly database: DatabaseService,
    private readonly outlook: OutlookService,
    private readonly gemini: GeminiService,
    private readonly reporter: TicketDecisionService,
  ) {
    this.maxEmails = Number(
      this.config.get<number>('daemon.maxEmails') ?? 20,
    );
  }

  onApplicationBootstrap(): void {
    const seconds = Number(
      this.config.get<number>('daemon.intervalSeconds') ?? 60,
    );
    const intervalMs = Math.max(seconds, 5) * 1000;

    const handle = setInterval(() => {
      this.runCycle().catch((err) => {
        this.logger.error(
          `Error en ciclo del daemon: ${(err as Error).message}`,
          (err as Error).stack,
        );
      });
    }, intervalMs);

    this.schedulerRegistry.addInterval(this.intervalName, handle);
    this.logger.log(
      `Daemon programado cada ${seconds}s. Primer ciclo inmediato...`,
    );

    this.runCycle().catch((err) => {
      this.logger.error(
        `Error en ciclo inicial: ${(err as Error).message}`,
        (err as Error).stack,
      );
    });
  }

  onModuleDestroy(): void {
    try {
      this.schedulerRegistry.deleteInterval(this.intervalName);
    } catch {
      // ignore
    }
  }

  private async runCycle(): Promise<void> {
    if (this.running) {
      this.logger.debug('Ciclo anterior aun en curso, se omite este tick');
      return;
    }

    this.running = true;
    this.cycleInProgress = true;
    const startedAt = Date.now();

    try {
      const companies = await this.database.getActiveCompanies();
      this.logger.log(`Empresas activas encontradas: ${companies.length}`);

      for (const company of companies) {
        await this.processCompany(company);
      }
    } finally {
      this.currentBatch = [];
      this.running = false;
      this.cycleInProgress = false;
      this.logger.log(
        `Ciclo multiempresa finalizado en ${Date.now() - startedAt}ms`,
      );
    }
  }

  private async processCompany(company: CompanyConfig): Promise<void> {
    const runStartedAt = Date.now();
    const runId = await this.database.createRun(company, this.maxEmails);
    let emailsLoaded = 0;
    let emailsProcessed = 0;
    let successCount = 0;
    let errorCount = 0;
    let runError: Error | undefined;

    this.logger.log(
      `[empresa=${company.id}] Buscando correos no leidos en ${company.msMailbox}`,
    );
    console.log(
      JSON.stringify(
        {
          event: 'graph.connection',
          company_id: company.id,
          company_name: company.name,
          tenant_id: company.msTenantId,
          client_id: company.msClientId,
          mailbox: company.msMailbox,
          mail_folder: company.msMailFolder,
          max_emails_per_company: this.maxEmails,
        },
        null,
        2,
      ),
    );

    try {
      await this.database.logApp({
        companyId: company.id,
        runId,
        level: 'info',
        component: EmailDaemonService.name,
        event: 'daemon.run.started',
        message: 'Inicio de ciclo de empresa',
        details: {
          company_name: company.name,
          mailbox: company.msMailbox,
          max_emails_per_company: this.maxEmails,
          prompt_id: company.prompt.id,
        },
      });

      const unread = await this.outlook.getUnreadEmails(
        company,
        this.maxEmails,
      );
      const batch = unread.slice(0, this.maxEmails);
      this.currentBatch = batch;
      emailsLoaded = batch.length;

      if (batch.length === 0) {
        this.logger.log(`[empresa=${company.id}] No hay correos no leidos`);
        await this.database.logApp({
          companyId: company.id,
          runId,
          level: 'success',
          component: EmailDaemonService.name,
          event: 'daemon.run.empty',
          message: 'No hay correos no leidos',
        });
        return;
      }

      this.logger.log(
        `[empresa=${company.id}] Snapshot en memoria: ${batch.length}/${this.maxEmails} correo(s) por empresa`,
      );

      for (const [index, msg] of batch.entries()) {
        this.logger.log(
          `[empresa=${company.id}] Procesando correo ${index + 1}/${batch.length}`,
        );
        emailsProcessed += 1;
        const ok = await this.processOne(company, runId, msg);
        if (ok) {
          successCount += 1;
        } else {
          errorCount += 1;
        }
      }

      await this.database.logApp({
        companyId: company.id,
        runId,
        level: errorCount > 0 ? 'warn' : 'success',
        component: EmailDaemonService.name,
        event: 'daemon.run.finished',
        message: 'Ciclo de empresa finalizado',
        details: {
          emails_loaded: emailsLoaded,
          emails_processed: emailsProcessed,
          success_count: successCount,
          error_count: errorCount,
        },
      });
    } catch (err) {
      runError = err as Error;
      errorCount += 1;
      this.logger.error(
        `[empresa=${company.id}] Error en ciclo de empresa: ${runError.message}`,
        runError.stack,
      );
      this.consoleErrorContext({
        event: 'daemon.run.error',
        company,
        runId,
        error: runError,
      });
      await this.database.logApp({
        companyId: company.id,
        runId,
        level: 'error',
        component: EmailDaemonService.name,
        event: 'daemon.run.error',
        message: runError.message,
        error: runError,
      });
    } finally {
      const status: DaemonRunStatus = runError
        ? 'error'
        : errorCount > 0
          ? 'partial_error'
          : 'success';

      await this.database.finishRun(runId, {
        status,
        startedAt: runStartedAt,
        emailsLoaded,
        emailsProcessed,
        successCount,
        errorCount,
        error: runError,
      });
    }
  }

  private consoleErrorContext(input: {
    event: string;
    company: CompanyConfig;
    error: Error;
    runId?: number;
    mailMessageId?: number;
    attemptId?: number;
    message?: EmailMessage;
  }): void {
    console.log(
      JSON.stringify(
        {
          event: input.event,
          timestamp: new Date().toISOString(),
          company_id: input.company.id,
          company_name: input.company.name,
          mailbox: input.company.msMailbox,
          run_id: input.runId,
          mail_message_db_id: input.mailMessageId,
          attempt_id: input.attemptId,
          graph_message_id: input.message?.id,
          conversation_id: input.message?.conversationId,
          subject: input.message?.subject,
          from: input.message?.from,
          error: input.error.message,
        },
        null,
        2,
      ),
    );
  }

  private async processOne(
    company: CompanyConfig,
    runId: number,
    message: EmailMessage,
  ): Promise<boolean> {
    const tag = `[${message.id}] ${message.subject}`;
    const attemptStartedAt = Date.now();
    let mailMessageId: number | undefined;
    let attemptId: number | undefined;

    try {
      mailMessageId = await this.database.upsertMailMessage(company, message);
      attemptId = await this.database.createProcessingAttempt({
        companyId: company.id,
        runId,
        mailMessageId,
      });

      this.logger.log(
        `[empresa=${company.id}] Procesando ${tag} (conv=${message.conversationId})`,
      );
      const thread = await this.outlook.getThread(
        company,
        message.conversationId,
      );
      this.logger.log(
        `[empresa=${company.id}] Hilo de ${tag} -> ${thread.messages.length} mensaje(s)`,
      );

      const aiResult = await this.gemini.interpretThread(thread, {
        company,
        runId,
        attemptId,
        mailMessageId,
      });

      console.log(
        JSON.stringify(
          {
            event: 'gemini.response',
            timestamp: new Date().toISOString(),
            company_id: company.id,
            company_name: company.name,
            prompt_id: company.prompt.id,
            ai_interaction_id: aiResult.aiInteractionId,
            model: company.geminiModel,
            mailbox_message_id: message.id,
            conversation_id: message.conversationId,
            subject: message.subject,
            decision: aiResult.decision,
          },
          null,
          2,
        ),
      );

      this.reporter.report(company, message, thread, aiResult.decision);

      await this.database.finishProcessingAttempt({
        attemptId,
        startedAt: attemptStartedAt,
        status: 'success',
        requiresTicket: aiResult.decision.requiere_ticket,
        decisionJson: aiResult.decision,
      });

      await this.database.logApp({
        companyId: company.id,
        runId,
        mailMessageId,
        attemptId,
        aiInteractionId: aiResult.aiInteractionId,
        level: 'success',
        component: EmailDaemonService.name,
        event: 'email.processed',
        message: 'Correo procesado correctamente',
        details: {
          graph_message_id: message.id,
          conversation_id: message.conversationId,
          subject: message.subject,
          requiere_ticket: aiResult.decision.requiere_ticket,
        },
      });

      this.logger.log(
        `[empresa=${company.id}] Modo test: no se marca como leido el mensaje ${message.id}`,
      );
      // TODO: Reactivar en produccion cuando el daemon pueda confirmar correos procesados.
      // await this.outlook.markAsRead(company, message.id);
      return true;
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `[empresa=${company.id}] Fallo el procesamiento de ${tag}: ${error.message}`,
        error.stack,
      );
      this.consoleErrorContext({
        event: 'email.processing.error',
        company,
        runId,
        mailMessageId,
        attemptId,
        message,
        error,
      });

      if (attemptId) {
        await this.database.finishProcessingAttempt({
          attemptId,
          startedAt: attemptStartedAt,
          status: 'error',
          error,
        });
      }

      await this.database.logApp({
        companyId: company.id,
        runId,
        mailMessageId,
        attemptId,
        level: 'error',
        component: EmailDaemonService.name,
        event: 'email.processing.error',
        message: error.message,
        details: {
          graph_message_id: message.id,
          conversation_id: message.conversationId,
          subject: message.subject,
        },
        error,
      });
      return false;
    }
  }

  isRunning(): boolean {
    return this.cycleInProgress;
  }
}
