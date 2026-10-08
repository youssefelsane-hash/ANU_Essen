import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mock = vi.hoisted(() => ({
  pageAuth: vi.fn(), merchantContext: vi.fn(), platformOverview: vi.fn(), merchantOverview: vi.fn(),
  management: vi.fn(), cashPanel: vi.fn(),
}));
vi.mock('@/server/auth/session', () => ({ pageAuth: mock.pageAuth }));
vi.mock('@/server/merchant-context', () => ({ merchantContext: mock.merchantContext }));
vi.mock('@/server/db', () => ({ db: () => 'test-db' }));
vi.mock('@/server/admin-guard', () => ({ platformTimezone: async () => 'Africa/Cairo' }));
vi.mock('@/server/services/couriers', () => ({ platformCourierOverview: mock.platformOverview, merchantCourierOverview: mock.merchantOverview }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'ar' }));
vi.mock('@/components/admin/ui', () => ({
  Forbidden: () => createElement('p', null, 'FORBIDDEN'),
  PageTitle: ({ title }: { title: string }) => createElement('h1', null, title),
}));
vi.mock('@/components/admin/courier-management', () => ({ CourierManagement: mock.management }));
vi.mock('@/components/admin/courier-cash-panel', () => ({ CourierCashPanel: mock.cashPanel }));

import DeliveryAdminPage from '@/app/admin/delivery/page';
import MerchantCouriersPage from '@/app/merchant/couriers/page';

const restaurant = { id: 'restaurant-a', nameAr: 'مطعم أول', nameEn: 'First restaurant', timezone: 'Africa/Cairo' };
function auth(permissions: string[]) { return { user: { id: 'admin-one', name: 'Admin' }, platformPermissions: new Set(permissions) }; }

beforeEach(() => {
  vi.clearAllMocks();
  mock.management.mockImplementation(() => createElement('p', null, 'MANAGEMENT'));
  mock.cashPanel.mockImplementation(() => createElement('p', null, 'CASH'));
  mock.platformOverview.mockResolvedValue({ restaurants: [], candidates: [], couriers: [], balances: [{ userId: 'cash-courier' }], handIns: [] });
  mock.merchantOverview.mockResolvedValue({ balances: [{ restaurantId: restaurant.id }], handIns: [] });
});

describe('courier administration permission boundaries', () => {
  it('keeps financial controls hidden from a user administrator even when the cash view is requested', async () => {
    mock.pageAuth.mockResolvedValue(auth(['platform.users']));
    const html = renderToStaticMarkup(await DeliveryAdminPage({ searchParams: Promise.resolve({ view: 'cash' }) }));
    expect(html).toContain('MANAGEMENT');
    expect(html).not.toContain('CASH');
    expect(mock.cashPanel).not.toHaveBeenCalled();
    expect(mock.management.mock.calls[0][0]).not.toHaveProperty('balances');
    expect(mock.management.mock.calls[0][0].actorUserId).toBe('admin-one');
  });

  it('allows a finance administrator to review cash without receiving user-assignment controls', async () => {
    mock.pageAuth.mockResolvedValue(auth(['platform.finance']));
    const html = renderToStaticMarkup(await DeliveryAdminPage({ searchParams: Promise.resolve({ view: 'team' }) }));
    expect(html).toContain('CASH');
    expect(html).not.toContain('MANAGEMENT');
    expect(mock.management).not.toHaveBeenCalled();
    expect(mock.cashPanel.mock.calls[0][0]).not.toHaveProperty('candidates');
  });

  it('rechecks a revoked platform permission before loading either report', async () => {
    mock.pageAuth.mockResolvedValue(auth(['platform.users', 'platform.finance']));
    renderToStaticMarkup(await DeliveryAdminPage({ searchParams: Promise.resolve({}) }));
    mock.platformOverview.mockClear();
    mock.management.mockClear();
    mock.cashPanel.mockClear();
    mock.pageAuth.mockResolvedValue(auth([]));
    const html = renderToStaticMarkup(await DeliveryAdminPage({ searchParams: Promise.resolve({ view: 'cash' }) }));
    expect(html).toContain('FORBIDDEN');
    expect(mock.platformOverview).not.toHaveBeenCalled();
    expect(mock.management).not.toHaveBeenCalled();
    expect(mock.cashPanel).not.toHaveBeenCalled();
  });

  it('loads only the selected authorized restaurant for an owner', async () => {
    const owner = auth([]);
    mock.merchantContext.mockResolvedValue({ auth: owner, restaurant, permissions: new Set(['couriers.cash']) });
    renderToStaticMarkup(await MerchantCouriersPage());
    expect(mock.merchantOverview).toHaveBeenCalledExactlyOnceWith('test-db', owner, restaurant.id);
    expect(mock.cashPanel.mock.calls[0][0]).toMatchObject({ actorUserId: owner.user.id, showRestaurant: false, timezone: restaurant.timezone });
  });

  it('does not expose owner accounting to a courier or an owner whose cash permission was removed', async () => {
    for (const permissions of [['orders.delivery', 'orders.view'], []]) {
      mock.merchantContext.mockResolvedValue({ auth: auth([]), restaurant, permissions: new Set(permissions) });
      const html = renderToStaticMarkup(await MerchantCouriersPage());
      expect(html).toContain('ليس لديك صلاحية');
    }
    expect(mock.merchantOverview).not.toHaveBeenCalled();
    expect(mock.cashPanel).not.toHaveBeenCalled();
  });
});
