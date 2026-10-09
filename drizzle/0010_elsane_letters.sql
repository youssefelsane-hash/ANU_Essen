CREATE TABLE "loyalty_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"letter" text NOT NULL,
	"voucher_promotion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_awards_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "loyalty_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"letters" text[] DEFAULT '{}'::text[] NOT NULL,
	"words_completed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_cards_uq" UNIQUE("restaurant_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "customer_phone" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "loyalty_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "loyalty_reward" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "loyalty_min_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "loyalty_voucher_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty_awards" ADD CONSTRAINT "loyalty_awards_card_id_loyalty_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."loyalty_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_awards" ADD CONSTRAINT "loyalty_awards_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_awards" ADD CONSTRAINT "loyalty_awards_voucher_promotion_id_promotions_id_fk" FOREIGN KEY ("voucher_promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_cards" ADD CONSTRAINT "loyalty_cards_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_cards" ADD CONSTRAINT "loyalty_cards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_awards_card_idx" ON "loyalty_awards" USING btree ("card_id");