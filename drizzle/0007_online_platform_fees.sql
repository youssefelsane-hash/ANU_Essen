CREATE TYPE "public"."pricing_mode" AS ENUM('LEGACY_COMMISSION', 'ONLINE_PLATFORM_FEE', 'COUNTER_NO_FEE');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pricing_mode" "pricing_mode" DEFAULT 'LEGACY_COMMISSION' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "platform_fee_amount" integer DEFAULT 0 NOT NULL;