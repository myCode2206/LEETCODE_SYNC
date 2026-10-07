import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_BASE_URL: z.url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1, 'GITHUB_CLIENT_ID is required'),
  GITHUB_CLIENT_SECRET: z.string().min(1, 'GITHUB_CLIENT_SECRET is required'),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    ),
  ALLOWED_EXTENSION_IDS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  publicBaseUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  databaseUrl: string;
  github: { clientId: string; clientSecret: string };
  tokenEncryptionKey: Buffer;
  allowedExtensionIds: string[];
  sessionTtlDays: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && e.ALLOWED_EXTENSION_IDS.length === 0) {
    throw new Error('ALLOWED_EXTENSION_IDS must be set in production');
  }
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    github: { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET },
    tokenEncryptionKey: Buffer.from(e.TOKEN_ENCRYPTION_KEY, 'base64'),
    allowedExtensionIds: e.ALLOWED_EXTENSION_IDS,
    sessionTtlDays: e.SESSION_TTL_DAYS,
  };
}
