import { z } from 'zod';

/** Guest-checkout protection against fake orders (editable in Admin → Settings). */
export const riskPolicySchema = z.object({
  /** Open (not finished) online orders one phone may have at once across the platform. 0 = no limit. */
  maxOpenOrdersPerPhone: z.number().int().min(0).max(20),
  /** After this many never-collected orders, the phone must pay by InstaPay. 0 = never restrict. */
  noShowCashLimit: z.number().int().min(0).max(20),
});
export type RiskPolicy = z.infer<typeof riskPolicySchema>;

export const DEFAULT_RISK_POLICY: RiskPolicy = { maxOpenOrdersPerPhone: 3, noShowCashLimit: 2 };

/** Minutes after a cash order is accepted during which the customer may still cancel it themselves. */
export const CUSTOMER_CANCEL_GRACE_MINUTES = 3;
