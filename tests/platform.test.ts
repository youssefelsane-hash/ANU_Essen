import { describe, expect, it } from 'vitest';
import { DEFAULT_PLATFORM_PROFILE, platformProfileSchema, resolvePlatformProfile, whatsappUrl } from '@/lib/domain/platform-profile';
import { buildPlatformQrUrl } from '@/lib/domain/restaurant-qr';
import { SYSTEM_ROLES } from '@/lib/domain/permissions';
import { isImageType, looksLikeImage } from '@/server/images';

describe('platform profile', () => {
  it('falls back to defaults and keeps saved values', () => {
    expect(resolvePlatformProfile(null)).toEqual(DEFAULT_PLATFORM_PROFILE);
    expect(resolvePlatformProfile({ whatsapp: '01012345678' }).whatsapp).toBe('01012345678');
    expect(DEFAULT_PLATFORM_PROFILE.orderAheadAr).toContain('ربع ساعة');
  });

  it('rejects unsafe or malformed links', () => {
    const base = { ...DEFAULT_PLATFORM_PROFILE };
    expect(platformProfileSchema.safeParse({ ...base, facebookUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(platformProfileSchema.safeParse({ ...base, facebookUrl: 'http://facebook.com/x' }).success).toBe(false);
    expect(platformProfileSchema.safeParse({ ...base, facebookUrl: 'https://facebook.com/x' }).success).toBe(true);
    expect(platformProfileSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(platformProfileSchema.safeParse({ ...base, whatsapp: '010<script>' }).success).toBe(false);
    expect(platformProfileSchema.parse({ ...base, email: '' }).email).toBeNull();
  });

  it('builds WhatsApp links with the Egyptian country code', () => {
    expect(whatsappUrl('01012345678')).toBe('https://wa.me/201012345678');
    expect(whatsappUrl('+20 101 234 5678')).toBe('https://wa.me/201012345678');
    expect(whatsappUrl(null)).toBeNull();
  });
});

describe('platform QR', () => {
  it('opens the restaurant list and keeps the poster label', () => {
    expect(buildPlatformQrUrl('https://order.example.com', 'gate_1')).toBe('https://order.example.com/?utm_source=gate_1');
    expect(buildPlatformQrUrl('https://order.example.com')).toBe('https://order.example.com/');
    expect(() => buildPlatformQrUrl('https://order.example.com/x')).toThrow();
    expect(() => buildPlatformQrUrl('https://order.example.com', 'bad label')).toThrow();
  });
});

describe('menu management roles', () => {
  it('lets restaurant owners and managers build their menu; cashiers and kitchen only toggle', () => {
    const has = (role: string, p: string) => SYSTEM_ROLES.find((r) => r.key === role)!.permissions.includes(p as never);
    expect(has('MERCHANT_OWNER', 'menu.manage')).toBe(true);
    expect(has('MERCHANT_MANAGER', 'menu.manage')).toBe(true);
    expect(has('CASHIER', 'menu.manage')).toBe(false);
    expect(has('KITCHEN_STAFF', 'menu.manage')).toBe(false);
    expect(has('MERCHANT_MANAGER', 'payments.refund')).toBe(true);
    expect(has('CASHIER', 'payments.refund')).toBe(false);
  });
});

describe('menu photo uploads', () => {
  it('accepts only real raster images', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(isImageType('image/png') && looksLikeImage(png, 'image/png')).toBe(true);
    expect(isImageType('image/svg+xml')).toBe(false);
    expect(looksLikeImage(Buffer.from('<svg onload=alert(1)>'), 'image/png')).toBe(false);
    expect(looksLikeImage(png, 'image/jpeg')).toBe(false);
  });
});
