import { Injectable, Logger } from '@nestjs/common';
import { CompanyConfig } from '../database/database.types';
import { GeminiDecision } from '../gemini/gemini.service';
import { EmailMessage, EmailThread } from '../microsoft/types';

@Injectable()
export class TicketDecisionService {
  private readonly logger = new Logger(TicketDecisionService.name);

  report(
    company: CompanyConfig,
    unreadMessage: EmailMessage,
    thread: EmailThread,
    decision: GeminiDecision,
  ): void {
    const header = {
      event: 'email.processed',
      timestamp: new Date().toISOString(),
      company_id: company.id,
      company_name: company.name,
      mailbox: company.msMailbox,
      mailbox_message_id: unreadMessage.id,
      conversation_id: unreadMessage.conversationId,
      subject: thread.subject,
      from: unreadMessage.from,
      received_at: unreadMessage.receivedDateTime,
      thread_length: thread.messages.length,
    };

    if (!decision.requiere_ticket) {
      this.logger.log('============================================================');
      this.logger.log(`[empresa=${company.id}] [TICKET] NO requiere ticket`);
      this.logger.log(
        `Mensaje: ${unreadMessage.subject} (${unreadMessage.from.address})`,
      );
      this.logger.log(`Motivo: ${decision.motivo}`);
      this.logger.log(
        `Detalle: ${JSON.stringify({ ...header, decision }, null, 2)}`,
      );
      this.logger.log('============================================================');
      return;
    }

    const ticketPayload = {
      ...header,
      decision,
    };

    this.logger.log('============================================================');
    this.logger.log(
      `[empresa=${company.id}] [TICKET] REQUIERE ticket -> crear en sistema externo`,
    );
    this.logger.log(
      `Mensaje: ${unreadMessage.subject} (${unreadMessage.from.address})`,
    );
    this.logger.log(
      `Ticket a crear: ${JSON.stringify(decision.ticket_data, null, 2)}`,
    );
    this.logger.log('Estructura completa:');
    this.logger.log(JSON.stringify(ticketPayload, null, 2));
    this.logger.log('============================================================');
  }
}
