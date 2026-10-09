import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, isUniqueViolation, type Db } from '../db';
import { orders, restaurants, supportMessages, supportTickets } from '../db/schema';
import { AppError } from '../errors';
import { hasPermission, type AuthzSnapshot } from '../../lib/domain/permissions';
import { normalizeEgyptianPhone } from '../../lib/domain/misc';
import { audit } from './audit';

export const TICKET_CATEGORIES = ['ORDER', 'FOOD', 'DELIVERY', 'PAYMENT', 'APP', 'SUGGESTION', 'OTHER'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';

type TicketRow = typeof supportTickets.$inferSelect;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const bytes = randomBytes(6);
  return 'S-' + [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export interface CreateTicketInput {
  orderToken?: string | null;
  category: TicketCategory;
  message: string;
  customerName?: string | null;
  customerPhone?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Customer opens a complaint / question. Linked to an order when they come from its tracking page. */
export async function createTicket(input: CreateTicketInput) {
  const message = input.message.trim();
  if (message.length < 5) throw new AppError('VALIDATION', 'اكتب المشكلة بالتفصيل شوية');
  let order: typeof orders.$inferSelect | null = null;
  if (input.orderToken) {
    [order] = await db().select().from(orders).where(eq(orders.trackingToken, input.orderToken));
    if (!order) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  }
  const name = (input.customerName?.trim() || order?.customerName || '').slice(0, 60);
  if (name.length < 2) throw new AppError('VALIDATION', 'اكتب اسمك');
  let phone = order?.customerPhone ?? null;
  if (input.customerPhone?.trim()) {
    phone = normalizeEgyptianPhone(input.customerPhone);
    if (!phone) throw new AppError('VALIDATION', 'رقم الموبايل غير صحيح');
  }
  if (!order && !phone) throw new AppError('VALIDATION', 'اكتب رقم موبايلك عشان نقدر نرد عليك');
  const token = randomBytes(18).toString('base64url');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db().transaction(async (tx) => {
        const now = new Date();
        const [ticket] = await tx.insert(supportTickets).values({
          code: newCode(), token, restaurantId: order?.restaurantId ?? null, orderId: order?.id ?? null,
          category: input.category, status: 'OPEN', customerName: name, customerPhone: phone,
          subject: message.slice(0, 120), lastMessageAt: now, createdAt: now, updatedAt: now,
        }).returning();
        await tx.insert(supportMessages).values({ ticketId: ticket.id, authorType: 'CUSTOMER', authorName: name, body: message.slice(0, 2000), createdAt: now });
        await audit({ actor: { type: 'CUSTOMER', label: 'customer' }, action: 'support.ticket_created', entity: 'support_ticket', entityId: ticket.id, restaurantId: ticket.restaurantId, after: { code: ticket.code, category: ticket.category, orderNumber: order?.orderNumber ?? null }, ip: input.ip, userAgent: input.userAgent }, tx);
        return { token: ticket.token, code: ticket.code };
      });
    } catch (err) {
      if (!isUniqueViolation(err, 'support_tickets_code_unique')) throw err;
    }
  }
  throw new AppError('INTERNAL', 'Could not allocate a ticket code');
}

export interface TicketThread {
  ticket: TicketRow & { restaurantNameAr: string | null; restaurantNameEn: string | null; orderNumber: string | null; orderToken: string | null };
  messages: { id: string; authorType: 'CUSTOMER' | 'USER' | 'SYSTEM'; authorName: string | null; body: string; createdAt: Date }[];
}

async function loadThread(d: Db, where: ReturnType<typeof eq>): Promise<TicketThread | null> {
  const [row] = await d.select({ t: supportTickets, restaurantNameAr: restaurants.nameAr, restaurantNameEn: restaurants.nameEn, orderNumber: orders.orderNumber, orderToken: orders.trackingToken })
    .from(supportTickets)
    .leftJoin(restaurants, eq(restaurants.id, supportTickets.restaurantId))
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .where(where);
  if (!row) return null;
  const messages = await d.select({ id: supportMessages.id, authorType: supportMessages.authorType, authorName: supportMessages.authorName, body: supportMessages.body, createdAt: supportMessages.createdAt })
    .from(supportMessages).where(eq(supportMessages.ticketId, row.t.id)).orderBy(asc(supportMessages.createdAt));
  return { ticket: { ...row.t, restaurantNameAr: row.restaurantNameAr, restaurantNameEn: row.restaurantNameEn, orderNumber: row.orderNumber, orderToken: row.orderToken }, messages };
}

/** Customer view (bearer token). Staff names are not shown to customers. */
export async function ticketByToken(token: string) {
  const thread = await loadThread(db(), eq(supportTickets.token, token));
  if (!thread) return null;
  return { ...thread, messages: thread.messages.map((m) => ({ ...m, authorName: m.authorType === 'CUSTOMER' ? m.authorName : null })) };
}

export function canHandleTicket(auth: AuthzSnapshot, ticket: Pick<TicketRow, 'restaurantId'>): boolean {
  if (hasPermission(auth, 'platform.support')) return true;
  return !!ticket.restaurantId && hasPermission(auth, 'support.manage', ticket.restaurantId);
}

export async function ticketForStaff(id: string, auth: AuthzSnapshot) {
  const thread = await loadThread(db(), eq(supportTickets.id, id));
  if (!thread || !canHandleTicket(auth, thread.ticket)) return null;
  return thread;
}

export async function customerReply(token: string, body: string) {
  const text = body.trim();
  if (text.length < 2) throw new AppError('VALIDATION', 'اكتب ردك');
  return db().transaction(async (tx) => {
    const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.token, token)).for('update');
    if (!ticket) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
    const now = new Date();
    await tx.insert(supportMessages).values({ ticketId: ticket.id, authorType: 'CUSTOMER', authorName: ticket.customerName, body: text.slice(0, 2000), createdAt: now });
    // A customer writing again re-opens the conversation.
    await tx.update(supportTickets).set({ status: 'OPEN', closedAt: null, lastMessageAt: now, updatedAt: now }).where(eq(supportTickets.id, ticket.id));
  });
}

