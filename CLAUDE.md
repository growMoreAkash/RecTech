# CLAUDE.md — DineSense

AI restaurant floor & guest-journey platform. Product brief: `docs/PRD.md`. Engineering plan: `docs/PLAN.md`.

## Current status

- **Plan:** approved 2026-11-05.
- **Done:** M0 (tooling), M1 (schema, seed, auth, tenancy, RBAC, audit), M2 (state machine, floor map & editor,
  staff & shifts, Socket.IO, dashboard), M3 (menu, guest QR app, shared cart, order approval, KDS), M4 (staff PWA,
  web push, billing + GST invoice, alerts centre, audit viewer, e2e suite) — **Phase 1 complete** — and M5 (greet SLA
  engine, round-robin assignment, re-assignment, escalation, settings), M6 (edge vision service, signed edge events,
  cameras page with zone calibration, camera health, synthetic dev footage + eval), M7 (split bills, Razorpay
  pay-at-table in test mode, departure/cleaning, reports) — **Phase 2 complete**. Phase 3 (`docs/PLAN-P3.md`,
  approved 2026-11-05): M8 (guest profiles + DPDP export/erase/retention, returning-guest recognition, online
  booking + manage link, table holds, no-shows, bookings/guests pages), M9 (guest messaging outbox with WhatsApp
  Cloud API / console channel, booking confirm/change/reminder, digital waitlist with ETAs, door-camera party size),
  M10 (idle-table nudges/alerts from staff touches, course pacing with held mains, prep-time ETAs, mid-meal
  check-in with service recovery, camera dirty-table check, tips per waiter). Demo scripts: `docs/MILESTONES.md`.
- **Next milestone:** M11 — feedback, loyalty & growth (needs owner approval). Open items: real footage for vision
  accuracy; Razorpay test keys; Meta WhatsApp Business account + approved templates (`docs/whatsapp-templates.md`)
  to switch from console.

## How we work

1. Get approval before starting a new milestone or changing the stack.
2. One milestone at a time. After each: `pnpm lint && pnpm typecheck && pnpm test` (and `pytest` in Python
   services) must pass; then update this file and write a short demo script in the PR.
3. Ask before adding any paid service or new infrastructure. Every secret goes in `.env.example` with a comment.
4. Phase 3 is approved milestone by milestone (`docs/PLAN-P3.md`); do not build Phase 4 features (extension points only).
5. Never run destructive DB commands (`prisma migrate reset`, `db push --force-reset`, `TRUNCATE`, seed) against
   anything but a local dev database, and never bypass Prisma's AI-agent consent guard without the owner's explicit OK.

## Layout

