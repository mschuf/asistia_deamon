import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  GenerationConfig,
  SchemaType,
} from '@google/generative-ai';
import { DatabaseService } from '../database/database.service';
import { CompanyConfig } from '../database/database.types';
import { EmailThread } from '../microsoft/types';
import {
  TICKET_CATEGORIES,
  categoryName,
  resolveCategoryId,
} from '../ticket/categories';
import { TicketType, resolveTicketType } from '../ticket/ticket-types';

export interface TicketData {
  titulo: string;
  descripcion: string;
  prioridad: 'Alta' | 'Media' | 'Baja';
  type: TicketType;
  solicitante: string;
  categoria_id: number;
  categoria_nombre?: string;
}

export interface GeminiDecision {
  requiere_ticket: boolean;
  motivo: string;
  ticket_data: TicketData;
}

export interface GeminiInterpretContext {
  company: CompanyConfig;
  runId: number;
  attemptId: number;
  mailMessageId: number;
}

export interface GeminiInterpretResult {
  decision: GeminiDecision;
  promptText: string;
  promptSummary: string;
  responseText: string;
  aiInteractionId: number;
}

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private client!: GoogleGenerativeAI;

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('gemini.apiKey');
    if (!apiKey) {
      throw new Error('Falta GEMINI_API_KEY en las variables de entorno');
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.logger.log('Gemini inicializado');
  }

  private buildThreadText(thread: EmailThread): string {
    return thread.messages
      .map((m, idx) => {
        const date = new Date(m.receivedDateTime).toISOString();
        return [
          `--- Mensaje ${idx + 1} ---`,
          `Fecha: ${date}`,
          `De: ${m.from.name || ''} <${m.from.address}>`,
          `Asunto: ${m.subject}`,
          '',
          m.body || m.bodyPreview,
          '',
        ].join('\n');
      })
      .join('\n');
  }

  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(variables, key)
        ? variables[key]
        : match,
    );
  }

  private get responseSchema() {
    return {
      type: SchemaType.OBJECT,
      properties: {
        requiere_ticket: {
          type: SchemaType.BOOLEAN,
          description:
            'true si el correo requiere apertura de un ticket de soporte, false en caso contrario',
        },
        motivo: {
          type: SchemaType.STRING,
          description:
            'Breve explicacion de por que si o por que no requiere ticket',
        },
        ticket_data: {
          type: SchemaType.OBJECT,
          properties: {
            titulo: {
              type: SchemaType.STRING,
              description: 'Resumen conciso del problema',
            },
            descripcion: {
              type: SchemaType.STRING,
              description: 'Detalle limpio de la solicitud',
            },
            prioridad: {
              type: SchemaType.STRING,
              enum: ['Alta', 'Media', 'Baja'],
              description: 'Nivel de prioridad sugerido',
              format: 'enum',
            },
            type: {
              type: SchemaType.STRING,
              enum: ['incident', 'request'],
              description:
                'Tipo de ticket. request para solicitudes de baja prioridad; incident para incidentes de mayor prioridad o paralizantes',
              format: 'enum',
            },
            solicitante: {
              type: SchemaType.STRING,
              description:
                'Email del solicitante que reporta el problema',
            },
            categoria_id: {
              type: SchemaType.INTEGER,
              description: `Id de la categoria del catalogo que mejor describe el problema. Valores validos: ${TICKET_CATEGORIES.map(
                (c) => `${c.id} (${c.name})`,
              ).join(
                '; ',
              )}. Si ninguna aplica con claridad, usar 66.`,
            },
            categoria_nombre: {
              type: SchemaType.STRING,
              description:
                'Nombre exacto de la categoria elegida, tal como figura en el catalogo',
            },
          },
          required: [
            'titulo',
            'descripcion',
            'prioridad',
            'type',
            'solicitante',
            'categoria_id',
          ],
        },
      },
      required: ['requiere_ticket', 'motivo', 'ticket_data'],
    };
  }

  private get generationConfig(): GenerationConfig {
    return {
      responseMimeType: 'application/json',
      responseSchema: this.responseSchema as any,
      temperature: 0.2,
    };
  }

  private logGeminiBlock(title: string, content: string): void {
    console.log('');
    console.log(`========== ${title}: ==========`);
    console.log(content);
    console.log(`========== Fin ${title} ==========`);
    console.log('');
  }

  private truncate(text: string, maxLength = 300): string {
    return text.length > maxLength
      ? `${text.slice(0, maxLength)}...`
      : text;
  }

  private buildPromptSummary(
    thread: EmailThread,
    company: CompanyConfig,
  ): string {
    const messages = thread.messages
      .map((m, idx) => {
        const preview = this.truncate(
          (m.bodyPreview || m.body || '').replace(/\s+/g, ' ').trim(),
          180,
        );
        return [
          `Mensaje ${idx + 1}:`,
          `  Fecha: ${new Date(m.receivedDateTime).toISOString()}`,
          `  De: ${m.from.name || ''} <${m.from.address}>`,
          `  Asunto: ${m.subject}`,
          `  Preview: ${preview || '(sin preview)'}`,
        ].join('\n');
      })
      .join('\n\n');

    return [
      `Empresa: ${company.name} (${company.id})`,
      `Modelo: ${company.geminiModel}`,
      `Prompt ID: ${company.prompt.id}`,
      `ConversationId: ${thread.conversationId}`,
      `Asunto: ${thread.subject}`,
      'Orden: mensaje mas nuevo -> mensaje mas viejo',
      `Mensajes en hilo: ${thread.messages.length}`,
      '',
      messages,
    ].join('\n');
  }

  private findRequester(thread: EmailThread, company: CompanyConfig): string {
    const mailbox = company.msMailbox.toLowerCase();
    const message =
      thread.messages.find(
        (m) =>
          m.from.address &&
          m.from.address.toLowerCase() !== mailbox,
      ) || thread.messages[0];

    return message?.from.address || 'desconocido@local';
  }

  async interpretThread(
    thread: EmailThread,
    context: GeminiInterpretContext,
  ): Promise<GeminiInterpretResult> {
    const { company } = context;
    const requesterEmail = this.findRequester(thread, company);
    const promptText = this.renderTemplate(company.prompt.promptTemplate, {
      company_name: company.name,
      mailbox: company.msMailbox,
      model: company.geminiModel,
      thread_subject: thread.subject,
      conversation_id: thread.conversationId,
      thread_messages: this.buildThreadText(thread),
      requester_email: requesterEmail,
      message_order: 'mensaje mas nuevo -> mensaje mas viejo',
    });
    const promptSummary = this.buildPromptSummary(thread, company);
    const aiStartedAt = Date.now();

    const aiInteractionId = await this.database.createAiInteraction({
      companyId: company.id,
      runId: context.runId,
      attemptId: context.attemptId,
      mailMessageId: context.mailMessageId,
      promptId: company.prompt.id,
      model: company.geminiModel,
      systemInstruction: company.prompt.systemInstruction,
      promptText,
      promptSummary,
    });

    this.logGeminiBlock('Resumen enviado a Gemini', promptSummary);

    try {
      const model = this.client.getGenerativeModel({
        model: company.geminiModel,
        systemInstruction: company.prompt.systemInstruction,
        generationConfig: this.generationConfig,
      });

      const result = await model.generateContent(promptText);
      const responseText = result.response.text();
      this.logGeminiBlock('Gemini respuesta', responseText);

      let parsed: GeminiDecision;
      try {
        parsed = JSON.parse(responseText) as GeminiDecision;
      } catch {
        throw new Error('Gemini devolvio una respuesta no-JSON');
      }

      if (typeof parsed.requiere_ticket !== 'boolean') {
        throw new Error('Gemini omitio el campo requiere_ticket');
      }

      if (parsed.requiere_ticket) {
        parsed.ticket_data = parsed.ticket_data || ({} as TicketData);
        parsed.ticket_data.titulo =
          parsed.ticket_data.titulo || thread.subject || 'Sin titulo';
        parsed.ticket_data.descripcion =
          parsed.ticket_data.descripcion ||
          thread.latestMessage.body ||
          thread.latestMessage.bodyPreview;
        parsed.ticket_data.prioridad = (['Alta', 'Media', 'Baja'].includes(
          parsed.ticket_data.prioridad,
        )
          ? parsed.ticket_data.prioridad
          : 'Media') as 'Alta' | 'Media' | 'Baja';
        parsed.ticket_data.type = resolveTicketType(
          parsed.ticket_data.type,
          parsed.ticket_data.prioridad,
        );
        parsed.ticket_data.solicitante =
          parsed.ticket_data.solicitante || requesterEmail;
        const defaultCategoryId = resolveCategoryId(
          this.config.get<number>('ticketApi.defaultCategoryId'),
        );
        parsed.ticket_data.categoria_id = resolveCategoryId(
          parsed.ticket_data.categoria_id,
          defaultCategoryId,
        );
        parsed.ticket_data.categoria_nombre =
          categoryName(parsed.ticket_data.categoria_id) ??
          parsed.ticket_data.categoria_nombre;
      }

      await this.database.finishAiInteraction({
        aiInteractionId,
        startedAt: aiStartedAt,
        status: 'success',
        responseText,
        parsedDecisionJson: parsed,
      });

      return {
        decision: parsed,
        promptText,
        promptSummary,
        responseText,
        aiInteractionId,
      };
    } catch (err) {
      await this.database.finishAiInteraction({
        aiInteractionId,
        startedAt: aiStartedAt,
        status: 'error',
        error: err as Error,
      });
      this.logger.error(
        `Error consultando Gemini: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}
