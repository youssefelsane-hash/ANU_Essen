import type { AuthContext } from './authz';
import { AppError } from '../errors';

/** Bind a long-lived screen and its durable outbox to the current cookie's account. */
export function assertRequestActor(auth: AuthContext, actorUserId: unknown): void {
  if (typeof actorUserId !== 'string' || actorUserId !== auth.user.id) {
    throw new AppError('UNAUTHENTICATED', 'Please sign in');
  }
}
