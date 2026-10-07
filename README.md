# ANU Essen — Campus QR Ordering

> منصة طلبات بالـ QR لطلاب جامعة الإسكندرية الأهلية. الطالب يعمل Scan → يختار من المنيو → يدفع InstaPay أو كاش → يتابع عداد الوقت → يستلم عند بوابة الباركينج.
> المحل عنده شاشة مطبخ بتشتغل **حتى لو النت قطع**، وصاحب المنصة عنده لوحة كاملة للعمولة والإعدادات.

First restaurant: **الراية الدمشقية**. Each restaurant has independent branding, menu, staff, payment settings, queue configuration and a permanent QR link.

## Premium ordering update — 7 October 2026

- Arabic mobile-first menu with search, category filters, accessible product customization, saved baskets and previous-order tracking.
- Compact checkout with editable quantities, promo codes, pickup choices, accurate cart-specific ETA and safe retry behavior.
- Tracking with server-corrected countdowns, explicit provisional estimates, delayed-order wording and manual InstaPay review.
- Super admin controls restaurant names, badge, tagline, logo, cover and color with live previews.
- Permanent `/q/{restaurantId}` codes redirect to the current `/s/{slug}`. PNG, SVG and branded poster exports include a scannable white margin. Old `/s/...` codes still depend on their original slug.
- Ordering/expiry concurrency and tenant isolation fixes, including user- and permission-scoped offline caches.

The supplied food photography is **illustrative demo imagery**. Replace it with actual restaurant/product photos before launch. Provenance is documented in `public/images/README.md`.

```
Student:   QR → Menu → Cart → Checkout → InstaPay / Cash → Order # → Live countdown → Delivered at the gate
Merchant:  New order (sound) → Verify payment → Preparing → Ready → Out for delivery → Arrived → Completed → Receipt
Platform:  Sales · commission ledger · settlements · queue engine · menus · staff · roles · audit log
```

---

## 1. Architecture (and why)

**One Next.js app, deployed as one Vercel project, plus one PostgreSQL database.** That's the whole infrastructure.

| Concern | Choice | Why |
|---|---|---|
| Web apps + API | **Next.js 16** (App Router, route handlers, server actions) | One deploy on Vercel. Customer, merchant PWA, admin and API share types and validation. |
| Database | **PostgreSQL** + **Drizzle ORM** + SQL migrations | Transactions, row locks, unique constraints = reliability. Works with Neon / Supabase / any Postgres. |
| Validation | **Zod**, shared between client and server | |
| Offline merchant | **IndexedDB** (`idb`) + service worker | Orders survive refresh, crashes and outages. |
| Realtime | **Cursor-based sync** (reliable) + short polling | Vercel functions can't hold WebSockets; see §6. A push channel can be added without changing anything else. |
| Rate limiting | Postgres fixed-window table | No Redis needed at this scale; swap in Upstash later behind the same function. |
| Auth | HttpOnly session cookie + scrypt (Node built-in) | No auth vendor, no native deps. |

The spec suggested NestJS + Socket.IO + Redis as separate services. Given the goal of **simplicity and Vercel hosting**, the backend lives in the same Next.js app. The domain logic is kept in **pure, framework-free modules** so it can move into a separate API service later without a rewrite:

```
src/
  lib/                     ← shared by browser + server (no DB, no Next.js)
    domain/
      order-machine.ts     ← order state machine (single source of truth)
      queue.ts             ← Smart Queue & ETA engine
      pricing.ts           ← cart pricing, promotions, commission
      permissions.ts       ← RBAC catalogue + system roles
      hours.ts             ← opening hours / timezone math
      store-status.ts      ← OPEN / BUSY / PAUSED / CLOSED
    validation.ts, types.ts, labels.ts, receipt-text.ts
  server/
    db/schema.ts           ← Drizzle schema (migrations generated into /drizzle)
    services/              ← checkout, order-actions, sync, menu, stats, audit …
    actions/               ← server actions for admin/merchant forms (all permission-checked)
    auth/                  ← sessions, password hashing, RBAC loader
  client/merchant/         ← offline engine (IndexedDB, outbox, sync)
  components/              ← customer / merchant / admin UI
  app/
    q/[id]                 ← permanent restaurant QR redirect
    s/[slug]               ← customer menu   /s/[slug]/checkout
    order/[token]          ← tracking page (unguessable token, no account)
    merchant/*             ← merchant PWA: kitchen screen, dashboard, menu, staff
    admin/*                ← super admin
    api/*                  ← public + merchant APIs, /api/health, /api/ready
tests/                     ← unit + integration (real migrations on in-memory Postgres)
```

---

## 2. Run it locally

