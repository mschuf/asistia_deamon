import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { CompanyConfig } from "../database/database.types";
import { GeminiDecision } from "../gemini/gemini.service";
import { categoryName, resolveCategoryId } from "./categories";
import { TicketType, resolveTicketType } from "./ticket-types";

/** Estructura que se envia al backend para crear el ticket. */
export interface TicketSendPayload {
  email: string;
  description: string;
  categoryId: number;
  type: TicketType;
}

/** Respuesta esperada del backend /api/v1/mail/send. */
export interface TicketSendResponse {
  sent?: boolean;
  error?: string | null;
  requester?: {
    userId?: number;
    name?: string;
    email?: string;
    source?: string;
  } | null;
  category?: {
    id?: number;
    name?: string;
  } | null;
  userMailSent?: boolean;
  supportMailSent?: boolean;
}

/** Resultado normalizado que el daemon persiste junto a la decision. */
export interface TicketCreationResult {
  sent: boolean;
  skipped: boolean;
  url: string;
  http_status: number | null;
  request: TicketSendPayload;
  response: TicketSendResponse | null;
  error: string | null;
}

export interface TicketCreateContext {
  runId: number;
  attemptId: number;
  mailMessageId: number;
  aiInteractionId?: number;
}

@Injectable()
export class TicketService {
  private readonly logger = new Logger(TicketService.name);
  private readonly baseUrl: string;
  private readonly sendPath: string;
  private readonly defaultCategoryId: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {
    this.baseUrl = this.config.get<string>("ticketApi.baseUrl") ?? "";
    this.sendPath =
      this.config.get<string>("ticketApi.sendPath") ?? "/api/v1/mail/send";
    this.defaultCategoryId =
      Number(this.config.get<number>("ticketApi.defaultCategoryId")) || 66;
    this.timeoutMs =
      Number(this.config.get<number>("ticketApi.timeoutMs")) || 15000;
  }

  /** Construye el payload exacto que espera el backend a partir de la decision de la IA. */
  buildPayload(
    decision: GeminiDecision,
    requesterEmailFallback?: string,
  ): TicketSendPayload {
    const data = decision.ticket_data;
    const email =
      (data?.solicitante || "").trim() || (requesterEmailFallback || "").trim();

    const titulo = (data?.titulo || "").trim();
    const descripcion = (data?.descripcion || "").trim();
    const description = [titulo, descripcion]
      .filter((part) => part.length > 0)
      .join("\n\n");

    const categoryId = resolveCategoryId(
      data?.categoria_id,
      this.defaultCategoryId,
    );
    const type = resolveTicketType(data?.type, data?.prioridad);

    return { email, description, categoryId, type };
  }

  /**
   * Crea el ticket llamando al backend. No lanza: ante un fallo HTTP/red
   * devuelve sent=false con el detalle del error para que el daemon lo
   * persista y el correo se reintente en el proximo ciclo.
   */
  async create(
    company: CompanyConfig,
    decision: GeminiDecision,
    context: TicketCreateContext,
    requesterEmailFallback?: string,
  ): Promise<TicketCreationResult> {
    const payload = this.buildPayload(decision, requesterEmailFallback);
    const url = `${this.baseUrl}${this.sendPath}`;

    const base: TicketCreationResult = {
      sent: false,
      skipped: false,
      url,
      http_status: null,
      request: payload,
      response: null,
      error: null,
    };

    if (!payload.email) {
      base.error = "No se pudo determinar el email del solicitante";
      await this.logResult(company, context, base, "warn");
      return base;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // Body exacto que se envia al endpoint de creacion de ticket.
    const body = JSON.stringify(payload);
    console.log(`body: ${body}   TERMINAAAAAAAAAAAAAAAAAAAAAA`);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        signal: controller.signal,
      });

      base.http_status = res.status;

      const raw = await res.text();
      let parsed: TicketSendResponse | null = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw) as TicketSendResponse;
        } catch {
          parsed = null;
        }
      }
      base.response = parsed;

      if (!res.ok) {
        base.error =
          parsed?.error ||
          `El backend respondio ${res.status}: ${this.truncate(raw)}`;
        await this.logResult(company, context, base, "error");
        return base;
      }

      base.sent = parsed?.sent === true;
      if (!base.sent) {
        base.error = parsed?.error || "El backend respondio sin sent=true";
        await this.logResult(company, context, base, "error");
        return base;
      }

      await this.logResult(company, context, base, "success");
      return base;
    } catch (err) {
      const error = err as Error;
      base.error =
        error.name === "AbortError"
          ? `Timeout (${this.timeoutMs}ms) llamando al backend de tickets`
          : error.message;
      await this.logResult(company, context, base, "error", error);
      return base;
    } finally {
      clearTimeout(timer);
    }
  }

  private async logResult(
    company: CompanyConfig,
    context: TicketCreateContext,
    result: TicketCreationResult,
    level: "success" | "warn" | "error",
    error?: Error,
  ): Promise<void> {
    const resolvedCategoryName =
      result.response?.category?.name ??
      categoryName(result.request.categoryId);

    const details = {
      url: result.url,
      http_status: result.http_status,
      request: result.request,
      category_name: resolvedCategoryName,
      sent: result.sent,
      requester: result.response?.requester ?? null,
      user_mail_sent: result.response?.userMailSent ?? null,
      support_mail_sent: result.response?.supportMailSent ?? null,
      backend_error: result.response?.error ?? null,
    };

    console.log(
      JSON.stringify(
        {
          event: result.sent ? "ticket.created" : "ticket.error",
          timestamp: new Date().toISOString(),
          company_id: company.id,
          company_name: company.name,
          ai_interaction_id: context.aiInteractionId,
          ...details,
          error: result.error,
        },
        null,
        2,
      ),
    );

    if (result.sent) {
      this.logger.log(
        `[empresa=${company.id}] [TICKET] Creado en backend para ${result.request.email} (categoria ${result.request.categoryId})`,
      );
    } else {
      this.logger.error(
        `[empresa=${company.id}] [TICKET] Fallo creacion para ${result.request.email}: ${result.error}`,
      );
    }

    // El logging NUNCA debe romper el flujo de creacion del ticket: si la
    // escritura a la BD falla, lo registramos en consola pero no propagamos,
    // para respetar el contrato no-throw de create().
    try {
      await this.database.logApp({
        companyId: company.id,
        runId: context.runId,
        mailMessageId: context.mailMessageId,
        attemptId: context.attemptId,
        aiInteractionId: context.aiInteractionId,
        level,
        component: TicketService.name,
        event: result.sent ? "ticket.created" : "ticket.error",
        message: result.sent
          ? "Ticket creado en el backend"
          : `No se pudo crear el ticket: ${result.error ?? "error desconocido"}`,
        details,
        error,
      });
    } catch (logErr) {
      this.logger.error(
        `[empresa=${company.id}] No se pudo persistir el log del ticket: ${
          (logErr as Error).message
        }`,
      );
    }
  }

  private truncate(text: string, maxLength = 300): string {
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }
}
