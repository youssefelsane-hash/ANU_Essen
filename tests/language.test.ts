import { describe, expect, it } from 'vitest';
import { direction, errorMessage, labels, languageScope, localizedName, localizeMessage, resolveLocale } from '@/lib/i18n';
import { ORDER_ACTIONS, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '@/lib/domain/order-machine';

describe('request-scoped languages', () => {
  it('uses device language for customers, respecting quality and excluded languages', () => {
    expect(resolveLocale('customer', null, 'ar-EG, en;q=.8')).toBe('ar');
    expect(resolveLocale('customer', null, 'en-US,ar;q=.8')).toBe('en');
    expect(resolveLocale('customer', null, 'ar;q=0,en;q=.5')).toBe('en');
    expect(resolveLocale('customer', null, 'ar;q=.5,en;q=.9')).toBe('en');
    expect(resolveLocale('customer', null, 'fr-FR,de;q=.8')).toBe('en');
    expect(resolveLocale('customer', null, 'en;q=invalid,ar;q=.8')).toBe('ar');
  });
  it('keeps staff Arabic by default and saves a separate explicit choice for each area', () => {
    expect(resolveLocale('staff', null, 'en-GB')).toBe('ar');
    expect(resolveLocale('staff', 'en', 'ar')).toBe('en');
    expect(resolveLocale('customer', 'ar', 'en')).toBe('ar');
    expect(resolveLocale('customer', 'invalid', 'en')).toBe('en');
    for (const path of ['/admin', '/admin/users', '/merchant/menu', '/login', '/api/merchant/sync']) expect(languageScope(path)).toBe('staff');
    for (const path of ['/', '/s/alrayez', '/order/token', '/q/123', '/api/public/stores/alrayez', '/administrator']) expect(languageScope(path)).toBe('customer');
    expect(direction('ar')).toBe('rtl'); expect(direction('en')).toBe('ltr');
  });
  it('localizes every order/payment/action status and preserves content when a translation is missing', () => {
    for (const locale of ['ar', 'en'] as const) {
      const l = labels(locale);
      ORDER_STATUSES.forEach((key) => expect(l.status[key]).toBeTruthy());
      ORDER_ACTIONS.forEach((key) => expect(l.action[key]).toBeTruthy());
      PAYMENT_METHODS.forEach((key) => expect(l.paymentMethod[key]).toBeTruthy());
      PAYMENT_STATUSES.forEach((key) => expect(l.paymentStatus[key]).toBeTruthy());
    }
    expect(localizedName('en', 'الراية', '')).toBe('الراية');
    expect(localizedName('ar', 'الراية', 'Al Raya')).toBe('الراية');
    expect(localizedName('en', 'الراية', 'Al Raya')).toBe('Al Raya');
  });
  it('translates common and dynamic errors without changing user-entered notes', () => {
    expect(localizeMessage('Saved', 'ar')).toBe('تم الحفظ');
    expect(localizeMessage('رقم الموبايل غير صحيح', 'en')).toBe('Enter a valid Egyptian mobile number');
    expect(localizeMessage('Password must be at least 10 characters', 'ar')).toContain('10');
    expect(localizeMessage('Cannot ACCEPT an order that is COMPLETED', 'ar')).toContain('اتغيّرت');
    expect(localizeMessage('الحد الأدنى للطلب 75 ج.م', 'en')).toBe('Minimum order 75 EGP');
    expect(errorMessage('FORBIDDEN', 'ar')).toContain('صلاحية');
    expect(errorMessage('INTERNAL', 'en')).toBe('Something went wrong. Please try again.');
    expect(localizeMessage('من فضلك من غير بصل', 'en')).toBe('من فضلك من غير بصل');
  });
});
