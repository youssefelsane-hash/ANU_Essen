import { ZodError } from 'zod';
import { AppError } from './errors';
import { log, reportError } from './log';
import { PricingError } from '../lib/domain/pricing';
import { errorMessage, languageScope, LANGUAGE_COOKIES, resolveLocale, type Locale } from '../lib/i18n';

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip');
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  // Private by default; a route may opt into shared caching explicitly.
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return Response.json(data, { ...init, headers });
}

export function errorResponse(err: unknown, requestId: string, locale: Locale = 'ar'): Response {
  if (err instanceof AppError) {
    return json({ error: { code: err.code, message: errorMessage(err.code, locale, err.message), details: err.details, requestId } }, { status: err.status });
  }
  if (err instanceof PricingError) {
    return json({ error: { code: 'PRICING', message: errorMessage('PRICING', locale, err.message), details: { reason: err.code, ...err.meta }, requestId } }, { status: 422 });
  }
  if (err instanceof ZodError) {
    return json(
      { error: { code: 'VALIDATION', message: errorMessage('VALIDATION', locale), details: { fields: err.issues.slice(0, 10).map((issue) => issue.path.join('.')) }, requestId } },
      { status: 400 },
    );
  }
  reportError(err, { requestId });
  return json({ error: { code: 'INTERNAL', message: errorMessage('INTERNAL', locale), requestId } }, { status: 500 });
}

/** Route wrapper: request id, structured access log, uniform error mapping. */
export function route<Ctx>(handler: (req: Request, ctx: Ctx, meta: RequestMeta) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const started = Date.now();
    let res: Response;
    try {
      res = await handler(req, ctx, { requestId, ip: clientIp(req), userAgent: req.headers.get('user-agent') });
    } catch (err) {
      const scope = languageScope(new URL(req.url).pathname);
      const pref = req.headers.get('cookie')?.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${LANGUAGE_COOKIES[scope]}=`))?.split('=')[1];
      res = errorResponse(err, requestId, resolveLocale(scope, pref, req.headers.get('accept-language')));
    }
    res.headers.set('x-request-id', requestId);
    const fields = { requestId, method: req.method, path: new URL(req.url).pathname, status: res.status, ms: Date.now() - started };
    if (res.status >= 500) log.error('request', fields);
    else if (req.method === 'GET' && res.status < 400) log.debug('request', fields);
    else log.info('request', fields);
    return res;
  };
}

/** Cookie-authenticated mutations require the same protocol, host and port. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('FORBIDDEN', 'Cross-origin request blocked');
  if (!origin) return; // non-browser clients (no ambient cookies are sent cross-site without Origin)
  try {
    if (new URL(origin).origin !== origin || origin !== new URL(req.url).origin) throw new AppError('FORBIDDEN', 'Cross-origin request blocked');
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('FORBIDDEN', 'Bad origin');
  }
}

export async function readJson(req: Request, maxBytes = 1_000_000): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE', 'Request too large');
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE', 'Request too large');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AppError('VALIDATION', 'Invalid JSON');
  }
}
