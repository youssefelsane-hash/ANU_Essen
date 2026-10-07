import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { describeDatabaseError, describeDatabaseTarget, normalizeDatabaseUrl, redactSecrets } from '@/server/db/url';
import { bootstrapSuperAdmin } from '@/server/seed';
import { loadAuthz } from '@/server/auth/authz';
import { verifyPassword } from '@/server/auth/password';
import * as s from '@/server/db/schema';
import { setupTestDb } from './helpers/db';

const neon = 'postgresql://neondb_owner:npg_SECRET123@ep-cool-sky-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('database URL handling', () => {
  it('accepts the connection string however it was pasted, without channel_binding', () => {
    const expected = 'postgresql://neondb_owner:npg_SECRET123@ep-cool-sky-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';
    expect(normalizeDatabaseUrl(neon)).toBe(expected);
    expect(normalizeDatabaseUrl(`  '${neon}'  `)).toBe(expected);
    expect(normalizeDatabaseUrl(`psql '${neon}'`)).toBe(expected);
    expect(normalizeDatabaseUrl(`DATABASE_URL=${neon}`)).toBe(expected);
    expect(normalizeDatabaseUrl('postgres://u:p@localhost:5432/db')).toBe('postgres://u:p@localhost:5432/db');
  });

  it('never prints the password', () => {
    expect(redactSecrets(`failed to connect to ${neon}`)).not.toContain('npg_SECRET123');
    expect(redactSecrets('host=x password=hunter2 user=y')).not.toContain('hunter2');
    expect(describeDatabaseTarget(neon)).toBe('ep-cool-sky-123-pooler.eu-central-1.aws.neon.tech/neondb');
    const message = describeDatabaseError(Object.assign(new Error(`password authentication failed (${neon})`), { code: '28P01' }));
    expect(message).toContain('wrong database user or password');
    expect(message).not.toContain('npg_SECRET123');
  });
});

describe('first platform owner on a new deployment', () => {
  it('is created once from deploy variables and never overwritten', async () => {
    const { d } = await setupTestDb(); // the test DB already has an admin
    expect(await bootstrapSuperAdmin(d, { email: 'new@example.com', password: 'another-strong-pass' })).toBe('exists');
    expect(await d.select().from(s.users).where(eq(s.users.email, 'new@example.com'))).toHaveLength(0);

    // Fresh database: remove the existing platform owner role assignments.
    const [role] = await d.select().from(s.roles).where(eq(s.roles.key, 'SUPER_ADMIN'));
    await d.delete(s.userRoles).where(eq(s.userRoles.roleId, role.id));
    await expect(bootstrapSuperAdmin(d, { email: 'owner@example.com', password: 'short' })).rejects.toThrow(/12 characters/);
    expect(await bootstrapSuperAdmin(d, { email: 'Owner@Example.com', password: 'Very-Strong-Pass-2026' })).toBe('created');

    const [user] = await d.select().from(s.users).where(eq(s.users.email, 'owner@example.com'));
    expect(await verifyPassword('Very-Strong-Pass-2026', user.passwordHash)).toBe(true);
    const auth = await loadAuthz(d, { id: user.id, name: user.name, email: user.email });
    expect(auth.platformPermissions.has('platform.restaurants')).toBe(true);

    // Redeploy with a different password: nothing changes.
    expect(await bootstrapSuperAdmin(d, { email: 'owner@example.com', password: 'Changed-Password-999' })).toBe('exists');
    const [again] = await d.select().from(s.users).where(eq(s.users.email, 'owner@example.com'));
    expect(again.passwordHash).toBe(user.passwordHash);
  });
});

describe('APP_URL', () => {
  it('tolerates a missing scheme or trailing slash, and ignores garbage instead of crashing', async () => {
    const { normalizeAppUrl } = await import('@/server/env');
    expect(normalizeAppUrl('anu-essen.vercel.app')).toBe('https://anu-essen.vercel.app');
    expect(normalizeAppUrl('https://order.example.com/')).toBe('https://order.example.com');
    expect(normalizeAppUrl('"https://order.example.com"')).toBe('https://order.example.com');
    expect(normalizeAppUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeAppUrl('not a url at all')).toBeUndefined();
    expect(normalizeAppUrl('')).toBeUndefined();
  });
});
