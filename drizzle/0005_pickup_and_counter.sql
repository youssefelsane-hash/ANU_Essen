ALTER TABLE "delivery_points" ADD COLUMN "fulfillment_type" text DEFAULT 'DELIVERY' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cash_received_at_counter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_type" text DEFAULT 'DELIVERY' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_points" ADD CONSTRAINT "delivery_points_fulfillment_type_check" CHECK ("delivery_points"."fulfillment_type" in ('PICKUP', 'DELIVERY'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfillment_type_check" CHECK ("orders"."fulfillment_type" in ('PICKUP', 'DELIVERY'));
--> statement-breakpoint
-- Backfill defaults without replacing configured university points or changing historical orders.
UPDATE delivery_points
SET fulfillment_type = 'PICKUP', delivery_fee = 0, extra_minutes = 0
WHERE lower(trim(name_en)) IN ('collect from restaurant', 'store pickup', 'restaurant pickup', 'pickup from restaurant')
   OR trim(name_ar) IN ('استلام من المطعم', 'استلام من المحل', 'الاستلام من المطعم', 'الاستلام من المحل');
--> statement-breakpoint
INSERT INTO delivery_points (restaurant_id, name_ar, name_en, fulfillment_type, is_default, sort_order)
SELECT r.id, 'استلام من المطعم', 'Collect from restaurant', 'PICKUP', false, 100
FROM restaurants r
WHERE NOT EXISTS (SELECT 1 FROM delivery_points p WHERE p.restaurant_id = r.id AND p.fulfillment_type = 'PICKUP');
--> statement-breakpoint
INSERT INTO delivery_points (restaurant_id, name_ar, name_en, description, fulfillment_type, is_default, sort_order)
SELECT r.id, 'بوابة الباركينج — جامعة الإسكندرية الأهلية', 'University Parking Gate',
       'Alexandria National University — parking gate', 'DELIVERY', false, 0
FROM restaurants r
WHERE NOT EXISTS (SELECT 1 FROM delivery_points p WHERE p.restaurant_id = r.id AND p.fulfillment_type = 'DELIVERY');
--> statement-breakpoint
WITH fallback AS (
  SELECT DISTINCT ON (p.restaurant_id) p.id
  FROM delivery_points p
  WHERE p.is_active AND NOT EXISTS (
    SELECT 1 FROM delivery_points current_default
    WHERE current_default.restaurant_id = p.restaurant_id AND current_default.is_default AND current_default.is_active
  )
  ORDER BY p.restaurant_id, CASE WHEN p.fulfillment_type = 'DELIVERY' THEN 0 ELSE 1 END, p.sort_order, p.created_at, p.id
)
UPDATE delivery_points SET is_default = true WHERE id IN (SELECT id FROM fallback);
