/**
 * Refunds: staff gives money back (full / partial), customers ask from the tracking page,
 * and every report (dashboard, platform commission ledger) reflects it.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '@/server/db/schema';
import type { Db } from '@/server/db';
import type { AuthContext } from '@/server/auth/authz';
import { AppError } from '@/server/errors';
import { createOrder } from '@/server/services/checkout';
import { applyOrderAction, type ActionActor } from '@/server/services/order-actions';
import { loadOrderSnapshots, loadTrackingView } from '@/server/services/order-views';
import { recordRefund, refundQueue, rejectRefundRequest, requestRefundByCustomer, REFUND_REQUEST_WINDOW_HOURS } from '@/server/services/refunds';
import { financeByRestaurant, periodStats } from '@/server/services/stats';
import { merchantSync } from '@/server/services/sync';
import { authFor, setupTestDb } from './helpers/db';

let d: Db;
let restaurantId: string;
let productId: string, variantId: string;
let owner: AuthContext, cashier: AuthContext, kitchen: AuthContext, admin: AuthContext;
let n = 0;
const key = () => `rf-${++n}-${Math.random().toString(36).slice(2)}`;
const staff = (a: AuthContext): ActionActor => ({ type: 'USER', userId: a.user.id, label: a.user.name, auth: a });
const actor = (a: AuthContext) => ({ userId: a.user.id, name: a.user.name, auth: a });
const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
const orderRow = async (id: string) => (await d.select().from(s.orders).where(eq(s.orders.id, id)))[0];

/** A paid (InstaPay verified) pickup order, completed. */
async function completedInstapayOrder() {
  const o = await createOrder('alrayez', { items: [{ productId, variantId, addonIds: [], quantity: 2 }], customerName: 'Sara', customerPhone: '01055556666', paymentMethod: 'INSTAPAY' }, key());
  await applyOrderAction({ orderId: o.orderId, action: 'SUBMIT_PAYMENT', actor: { type: 'CUSTOMER', label: 'customer' }, payload: { reference: 'IPN' } });
  await applyOrderAction({ orderId: o.orderId, action: 'VERIFY_PAYMENT', actor: staff(cashier) });
  for (const action of ['START_PREPARING', 'MARK_READY', 'OUT_FOR_DELIVERY', 'MARK_ARRIVED', 'COMPLETE'] as const) {
    await applyOrderAction({ orderId: o.orderId, action, actor: staff(owner) });
  }
  return o;
}

beforeAll(async () => {
  let demo;
  ({ d, demo } = await setupTestDb());
  restaurantId = demo.restaurantId;
  productId = demo.productIds['Chicken Shawarma Sandwich'];
  variantId = demo.variantIds['Chicken Shawarma Sandwich:Regular'];
  owner = await authFor(d, 'owner@alrayez.test');
  cashier = await authFor(d, 'cashier@alrayez.test');
  kitchen = await authFor(d, 'kitchen@alrayez.test');
  admin = await authFor(d, 'admin@test.local');
});

