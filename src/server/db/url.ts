/**
 * Database URL helpers shared by the app and the build-time migration script.
 * No imports: this file is used by CLI scripts before anything else loads.
 */

/**
 * Accepts the connection string the way people paste it from Neon/Supabase:
 * plain, quoted, as a `psql '…'` command or as `DATABASE_URL=…`. postgres.js forwards unknown URL
 * parameters to the server as startup settings, and Postgres rejects `channel_binding` (which Neon
 * adds by default), so it is removed. TLS is still enforced through `sslmode`.
 */
export function normalizeDatabaseUrl(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/postgres(?:ql)?:\/\/[^\s'"]+/i);
  const candidate = match ? match[0] : trimmed.replace(/^['"]|['"]$/g, '');
  try {
    const url = new URL(candidate);
    url.searchParams.delete('channel_binding');
    return url.toString();
  } catch {
    return candidate;
  }
}

/** Removes passwords from any text that may contain a connection string. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:@\s/]+):[^@\s]+@/gi, '$1:***@')
    .replace(/(password\s*=\s*)[^&\s]+/gi, '$1***');
}

/** Host and database name only — safe to print in build logs. */
export function describeDatabaseTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname || ''}`;
  } catch {
    return 'an invalid URL';
  }
}

const HINTS: Record<string, string> = {
  '28P01': 'wrong database user or password — copy the connection string again from your database provider',
  '28000': 'the database refused this user',
  '3D000': 'the database name at the end of the URL does not exist',
  '42704': 'the URL contains a connection setting the server does not support',
  ENOTFOUND: 'the database host name is wrong',
  EAI_AGAIN: 'the database host name could not be resolved',
  ECONNREFUSED: 'the database refused the connection',
  ETIMEDOUT: 'timed out while connecting to the database',
  CONNECT_TIMEOUT: 'timed out while connecting to the database',
};

/** A short, credential-free explanation of a database error for logs. */
export function describeDatabaseError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ?? '';
  const message = redactSecrets(String(e?.message ?? err)).slice(0, 300);
  return `${HINTS[code] ?? 'database error'}${code ? ` [${code}]` : ''}: ${message}`;
}