```
apps/api            NestJS API (only component that changes table state)
  prisma/           schema.prisma, migrations/, seed.ts
  src/auth          login, PIN login (device-bound), rotating refresh, global AuthGuard (JWT + RBAC + outlet scope)
  src/prisma        PrismaService, forOrg() tenant-scoped client
  src/audit         AuditService (call inside the same transaction as the change) + list endpoint
  src/outlets       outlets + OutletSettings
  src/devices       staff terminal / KDS device registration
  src/table-state   TableStateService (only writer of table state), TableViews, SlaScheduler interface
  src/sla           SlaEngine.evaluate (idempotent greet rule), BullMQ scheduler + reconcile sweep, assignment ack
  src/floor         floor snapshot, bulk floor-plan save, sections
  src/staff         staff, shifts, check-in sequence, breaks
  src/alerts        alerts list / ack / resolve
  src/realtime      Socket.IO /rt gateway (staff + guest tokens) + RealtimeService.emit
  src/menu          stations, categories, items, modifier groups, availability (guest menu filtering)
  src/ordering      OrderingService (pricing, QR/waiter orders, approval, KDS flow) + orders/KDS endpoints
  src/guest         public QR endpoints (/g/*), guest JWT, GuestGuard, rate limits
  src/billing       bills (open → finalised → paid), gap-free invoice numbers, split shares, payments, signed HTML
                    invoice; online payments (reserve → provider order → capture) live here too
  src/payments      PaymentProvider interface + RazorpayProvider, guest pay endpoints (/g/bills, /g/payments*),
                    signed provider webhook (/payments/razorpay/webhook)
  src/guests        guest profiles (org-wide, phone E.164), consent history, lookup, DPDP export/erase, retention sweep,
                    visit stats recomputed on seating close (SeatingEvents hook)
  src/reservations  bookings: availability (pure, in shared), staff + public /b/* endpoints, signed manage links,
                    check-in through the state machine, hold/no-show sweep, opening hours
  src/messaging     guest message outbox (MessageLog rows queued in the business tx), dispatcher (SKIP LOCKED leases),
                    WhatsApp Cloud API / console channel, signed Meta webhook (statuses, STOP opt-out)
  src/waitlist      digital waitlist (QR /w/* + host), ETAs from the pure predictWaits, table-ready holds + message
  src/service-quality ServiceEngine sweep (idle nudge/alert, fire-mains prompt/auto-fire, dessert offer) over the
                    pure decideService; prep-time ETAs live in src/ordering/prep-time.service.ts
  src/reports       day report (managers): seatings, greet times, per-waiter SLA, sales by hour, payments
  src/tasks         staff task inbox (accept / done)
  src/notifications NotifierService (socket + web push for every new task/alert), PushService (VAPID)
  src/edge          edge devices (HMAC-signed, secret derived, never stored), cameras (RTSP URL AES-GCM), zones,
                    snapshots, /edge/config + /edge/events (dedupe via EdgeEventReceipt), health sweep → alerts
  test/             integration tests (*.int.ts) against real Postgres + Redis
apps/dashboard      Next.js 15 (App Router): /login, /floor, /floor/edit, /floor/qr, /staff, /menu, /kds/[station],
                    /bills, /alerts, /audit, /reports, /bookings, /waitlist, /guests, /cameras, /settings
  src/lib           api client (silent refresh), session, live socket sync, queries, pure floor/editor/kds helpers
apps/guest          Next.js 15 mobile PWA on :3001 — /t/[qrToken]: menu, cart, orders, pay; /b/[slug] booking; /b/manage/[token]; /w/[slug] join queue; /w/status/[token]
apps/staff          Next.js 15 PWA on :3002 — device setup, PIN pad, tasks, tables (take order/approve/serve), clean, shift, push
e2e/                Playwright full-service test against the built apps (`pnpm e2e`; wipes/seeds dinesense_e2e)
packages/ui         shared TSX primitives (Button, Field, Sheet, VegMark, Money); apps transpile the source
services/vision     Python 3.11 edge service (uv, ruff, mypy --strict, pytest): `ds-vision run|synth|eval|snapshot|record|fetch-model`
packages/shared     enums (mirror Prisma), table-machine (pure reducer), zod schemas, realtime contracts, money/GST, time
packages/i18n       en/hi catalogs (key parity enforced by test)
packages/config     shared tsconfig + eslint flat config
infra/              docker-compose.yml, Dockerfiles
```

## Architecture (short)

- `apps/api` (NestJS + Prisma + BullMQ + Socket.IO) is the **only** component that changes table state.
- Apps talk REST to the API and receive live updates over Socket.IO. The edge vision service only sends events.
- Table state machine: pure reducer in `packages/shared/src/table-machine`; side effects in `TableStateService`.
- Greet SLA: `SlaEngine.evaluate(seating, now)` is the single, idempotent decision (breach → assign → re-assign →
  escalate) under a per-seating advisory lock; BullMQ delayed jobs only decide _when_ it runs, plus a 30 s sweep.
- Video never leaves the restaurant. No face recognition. No video storage.

## Conventions

- TypeScript strict everywhere; zod for every input (shared schemas in `packages/shared`).
  Validate with `@Body(new ZodPipe(schema))` and document with `@ApiZodBody(schema)`.
