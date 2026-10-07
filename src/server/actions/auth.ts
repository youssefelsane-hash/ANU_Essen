'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '../db';
import { users } from '../db/schema';
import { hashPassword, verifyPassword } from '../auth/password';
import { createSession, destroySession } from '../auth/session';
import { loadAuthz } from '../auth/authz';
import { hitRateLimit } from '../rate-limit';
import { audit } from '../services/audit';
import { requestMeta } from './util';
import type { ActionState } from '../../lib/action-state';

let dummyHash: Promise<string> | null = null;

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');
  const next = String(fd.get('next') ?? '');
  const meta = await requestMeta();
  if (!email || !password) return { ok: false, error: 'اكتب البريد الإلكتروني وكلمة المرور', at: Date.now() };

  const { allowed } = await hitRateLimit(`login:${meta.ip ?? 'unknown'}:${email}`, 10, 900);
  if (!allowed) return { ok: false, error: 'محاولات كتير. جرّب تاني بعد 15 دقيقة', at: Date.now() };

  const [user] = await db().select().from(users).where(eq(users.email, email));
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  dummyHash ??= hashPassword('not-the-password');
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !user.isActive || !valid) {
    await audit({ actor: { type: 'SYSTEM', label: email }, action: 'auth.login_failed', entity: 'user', entityId: user?.id ?? null, ip: meta.ip, userAgent: meta.userAgent });
    return { ok: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة', at: Date.now() };
  }

  await createSession(user.id, meta);
  await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit({ actor: { type: 'USER', userId: user.id, label: user.name }, action: 'auth.login', entity: 'user', entityId: user.id, ip: meta.ip, userAgent: meta.userAgent });

  const auth = await loadAuthz(db(), { id: user.id, name: user.name, email: user.email });
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : null;
  redirect(safeNext ?? (auth.isPlatform ? '/admin' : '/merchant'));
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}
