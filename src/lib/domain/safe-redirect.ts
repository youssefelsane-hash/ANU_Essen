/** Login can return only to a local path; browsers treat backslashes as URL separators. */
export function safeLocalRedirect(value: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const base = 'https://local.invalid';
    return new URL(value, base).origin === base ? value : null;
  } catch { return null; }
}