Requirements: Node 20.9+ and Docker (only for local Postgres).

```bash
cp .env.example .env          # then set SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD
npm install
npm run db:up                 # Postgres 17 in Docker
npm run db:migrate
npm run db:seed               # roles, super admin, demo restaurant "الراية الدمشقية"
npm run dev
```

- Customer menu: <http://localhost:3000/s/alrayez> (try `?utm_source=campus_poster_1`)
- Staff sign in: <http://localhost:3000/login>
  - Super admin: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
  - Demo staff (password = `SEED_DEMO_PASSWORD`): `owner@alrayez.test`, `cashier@alrayez.test`, `kitchen@alrayez.test`, `delivery@alrayez.test`
- Promo code in the seed: `WELCOME10` (10% from 100 EGP, max 30 EGP)

```bash
npm test            # 78 tests: domain units + integration + full acceptance scenario
npm run typecheck
npm run db:reset    # local only: wipe, migrate, seed
```

Tests need no Docker: they run the real SQL migrations on an in-memory Postgres (PGlite).

---

## 3. Deploy (Vercel + Neon/Supabase)

1. Create a Postgres database (Neon free tier in **Frankfurt** matches `vercel.json` → `fra1`, the closest region to Egypt).
2. Import this repo in Vercel. Set the environment variables:
   - `DATABASE_URL` (pooled URL is fine; the app uses `prepare: false`)
   - `APP_URL` = your public URL (used for QR codes)
   - optional: `DB_POOL_MAX` (default 5), `LOG_LEVEL`
3. Deploy. `vercel-build` runs `db:migrate` and then `next build`, so migrations apply on every deploy.
4. Seed once from your machine against the production DB:
   ```bash
   DATABASE_URL=… SEED_ADMIN_EMAIL=you@… SEED_ADMIN_PASSWORD='a-long-password' SEED_DEMO=false npm run db:seed
   ```
   (Use `SEED_DEMO=true` + `SEED_DEMO_PASSWORD` for a demo restaurant.)
5. Sign in → Admin → Restaurants → configure identity, InstaPay, opening hours and queue → Marketing tab → download the QR (PNG/SVG) or branded poster.
6. Set `APP_URL` to the actual public HTTPS origin before generating print files. Localhost QR codes are for this computer only. Physically scan the final print on several phones before distributing it.

No secrets are committed; `.env` is git-ignored.

---

## 4. Order lifecycle (state machine)

`src/lib/domain/order-machine.ts` is the only place transitions are defined. The server validates every change. The merchant PWA uses the same table to apply actions optimistically while offline.

```
InstaPay:  AWAITING_PAYMENT ──SUBMIT_PAYMENT(customer)──▶ PAYMENT_REVIEW ──VERIFY_PAYMENT──▶ CONFIRMED
                 ▲                                            │
                 └──────────────REJECT_PAYMENT────────────────┘   (VERIFY also allowed directly from AWAITING_PAYMENT)
Cash:      CREATED ──ACCEPT──▶ CONFIRMED

CONFIRMED ─START_PREPARING▶ PREPARING ─MARK_READY▶ READY ─OUT_FOR_DELIVERY▶ OUT_FOR_DELIVERY ─MARK_ARRIVED▶ ARRIVED_AT_GATE ─COMPLETE▶ COMPLETED
Any non-terminal ──CANCEL──▶ CANCELLED   (customer only before paying; unpaid InstaPay orders auto-expire after N minutes)
```

Each action is tied to a permission (`orders.kitchen`, `payments.verify`, …). Every change appends an **order event**. The event log is the timeline, the status history and the sync feed, and it stores both `occurred_at` (when it happened on the device) and `recorded_at` (when the server received it).

Payment statuses: `UNPAID · PAYMENT_SUBMITTED · PAYMENT_VERIFIED · PAYMENT_REJECTED · CASH · REFUNDED`.

---

## 5. Smart Queue & ETA engine

- Every product (and optionally each size) has **`prep_load_units`**: sandwich = 1, meal = 2, drink = 0.
- **Active kitchen load** = sum of load units of orders in `CONFIRMED` + `PREPARING`.
- When an order is confirmed, the server computes `projected load = active + this order` and looks up the capacity rules:

```json
{ "basePrepMinutes": 7, "deliveryMinutes": 2,
  "capacityRules": [ {"maxLoad":30,"prepMinutes":7}, {"maxLoad":40,"prepMinutes":8},
                     {"maxLoad":50,"prepMinutes":10}, {"maxLoad":60,"prepMinutes":12}, {"maxLoad":70,"prepMinutes":14} ],
  "overflowStepUnits": 10, "overflowStepMinutes": 2,
  "busyAtLoad": 31, "heavyAtLoad": 51, "maxAcceptedLoad": 90, "maxActiveOrders": 0, "autoPause": true }
```

