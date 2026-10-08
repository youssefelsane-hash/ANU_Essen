CREATE TABLE "courier_cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"courier_user_id" uuid NOT NULL,
	"entry_kind" text NOT NULL,
	"amount" integer NOT NULL,
	"reverses_entry_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_cash_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "courier_cash_entries_reversal_uq" UNIQUE("reverses_entry_id"),
	CONSTRAINT "courier_cash_entries_positive_amount" CHECK ("courier_cash_entries"."amount" > 0),
	CONSTRAINT "courier_cash_entries_kind_valid" CHECK (("courier_cash_entries"."entry_kind" = 'HAND_IN' and "courier_cash_entries"."reverses_entry_id" is null) or ("courier_cash_entries"."entry_kind" = 'REVERSAL' and "courier_cash_entries"."reverses_entry_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "courier_cash_entries" ADD CONSTRAINT "courier_cash_entries_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_cash_entries" ADD CONSTRAINT "courier_cash_entries_courier_user_id_users_id_fk" FOREIGN KEY ("courier_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_cash_entries" ADD CONSTRAINT "courier_cash_entries_reverses_entry_id_courier_cash_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."courier_cash_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_cash_entries" ADD CONSTRAINT "courier_cash_entries_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courier_cash_entries_pair_created_idx" ON "courier_cash_entries" USING btree ("restaurant_id","courier_user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_courier_completed_idx" ON "orders" USING btree ("restaurant_id","assigned_to_user_id","completed_at");