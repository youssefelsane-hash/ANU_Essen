CREATE TYPE "public"."refund_status" AS ENUM('REQUESTED', 'COMPLETED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'PARTIALLY_REFUNDED';--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "refund_status" NOT NULL,
	"amount" integer NOT NULL,
	"method" "payment_method",
	"reason" text,
	"payout_details" text,
	"reference" text,
	"decision_note" text,
	"commission_reversed" integer DEFAULT 0 NOT NULL,
	"requested_by_customer" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_restaurant_idx" ON "media" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_restaurant_status_idx" ON "refunds" USING btree ("restaurant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_one_open_request_uq" ON "refunds" ("order_id") WHERE "status" = 'REQUESTED';
--> statement-breakpoint
INSERT INTO "permissions" ("key", "description", "scope") VALUES ('payments.refund', 'Refund paid orders and handle customer refund requests', 'STORE') ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT "id", 'payments.refund' FROM "roles" WHERE "key" IN ('SUPER_ADMIN', 'MERCHANT_OWNER', 'MERCHANT_MANAGER')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Restaurant managers build their own menu (owners already could).
INSERT INTO "role_permissions" ("role_id","permission_key") SELECT "id",'menu.manage' FROM "roles" WHERE "key" = 'MERCHANT_MANAGER' ON CONFLICT DO NOTHING;
