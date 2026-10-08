/**
 * Smart Queue & ETA engine (pure). All numbers come from a QueueConfig stored per restaurant
 * and editable only by platform admins — nothing here is hardcoded business policy.
 */
import { z } from 'zod';
import type { FulfillmentType } from './order-machine';

export const capacityRuleSchema = z.object({
  maxLoad: z.number().int().min(0).max(100_000),
  prepMinutes: z.number().int().min(0).max(600),
});
export type CapacityRule = z.infer<typeof capacityRuleSchema>;

export const queueConfigSchema = z
  .object({
    basePrepMinutes: z.number().int().min(0).max(600),
    deliveryMinutes: z.number().int().min(0).max(600),
    capacityRules: z.array(capacityRuleSchema).max(50),
    /** Beyond the last rule, add `overflowStepMinutes` for every `overflowStepUnits` extra load units. */
    overflowStepUnits: z.number().int().min(0).max(10_000),
    overflowStepMinutes: z.number().int().min(0).max(600),
    /** Load at which the kitchen is shown as "Busy". */
    busyAtLoad: z.number().int().min(0).max(100_000),
    /** Load at which the kitchen is shown as "Heavy rush". */
    heavyAtLoad: z.number().int().min(0).max(100_000),
    /** Max active load before new orders are refused (0 = unlimited). */
    maxAcceptedLoad: z.number().int().min(0).max(100_000),
    /** Max active (kitchen) orders before new orders are refused (0 = unlimited). */
    maxActiveOrders: z.number().int().min(0).max(100_000),
    /** Automatically pause new orders when a max is reached. */
    autoPause: z.boolean(),
  })
  .superRefine((cfg, ctx) => {
    const loads = cfg.capacityRules.map((r) => r.maxLoad);
    for (let i = 1; i < loads.length; i++) {
      if (loads[i] <= loads[i - 1]) {
        ctx.addIssue({ code: 'custom', message: 'Capacity rules must have strictly increasing maxLoad', path: ['capacityRules', i, 'maxLoad'] });
      }
    }
  });
export type QueueConfig = z.infer<typeof queueConfigSchema>;

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  basePrepMinutes: 7,
  deliveryMinutes: 2,
  capacityRules: [
    { maxLoad: 30, prepMinutes: 7 },
    { maxLoad: 40, prepMinutes: 8 },
    { maxLoad: 50, prepMinutes: 10 },
    { maxLoad: 60, prepMinutes: 12 },
    { maxLoad: 70, prepMinutes: 14 },
  ],
  overflowStepUnits: 10,
  overflowStepMinutes: 2,
  busyAtLoad: 31,
  heavyAtLoad: 51,
  maxAcceptedLoad: 90,
  maxActiveOrders: 0,
  autoPause: true,
};

export function sortedRules(cfg: QueueConfig): CapacityRule[] {
  return [...cfg.capacityRules].sort((a, b) => a.maxLoad - b.maxLoad);
}

/** Preparation minutes for a given kitchen load (load units, not order count). */
export function prepMinutesForLoad(load: number, cfg: QueueConfig): number {
  const rules = sortedRules(cfg);
  const safeLoad = Math.max(0, load);
  if (rules.length === 0) return cfg.basePrepMinutes;
  for (const rule of rules) {
    if (safeLoad <= rule.maxLoad) return Math.max(cfg.basePrepMinutes, rule.prepMinutes);
  }
  const last = rules[rules.length - 1];
  const over = safeLoad - last.maxLoad;
  const steps = cfg.overflowStepUnits > 0 ? Math.ceil(over / cfg.overflowStepUnits) : 0;
  return Math.max(cfg.basePrepMinutes, last.prepMinutes + steps * cfg.overflowStepMinutes);
}

export type LoadLevel = 'NORMAL' | 'BUSY' | 'HEAVY' | 'FULL';

export function loadLevel(load: number, cfg: QueueConfig, activeOrders = 0): LoadLevel {
  if (isAtCapacity(load, cfg, activeOrders)) return 'FULL';
  if (cfg.heavyAtLoad > 0 && load >= cfg.heavyAtLoad) return 'HEAVY';
  if (cfg.busyAtLoad > 0 && load >= cfg.busyAtLoad) return 'BUSY';
  return 'NORMAL';
}

export function isAtCapacity(load: number, cfg: QueueConfig, activeOrders = 0): boolean {
  if (cfg.maxAcceptedLoad > 0 && load >= cfg.maxAcceptedLoad) return true;
  if (cfg.maxActiveOrders > 0 && activeOrders >= cfg.maxActiveOrders) return true;
  return false;
}

/** The capacity tier ceiling for display ("18 / 30"); null when beyond the last rule. */
export function tierCeiling(load: number, cfg: QueueConfig): number | null {
  for (const rule of sortedRules(cfg)) if (load <= rule.maxLoad) return rule.maxLoad;
  return null;
}

export interface EtaInput {
  /** When the order enters the queue (confirmation time). */
  confirmedAt: Date;
  /** Current kitchen load excluding this order. */
  activeLoad: number;
  /** Load units of this order. */
  orderLoad: number;
  config: QueueConfig;
  /** Extra delivery minutes for the delivery point (e.g. a farther gate). */
  extraDeliveryMinutes?: number;
  fulfillmentType?: FulfillmentType;
}

export interface EtaResult {
  projectedLoad: number;
  prepMinutes: number;
  deliveryMinutes: number;
  prepStartAt: Date;
  readyAt: Date;
  arrivalAt: Date;
}

export function computeEta(input: EtaInput): EtaResult {
  const projectedLoad = Math.max(0, input.activeLoad) + Math.max(0, input.orderLoad);
  const prepMinutes = prepMinutesForLoad(projectedLoad, input.config);
  const deliveryMinutes = input.fulfillmentType === 'PICKUP' ? 0 : input.config.deliveryMinutes + (input.extraDeliveryMinutes ?? 0);
  const start = input.confirmedAt.getTime();
  const readyAt = new Date(start + prepMinutes * 60_000);
  return {
    projectedLoad,
    prepMinutes,
    deliveryMinutes,
    prepStartAt: new Date(start),
    readyAt,
    arrivalAt: new Date(readyAt.getTime() + deliveryMinutes * 60_000),
  };
}

/** Estimate shown on the menu before ordering (a typical 1-unit order). */
export function estimateTotalMinutes(activeLoad: number, cfg: QueueConfig, orderLoad = 1): number {
  return prepMinutesForLoad(activeLoad + orderLoad, cfg) + cfg.deliveryMinutes;
}