- Multi-tenant: every tenant row carries `organizationId` (+ `outletId`). Query tenant data through
  `prisma.forOrg(ctx.user.org)`; the raw client is only for auth bootstrap and system jobs.
- RBAC: every route has `@Roles(...)`, `@Managers()`, `@Authenticated()` or `@Public()`; a unit test fails otherwise,
  and the guard denies at runtime. Routes under `/outlets/:outletId/...` are checked against roles _in that outlet_;
  an outlet the user has no role in returns **404**, not 403.
- Audit: `AuditService.record(ctx, entry, tx)` inside the same `$transaction` as the change.
- Money in **paise** (`Int`), tax rates in **basis points**. Never use floats for money. Use `gstForLine()`.
- Times stored UTC (`timestamptz`), displayed in `Asia/Kolkata`.
- UI strings only via i18n catalogs (`packages/i18n`: `en`, `hi`). No hard-coded user-facing text.
- Error shape: `{ error: { code, message, details?, requestId } }`. Throw `AppError` with an `ErrorCode`.
- Shared enums in `packages/shared/src/enums.ts` must match Prisma enums (test enforces it).
- Never rely on `instanceof ZodError` (ESM/CJS dual copies under Vitest) — `ZodPipe` uses `safeParse`.
- BullMQ custom job ids use `_` separators (`:` is not allowed).
- Table state changes go only through `TableStateService.apply()`; UIs ask the same shared `transition()` which
  actions to offer, so buttons never offer what the API would reject.
- Realtime is a hint: every client refetches on (re)connect; REST is the source of truth.
- Dashboard: React is pinned to 19.2.x to match the React that Next 15 vendors (react-konva 19.3 refuses it);
  canvases load via `next/dynamic({ ssr: false })` with a sized placeholder. Every canvas has an accessible list
  equivalent.
- Guests: prices are always computed server-side (`priceLines`); guest tokens have their own issuer/audience and
  die when the seating closes; every public `/g/*` route is rate-limited.
- Snapshots shown back to the API must be stripped of read-only fields (see `toDraft`): request schemas are strict.
- Plurals in English strings use ICU (`{count, plural, one {…} other {…}}`).
- Billing: GST is computed per rate on the rate's total taxable value (so "CGST @ x% on ₹X" prints exactly) and
  distributed back to lines; invoice numbers are allocated inside the finalise transaction (gap-free).
- New tasks/alerts must go through `NotifierService` after commit (socket + push); it never throws into the caller.
- SLA logic is tested with explicit `now` values (fake clock) against the engine; one test waits for a real timer.
- Waiter selection is pure (`packages/shared/src/assignment`); the API only builds candidates and holds the
  `rr:{outletId}` advisory lock while picking and advancing the cursor.
- Edge: signing helper is the Node-only entry `@dinesense/shared/edge-signing` (never import node:crypto from the
  shared root — it breaks browser bundles). After changing edge contracts run `pnpm --filter @dinesense/shared
gen:edge-schema`; the Python tests validate events against that JSON Schema and the shared signing vector.
- Vision: the same `CameraPipeline` runs live and in `ds-vision eval`. Only seated people make a table occupied;
  standing people at an occupied table are staff-present candidates. Frames never leave memory except blurred
  calibration snapshots. Synthetic footage/detector are dev/eval only; real cameras use YOLOX.
- Payments: amounts due are always computed by `BillingService` (never by the provider or the browser). Online
  capture is idempotent by provider order id; browser callback and webhook may both arrive. Webhooks are verified
  over the raw body. A split share is `Payment.shareKey`; shares come from the pure `computeSplit` (sums exactly).
  Money is never refused once taken: excess is recorded and audited as `bill.payment.excess` for a manual refund.
- Guests: phone is the only identity (no faces). Personal data lives only on `Guest`; erasure nulls it and keeps the
  row; audit entries for guest changes store field names, never values. Every read of a profile is audited.
  Consents are per purpose (WHATSAPP/FEEDBACK/MARKETING), never pre-ticked, history in `GuestConsent`.
