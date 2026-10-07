import { describe, expect, it } from 'vitest';
import { computeEta, DEFAULT_QUEUE_CONFIG, loadLevel, prepMinutesForLoad, queueConfigSchema, type QueueConfig } from '@/lib/domain/queue';

const cfg: QueueConfig = {
  ...DEFAULT_QUEUE_CONFIG,
  basePrepMinutes: 7,
  deliveryMinutes: 2,
  capacityRules: [
    { maxLoad: 30, prepMinutes: 7 },
    { maxLoad: 40, prepMinutes: 8 },
    { maxLoad: 50, prepMinutes: 10 },
    { maxLoad: 60, prepMinutes: 12 },
  ],
  overflowStepUnits: 10,
  overflowStepMinutes: 2,
};

describe('queue engine', () => {
  it.each([
    [0, 7],
    [25, 7],
    [30, 7],
    [35, 8],
    [48, 10],
    [55, 12],
    [60, 12],
    [61, 14],
    [75, 16],
  ])('load %i → %i prep minutes', (load, expected) => {
    expect(prepMinutesForLoad(load, cfg)).toBe(expected);
  });

  it('reads every number from configuration (nothing hardcoded)', () => {
    const other: QueueConfig = { ...cfg, basePrepMinutes: 5, capacityRules: [{ maxLoad: 10, prepMinutes: 5 }, { maxLoad: 20, prepMinutes: 9 }] };
    expect(prepMinutesForLoad(8, other)).toBe(5);
    expect(prepMinutesForLoad(15, other)).toBe(9);
    expect(prepMinutesForLoad(25, other)).toBe(11);
  });

  it('base preparation time acts as a floor', () => {
    expect(prepMinutesForLoad(5, { ...cfg, basePrepMinutes: 9 })).toBe(9);
  });

  it('computes ETA from active load + this order load', () => {
    const confirmedAt = new Date('2026-10-07T09:00:00Z');
    const eta = computeEta({ confirmedAt, activeLoad: 19, orderLoad: 3, config: cfg });
    expect(eta.projectedLoad).toBe(22);
    expect(eta.prepMinutes).toBe(7);
    expect(eta.readyAt.toISOString()).toBe('2026-10-07T09:07:00.000Z');
    expect(eta.arrivalAt.toISOString()).toBe('2026-10-07T09:09:00.000Z');
  });

  it('adds delivery-point extra minutes', () => {
    const eta = computeEta({ confirmedAt: new Date(0), activeLoad: 0, orderLoad: 1, config: cfg, extraDeliveryMinutes: 3 });
    expect(eta.deliveryMinutes).toBe(5);
  });

  it('labels load levels from thresholds', () => {
    const c = { ...cfg, busyAtLoad: 31, heavyAtLoad: 51, maxAcceptedLoad: 80 };
    expect(loadLevel(18, c)).toBe('NORMAL');
    expect(loadLevel(46, c)).toBe('BUSY');
    expect(loadLevel(68, c)).toBe('HEAVY');
    expect(loadLevel(80, c)).toBe('FULL');
  });

  it('rejects non-increasing capacity rules', () => {
    const bad = { ...cfg, capacityRules: [{ maxLoad: 30, prepMinutes: 7 }, { maxLoad: 30, prepMinutes: 8 }] };
    expect(queueConfigSchema.safeParse(bad).success).toBe(false);
    expect(queueConfigSchema.safeParse(cfg).success).toBe(true);
  });
});