export async function staffReply(input: { ticketId: string; body: string; close?: boolean; actor: { userId: string; name: string; auth: AuthzSnapshot; ip?: string | null; userAgent?: string | null } }) {
  const text = input.body.trim();
  if (text.length < 2) throw new AppError('VALIDATION', 'اكتب ردك');
  return db().transaction(async (tx) => {
    const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, input.ticketId)).for('update');
    if (!ticket || !canHandleTicket(input.actor.auth, ticket)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
    const now = new Date();
    await tx.insert(supportMessages).values({ ticketId: ticket.id, authorType: 'USER', authorUserId: input.actor.userId, authorName: input.actor.name, body: text.slice(0, 2000), createdAt: now });
    await tx.update(supportTickets).set({ status: input.close ? 'CLOSED' : 'ANSWERED', closedAt: input.close ? now : null, lastMessageAt: now, updatedAt: now }).where(eq(supportTickets.id, ticket.id));
    await audit({ actor: { type: 'USER', userId: input.actor.userId, label: input.actor.name }, action: 'support.replied', entity: 'support_ticket', entityId: ticket.id, restaurantId: ticket.restaurantId, after: { code: ticket.code, closed: !!input.close }, ip: input.actor.ip, userAgent: input.actor.userAgent }, tx);
  });
}

export async function setTicketStatus(input: { ticketId: string; status: 'OPEN' | 'CLOSED'; actor: { userId: string; name: string; auth: AuthzSnapshot } }) {
  const [ticket] = await db().select().from(supportTickets).where(eq(supportTickets.id, input.ticketId));
  if (!ticket || !canHandleTicket(input.actor.auth, ticket)) throw new AppError('NOT_FOUND', 'الطلب غير موجود');
  const now = new Date();
  await db().update(supportTickets).set({ status: input.status, closedAt: input.status === 'CLOSED' ? now : null, updatedAt: now }).where(eq(supportTickets.id, ticket.id));
  await audit({ actor: { type: 'USER', userId: input.actor.userId, label: input.actor.name }, action: `support.${input.status === 'CLOSED' ? 'closed' : 'reopened'}`, entity: 'support_ticket', entityId: ticket.id, restaurantId: ticket.restaurantId });
}

/** Restaurant inbox (its tickets) or platform inbox (restaurantId null = everything). */
export async function listTickets(d: Db, scope: { restaurantId: string | null }, status?: TicketStatus | 'ACTIVE') {
  const statusCond = status === 'ACTIVE' ? inArray(supportTickets.status, ['OPEN', 'ANSWERED']) : status ? eq(supportTickets.status, status) : undefined;
  return d.select({
    id: supportTickets.id, code: supportTickets.code, category: supportTickets.category, status: supportTickets.status,
    subject: supportTickets.subject, customerName: supportTickets.customerName, lastMessageAt: supportTickets.lastMessageAt,
    restaurantNameAr: restaurants.nameAr, restaurantNameEn: restaurants.nameEn, orderNumber: orders.orderNumber,
  })
    .from(supportTickets)
    .leftJoin(restaurants, eq(restaurants.id, supportTickets.restaurantId))
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .where(and(scope.restaurantId ? eq(supportTickets.restaurantId, scope.restaurantId) : undefined, statusCond))
    .orderBy(sql`case when ${supportTickets.status} = 'OPEN' then 0 when ${supportTickets.status} = 'ANSWERED' then 1 else 2 end`, desc(supportTickets.lastMessageAt))
    .limit(200);
}

/** Tickets waiting for a reply (nav badges). */
export async function openTicketCount(d: Db, restaurantId: string | null): Promise<number> {
  const [row] = await d.select({ n: sql<number>`count(*)::int` }).from(supportTickets)
    .where(and(eq(supportTickets.status, 'OPEN'), restaurantId ? eq(supportTickets.restaurantId, restaurantId) : undefined));
  return Number(row?.n ?? 0);
}
