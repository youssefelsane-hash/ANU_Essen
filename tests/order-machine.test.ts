import { describe, expect, it } from 'vitest';
import { actorMayPerform, initialStatusFor, nextStatus, ORDER_ACTIONS, ORDER_STATUSES, paymentStatusAfter } from '@/lib/domain/order-machine';

describe('order state machine', () => {
  it('walks the happy InstaPay path', () => {
    let s = initialStatusFor('INSTAPAY').status;
    expect(s).toBe('AWAITING_PAYMENT');
    for (const [action, expected] of [
      ['SUBMIT_PAYMENT', 'PAYMENT_REVIEW'],
      ['VERIFY_PAYMENT', 'CONFIRMED'],
      ['START_PREPARING', 'PREPARING'],
      ['MARK_READY', 'READY'],
      ['OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY'],
      ['MARK_ARRIVED', 'ARRIVED_AT_GATE'],
      ['COMPLETE', 'COMPLETED'],
    ] as const) {
      const next = nextStatus(s, action);
      expect(next, `${s} --${action}-->`).toBe(expected);
      s = next!;
    }
  });

  it('new cash orders enter the queue and historical cash orders can still be accepted', () => {
    expect(initialStatusFor('CASH')).toEqual({ status: 'CONFIRMED', paymentStatus: 'CASH' });
    expect(nextStatus('CREATED', 'ACCEPT')).toBe('CONFIRMED');
    expect(nextStatus('CREATED', 'START_PREPARING')).toBeNull();
  });

  it('rejects random status jumps', () => {
    expect(nextStatus('AWAITING_PAYMENT', 'MARK_READY')).toBeNull();
    expect(nextStatus('COMPLETED', 'CANCEL')).toBeNull();
    expect(nextStatus('CANCELLED', 'VERIFY_PAYMENT')).toBeNull();
    expect(nextStatus('READY', 'START_PREPARING')).toBeNull();
  });

  it('terminal states accept no action', () => {
    for (const action of ORDER_ACTIONS) {
      expect(nextStatus('COMPLETED', action)).toBeNull();
      expect(nextStatus('CANCELLED', action)).toBeNull();
    }
  });

  it('every status except terminal ones can be cancelled by staff', () => {
    for (const s of ORDER_STATUSES) {
      const expected = s === 'COMPLETED' || s === 'CANCELLED' ? null : 'CANCELLED';
      expect(nextStatus(s, 'CANCEL')).toBe(expected);
    }
  });

  it('customers may only submit payment or cancel before paying', () => {
    const none = () => false;
    expect(actorMayPerform('CUSTOMER', 'SUBMIT_PAYMENT', 'AWAITING_PAYMENT', none)).toBe(true);
    expect(actorMayPerform('CUSTOMER', 'CANCEL', 'AWAITING_PAYMENT', none)).toBe(true);
    expect(actorMayPerform('CUSTOMER', 'CANCEL', 'PREPARING', none)).toBe(false);
    expect(actorMayPerform('CUSTOMER', 'VERIFY_PAYMENT', 'PAYMENT_REVIEW', none)).toBe(false);
  });

  it('staff need the matching permission', () => {
    const kitchen = (p: string) => ['orders.view', 'orders.kitchen'].includes(p);
    expect(actorMayPerform('USER', 'MARK_READY', 'PREPARING', kitchen)).toBe(true);
    expect(actorMayPerform('USER', 'VERIFY_PAYMENT', 'PAYMENT_REVIEW', kitchen)).toBe(false);
  });

  it('updates payment status with the lifecycle', () => {
    expect(paymentStatusAfter('SUBMIT_PAYMENT', 'INSTAPAY', 'UNPAID')).toBe('PAYMENT_SUBMITTED');
    expect(paymentStatusAfter('VERIFY_PAYMENT', 'INSTAPAY', 'PAYMENT_SUBMITTED')).toBe('PAYMENT_VERIFIED');
    expect(paymentStatusAfter('REJECT_PAYMENT', 'INSTAPAY', 'PAYMENT_SUBMITTED')).toBe('PAYMENT_REJECTED');
    expect(paymentStatusAfter('COMPLETE', 'CASH', 'CASH')).toBe('PAYMENT_VERIFIED');
    expect(paymentStatusAfter('MARK_READY', 'INSTAPAY', 'PAYMENT_VERIFIED')).toBeNull();
  });
});
