import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('adds customer fee snapshots without repricing historical orders or rewriting completed refunds', async () => {
  const client = new PGlite();
  try {
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter((entry) => entry.idx < 7)) {
      await client.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
    }
    const restaurantId = randomUUID(), orderId = randomUUID(), refundId = randomUUID();
    await client.query('insert into restaurants (id, slug, name_ar, name_en) values ($1, $2, $3, $4)', [restaurantId, 'historical-price-proof', 'مطعم قديم', 'Historical Restaurant']);
    await client.query(`insert into orders (
      id, restaurant_id, order_seq, order_number, tracking_token, idempotency_key, request_hash,
      customer_name, status, payment_method, payment_status, delivery_point_name, subtotal,
      discount_total, delivery_fee, total, currency, commission_bps, commission_amount, merchant_net,
      load_units, refunded_total, completed_at
    ) values ($1, $2, 100, 'A100', 'historical-token', 'historical-key', 'historical-hash',
      'Historical customer', 'COMPLETED', 'CASH', 'PARTIALLY_REFUNDED', 'Historical gate',
      10000, 0, 0, 10000, 'EGP', 500, 500, 9500, 1, 3333, now())`, [orderId, restaurantId]);
    await client.query(`insert into refunds (id, restaurant_id, order_id, status, amount, method, commission_reversed, decided_at)
      values ($1, $2, $3, 'COMPLETED', 3333, 'CASH', 167, now())`, [refundId, restaurantId, orderId]);
    const selectOrder = 'select total, subtotal, discount_total, delivery_fee, commission_bps, commission_amount, merchant_net, refunded_total, payment_status from orders where id = $1';
    const before = await client.query(selectOrder, [orderId]);
    const beforeRefund = await client.query('select * from refunds where id = $1', [refundId]);
    await client.exec(await readFile('drizzle/0007_online_platform_fees.sql', 'utf8'));
    expect((await client.query(selectOrder, [orderId])).rows).toEqual(before.rows);
    expect((await client.query('select * from refunds where id = $1', [refundId])).rows).toEqual(beforeRefund.rows);
    expect((await client.query('select pricing_mode, platform_fee_amount from orders where id = $1', [orderId])).rows[0]).toEqual({ pricing_mode: 'LEGACY_COMMISSION', platform_fee_amount: 0 });
  } finally {
    await client.close();
  }
});