- It stores `estimated_prep_start_at`, `estimated_ready_at` and `estimated_arrival_at` on the order. The ETA is **server-authoritative**. Ready, out-for-delivery and arrived each recalculate it (`eta_version` increments). The customer countdown uses `estimated_arrival_at − server time`, correcting for the phone's clock offset.
- Everything is configurable **per restaurant by platform admins only** (Admin → Restaurant → *Queue & ETA*), with a live preview table. Merchants only see the result ("18 / 30 · Normal").
- At `maxAcceptedLoad` / `maxActiveOrders` the store shows **PAUSED** and new orders are refused ("الطلبات متوقفة مؤقتًا بسبب ضغط الطلبات") when `autoPause` is on.

---

## 6. Offline-first merchant PWA (No Lost Orders rule)

```
            ┌─────────────── merchant device ────────────────┐
 server ──▶ │ pull /api/merchant/sync?cursor=N               │
            │   → write orders + cursor to IndexedDB (1 tx)  │  ← only then shown on screen
            │                                                │
 staff tap ─│ action → IndexedDB outbox (UUID, timestamp)    │  ← UI updates instantly, offline OK
            │   → POST /api/merchant/actions (batch)         │
            │   ← applied | duplicate | rejected | retry     │
            └────────────────────────────────────────────────┘
```

- **Gap-free cursor.** Each restaurant has a counter row. Every order event takes the next `seq` while holding that row lock, so events commit in cursor order. A device that asks for "everything after N" can never skip an event, even if a push or poll was missed. Orders placed while the shop was offline arrive on the first sync after reconnecting.
- **Exactly-once actions.** Every offline action carries a client UUID (`order_events.client_event_id` is UNIQUE). Retries return `duplicate`. Actions that are no longer valid (another device already did it) return `rejected` and the server state wins.
- **Real timestamps.** Offline actions keep the time they happened, clamped between the order's creation time and server time.
- **Service worker** caches the `/merchant` app shell, so the kitchen screen **reloads with no internet** and shows all orders from IndexedDB.
- **Status pill:** Online / Offline — working locally / Syncing… / Synced ✓, with a pending-action count.
- New orders trigger a sound (WebAudio, enabled with one tap), vibration, a system notification when the tab is hidden, a highlighted card and a title badge. A screen wake lock keeps tablets awake.

**Realtime.** The sync endpoint polls every 3 s while the screen is visible, and the customer page polls every 4 s. Vercel functions can't hold WebSocket connections, so this reliable pull is the source of truth. To get sub-second push later, add a provider (Ably / Pusher / Supabase Realtime) that only sends "sync now" nudges. Nothing else changes.

---

## 7. Payments & commission

- **InstaPay is verified manually** (no official API is assumed). The student sees the amount, the InstaPay address/phone (with copy buttons), "write `Order #A124` in the transfer note", an optional reference and an optional screenshot (compressed to ≤ 480 KB on the phone). Staff see it as *Waiting verification* and press **Confirm payment** or **Reject** (with a reason, which the student sees).
- **Cash** can be enabled or disabled per restaurant. Cash orders must be accepted, and payment becomes *verified* on completion.
- **Commission is a ledger.** Each order snapshots `commission_bps`, `commission_amount = (subtotal − discount) × rate` and `merchant_net`. Changing a restaurant's rate never changes past orders. Sales count when an order is **completed**. *Settlements* record commission received. Admin → Commissions shows gross sales, commission, paid and outstanding per restaurant and period, plus orders per QR poster (`utm_source`).
- Money is stored as integer piasters; currency is EGP.

## 8. Roles & permissions

`Role`, `Permission`, `RolePermission` and `UserRole` (with an optional restaurant scope). Platform roles grant permissions everywhere. Store roles grant them only inside their restaurant and can never hold `platform.*` permissions. Custom roles can be created in Admin → Roles.

| Role | Highlights |
|---|---|
| SUPER_ADMIN | Everything: restaurants, queue engine, finance, users/roles, audit, settings |
| MERCHANT_OWNER | Own restaurant: orders, payments, menu & prices, staff, reports (no platform finance) |
| MERCHANT_MANAGER | Operations: orders, payments, availability, pause/open, reports |
| CASHIER | Orders, accept, payment verification, receipts, delivery steps |
| KITCHEN_STAFF | Kitchen steps + receipts (customer phone numbers hidden) |
| DELIVERY_STAFF | Only READY orders + deliveries they took |

Product **load units** can only be changed by users with `platform.queue`.

## 9. Receipts & printing

