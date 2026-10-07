ALTER TABLE "restaurants" ADD COLUMN "badge_text" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "tagline_ar" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "brand_color" text DEFAULT '#163d35' NOT NULL;
--> statement-breakpoint
UPDATE "restaurants" SET "name_ar" = 'الراية الدمشقية', "badge_text" = COALESCE("badge_text", 'الراية'), "tagline_ar" = COALESCE("tagline_ar", 'من قلب الشام، لحد عندك') WHERE "slug" = 'alrayez' AND "name_ar" = 'الرايظ الدمشقية';
--> statement-breakpoint
UPDATE "restaurants" SET "name_en" = 'Al Raya Al Dimashqia' WHERE "slug" = 'alrayez' AND "name_en" = 'Al Rayez Damascene';
