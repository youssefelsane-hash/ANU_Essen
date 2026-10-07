import { z } from 'zod';
import { ORDER_ACTIONS, PAYMENT_METHODS } from './domain/order-machine';

export const cartLineSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullish(),
  addonIds: z.array(z.uuid()).max(20).default([]),
  quantity: z.number().int().min(1).max(50),
  note: z.string().trim().max(140).nullish(),
});

export const quoteSchema = z.object({
  items: z.array(cartLineSchema).min(1).max(30),
  promoCode: z.string().trim().max(32).nullish(),
  deliveryPointId: z.uuid().nullish(),
});

export const createOrderSchema = quoteSchema.extend({
  customerName: z.string().trim().min(2, 'اكتب اسمك').max(60),
  customerPhone: z.string().trim().max(20).nullish(),
  note: z.string().trim().max(300).nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  source: z.string().trim().max(64).nullish(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const idempotencyKeySchema = z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_\-:.]+$/);

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_SCREENSHOT_BYTES = 500_000;

export const submitPaymentSchema = z.object({
  reference: z.string().trim().max(64).nullish(),
  screenshot: z
    .object({
      contentType: z.enum(ALLOWED_IMAGE_TYPES),
      base64: z.string().max(Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 8),
    })
    .nullish(),
});

export const offlineActionSchema = z.object({
  eventId: z.uuid(),
  orderId: z.uuid(),
  action: z.enum(ORDER_ACTIONS),
  occurredAt: z.number().int().positive(),
  payload: z.object({ reason: z.string().trim().max(200).optional() }).optional(),
});

export const actionsBatchSchema = z.object({
  restaurantId: z.uuid(),
  deviceId: z.uuid(),
  actions: z.array(offlineActionSchema).max(100),
});

export const syncQuerySchema = z.object({
  restaurantId: z.uuid(),
  deviceId: z.uuid(),
  cursor: z.coerce.number().int().min(0).default(0),
});

/** Walk-in order entered by staff at the register. Name/phone are optional for someone standing at the counter. */
export const counterOrderSchema = z.object({
  restaurantId: z.uuid(),
  deviceId: z.uuid().nullish(),
  items: z.array(cartLineSchema).min(1).max(30),
  customerName: z.string().trim().max(60).nullish(),
  customerPhone: z.string().trim().max(20).nullish(),
  note: z.string().trim().max(300).nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  deliveryPointId: z.uuid().nullish(),
});