The receipt is designed for 80 mm (or 58 mm) thermal printers using print CSS (`@page size: 80mm auto`), and the paper width is selectable on the kitchen screen. Print and reprint work offline from the local snapshot. Browsers can't print silently, so `src/client/merchant/printing.ts` defines a `PrintDriver` interface and `receiptText()` (a fixed-width text receipt) for a future QZ Tray / PrintNode / local print bridge.

## 10. Reliability, security, observability

- Transactions plus row locks for order creation and every transition. Unique constraints cover order numbers, idempotency keys and client event ids.
- **`Idempotency-Key`** on order creation: a double tap or retry returns the same order, and the same key with a different cart returns 422.
- Snapshots: item names and prices, add-ons, discount, delivery point and commission are stored on the order.
- Sessions are HttpOnly SameSite cookies with sliding expiry. Passwords use scrypt. Login is rate-limited and timing-safe. Mutating API routes check the Origin header (CSRF), and server actions have Next.js built-in origin protection.
- Rate limits: order creation per IP and per phone, payment submission, quotes and login.
- Security headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, a minimal CSP). Uploads are magic-byte checked. The tracking URL is an unguessable token (`/order/<token>`), not the order number.
- Every important action is audit-logged with the actor, before/after values and the IP or device. This covers prices, availability, payment verify/reject, cancel, complete, commission, queue config, staff and roles, settlements, settings and logins.
- Structured JSON logs and an `x-request-id` header on API responses. `/api/health` reports liveness and `/api/ready` checks the database. To plug in Sentry or similar, call `setErrorReporter()` in `src/server/log.ts`.
- All timestamps are `timestamptz` (UTC). Display, opening hours, "today" reports and promotion windows use the restaurant's timezone (`Africa/Cairo`, DST-aware).

## 11. Tests

`npm test` runs 78 tests:
- `queue.test.ts`: the spec's load→prep table (25→7, 35→8, 48→10, 55→12…), config-driven, ETA math, load levels
- `order-machine.test.ts`: allowed and forbidden transitions, actor rules, payment status
- `pricing.test.ts`: variants, add-ons, availability, promo codes and limits, the spec's commission example (200−20=180 → 9 → net 171)
- `hours.test.ts`: overnight hours, DST, local day boundaries, phone normalisation, order numbers
- `integration.test.ts`: idempotent creation (sequential and concurrent), price and commission snapshots, pause and capacity, promo usage limits, payment verification and ETA from load, offline action idempotency and timestamps, missed-order sync by cursor, delivery and kitchen visibility, cross-restaurant permission isolation, unpaid expiry
- `acceptance.test.ts`: the full 26-step acceptance scenario, from QR to commission in the admin dashboard
- `reliability.test.ts`: cart-aware ETA, deadlines, action replay, concurrent promo retries, tenant identity and safe payment links
- `cart-offline.test.ts`: damaged storage, unavailable selections and shared-terminal cache isolation
- `restaurant-identity.test.ts`: isolated branding, stable redirects and independent QR round-trip decoding

Browser checks run against a **local, seeded demo database** and create demo orders:

```bash
npx playwright install chromium
E2E_BASE_URL=http://localhost:3000 E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD='your-local-seed-password' npm run test:e2e
# If Chrome is installed, add PLAYWRIGHT_CHANNEL=chrome instead of installing Chromium.
```

The three browser scenarios cover customized cash checkout and every fulfilment step, manual InstaPay review, and QR/poster downloads decoded independently with jsQR. Menu, checkout and tracking also receive automated WCAG 2 A/AA checks; these do not replace testing with real people and assistive technologies.

A separate real PostgreSQL verification uses 12 connections, creates unique temporary fixtures, exercises concurrent checkout/action/promotion/ETA/sync cases, then removes those fixtures. It refuses remote or production databases:

```bash
npm run test:postgres
```

Observed local validation: 24 same-key requests created one order, 24 final-promo retries consumed one allowance, 12 action retries applied once, and concurrent traffic yielded 80 unique, gap-free events. This is a short burst test, not a sustained load or network-failure benchmark.

`npm audit --omit=dev` reports no production advisories. The development migration tool chain retains four moderate entries originating from one legacy esbuild advisory; do not apply npm's suggested Drizzle Kit downgrade blindly.

## 12. Growing later (designed for, not built)

More restaurants and campuses (already multi-tenant), more delivery points and zones (the `delivery_points` table), drivers and assignment (`assigned_to_user_id`), online payments (add a `payment_method` and webhook), wallet and loyalty (the `customers` table is keyed by phone), scheduled orders, native apps (the public and merchant JSON APIs are already there), push realtime, Redis or Upstash rate limiting, blob storage for screenshots, and kitchen printers via `PrintDriver`.
