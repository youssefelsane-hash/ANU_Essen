import { describe, expect, it } from 'vitest';
import { isOpenAt, localDateToUtc, startOfLocalDay, type WeeklyHours } from '@/lib/domain/hours';
import { formatOrderNumber, normalizeEgyptianPhone } from '@/lib/domain/misc';
import { computeEffectiveStatus } from '@/lib/domain/store-status';
import { DEFAULT_QUEUE_CONFIG } from '@/lib/domain/queue';

const TZ = 'Africa/Cairo';
const every = (open: string, close: string): WeeklyHours => Array.from({ length: 7 }, () => ({ open, close }));

describe('opening hours', () => {
  it('handles same-day windows in Cairo time', () => {
    const h = every('10:00', '22:00');
    expect(isOpenAt(h, TZ, new Date('2026-01-15T09:00:00Z'))).toBe(true); // 11:00 Cairo (UTC+2)
    expect(isOpenAt(h, TZ, new Date('2026-01-15T07:30:00Z'))).toBe(false); // 09:30 Cairo
    expect(isOpenAt(h, TZ, new Date('2026-01-15T20:30:00Z'))).toBe(false); // 22:30 Cairo
  });

  it('handles windows past midnight', () => {
    const h = every('12:00', '02:00');
    expect(isOpenAt(h, TZ, new Date('2026-01-15T23:30:00Z'))).toBe(true); // 01:30 next day
    expect(isOpenAt(h, TZ, new Date('2026-01-16T01:00:00Z'))).toBe(false); // 03:00
  });

  it('null schedule = always open, null day = closed', () => {
    expect(isOpenAt(null, TZ, new Date())).toBe(true);
    const h = every('10:00', '22:00');
    h[5] = null; // Friday closed
    expect(isOpenAt(h, TZ, new Date('2026-01-16T10:00:00Z'))).toBe(false); // Friday 12:00
  });

  it('computes local day boundaries across DST', () => {
    expect(startOfLocalDay(new Date('2026-01-15T12:00:00Z'), TZ).toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-07-15T12:00:00Z'), TZ).toISOString()).toBe('2026-07-14T21:00:00.000Z');
    expect(localDateToUtc('2026-07-15', TZ).toISOString()).toBe('2026-07-14T21:00:00.000Z');
  });
});

describe('store status', () => {
  const base = { isActive: true, orderingStatus: 'OPEN' as const, openingHours: null, timezone: TZ, now: new Date(), load: 0, activeOrders: 0, queue: DEFAULT_QUEUE_CONFIG };
  it('derives OPEN / BUSY / PAUSED / CLOSED', () => {
    expect(computeEffectiveStatus(base).status).toBe('OPEN');
    expect(computeEffectiveStatus({ ...base, load: 45 }).status).toBe('BUSY');
    expect(computeEffectiveStatus({ ...base, load: 95 })).toEqual({ status: 'PAUSED', reason: 'CAPACITY' });
    expect(computeEffectiveStatus({ ...base, orderingStatus: 'PAUSED' }).reason).toBe('MANUAL_PAUSE');
    expect(computeEffectiveStatus({ ...base, orderingStatus: 'CLOSED' }).status).toBe('CLOSED');
    expect(computeEffectiveStatus({ ...base, queue: { ...DEFAULT_QUEUE_CONFIG, autoPause: false }, load: 95 }).status).toBe('BUSY');
  });
});

describe('misc', () => {
  it('formats human order numbers', () => {
    expect(formatOrderNumber(100)).toBe('A100');
    expect(formatOrderNumber(124)).toBe('A124');
    expect(formatOrderNumber(999)).toBe('A999');
    expect(formatOrderNumber(1000)).toBe('B100');
  });
  it('normalizes Egyptian phones', () => {
    expect(normalizeEgyptianPhone('01012345678')).toBe('01012345678');
    expect(normalizeEgyptianPhone('+20 101 234 5678')).toBe('01012345678');
    expect(normalizeEgyptianPhone('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678');
    expect(normalizeEgyptianPhone('0123')).toBeNull();
  });
});

describe('datetime-local inputs in the restaurant timezone', () => {
  it('round-trips wall-clock values in Cairo regardless of server timezone', async () => {
    const { fromZonedInputValue, toZonedInputValue } = await import('@/lib/domain/hours');
    const winter = fromZonedInputValue('2026-01-15T18:30', 'Africa/Cairo')!;
    expect(winter.toISOString()).toBe('2026-01-15T16:30:00.000Z');
    const summer = fromZonedInputValue('2026-07-15T18:30', 'Africa/Cairo')!;
    expect(summer.toISOString()).toBe('2026-07-15T15:30:00.000Z');
    expect(toZonedInputValue(summer, 'Africa/Cairo')).toBe('2026-07-15T18:30');
    expect(fromZonedInputValue('bad', 'Africa/Cairo')).toBeNull();
  });
});