- Bookings: availability is the pure `pickTables`/`listSlots` (packages/shared/src/booking, property-tested);
  every booking write takes the `book:{outletId}` advisory lock and re-checks. Online bookings must hit an
  available slot; staff can book any time/table. Public `/b/*` routes are rate-limited per IP and per phone.
- Messaging: never call a provider from business code — `MessagingService.queue(tx, …)` inside the transaction;
  one row per purpose + entity (`dedupeKey`). WhatsApp consent is required to queue and re-checked at send time.
  Template texts live in i18n `whatsapp.*`; variable order in `MESSAGE_VARIABLES`; names `ds_<purpose>`.
- Service quality: a "staff touch" (`touchSeating` in table-state) is any STAFF table transition, camera
  staff-present, waiter order, served item or ticked-off task; it ends the idle episode (closes CHECK_TABLE,
  resolves IDLE_TABLE). Every prompt is claimed by compare-and-set on its seating marker (`idleNudgedAt`,
  `idleAlertedAt`, `fireMainsPromptAt`, `dessertOfferAt`) so parallel sweeps never double it. Rules are the pure
  `decideService` (packages/shared/src/service), tested with explicit `now`.
- Pacing: `OrderItem.course` snapshots the category's course; HELD items are on the KDS but only `fireCourse`
  releases them. An item's `queuedAt` is when it reached the kitchen (restarted on approval/fire, keeping relative
  order); `etaReadyAt` is stamped then for accuracy tracking.
- Tips: `Payment.tipPaise` on top of `amountPaise`, never part of the bill, invoice or GST; attributed to the
  serving waiter at payment time (`tipWaiterId`). Online orders charge amount + tip; capture splits the charged
  amount back (tip comes out last).
- Waitlist ETAs are ranges from `predictWaits` (packages/shared/src/booking/wait-time.ts): table free-at times from
  stage + this outlet's 28-day median dwell (fallback: turn times), then the queue played forward.
- Commits: conventional commits (`feat(api): …`, `fix(vision): …`).

## Commands

```bash
cp .env.example .env                       # once; root .env is read by the API and the Prisma CLI
docker compose -f infra/docker-compose.yml up -d postgres redis   # or local Postgres 16 + Redis 7
pnpm i
pnpm --filter @dinesense/api db:migrate    # prisma migrate dev (local dev DB only)
pnpm --filter @dinesense/api seed          # DESTRUCTIVE: wipes and re-seeds the dev DB (refuses NODE_ENV=production)
pnpm dev                                   # API :4000 (OpenAPI /api/docs), dashboard :3000, guest :3001, staff :3002
pnpm lint | pnpm typecheck | pnpm test | pnpm build | pnpm format
pnpm --filter @dinesense/api test:unit     # no DB needed
pnpm --filter @dinesense/api test:int      # needs TEST_DATABASE_URL (db name must contain "test")
pnpm build && pnpm e2e                     # full service in browsers; stop dev servers first (uses ports 3000-3002, 4000)
```

Integration tests run `prisma migrate deploy` on the test DB and never delete data; each test creates its own
organization. Drop/recreate `dinesense_test` yourself if it grows.

Seed credentials (dev only): email users `owner|manager|host|cashier@demo.dinesense.in` / `dinesense123`;
`chef@demo.dinesense.in` (KDS) has the same password; staff terminal header
`x-device-token: sd_demo_floor_terminal_dev_only`; guest QR links: dashboard → Floor plan → Table QR codes; PINs printed by the seed
(waiters 1001–1006, bussers 2001–2002).

## Decisions log

