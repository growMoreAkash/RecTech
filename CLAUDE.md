# CLAUDE.md — DineSense

AI restaurant floor & guest-journey platform. Product brief: `docs/PRD.md`. Engineering plan: `docs/PLAN.md`.

## Current status

- **Plan:** approved 2026-11-05.
- **Done:** M0 (tooling), M1 (schema, seed, auth, tenancy, RBAC, audit), M2 (state machine, floor map & editor,
  staff & shifts, Socket.IO, dashboard), M3 (menu, guest QR app, shared cart, order approval, KDS).
  Demo scripts: `docs/MILESTONES.md`.
- **Next milestone:** M4 — staff PWA, web push, billing + GST invoice, alerts centre, audit viewer, e2e suite.

## How we work

1. Get approval before starting a new milestone or changing the stack.
2. One milestone at a time. After each: `pnpm lint && pnpm typecheck && pnpm test` (and `pytest` in Python
   services) must pass; then update this file and write a short demo script in the PR.
3. Ask before adding any paid service or new infrastructure. Every secret goes in `.env.example` with a comment.
4. Do not build Phase 3–4 features; leave extension points (see PLAN §11).
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
  src/table-state   TableStateService (only writer of table state), TableViews, SlaScheduler (no-op until M5)
  src/floor         floor snapshot, bulk floor-plan save, sections
  src/staff         staff, shifts, check-in sequence, breaks
  src/alerts        alerts list / ack / resolve
  src/realtime      Socket.IO /rt gateway (staff + guest tokens) + RealtimeService.emit
  src/menu          stations, categories, items, modifier groups, availability (guest menu filtering)
  src/ordering      OrderingService (pricing, QR/waiter orders, approval, KDS flow) + orders/KDS endpoints
  src/guest         public QR endpoints (/g/*), guest JWT, GuestGuard, rate limits
  test/             integration tests (*.int.ts) against real Postgres + Redis
apps/dashboard      Next.js 15 (App Router): /login, /floor, /floor/edit, /floor/qr, /staff, /menu, /kds/[station]
  src/lib           api client (silent refresh), session, live socket sync, queries, pure floor/editor/kds helpers
apps/guest          Next.js 15 mobile PWA on :3001 — /t/[qrToken]: menu, shared cart, orders, service buttons
packages/ui         shared TSX primitives (Button, Field, Sheet, VegMark, Money); apps transpile the source
packages/shared     enums (mirror Prisma), table-machine (pure reducer), zod schemas, realtime contracts, money/GST, time
packages/i18n       en/hi catalogs (key parity enforced by test)
packages/config     shared tsconfig + eslint flat config
infra/              docker-compose.yml, Dockerfiles
```

## Architecture (short)

- `apps/api` (NestJS + Prisma + BullMQ + Socket.IO) is the **only** component that changes table state.
- Apps talk REST to the API and receive live updates over Socket.IO. The edge vision service only sends events.
- Table state machine: pure reducer in `packages/shared/src/table-machine`; side effects in `TableStateService`.
- Greet SLA: BullMQ delayed jobs + a 30 s reconciler; job handlers always re-check the DB.
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
- Commits: conventional commits (`feat(api): …`, `fix(vision): …`).

## Commands

```bash
cp .env.example .env                       # once; root .env is read by the API and the Prisma CLI
docker compose -f infra/docker-compose.yml up -d postgres redis   # or local Postgres 16 + Redis 7
pnpm i
pnpm --filter @dinesense/api db:migrate    # prisma migrate dev (local dev DB only)
pnpm --filter @dinesense/api seed          # DESTRUCTIVE: wipes and re-seeds the dev DB (refuses NODE_ENV=production)
pnpm dev                                   # API :4000 (OpenAPI /api/docs), dashboard :3000, guest :3001
pnpm lint | pnpm typecheck | pnpm test | pnpm build | pnpm format
pnpm --filter @dinesense/api test:unit     # no DB needed
pnpm --filter @dinesense/api test:int      # needs TEST_DATABASE_URL (db name must contain "test")
```

Integration tests run `prisma migrate deploy` on the test DB and never delete data; each test creates its own
organization. Drop/recreate `dinesense_test` yourself if it grows.

Seed credentials (dev only): email users `owner|manager|host|cashier@demo.dinesense.in` / `dinesense123`;
`chef@demo.dinesense.in` (KDS) has the same password; staff terminal header
`x-device-token: sd_demo_floor_terminal_dev_only`; guest QR links: dashboard → Floor plan → Table QR codes; PINs printed by the seed
(waiters 1001–1006, bussers 2001–2002).

## Decisions log

| Date       | Decision                                                                                                        | Status           |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ---------------- |
| 2026-11-05 | Stack as in brief (pnpm/Turborepo, NestJS/Prisma/Postgres, Redis/BullMQ, Socket.IO, Next.js, Python vision)     | Accepted (brief) |
| 2026-11-05 | D1 Apache-2.0 detector (RT-DETR/D-FINE or YOLOX), not Ultralytics AGPL                                          | Accepted         |
| 2026-11-05 | D2 Aspect-ratio posture first, RTMPose behind flag                                                              | Accepted         |
| 2026-11-05 | D3 HTTPS + HMAC + SQLite outbox for edge events; MQTT deferred                                                  | Accepted         |
| 2026-11-05 | D4 VAPID Web Push first; FCM with Expo app later                                                                | Accepted         |
| 2026-11-05 | D5 Own auth: password for managers, device-bound PIN for floor staff                                            | Accepted         |
| 2026-11-05 | D6 `SeatingTable` join model for joined tables                                                                  | Accepted         |
| 2026-11-05 | D7 Paise + basis points for money/tax                                                                           | Accepted         |
| 2026-11-05 | D8 Node 22, NestJS 11, Prisma 6, Next 15, React 19, Tailwind 4, Vitest (zod 3.25)                               | Accepted         |
| 2026-11-05 | D9 next-intl, shared catalogs in `packages/i18n`                                                                | Accepted         |
| 2026-11-05 | D10 KDS as a route group inside `apps/dashboard`                                                                | Accepted         |
| 2026-11-05 | State machine reducer moved from M5 into M2; added M0 for tooling                                               | Accepted         |
| 2026-11-05 | M1: integration tests use a real Postgres/Redis from env (CI service containers) instead of testcontainers      | Accepted         |
| 2026-11-05 | M1: tests are non-destructive (`migrate deploy`, per-test tenants); no `migrate reset` in tooling               | Accepted         |
| 2026-11-05 | M1: `organizationId` added to `OrderItem` and `GuestSession` so KDS/guest queries are tenant-scoped             | Accepted         |
| 2026-11-05 | M1: audit via explicit `AuditService.record()` in the same transaction (not an interceptor) — real before/after | Accepted         |
| 2026-11-05 | M1: refresh tokens are opaque, hashed, rotated; reuse of a rotated token revokes the whole family               | Accepted         |
| 2026-11-05 | M1: PIN login locked per user after `PIN_MAX_ATTEMPTS` failures (Redis counter, `PIN_LOCKOUT_SECONDS`)          | Accepted         |
| 2026-11-05 | M1: modules are CommonJS (Nest-friendly); `packages/*` build to `dist/` and turbo builds deps first             | Accepted         |
| 2026-11-05 | M2: table rows locked `FOR UPDATE` per transition; client `expectedVersion` → 409 `VERSION_CONFLICT`            | Accepted         |
| 2026-11-05 | M2: camera vacancy never auto-closes an unpaid table; with an order it raises LEFT_WITHOUT_PAYING               | Accepted         |
| 2026-11-05 | M2: a waiter-taken order counts as greet; QR orders only if `qrOrderSatisfiesGreet`                             | Accepted         |
| 2026-11-05 | M2: events that fulfil a task mark it DONE (greet, clean, pay); departures CANCEL the rest                      | Accepted         |
| 2026-11-05 | M2: the greeting waiter becomes the serving waiter unless one is already assigned                               | Accepted         |
| 2026-11-05 | M2: only OWNER may grant OWNER/MANAGER; role changes and deactivation revoke sessions                           | Accepted         |
| 2026-11-05 | M2: shared UI primitives live in the dashboard for now; extract `packages/ui` when guest/staff apps arrive (M3) | Accepted         |
| 2026-11-05 | M2: Next standalone output; `API_URL` / `NEXT_PUBLIC_API_URL` are build-time values                             | Accepted         |
| 2026-11-05 | M3: guest JWT (issuer `dinesense-guest`) per device per seating; stored per QR in localStorage                  | Accepted         |
| 2026-11-05 | M3: QR orders → PENDING_APPROVAL (APPROVE_ORDER task); waiter orders → kitchen and count as greet               | Accepted         |
| 2026-11-05 | M3: order lines snapshot name, price incl. modifiers, tax rate; daily ticket numbers under an advisory lock     | Accepted         |
| 2026-11-05 | M3: item flow QUEUED→COOKING→READY (chef) →SERVED (floor), VOID by managers; READY creates a SERVE task         | Accepted         |
| 2026-11-05 | M3: running bill = per-line GST on accepted, non-void items; service charge/discounts/round-off come in M4      | Accepted         |
| 2026-11-05 | M3: refresh-token reuse within `REFRESH_REUSE_GRACE_SECONDS` (20 s) continues the session (lost response)       | Accepted         |
| 2026-11-05 | M3: Express `trust proxy` (`TRUST_PROXY`) so guest rate limits key on the real client IP behind Next            | Accepted         |
| 2026-11-05 | M3: `packages/ui` extracted (TSX source, `transpilePackages`); Tailwind `@source` scans it                      | Accepted         |
| 2026-11-05 | M3: chef has a dashboard login (KDS); device-bound KDS screens with PIN come with the staff app in M4           | Accepted         |
