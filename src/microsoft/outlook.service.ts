import { Injectable, Logger } from '@nestjs/common';
import { MicrosoftAuthService } from './microsoft-auth.service';
import {
  EmailMessage,
  EmailThread,
  GraphMessage,
  GraphMessagesResponse,
  MicrosoftMailboxConfig,
} from './types';

@Injectable()
export class OutlookService {
  private readonly logger = new Logger(OutlookService.name);

  constructor(private readonly auth: MicrosoftAuthService) {}

  private mapMessage(msg: GraphMessage): EmailMessage {
    return {
      id: msg.id,
      conversationId: msg.conversationId || msg.id,
      subject: msg.subject || '(sin asunto)',
      from: {
        name: msg.from?.emailAddress?.name || '',
        address: msg.from?.emailAddress?.address || 'desconocido@local',
      },
      receivedDateTime:
        msg.receivedDateTime || msg.sentDateTime || new Date().toISOString(),
      bodyPreview: msg.bodyPreview || '',
      body:
        msg.body?.contentType?.toLowerCase() === 'html'
          ? this.htmlToText(msg.body.content || '')
          : msg.body?.content || msg.bodyPreview || '',
      isRead: !!msg.isRead,
    };
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async getUnreadEmails(
    config: MicrosoftMailboxConfig,
    maxEmails: number,
  ): Promise<EmailMessage[]> {
    const client = this.auth.getGraphClient(config);
    const path = `/users/${encodeURIComponent(config.msMailbox)}/mailFolders/${config.msMailFolder}/messages`;
    const response = (await client
      .api(path)
      .query({
        $filter: 'isRead eq false',
        $orderby: 'receivedDateTime desc',
        $top: maxEmails,
        $select:
          'id,conversationId,subject,bodyPreview,receivedDateTime,from,isRead,body',
      })
      .get()) as GraphMessagesResponse;

    return (response.value || []).map((m) => this.mapMessage(m));
  }

  async getThread(
    config: MicrosoftMailboxConfig,
    conversationId: string,
  ): Promise<EmailThread> {
    const client = this.auth.getGraphClient(config);
    const path = `/users/${encodeURIComponent(config.msMailbox)}/messages`;
    const response = (await client
      .api(path)
      .query({
        $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
        $select:
          'id,conversationId,subject,bodyPreview,receivedDateTime,from,isRead,body',
      })
      .get()) as GraphMessagesResponse;

    const messages = (response.value || []).map((m) => this.mapMessage(m));
    messages.sort(
      (a, b) =>
        new Date(b.receivedDateTime).getTime() -
        new Date(a.receivedDateTime).getTime(),
    );

    const latest =
      messages[0] ||
      ({
        id: conversationId,
        conversationId,
        subject: '(sin asunto)',
        from: { name: '', address: '' },
        receivedDateTime: new Date().toISOString(),
        bodyPreview: '',
        body: '',
        isRead: true,
      } as EmailMessage);

    return {
      conversationId,
      subject: latest.subject,
      messages,
      latestMessage: latest,
    };
  }

  async markAsRead(
    config: MicrosoftMailboxConfig,
    messageId: string,
  ): Promise<void> {
    try {
      const client = this.auth.getGraphClient(config);
      const path = `/users/${encodeURIComponent(config.msMailbox)}/messages/${messageId}`;
      await client.api(path).patch({ isRead: true });
      this.logger.debug(`Mensaje ${messageId} marcado como leido`);
    } catch (err) {
      this.logger.warn(
        `No se pudo marcar como leido ${messageId}: ${(err as Error).message}`,
      );
    }
  }
}
