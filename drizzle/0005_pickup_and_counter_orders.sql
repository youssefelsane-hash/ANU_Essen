CREATE TYPE "public"."fulfillment" AS ENUM('DELIVERY', 'PICKUP');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('ONLINE', 'COUNTER');--> statement-breakpoint
ALTER TABLE "delivery_points" ADD COLUMN "kind" "fulfillment" DEFAULT 'DELIVERY' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment" "fulfillment" DEFAULT 'DELIVERY' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "channel" "order_channel" DEFAULT 'ONLINE' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "counter_commission_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "permissions" ("key", "description", "scope") VALUES ('orders.create', 'Create orders at the counter (walk-in customers)', 'STORE') ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT "id", 'orders.create' FROM "roles" WHERE "key" IN ('SUPER_ADMIN', 'MERCHANT_OWNER', 'MERCHANT_MANAGER', 'CASHIER')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "delivery_points" ("restaurant_id", "name_ar", "name_en", "kind", "delivery_fee", "extra_minutes", "is_default", "is_active", "sort_order")
SELECT r."id", 'استلام من المطعم', 'Pickup at the restaurant', 'PICKUP', 0, 0, false, true, 100
FROM "restaurants" AS r
WHERE NOT EXISTS (SELECT 1 FROM "delivery_points" AS p WHERE p."restaurant_id" = r."id" AND p."kind" = 'PICKUP');
