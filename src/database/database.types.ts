export interface CompanyPrompt {
  id: number;
  systemInstruction: string;
  promptTemplate: string;
}

export interface CompanyConfig {
  id: number;
  name: string;
  msTenantId: string;
  msClientId: string;
  msClientSecret: string;
  msMailbox: string;
  msMailFolder: string;
  geminiModel: string;
  prompt: CompanyPrompt;
}

export type DaemonRunStatus =
  | 'running'
  | 'success'
  | 'partial_error'
  | 'error'
  | 'cancelled';

export type EmailProcessingStatus =
  | 'processing'
  | 'success'
  | 'error'
  | 'skipped';

export type AiInteractionStatus = 'pending' | 'success' | 'error';

export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';
