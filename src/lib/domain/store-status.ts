import { isOpenAt, type WeeklyHours } from './hours';
import { isAtCapacity, loadLevel, type QueueConfig } from './queue';

export type OrderingStatus = 'OPEN' | 'PAUSED' | 'CLOSED';
export type EffectiveStatus = 'OPEN' | 'BUSY' | 'PAUSED' | 'CLOSED';
export type StatusReason = 'INACTIVE' | 'MANUAL_CLOSED' | 'OUTSIDE_HOURS' | 'MANUAL_PAUSE' | 'CAPACITY' | null;

export interface StoreStatusInput {
  isActive: boolean;
  orderingStatus: OrderingStatus;
  openingHours: WeeklyHours | null;
  timezone: string;
  now: Date;
  load: number;
  activeOrders: number;
  queue: QueueConfig;
}

export function computeEffectiveStatus(input: StoreStatusInput): { status: EffectiveStatus; reason: StatusReason } {
  if (!input.isActive) return { status: 'CLOSED', reason: 'INACTIVE' };
  if (input.orderingStatus === 'CLOSED') return { status: 'CLOSED', reason: 'MANUAL_CLOSED' };
  if (!isOpenAt(input.openingHours, input.timezone, input.now)) return { status: 'CLOSED', reason: 'OUTSIDE_HOURS' };
  if (input.orderingStatus === 'PAUSED') return { status: 'PAUSED', reason: 'MANUAL_PAUSE' };
  if (input.queue.autoPause && isAtCapacity(input.load, input.queue, input.activeOrders)) {
    return { status: 'PAUSED', reason: 'CAPACITY' };
  }
  const level = loadLevel(input.load, input.queue, input.activeOrders);
  if (level === 'BUSY' || level === 'HEAVY' || level === 'FULL') return { status: 'BUSY', reason: null };
  return { status: 'OPEN', reason: null };
}

export function acceptsOrders(status: EffectiveStatus): boolean {
  return status === 'OPEN' || status === 'BUSY';
}
