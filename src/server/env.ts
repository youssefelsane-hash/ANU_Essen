import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  APP_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ORDER_IP_RATE_LIMIT: z.coerce.number().int().min(100).max(10000).default(600),
  ORDER_PHONE_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(8),
  QUOTE_IP_RATE_LIMIT: z.coerce.number().int().min(100).max(10000).default(1200),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

/** Validated environment. Parsed lazily so unit tests and builds don't need every variable. */
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === 'production';
