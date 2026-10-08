import { describe, expect, it } from 'vitest';
import { courierJobStage, courierOrders, type CourierBoardState, type CourierStore } from '@/client/merchant/delivery-board';
import type { EngineState } from '@/client/merchant/engine';
import type { OrderSnapshot } from '@/lib/types';

const store = (id: string): CourierStore => ({ id, nameAr: `مطعم ${id}`, nameEn: `Restaurant ${id}`, timezone: 'Africa/Cairo', permissions: ['orders.delivery'] });
function order(restaurantId: string, id: string, overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    id, restaurantId, orderNumber: 'A100', status: 'READY', fulfillment: 'DELIVERY', channel: 'ONLINE',
    paymentMethod: 'CASH', paymentStatus: 'CASH', paymentReference: null, paymentRejectedReason: null, hasPaymentAttachment: false,
    customerName: 'Customer', customerPhone: '01012345678', customerNote: null, deliveryPointName: 'بوابة الجامعة',
    items: [], subtotal: 10000, discountTotal: 0, deliveryFee: 0, total: 10000, currency: 'EGP', promoCode: null, loadUnits: 1,
    estimatedReadyAt: null, estimatedArrivalAt: null, createdAt: 1000, confirmedAt: 1001, preparingAt: null, readyAt: 1002,
    outForDeliveryAt: null, arrivedAt: null, completedAt: null, cancelledAt: null, cancelReason: null, assignedToUserId: null,
    assignedToName: null, timeline: [], version: 1, ...overrides,
  };
}
function state(orders: OrderSnapshot[], overrides: Partial<EngineState> = {}): EngineState {
  return { ready: true, orders, pending: {}, outboxCount: 0, connectivity: 'online', lastSyncAt: 1000, store: null, serverOffset: 0, authError: false, notice: null, highlighted: {}, ...overrides };
}
function snapshot(a: OrderSnapshot[], b: OrderSnapshot[], denied = false): CourierBoardState {
  return { ready: true, stores: [{ store: store('a'), state: state(a), error: false }, { store: store('b'), state: state(b, { accessDenied: denied }), error: false }] };
}

describe('shared courier board boundaries', () => {
  it('alerts only for delivery work visible here, even when the actor also has kitchen permissions', () => {
    expect(courierJobStage(order('a', 'cooking', { status: 'CONFIRMED' }), 'courier')).toBeNull();
    expect(courierJobStage(order('a', 'ready'), 'courier')).toBe('ready');
    expect(courierJobStage(order('a', 'mine', { status: 'OUT_FOR_DELIVERY', assignedToUserId: 'courier' }), 'courier')).toBe('mine');
    expect(courierJobStage(order('a', 'other', { status: 'OUT_FOR_DELIVERY', assignedToUserId: 'someone-else' }), 'courier')).toBeNull();
  });

  it('combines ready delivery jobs across assigned stores even when their printed order numbers repeat', () => {
    const jobs = courierOrders(snapshot([order('a', 'a1')], [order('b', 'b1')]), 'courier');
    expect(jobs.ready.map((job) => [job.store.id, job.order.id, job.order.orderNumber])).toEqual([['a', 'a1', 'A100'], ['b', 'b1', 'A100']]);
  });

  it('shows only this courier’s in-flight orders and excludes pickup orders, completed jobs and another courier’s deliveries', () => {
    const jobs = courierOrders(snapshot([
      order('a', 'mine', { status: 'OUT_FOR_DELIVERY', assignedToUserId: 'courier' }),
      order('a', 'other', { status: 'OUT_FOR_DELIVERY', assignedToUserId: 'other-courier' }),
      order('a', 'pickup', { fulfillment: 'PICKUP' }),
      order('a', 'finished', { status: 'COMPLETED', assignedToUserId: 'courier' }),
    ], [order('b', 'arrived', { status: 'ARRIVED_AT_GATE', assignedToUserId: 'courier' })]), 'courier');
    expect(jobs.mine.map((job) => job.order.id)).toEqual(['mine', 'arrived']);
    expect(jobs.ready).toEqual([]);
  });

  it('never displays a revoked store’s previously cached phone or an order accidentally stored under another restaurant', () => {
    const jobs = courierOrders(snapshot([order('b', 'wrong-store')], [order('b', 'revoked')], true), 'courier');
    expect(jobs).toEqual({ ready: [], mine: [] });
  });

  it('filters by restaurant without mixing that store’s pending action and highlight state with another store', () => {
    const view = snapshot([order('a', 'a1')], [order('b', 'b1')]);
    view.stores[0].state.pending['a1'] = 2;
    view.stores[1].state.pending['b1'] = 1;
    view.stores[1].state.highlighted['b1'] = 1000;
    const jobs = courierOrders(view, 'courier', 'b');
    expect(jobs.ready).toHaveLength(1);
    expect(jobs.ready[0]).toMatchObject({ store: { id: 'b' }, pending: 1, highlighted: true });
  });
});
