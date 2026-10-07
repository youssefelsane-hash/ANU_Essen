import { z } from 'zod';

export const DEFAULT_BRAND_COLOR = '#163d35';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
export const restaurantImageUrlSchema = optionalText(2000).refine((value) => {
  if (value === null) return true;
  if (/^\/(?!\/)[^\s\\]*$/.test(value)) return true;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'Image must use an http(s) URL or a local /image path');

/** Shared validation for platform-managed restaurant identity. */
export const restaurantBrandSchema = z.object({
  nameAr: z.string().trim().min(2, 'أدخل اسم المطعم').max(80),
  nameEn: z.string().trim().min(2, 'Enter the restaurant name').max(80),
  badgeText: optionalText(24),
  badgeTextEn: optionalText(24),
  taglineAr: optionalText(120),
  taglineEn: optionalText(120),
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/i, 'Choose a valid brand color').default(DEFAULT_BRAND_COLOR).transform((value) => value.toLowerCase()),
  logoUrl: restaurantImageUrlSchema,
  coverImageUrl: restaurantImageUrlSchema,
});

export type RestaurantBrand = z.infer<typeof restaurantBrandSchema>;

/** Keep badges readable even when an admin chooses a very light brand color. */
export function brandTextColor(color: string): '#ffffff' | '#111111' {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return '#ffffff';
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#111111' : '#ffffff';
}
