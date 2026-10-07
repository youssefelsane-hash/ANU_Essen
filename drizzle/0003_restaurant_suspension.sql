ALTER TABLE "restaurants" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "suspended_at" timestamp with time zone;