describe('staff refunds', () => {
  it('only owners / managers / the platform may refund', async () => {
    const o = await completedInstapayOrder();
    await expectCode(recordRefund({ orderId: o.orderId, method: 'INSTAPAY', actor: actor(cashier) }), 'FORBIDDEN');
    await expectCode(recordRefund({ orderId: o.orderId, method: 'INSTAPAY', actor: actor(kitchen) }), 'FORBIDDEN');
    // Another restaurant's scope is rejected even for a valid refunder.
    await expectCode(recordRefund({ orderId: o.orderId, restaurantId: crypto.randomUUID(), method: 'INSTAPAY', actor: actor(owner) }), 'NOT_FOUND');
    const r = await recordRefund({ orderId: o.orderId, method: 'INSTAPAY', actor: actor(admin) });
    expect(r.paymentStatus).toBe('REFUNDED');
  });

  it('partial then full refund, never more than was paid; commission reversed proportionally', async () => {
    const o = await completedInstapayOrder();
    const before = await orderRow(o.orderId);
    const part = Math.floor(before.total / 4);
    const first = await recordRefund({ orderId: o.orderId, amount: part, method: 'INSTAPAY', reason: 'صنف ناقص', reference: 'R-1', actor: actor(owner) });
    expect(first.paymentStatus).toBe('PARTIALLY_REFUNDED');
    await expectCode(recordRefund({ orderId: o.orderId, amount: before.total, method: 'INSTAPAY', actor: actor(owner) }), 'VALIDATION');
    await expectCode(recordRefund({ orderId: o.orderId, amount: 0, method: 'INSTAPAY', actor: actor(owner) }), 'VALIDATION');
    const rest = await recordRefund({ orderId: o.orderId, method: 'CASH', actor: actor(owner) });
    expect(rest.amount).toBe(before.total - part);
    const after = await orderRow(o.orderId);
    expect(after.refundedTotal).toBe(before.total);
    expect(after.paymentStatus).toBe('REFUNDED');
    const [payment] = await d.select().from(s.payments).where(eq(s.payments.orderId, o.orderId));
    expect(payment.status).toBe('REFUNDED');
    await expectCode(recordRefund({ orderId: o.orderId, method: 'CASH', actor: actor(owner) }), 'CONFLICT');

    const rows = await d.select().from(s.refunds).where(eq(s.refunds.orderId, o.orderId));
    expect(rows.reduce((a, r) => a + r.commissionReversed, 0)).toBeGreaterThanOrEqual(before.commissionAmount - 1);
    const logs = await d.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, o.orderId), eq(s.auditLogs.action, 'order.refund')));
    expect(logs).toHaveLength(2);
  });

  it('refuses unpaid orders (cash not collected yet)', async () => {
    const o = await createOrder('alrayez', { items: [{ productId, variantId, addonIds: [], quantity: 1 }], customerName: 'Ali', customerPhone: '01000000001', paymentMethod: 'CASH' }, key());
    await expectCode(recordRefund({ orderId: o.orderId, method: 'CASH', actor: actor(owner) }), 'CONFLICT');
  });

  it('reaches every merchant device through the sync feed', async () => {
    const o = await completedInstapayOrder();
    const device = crypto.randomUUID();
    const boot = await merchantSync({ auth: owner, restaurantId, deviceId: device, cursor: 0 });
    await recordRefund({ orderId: o.orderId, amount: 100, method: 'INSTAPAY', actor: actor(owner) });
    const next = await merchantSync({ auth: owner, restaurantId, deviceId: device, cursor: boot.cursor });
    const snap = next.orders.find((x) => x.id === o.orderId)!;
    expect(snap.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(snap.refundedTotal).toBe(100);
    expect(snap.refunds?.[0]).toMatchObject({ status: 'COMPLETED', amount: 100 });
    expect(snap.timeline.some((e) => e.type === 'REFUNDED')).toBe(true);
  });
});

