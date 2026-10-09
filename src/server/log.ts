/** Structured JSON logs (Vercel/any log drain friendly) + a pluggable error reporter. */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level) ?? 'info';
  return ORDER[lvl] ?? ORDER.info;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => write('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write('error', msg, f),
};

export type ErrorReporter = (err: unknown, context: Record<string, unknown>) => void;
let reporter: ErrorReporter | null = null;

/** Plug Sentry/Logtail/etc. here at startup (see README). */
export function setErrorReporter(r: ErrorReporter) {
  reporter = r;
}

export function reportError(err: unknown, context: Record<string, unknown> = {}) {
  const e = err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { value: String(err) };
  write('error', 'unhandled_error', { ...context, error: e });
  try {
    reporter?.(err, context);
  } catch {
    /* never let reporting break a request */
  }
  void sendAlert(`${err instanceof Error ? err.name : 'Error'}: ${err instanceof Error ? err.message : String(err)}`, context);
}

const lastAlert = new Map<string, number>();

/**
 * Instant alert to a chat webhook (ALERT_WEBHOOK_URL: Slack / Discord / Telegram sendMessage URL).
 * At most one alert per distinct message per 5 minutes per server instance; never includes request
 * bodies, and connection strings / tokens are redacted.
 */
export async function sendAlert(message: string, context: Record<string, unknown> = {}) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const clean = message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://[redacted]').replace(/(token|secret|password)=\S+/gi, '$1=[redacted]').slice(0, 300);
  const key = clean.slice(0, 120);
  const now = Date.now();
  if (now - (lastAlert.get(key) ?? 0) < 5 * 60_000) return;
  lastAlert.set(key, now);
  const where = typeof context.where === 'string' ? context.where : typeof context.path === 'string' ? context.path : '';
  const text = `🚨 ${process.env.VERCEL_ENV ?? 'local'}${where ? ` · ${where}` : ''}\n${clean}`;
  try {
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(3000) });
  } catch {
    /* alerting is best effort */
  }
}
