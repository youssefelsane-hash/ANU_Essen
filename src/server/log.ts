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
}
