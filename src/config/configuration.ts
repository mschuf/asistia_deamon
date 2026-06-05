export interface AppConfig {
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
    poolMax: number;
  };
  microsoft: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    mailbox: string;
    mailFolder: string;
  };
  gemini: {
    apiKey: string;
    model: string;
  };
  daemon: {
    intervalSeconds: number;
    maxEmails: number;
  };
  ticketApi: {
    baseUrl: string;
    sendPath: string;
    defaultCategoryId: number;
    timeoutMs: number;
  };
}

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
};

export default (): AppConfig => ({
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: positiveInt(process.env.DB_PORT, 5432),
    name: process.env.DB_NAME || 'asistia_back',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true',
    poolMax: positiveInt(process.env.DB_POOL_MAX, 10),
  },
  microsoft: {
    tenantId: process.env.MS_TENANT_ID || '',
    clientId: process.env.MS_CLIENT_ID || '',
    clientSecret: process.env.MS_CLIENT_SECRET || '',
    mailbox: process.env.MS_MAILBOX || 'TI.soporte@grupopettengill.com.py',
    mailFolder: process.env.MS_MAIL_FOLDER || 'inbox',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
  },
  daemon: {
    intervalSeconds: positiveInt(process.env.DAEMON_INTERVAL_SECONDS, 60),
    maxEmails: positiveInt(process.env.DAEMON_MAX_EMAILS, 20),
  },
  ticketApi: {
    baseUrl: (process.env.TICKET_API_BASE_URL || 'http://192.168.10.88:5173').replace(
      /\/+$/,
      '',
    ),
    sendPath: process.env.TICKET_API_SEND_PATH || '/api/v1/mail/send',
    defaultCategoryId: positiveInt(process.env.TICKET_DEFAULT_CATEGORY_ID, 66),
    timeoutMs: positiveInt(process.env.TICKET_API_TIMEOUT_MS, 15000),
  },
});