| Date       | Decision                                                                                                             | Status           |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 2026-11-05 | Stack as in brief (pnpm/Turborepo, NestJS/Prisma/Postgres, Redis/BullMQ, Socket.IO, Next.js, Python vision)          | Accepted (brief) |
| 2026-11-05 | D1 Apache-2.0 detector (RT-DETR/D-FINE or YOLOX), not Ultralytics AGPL                                               | Accepted         |
| 2026-11-05 | D2 Aspect-ratio posture first, RTMPose behind flag                                                                   | Accepted         |
| 2026-11-05 | D3 HTTPS + HMAC + SQLite outbox for edge events; MQTT deferred                                                       | Accepted         |
| 2026-11-05 | D4 VAPID Web Push first; FCM with Expo app later                                                                     | Accepted         |
| 2026-11-05 | D5 Own auth: password for managers, device-bound PIN for floor staff                                                 | Accepted         |
| 2026-11-05 | D6 `SeatingTable` join model for joined tables                                                                       | Accepted         |
| 2026-11-05 | D7 Paise + basis points for money/tax                                                                                | Accepted         |
| 2026-11-05 | D8 Node 22, NestJS 11, Prisma 6, Next 15, React 19, Tailwind 4, Vitest (zod 3.25)                                    | Accepted         |
| 2026-11-05 | D9 next-intl, shared catalogs in `packages/i18n`                                                                     | Accepted         |
| 2026-11-05 | D10 KDS as a route group inside `apps/dashboard`                                                                     | Accepted         |
| 2026-11-05 | State machine reducer moved from M5 into M2; added M0 for tooling                                                    | Accepted         |
| 2026-11-05 | M1: integration tests use a real Postgres/Redis from env (CI service containers) instead of testcontainers           | Accepted         |
| 2026-11-05 | M1: tests are non-destructive (`migrate deploy`, per-test tenants); no `migrate reset` in tooling                    | Accepted         |
| 2026-11-05 | M1: `organizationId` added to `OrderItem` and `GuestSession` so KDS/guest queries are tenant-scoped                  | Accepted         |
| 2026-11-05 | M1: audit via explicit `AuditService.record()` in the same transaction (not an interceptor) — real before/after      | Accepted         |
| 2026-11-05 | M1: refresh tokens are opaque, hashed, rotated; reuse of a rotated token revokes the whole family                    | Accepted         |
| 2026-11-05 | M1: PIN login locked per user after `PIN_MAX_ATTEMPTS` failures (Redis counter, `PIN_LOCKOUT_SECONDS`)               | Accepted         |
| 2026-11-05 | M1: modules are CommonJS (Nest-friendly); `packages/*` build to `dist/` and turbo builds deps first                  | Accepted         |
| 2026-11-05 | M2: table rows locked `FOR UPDATE` per transition; client `expectedVersion` → 409 `VERSION_CONFLICT`                 | Accepted         |
| 2026-11-05 | M2: camera vacancy never auto-closes an unpaid table; with an order it raises LEFT_WITHOUT_PAYING                    | Accepted         |
| 2026-11-05 | M2: a waiter-taken order counts as greet; QR orders only if `qrOrderSatisfiesGreet`                                  | Accepted         |
| 2026-11-05 | M2: events that fulfil a task mark it DONE (greet, clean, pay); departures CANCEL the rest                           | Accepted         |
| 2026-11-05 | M2: the greeting waiter becomes the serving waiter unless one is already assigned                                    | Accepted         |
| 2026-11-05 | M2: only OWNER may grant OWNER/MANAGER; role changes and deactivation revoke sessions                                | Accepted         |
| 2026-11-05 | M2: shared UI primitives live in the dashboard for now; extract `packages/ui` when guest/staff apps arrive (M3)      | Accepted         |
| 2026-11-05 | M2: Next standalone output; `API_URL` / `NEXT_PUBLIC_API_URL` are build-time values                                  | Accepted         |
| 2026-11-05 | M3: guest JWT (issuer `dinesense-guest`) per device per seating; stored per QR in localStorage                       | Accepted         |
| 2026-11-05 | M3: QR orders → PENDING_APPROVAL (APPROVE_ORDER task); waiter orders → kitchen and count as greet                    | Accepted         |
| 2026-11-05 | M3: order lines snapshot name, price incl. modifiers, tax rate; daily ticket numbers under an advisory lock          | Accepted         |
| 2026-11-05 | M3: item flow QUEUED→COOKING→READY (chef) →SERVED (floor), VOID by managers; READY creates a SERVE task              | Accepted         |
| 2026-11-05 | M3: running bill = per-line GST on accepted, non-void items; service charge/discounts/round-off come in M4           | Accepted         |
| 2026-11-05 | M3: refresh-token reuse within `REFRESH_REUSE_GRACE_SECONDS` (20 s) continues the session (lost response)            | Accepted         |
| 2026-11-05 | M3: Express `trust proxy` (`TRUST_PROXY`) so guest rate limits key on the real client IP behind Next                 | Accepted         |
| 2026-11-05 | M3: `packages/ui` extracted (TSX source, `transpilePackages`); Tailwind `@source` scans it                           | Accepted         |
| 2026-11-05 | M3: chef has a dashboard login (KDS); device-bound KDS screens with PIN come with the staff app in M4                | Accepted         |
| 2026-11-05 | M4: one OPEN bill per seating holds all unbilled items; later orders go to a new bill; void keeps the number         | Accepted         |
| 2026-11-05 | M4: discount (with reason) allocated pro rata before tax; service charge taxed at each line's rate                   | Accepted         |
| 2026-11-05 | M4: GST rounded per rate total (not per line) so printed rate × base = tax; lines get exact shares                   | Accepted         |
| 2026-11-05 | M4: payments ≤ amount due (no overpayment/change tracking); table → PAID when every live bill is paid                | Accepted         |
| 2026-11-05 | M4: invoice is a signed, non-expiring HTML link (HMAC of bill id); English only as the legal document                | Accepted         |
| 2026-11-05 | M4: web push via `web-push` (MPL-2.0, unmodified dependency); disabled when VAPID keys are absent                    | Accepted         |
| 2026-11-05 | M4: unassigned tasks push to checked-in, on-shift, not-on-break staff whose role handles the task type               | Accepted         |
| 2026-11-05 | M4: staff terminals are registered once by a manager; PIN screen lists names only; push follows the signed-in user   | Accepted         |
| 2026-11-05 | M4: e2e runs built standalone apps on normal ports against `dinesense_e2e` (name must contain "e2e")                 | Accepted         |
| 2026-11-05 | M5: one `evaluate` job type with deterministic ids per deadline instead of three job families; cancel = no-op        | Accepted         |
| 2026-11-05 | M5: waiters with no sections cover every section; outlet-wide fallback uses its own cursor (`*`)                     | Accepted         |
| 2026-11-05 | M5: tried waiters are skipped on re-assignment until everyone has been tried, then the rotation starts again         | Accepted         |
| 2026-11-05 | M5: acknowledging (On my way / accepting the GREET task) stops re-assignment; only a greet stops escalation          | Accepted         |
| 2026-11-05 | M5: assignment mode is per outlet (per-shift override stored but not yet used by the engine)                         | Accepted         |
| 2026-11-05 | M5: managers' phones buzz only for escalation, no waiter available and left-without-paying; the rest is on screen    | Accepted         |
| 2026-11-05 | M5: settings ladder validated server-side (escalation after the greet deadline; vacancy ≥ occupancy)                 | Accepted         |
| 2026-11-05 | M6: edge auth = `x-ds-device` + timestamp + HMAC over method/path/body hash; secret = HMAC(EDGE_SECRET_KEY, id)      | Accepted         |
| 2026-11-05 | M6: detector YOLOX (Apache-2.0, GitHub release ONNX, sha256-pinned); HuggingFace unreachable from build envs         | Flagged to owner |
| 2026-11-05 | M6: own IoU tracker instead of supervision ByteTrack (removed from supervision 0.26+; tracking needs are simple)     | Accepted         |
| 2026-11-05 | M6: snapshot privacy = pixelate person head regions + OpenCV Haar faces (bundled), not YuNet (no download needed)    | Accepted         |
| 2026-11-05 | M6: no real footage available → synthetic labelled footage + synthetic detector for dev/eval; real accuracy TBD      | Flagged to owner |
| 2026-11-05 | M6: camera workers are threads (ONNX releases the GIL), not processes; one detector instance shared                  | Accepted         |
| 2026-11-05 | M6: occupancy counts seated people only; eval scores accuracy outside the configured debounce windows                | Accepted         |
| 2026-11-05 | M7: Razorpay in TEST MODE only (owner); off unless keys + outlet toggle; live keys need owner approval               | Accepted (owner) |
| 2026-11-05 | M7: split = plan on the bill (`splitPlan`) + `Payment.shareKey`; one invoice, shares sum exactly; frozen once paid   | Accepted         |
| 2026-11-05 | M7: splitting (or a guest starting checkout) finalises an open bill; by-item picks are remapped to the new lines     | Accepted         |
| 2026-11-05 | M7: pending online payment reused for 15 min (double taps share one order); blocks re-splitting meanwhile            | Accepted         |
| 2026-11-05 | M7: excess online capture (bill settled meanwhile) is recorded + audited for refund, never dropped                   | Accepted         |
| 2026-11-05 | M7: reports computed per local day by a pure `summarizeDay`; "missed" = assignment passed on without acknowledgement | Accepted         |
| 2026-11-05 | P3 plan approved (owner); WhatsApp to be built against a console channel first (paid service)                        | Accepted (owner) |
| 2026-11-05 | M8: guests org-wide by E.164 phone; erase = null PII + keep row; retention per org (default 730 days)                | Accepted         |
| 2026-11-05 | M8: domain-event outbox deferred to M9 (first cross-process consumers); in-process `SeatingEvents` hook for stats    | Accepted         |
| 2026-11-05 | M8: holds/no-shows via a 30 s idempotent sweep (not per-booking BullMQ jobs); walk-in on held table → alert          | Accepted         |
| 2026-11-05 | M8: guest manage link = HMAC-signed booking id (no account); consent changes allowed from it                         | Accepted         |
| 2026-11-05 | M9: messaging outbox = `MessageLog` (queued in tx, dispatched with SKIP LOCKED); general DomainEvent bus → M11       | Accepted         |
| 2026-11-05 | M9: console channel unless WHATSAPP_ACCESS_TOKEN + PHONE_NUMBER_ID are set (paid Meta service, owner approval)       | Accepted (owner) |
| 2026-11-05 | M9: utility templates only; STOP reply withdraws WhatsApp consent for that number in every organisation              | Accepted         |
| 2026-11-05 | M9: waitlist "table ready" holds tables via HOLD_FOR_RESERVATION; expired holds released by the 30 s sweep           | Accepted         |
| 2026-11-05 | M9: door party = tracks first seen (twice) in the entrance zone within 2 s of each other; host suggestion only       | Accepted         |
| 2026-11-05 | M9: IoU tracker gains a centre-distance fallback (fast walkers at 3 fps) to avoid identity switches                  | Accepted         |
| 2026-11-06 | M10: service rules run in one 30 s idempotent sweep (like holds), not per-seating BullMQ jobs                        | Accepted         |
| 2026-11-06 | M10: idle = no staff touch since max(seated, greeted, last touch); only GREETED/ORDERED/SERVED tables are watched    | Accepted         |
| 2026-11-06 | M10: pacing holds mains (not other courses) while a starter is unserved; off by default; auto-fire after 20 min      | Accepted         |
| 2026-11-06 | M10: prep ETA = item median (≥5 samples, 28 d) → station median → 15 min, × (1 + 5 % per queued item, max ×2)        | Accepted         |
| 2026-11-06 | M10: 👎 at check-in pushes managers (GUEST_UNHAPPY joins the pushed alerts) + SERVICE_RECOVERY task                  | Accepted         |
| 2026-11-06 | M10: dirty check needs confirmed vacancy + tableware for 20 s; only VACANT → NEEDS_CLEANING (never touches seatings) | Accepted         |
| 2026-11-06 | M10: e2e prepare moves the seeded shifts to cover "now" so the suite passes at any hour                              | Accepted         |
