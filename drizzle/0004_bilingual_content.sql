ALTER TABLE "banners" ADD COLUMN "title_en" text;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "subtitle_en" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_point_name_en" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "badge_text_en" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "tagline_en" text;
--> statement-breakpoint
UPDATE "orders" AS o SET "delivery_point_name_en" = p."name_en" FROM "delivery_points" AS p WHERE o."delivery_point_id" = p."id" AND o."delivery_point_name_en" IS NULL;
--> statement-breakpoint
UPDATE "restaurants" SET "badge_text_en" = 'Al Raya' WHERE "slug" = 'alrayez' AND "badge_text" = 'الراية' AND "badge_text_en" IS NULL;
--> statement-breakpoint
UPDATE "restaurants" SET "tagline_en" = 'From the heart of Damascus, to you' WHERE "slug" = 'alrayez' AND "tagline_ar" = 'من قلب الشام، لحد عندك' AND "tagline_en" IS NULL;
--> statement-breakpoint
UPDATE "products" SET "description_en" = 'Chicken shawarma with garlic sauce and pickles' WHERE "name_en" = 'Chicken Shawarma Sandwich' AND "description_ar" = 'شاورما فراخ بالثومية والمخلل' AND "description_en" IS NULL;
--> statement-breakpoint
UPDATE "products" SET "description_en" = 'Beef shawarma with tahini sauce' WHERE "name_en" = 'Meat Shawarma Sandwich' AND "description_ar" = 'شاورما لحمة بالطحينة' AND "description_en" IS NULL;
--> statement-breakpoint
UPDATE "products" SET "description_en" = 'Arabic shawarma, fries, garlic sauce and pickles' WHERE "name_en" = 'Shawarma Meal' AND "description_ar" = 'شاورما عربي + بطاطس + ثومية + مخلل' AND "description_en" IS NULL;
--> statement-breakpoint
UPDATE "banners" SET "title_en" = 'Authentic Syrian flavour', "subtitle_en" = 'Shawarma made with care. Order now and collect at the university gate.' WHERE "title_ar" = 'طعم شامي، على أصوله' AND "title_en" IS NULL;
--> statement-breakpoint
UPDATE "banners" SET "title_en" = '10% off your order', "subtitle_en" = 'Use WELCOME10 on orders of EGP 100 or more' WHERE "title_ar" = 'خصم 10% على طلبك' AND "title_en" IS NULL;
--> statement-breakpoint
UPDATE "restaurant_payment_methods" SET "config" = "config" || '{"instructionsEn":"Add your order number to the transfer note if you can"}'::jsonb WHERE "config"->>'instructions' = 'اكتب رقم الطلب في ملاحظة التحويل لو تقدر' AND "config"->>'instructionsEn' IS NULL;
