import { eq, sql } from 'drizzle-orm';
import { db, type Db } from '../db';
import { customers, systemSettings } from '../db/schema';
import { riskPolicySchema, DEFAULT_RISK_POLICY, type RiskPolicy } from '../../lib/domain/risk';

export const RISK_POLICY_KEY = 'risk.policy';

export async function getRiskPolicy(d: Db = db()): Promise<RiskPolicy> {
  const [row] = await d.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, RISK_POLICY_KEY));
  const parsed = riskPolicySchema.safeParse({ ...DEFAULT_RISK_POLICY, ...(row?.value && typeof row.value === 'object' ? row.value : {}) });
  return parsed.success ? parsed.data : DEFAULT_RISK_POLICY;
}

/** One more order this phone never collected. */
export async function recordNoShow(d: Db, phone: string) {
  await d.update(customers).set({ noShowCount: sql`${customers.noShowCount} + 1`, updatedAt: new Date() }).where(eq(customers.phone, phone));
}
