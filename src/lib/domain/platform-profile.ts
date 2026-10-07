import { z } from 'zod';

/**
 * Public identity of the platform itself (not a restaurant): shown in the footer, the legal pages
 * and the "order ahead" line. Edited by the platform owner in Admin → Settings; empty contact
 * fields simply hide their link (no dead links).
 */
export interface PlatformProfile {
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  companyAr: string;
  companyEn: string;
  /** Egyptian or international number, digits only once normalised (used for wa.me links). */
  whatsapp: string | null;
  email: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  addressAr: string | null;
  commercialRegister: string | null;
  taxId: string | null;
  orderAheadAr: string;
  orderAheadEn: string;
}

export const DEFAULT_PLATFORM_PROFILE: PlatformProfile = {
  nameAr: 'اطلب',
  nameEn: 'Campus Order',
  descriptionAr: 'اطلب أكلك من مطاعم الجامعة من غير طوابير: وقت تجهيز واضح، وتتبّع لحظي، ودفع كاش أو إنستاباي.',
  descriptionEn: 'Order from campus restaurants without the queue: a clear ready time, live tracking, and cash or InstaPay.',
  companyAr: 'الصانع جروب',
  companyEn: 'ELSANE Group',
  whatsapp: null,
  email: null,
  facebookUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
  addressAr: null,
  commercialRegister: null,
  taxId: null,
  orderAheadAr: 'اطلب قبل ما محاضرتك تخلص بربع ساعة… وأكلك يكون جاهز أول ما تطلع.',
  orderAheadEn: 'Order 15 minutes before your lecture ends — your food will be ready as you walk out.',
};

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .transform((v) => v || null)
  .nullable()
  .refine((v) => v === null || /^https:\/\/[^\s]+$/i.test(v), 'Links must start with https://');

export const platformProfileSchema = z.object({
  nameAr: z.string().trim().min(2).max(40),
  nameEn: z.string().trim().min(2).max(40),
  descriptionAr: z.string().trim().max(300),
  descriptionEn: z.string().trim().max(300),
  companyAr: z.string().trim().min(2).max(80),
  companyEn: z.string().trim().min(2).max(80),
  whatsapp: optionalText(20).refine((v) => v === null || /^\+?[0-9 ]{8,18}$/.test(v), 'WhatsApp number: digits only'),
  email: optionalText(120).refine((v) => v === null || z.email().safeParse(v).success, 'Invalid email'),
  facebookUrl: httpsUrl,
  instagramUrl: httpsUrl,
  tiktokUrl: httpsUrl,
  addressAr: optionalText(200),
  commercialRegister: optionalText(40),
  taxId: optionalText(40),
  orderAheadAr: z.string().trim().max(160),
  orderAheadEn: z.string().trim().max(160),
});

/** Saved settings merged over the defaults, so new fields always have a value. */
export function resolvePlatformProfile(saved: unknown): PlatformProfile {
  const merged = { ...DEFAULT_PLATFORM_PROFILE, ...(saved && typeof saved === 'object' ? saved : {}) };
  const parsed = platformProfileSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_PLATFORM_PROFILE;
}

/** wa.me link; Egyptian local numbers (01…) get the +20 country code. */
export function whatsappUrl(number: string | null): string | null {
  if (!number) return null;
  let digits = number.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `20${digits.slice(1)}`;
  return digits.length >= 10 ? `https://wa.me/${digits}` : null;
}