describe('customer refund requests', () => {
  it('can be asked once after a paid order finished, then approved', async () => {
    const o = await completedInstapayOrder();
    const view = (await loadTrackingView(d, o.trackingToken))!;
    expect(view.order.canRequestRefund).toBe(true);

    await expectCode(requestRefundByCustomer({ token: o.trackingToken, reason: 'x' }), 'VALIDATION');
    const { refundId } = await requestRefundByCustomer({ token: o.trackingToken, reason: 'الأكل وصل بارد', payoutDetails: 'sara@instapay' });
    await expectCode(requestRefundByCustomer({ token: o.trackingToken, reason: 'تاني' }), 'CONFLICT');

    const after = (await loadTrackingView(d, o.trackingToken))!;
    expect(after.order.canRequestRefund).toBe(false);
    expect(after.order.refunds[0]).toMatchObject({ status: 'REQUESTED', reason: 'الأكل وصل بارد' });
    // The payout address is for staff only.
    expect(after.order.refunds[0]).not.toHaveProperty('payoutDetails');
    const [staffView] = await loadOrderSnapshots(d, [o.orderId], { includePhone: true });
    expect(staffView.refunds?.[0].payoutDetails).toBe('sara@instapay');

    const queue = await refundQueue(d, restaurantId);
    expect(queue.open.map((r) => r.refundId)).toContain(refundId);

    // Approving completes the same request (no duplicate row).
    await recordRefund({ orderId: o.orderId, method: 'INSTAPAY', reference: 'BACK-1', actor: actor(owner) });
    const rows = await d.select().from(s.refunds).where(eq(s.refunds.orderId, o.orderId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: refundId, status: 'COMPLETED', requestedByCustomer: true, reference: 'BACK-1' });
  });

  it('can be declined with a note the customer sees', async () => {
    const o = await completedInstapayOrder();
    const { refundId } = await requestRefundByCustomer({ token: o.trackingToken, reason: 'مش عاجبني' });
    await expectCode(rejectRefundRequest({ refundId, note: 'ok', actor: actor(cashier) }), 'FORBIDDEN');
    await expectCode(rejectRefundRequest({ refundId, note: '', actor: actor(owner) }), 'VALIDATION');
    await rejectRefundRequest({ refundId, note: 'الطلب اتسلم كامل', actor: actor(owner) });
    const view = (await loadTrackingView(d, o.trackingToken))!;
    expect(view.order.refunds[0]).toMatchObject({ status: 'REJECTED', decisionNote: 'الطلب اتسلم كامل' });
    await expectCode(rejectRefundRequest({ refundId, note: 'تاني', actor: actor(owner) }), 'CONFLICT');
  });

  it('is not offered for active, unpaid, or old orders', async () => {
    const active = await createOrder('alrayez', { items: [{ productId, variantId, addonIds: [], quantity: 1 }], customerName: 'Ali', customerPhone: '01000000002', paymentMethod: 'CASH' }, key());
    expect((await loadTrackingView(d, active.trackingToken))!.order.canRequestRefund).toBe(false);
    await expectCode(requestRefundByCustomer({ token: active.trackingToken, reason: 'عايز فلوسي' }), 'CONFLICT');

    const old = await completedInstapayOrder();
    const late = new Date(Date.now() + (REFUND_REQUEST_WINDOW_HOURS + 1) * 3_600_000);
    await expectCode(requestRefundByCustomer({ token: old.trackingToken, reason: 'متأخر', now: late }), 'CONFLICT');
  });

  it('covers a transfer sent for an order that was then cancelled', async () => {
    const o = await createOrder('alrayez', { items: [{ productId, variantId, addonIds: [], quantity: 1 }], customerName: 'Hana', customerPhone: '01000000003', paymentMethod: 'INSTAPAY' }, key());
    await applyOrderAction({ orderId: o.orderId, action: 'SUBMIT_PAYMENT', actor: { type: 'CUSTOMER', label: 'customer' }, payload: { reference: 'IPN-X' } });
    await applyOrderAction({ orderId: o.orderId, action: 'CANCEL', actor: staff(owner), payload: { reason: 'خلص الصنف' } });
    const queue = await refundQueue(d, restaurantId);
    expect(queue.cancelledPaid.map((r) => r.orderId)).toContain(o.orderId);
    await recordRefund({ orderId: o.orderId, method: 'INSTAPAY', actor: actor(owner) });
    expect((await orderRow(o.orderId)).paymentStatus).toBe('REFUNDED');
    expect((await refundQueue(d, restaurantId)).cancelledPaid.map((r) => r.orderId)).not.toContain(o.orderId);
  });
});

describe('reports net of refunds', () => {
  it('reduces sales, commission and the restaurant net for the period', async () => {
    const from = new Date(Date.now() - 60_000);
    const o = await completedInstapayOrder();
    const row = await orderRow(o.orderId);
    const to = () => new Date(Date.now() + 60_000);
    const before = await periodStats(d, from, to(), restaurantId);
    const ledgerBefore = (await financeByRestaurant(d, from, to())).find((f) => f.restaurantId === restaurantId)!;

    const amount = Math.floor(row.total / 2);
    await recordRefund({ orderId: o.orderId, amount, method: 'INSTAPAY', actor: actor(owner) });
    const [refund] = await d.select().from(s.refunds).where(eq(s.refunds.orderId, o.orderId));

    const after = await periodStats(d, from, to(), restaurantId);
    expect(after.grossSales).toBe(before.grossSales);
    expect(after.sales).toBe(before.sales - amount);
    expect(after.refunds).toBe(before.refunds + amount);
    expect(after.commission).toBe(before.commission - refund.commissionReversed);
    expect(after.merchantNet).toBe(before.merchantNet - (amount - refund.commissionReversed));

    const ledger = (await financeByRestaurant(d, from, to())).find((f) => f.restaurantId === restaurantId)!;
    expect(ledger.period.refunds).toBe(ledgerBefore.period.refunds + amount);
    expect(ledger.allTime.commission).toBe(ledgerBefore.allTime.commission - refund.commissionReversed);
  });
});
