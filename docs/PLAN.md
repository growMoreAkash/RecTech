# DineSense — Engineering Plan (Phase 1 + Phase 2)

Status: **DRAFT — awaiting approval.** No application code is written until this plan is approved.
Brief: [`PRD.md`](./PRD.md). Conventions and decisions log: [`../CLAUDE.md`](../CLAUDE.md).

Contents

1. [Decisions that need your call](#1-decisions-that-need-your-call)
2. [Repo structure](#2-repo-structure)
3. [Prisma schema](#3-prisma-schema)
4. [Table state machine](#4-table-state-machine)
5. [Greet SLA, round robin and escalation](#5-greet-sla-round-robin-and-escalation)
6. [Event contracts](#6-event-contracts)
7. [API surface](#7-api-surface)
8. [Vision service design](#8-vision-service-design)
9. [Cross-cutting: auth, tenancy, errors, i18n, privacy](#9-cross-cutting)
10. [Milestone plan](#10-milestone-plan)
11. [Phase 3–4 extension points](#11-phase-34-extension-points)
12. [Risks](#12-risks)

---

## 1. Decisions that need your call

Each has a recommendation; I will proceed with the recommendation unless you say otherwise.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | **Person detector** | **RT-DETR / D-FINE (Apache-2.0)** exported to ONNX as the default; YOLOX (Apache-2.0) as the lightweight alternative. **Not** Ultralytics YOLOv8/11 (AGPL-3.0). | AGPL would force you to open-source the edge service or buy an Ultralytics Enterprise licence. Detector sits behind an interface, so swapping later is one class. |
| D2 | **Pose model** (seated vs standing) | Start with **box aspect ratio + track height heuristic**; add **RTMPose / RTMO (Apache-2.0, MMPose)** ONNX behind a flag. | Aspect ratio is often enough for top-down cameras; pose costs GPU. Evaluate both with the accuracy script. |
| D3 | **Edge → cloud transport** | **HTTPS `POST /edge/events`** with HMAC-signed device token, SQLite outbox. Leave Mosquitto out of Compose until needed. | One less service to secure and run; idempotent eventIds make HTTPS retries safe. MQTT can be added behind the same outbox later. |
| D4 | **Staff push** | **Standard Web Push (VAPID, `web-push` lib)** first; FCM only when the Expo app arrives. | VAPID is free and needs no Google/Firebase account; Chrome/Android/Safari 16.4+ all support it. FCM is free too but adds an external account — your call. |
| D5 | **Auth** | Own auth: email + password (argon2id) for OWNER/MANAGER/CASHIER on dashboard; **4–6 digit PIN on a registered outlet device** for floor staff. JWT access (15 min) + rotating refresh (httpOnly cookie). | No paid IdP. PIN-on-trusted-device is how restaurant POSes work; PINs alone are never valid off a registered device. |
| D6 | **Joined tables** | `Seating` ↔ `Table` via a join model `SeatingTable` (not a `tableIds[]` array). | Arrays have no foreign keys; join model lets us query "open seating for table X" with an index. |
| D7 | **Money & tax** | Integers in **paise**; tax rates in **basis points** (500 = 5%). Round half-up per line, CGST = SGST = half of GST. | No floating-point money bugs; GST invoices need per-line tax. |
| D8 | **Versions** | Node 22 LTS, pnpm 10, TypeScript 5.x strict, NestJS 11, Prisma 6, Next.js 15 (App Router), React 19, Tailwind 4, BullMQ 5, Socket.IO 4, Python 3.11, Vitest for TS unit tests, Jest only where Nest tooling needs it (prefer Vitest everywhere). | Current stable, long support. |
| D9 | **i18n** | `next-intl` in all three Next apps; message catalogs live in `packages/i18n` (`en.json`, `hi.json`). Menu item names/descriptions stored as `{ en, hi, ... }` JSON. | One catalog, shared; regional languages are just more keys. |
| D10 | **KDS location** | A route group inside `apps/dashboard` (`/kds/[station]`) with its own minimal layout and a device-login flow. | Matches the brief; avoids a fifth Next app. |

**Paid / external services in P1–P2** (I will ask again before wiring each): Razorpay (per-transaction fees, M7,
test mode first), optional FCM (free, needs account). Nothing else. WhatsApp/SMS are P3.

---

## 2. Repo structure

```
dinesense/
├─ apps/
│  ├─ api/                     NestJS + Prisma + BullMQ + Socket.IO
│  │  ├─ prisma/               schema.prisma, migrations/, seed.ts
│  │  └─ src/
│  │     ├─ main.ts, app.module.ts
│  │     ├─ common/            zod pipe, error filter, tenancy guard, RBAC decorator, logger, request-id
│  │     ├─ auth/              login, PIN login, refresh, device registration
│  │     ├─ org/ outlet/       organizations, outlets, OutletSettings
│  │     ├─ floor/             sections, tables, floor-plan, QR tokens
│  │     ├─ staff/ shifts/     users, roles, shifts, check-in/out, breaks
│  │     ├─ table-state/       TableStateService (applies reducer + effects), TableEvent store
│  │     ├─ seating/           seatings, host seat flow
│  │     ├─ assignment/        waiter selection (RR / least-loaded / fixed), cursor + lock
│  │     ├─ sla/               BullMQ queues, processors, reconciler
│  │     ├─ tasks/             task inbox
│  │     ├─ menu/              categories, items, modifiers, availability, stock toggle
│  │     ├─ guest/             QR session, shared cart, guest actions (rate-limited)
│  │     ├─ orders/ kds/       orders, approval, order items, station routing, bump
│  │     ├─ billing/           bills, invoice numbering, GST calc, payments (cash/UPI/card; Razorpay M7)
│  │     ├─ edge/              device auth, /edge/events ingest, camera + zone config for devices
│  │     ├─ cameras/           cameras, zones, health
│  │     ├─ alerts/            alerts centre
│  │     ├─ notifications/     web push, socket fan-out (NotificationChannel interface)
│  │     ├─ realtime/          Socket.IO gateway, room auth
│  │     ├─ audit/             AuditLog interceptor + service
│  │     ├─ reports/           basic P1/P2 reports
│  │     ├─ privacy/           guest data export/delete
│  │     └─ health/
│  ├─ dashboard/               Next.js: floor map, editor, cameras, staff, menu, settings, alerts, reports, /kds
│  ├─ guest/                   Next.js PWA: /t/[qrToken]
│  └─ staff/                   Next.js PWA: PIN login, tasks, tables, orders, clean queue
├─ packages/
│  ├─ shared/                  zod schemas, enums, event contracts, state machine reducer, money/GST utils
│  ├─ api-client/              typed REST client (generated from OpenAPI) + socket client helpers
│  ├─ ui/                      shared shadcn/ui components, Tailwind preset, veg/non-veg marks, state colours
│  ├─ i18n/                    en.json, hi.json + helpers
│  ├─ config/                  eslint, tsconfig, prettier, vitest presets
├─ services/
│  ├─ vision/                  Python 3.11 edge service (see §8)
│  └─ ml/                      FastAPI stubs: /predict/wait-time, /predict/prep-time, /recommendations
├─ infra/
│  ├─ docker-compose.yml       postgres, redis, api, dashboard, guest, staff, vision (profile: edge)
│  ├─ docker-compose.dev.yml   hot-reload overrides
│  └─ docker/                  Dockerfiles
├─ e2e/                        Playwright: full manual service
├─ docs/                       PRD.md, PLAN.md, adr/
├─ CLAUDE.md
├─ turbo.json, pnpm-workspace.yaml, package.json, .env.example
```

---

## 3. Prisma schema

Conventions: `cuid()` ids; every tenant row has `organizationId` and (where applicable) `outletId`, with composite
indexes leading on `outletId`. Timestamps are `timestamptz` (stored UTC, rendered IST). Money in paise (`Int`),
rates in basis points (`Int`). Soft-delete via `archivedAt` on config entities only.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ───────────── Enums ─────────────
enum Role { OWNER MANAGER HOST WAITER BUSSER CHEF CASHIER }
enum TableStatus { VACANT RESERVED OCCUPIED GREETED ORDERED SERVED BILL_REQUESTED PAID NEEDS_CLEANING OUT_OF_SERVICE }
enum TableShape { RECT SQUARE ROUND BOOTH }
enum AssignmentMode { ROUND_ROBIN LEAST_LOADED FIXED_SECTION }
enum SeatingSource { WALK_IN RESERVATION WAITLIST }
enum SeatingStatus { OPEN CLOSED }
enum AssignmentReason { ROUND_ROBIN LEAST_LOADED FIXED_SECTION MANUAL ESCALATION }
enum EventSource { CAMERA STAFF SYSTEM GUEST }
enum TaskType { GREET CALL_WAITER WATER CUTLERY BILL SERVE CLEAN APPROVE_ORDER }
enum TaskStatus { OPEN ACCEPTED DONE CANCELLED EXPIRED }
enum VegType { VEG NON_VEG EGG }
enum OrderSource { QR WAITER }
enum OrderStatus { PENDING_APPROVAL ACCEPTED REJECTED CANCELLED }
enum OrderItemStatus { QUEUED COOKING READY SERVED VOID }
enum BillStatus { OPEN FINALIZED PAID VOID }
enum PaymentMethod { CASH UPI CARD RAZORPAY OTHER }
enum PaymentStatus { PENDING CAPTURED FAILED REFUNDED }
enum AlertType { SLA_BREACH REASSIGNED ESCALATION NO_ELIGIBLE_WAITER CALL_WAITER LONG_WAIT CAMERA_OFFLINE EDGE_OFFLINE LEFT_WITHOUT_PAYING SEATED_AT_DIRTY_TABLE RESERVED_TABLE_TAKEN }
enum AlertSeverity { INFO WARNING CRITICAL }
enum AlertStatus { OPEN ACKNOWLEDGED RESOLVED }
enum DeviceKind { STAFF_TERMINAL KDS }

// ───────────── Tenancy ─────────────
model Organization {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  outlets   Outlet[]
  users     User[]
}

model Outlet {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  timezone       String   @default("Asia/Kolkata")
  currency       String   @default("INR")
  gstin          String?
  legalName      String?
  address        String?
  invoicePrefix  String   @default("INV")
  createdAt      DateTime @default(now())
  archivedAt     DateTime?

  organization Organization    @relation(fields: [organizationId], references: [id])
  settings     OutletSettings?
  sections     Section[]
  tables       Table[]
  stations     KitchenStation[]

  @@index([organizationId])
}

model OutletSettings {
  outletId               String         @id
  organizationId         String
  greetSlaSeconds        Int            @default(300)
  reassignAfterSeconds   Int            @default(120)
  escalateAfterSeconds   Int            @default(600)
  assignmentMode         AssignmentMode @default(ROUND_ROBIN)
  occupancyConfirmSeconds Int           @default(30)
  vacancyConfirmSeconds  Int            @default(90)
  staffPresentSeconds    Int            @default(10)
  staffPresentMinConfidence Float       @default(0.7)
  cameraGreetEnabled     Boolean        @default(false) // camera staff-present may count as greet
  qrOrderSatisfiesGreet  Boolean        @default(false)
  qrOrderNeedsApproval   Boolean        @default(true)
  serviceChargeBps       Int            @default(0)
  pricesIncludeTax       Boolean        @default(false)
  defaultMaxTables       Int            @default(4)
  updatedAt              DateTime       @updatedAt

  outlet Outlet @relation(fields: [outletId], references: [id])
}

// ───────────── Floor ─────────────
model Section {
  id             String  @id @default(cuid())
  organizationId String
  outletId       String
  name           String
  color          String?
  sortOrder      Int     @default(0)
  archivedAt     DateTime?

  outlet Outlet  @relation(fields: [outletId], references: [id])
  tables Table[]

  @@index([outletId])
}

model Table {
  id             String      @id @default(cuid())
  organizationId String
  outletId       String
  sectionId      String
  label          String
  capacity       Int
  minCapacity    Int         @default(1)
  shape          TableShape  @default(RECT)
  x              Float
  y              Float
  w              Float
  h              Float
  rotation       Float       @default(0)
  joinableWith   String[]    // table ids that may be joined (advisory, validated in app)
  qrToken        String      @unique   // guest QR: /t/{qrToken}
  staffQrToken   String      @unique   // staff "At table" QR
  status         TableStatus @default(VACANT)
  statusChangedAt DateTime   @default(now())
  version        Int         @default(0) // optimistic concurrency for transitions
  archivedAt     DateTime?

  outlet   Outlet         @relation(fields: [outletId], references: [id])
  section  Section        @relation(fields: [sectionId], references: [id])
  seatings SeatingTable[]
  zones    TableZone[]
  events   TableEvent[]

  @@unique([outletId, label])
  @@index([outletId, status])
}

// ───────────── Staff ─────────────
model User {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  email          String?  @unique
  phone          String?
  passwordHash   String?
  pinHash        String?
  avatarUrl      String?
  active         Boolean  @default(true)
  createdAt      DateTime @default(now())

  organization Organization       @relation(fields: [organizationId], references: [id])
  roles        UserOutletRole[]
  shifts       Shift[]
  pushSubs     PushSubscription[]
}

model UserOutletRole {
  userId   String
  outletId String
  role     Role
  @@id([userId, outletId, role])
  @@index([outletId, role])
}

model Shift {
  id             String    @id @default(cuid())
  organizationId String
  outletId       String
  userId         String
  role           Role
  startsAt       DateTime
  endsAt         DateTime
  sectionIds     String[]
  maxTables      Int?
  assignmentMode AssignmentMode? // per-shift override of outlet mode
  checkedInAt    DateTime?
  checkInSeq     Int?            // monotonically increasing per outlet+day: stable RR order
  checkedOutAt   DateTime?
  onBreak        Boolean   @default(false)
  breakStartedAt DateTime?

  user User @relation(fields: [userId], references: [id])

  @@index([outletId, startsAt])
  @@index([outletId, checkedInAt])
}

model StaffDevice {
  id             String     @id @default(cuid())
  organizationId String
  outletId       String
  name           String
  kind           DeviceKind
  tokenHash      String
  station        String?    // for KDS devices
  lastSeenAt     DateTime?
  revokedAt      DateTime?
}

model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
}

model RoundRobinCursor {
  outletId       String
  sectionKey     String   // sectionId, or "*" for outlet-wide fallback
  lastCheckInSeq Int
  lastUserId     String?
  updatedAt      DateTime @updatedAt
  @@id([outletId, sectionKey])
}

// ───────────── Edge & cameras ─────────────
model EdgeDevice {
  id             String    @id @default(cuid())
  organizationId String
  outletId       String
  name           String
  tokenHash      String
  lastSeenAt     DateTime?
  version        String?
  revokedAt      DateTime?
  cameras        Camera[]
}

model Camera {
  id               String    @id @default(cuid())
  organizationId   String
  outletId         String
  edgeDeviceId     String
  name             String
  rtspUrlEncrypted String    // AES-256-GCM with CAMERA_SECRET_KEY; never returned to browsers
  fps              Int       @default(3)
  enabled          Boolean   @default(true)
  healthy          Boolean   @default(false)
  lastHealthAt     DateTime?
  lastHealth       Json?
  snapshotKey      String?   // blurred calibration snapshot (object storage / local volume)
  snapshotAt       DateTime?

  edgeDevice EdgeDevice  @relation(fields: [edgeDeviceId], references: [id])
  zones      TableZone[]
  @@index([outletId])
}

model TableZone {
  id             String   @id @default(cuid())
  organizationId String
  outletId       String
  cameraId       String
  tableId        String
  polygon        Json     // [[x,y],...] normalised 0..1 to snapshot size
  calibratedAt   DateTime @default(now())
  calibratedById String?

  camera Camera @relation(fields: [cameraId], references: [id])
  table  Table  @relation(fields: [tableId], references: [id])
  @@unique([cameraId, tableId])
}

model EdgeEventReceipt {        // idempotency for all edge events (incl. non-table ones)
  eventId    String   @id
  deviceId   String
  receivedAt DateTime @default(now())
}

// ───────────── Journey ─────────────
model Guest {                   // P1 minimal; CRM fields in P3
  id             String   @id @default(cuid())
  organizationId String
  phone          String?
  name           String?
  consentFlags   Json     @default("{}") // { marketing: false, whatsapp: false, feedback: false }
  createdAt      DateTime @default(now())
  deletedAt      DateTime?
  @@unique([organizationId, phone])
}

model Seating {
  id               String        @id @default(cuid())
  organizationId   String
  outletId         String
  status           SeatingStatus @default(OPEN)
  partySize        Int?
  source           SeatingSource @default(WALK_IN)
  seatedBy         EventSource   // CAMERA or STAFF
  guestId          String?
  notes            String?
  seatedAt         DateTime
  greetedAt        DateTime?
  greetedById      String?
  firstOrderAt     DateTime?
  servedAt         DateTime?
  billRequestedAt  DateTime?
  paidAt           DateTime?
  leftAt           DateTime?
  cleanedAt        DateTime?
  closedAt         DateTime?
  servingWaiterId  String?
  slaBreachedAt    DateTime?
  escalatedAt      DateTime?
  reservationId    String?       // P3 extension point

  tables      SeatingTable[]
  assignments Assignment[]
  orders      Order[]
  tasks       Task[]
  sessions    GuestSession[]
  bills       Bill[]

  @@index([outletId, status])
  @@index([outletId, seatedAt])
}

model SeatingTable {
  seatingId String
  tableId   String
  isOpen    Boolean @default(true) // mirrors seating.status for a partial unique index
  seating   Seating @relation(fields: [seatingId], references: [id])
  table     Table   @relation(fields: [tableId], references: [id])
  @@id([seatingId, tableId])
  @@index([tableId, isOpen])
  // raw SQL migration: CREATE UNIQUE INDEX one_open_seating_per_table ON "SeatingTable"("tableId") WHERE "isOpen";
}

model Assignment {
  id             String           @id @default(cuid())
  organizationId String
  outletId       String
  seatingId      String
  waiterId       String
  reason         AssignmentReason
  attempt        Int              @default(1)
  assignedAt     DateTime         @default(now())
  acknowledgedAt DateTime?
  expiredAt      DateTime?
  seating        Seating          @relation(fields: [seatingId], references: [id])
  @@index([seatingId])
  @@index([waiterId, assignedAt])
}

model TableEvent {              // append-only
  id             String      @id @default(cuid())
  organizationId String
  outletId       String
  tableId        String
  seatingId      String?
  type           String      // see packages/shared TableEventType
  source         EventSource
  actorId        String?     // user or edge device
  confidence     Float?
  fromStatus     TableStatus?
  toStatus       TableStatus?
  payload        Json        @default("{}")
  eventId        String?     @unique // edge idempotency key
  occurredAt     DateTime
  recordedAt     DateTime    @default(now())
  table          Table       @relation(fields: [tableId], references: [id])
  @@index([tableId, occurredAt])
  @@index([outletId, occurredAt])
}

model Task {
  id             String     @id @default(cuid())
  organizationId String
  outletId       String
  type           TaskType
  tableId        String?
  seatingId      String?
  orderId        String?
  assigneeId     String?
  status         TaskStatus @default(OPEN)
  payload        Json       @default("{}")
  createdAt      DateTime   @default(now())
  acceptedAt     DateTime?
  doneAt         DateTime?
  doneById       String?
  seating        Seating?   @relation(fields: [seatingId], references: [id])
  @@index([outletId, status])
  @@index([assigneeId, status])
}

model Alert {
  id             String        @id @default(cuid())
  organizationId String
  outletId       String
  type           AlertType
  severity       AlertSeverity
  status         AlertStatus   @default(OPEN)
  tableId        String?
  seatingId      String?
  cameraId       String?
  message        String
  payload        Json          @default("{}")
  dedupeKey      String?       // e.g. "camera-offline:{cameraId}"
  createdAt      DateTime      @default(now())
  acknowledgedAt DateTime?
  acknowledgedById String?
  resolvedAt     DateTime?
  @@index([outletId, status, createdAt])
  @@unique([outletId, dedupeKey])
}

// ───────────── Menu ─────────────
model KitchenStation {
  id             String @id @default(cuid())
  organizationId String
  outletId       String
  code           String // "tandoor", "chinese", "bar", "desserts"
  name           Json   // { en, hi }
  outlet         Outlet @relation(fields: [outletId], references: [id])
  @@unique([outletId, code])
}

model MenuCategory {
  id             String     @id @default(cuid())
  organizationId String
  outletId       String
  name           Json       // { en, hi, ... }
  sortOrder      Int        @default(0)
  availabilityWindows Json? // [{ days:[1..7], from:"11:00", to:"15:30" }]
  archivedAt     DateTime?
  items          MenuItem[]
  @@index([outletId])
}

model MenuItem {
  id             String    @id @default(cuid())
  organizationId String
  outletId       String
  categoryId     String
  name           Json
  description    Json?
  vegType        VegType
  allergens      String[]
  spiceLevel     Int       @default(0) // 0..3
  stationId      String
  pricePaise     Int
  taxRateBps     Int       @default(500)
  hsnSac         String?   @default("996331") // restaurant service SAC
  imageUrl       String?
  isAvailable    Boolean   @default(true)       // out-of-stock toggle
  availabilityWindows Json?
  sortOrder      Int       @default(0)
  archivedAt     DateTime?
  category       MenuCategory   @relation(fields: [categoryId], references: [id])
  modifierGroups MenuItemModifierGroup[]
  @@index([outletId, categoryId])
}

model ModifierGroup {
  id             String     @id @default(cuid())
  organizationId String
  outletId       String
  name           Json
  minSelect      Int        @default(0)
  maxSelect      Int        @default(1)
  modifiers      Modifier[]
  items          MenuItemModifierGroup[]
}

model MenuItemModifierGroup {
  menuItemId      String
  modifierGroupId String
  sortOrder       Int @default(0)
  menuItem        MenuItem      @relation(fields: [menuItemId], references: [id])
  modifierGroup   ModifierGroup @relation(fields: [modifierGroupId], references: [id])
  @@id([menuItemId, modifierGroupId])
}

model Modifier {
  id              String  @id @default(cuid())
  modifierGroupId String
  name            Json
  priceDeltaPaise Int     @default(0)
  isAvailable     Boolean @default(true)
  group           ModifierGroup @relation(fields: [modifierGroupId], references: [id])
}

// ───────────── Ordering ─────────────
model GuestSession {
  id         String    @id @default(cuid())
  outletId   String
  seatingId  String
  deviceId   String    // random id stored in guest browser
  createdAt  DateTime  @default(now())
  expiresAt  DateTime?
  seating    Seating   @relation(fields: [seatingId], references: [id])
  @@unique([seatingId, deviceId])
}

model CartLine {               // shared cart per seating (persisted so reloads survive)
  id             String   @id @default(cuid())
  seatingId      String
  guestSessionId String
  menuItemId     String
  quantity       Int
  modifierIds    String[]
  note           String?
  updatedAt      DateTime @updatedAt
  @@index([seatingId])
}

model Order {
  id             String      @id @default(cuid())
  organizationId String
  outletId       String
  seatingId      String
  number         Int         // per-outlet daily ticket number
  source         OrderSource
  status         OrderStatus
  placedById     String?     // waiter user id
  guestSessionId String?
  approvedById   String?
  approvedAt     DateTime?
  rejectedReason String?
  createdAt      DateTime    @default(now())
  seating        Seating     @relation(fields: [seatingId], references: [id])
  items          OrderItem[]
  @@index([outletId, createdAt])
}

model OrderItem {
  id             String          @id @default(cuid())
  orderId        String
  outletId       String
  menuItemId     String
  nameSnapshot   Json
  stationId      String
  quantity       Int
  unitPricePaise Int             // incl. modifiers, snapshot
  taxRateBps     Int
  modifiers      Json            // snapshot [{ id, name, priceDeltaPaise }]
  note           String?
  status         OrderItemStatus @default(QUEUED)
  queuedAt       DateTime        @default(now())
  startedAt      DateTime?
  readyAt        DateTime?
  servedAt       DateTime?
  voidedAt       DateTime?
  voidReason     String?
  order          Order           @relation(fields: [orderId], references: [id])
  @@index([outletId, stationId, status])
}

// ───────────── Billing ─────────────
model Bill {
  id               String     @id @default(cuid())
  organizationId   String
  outletId         String
  seatingId        String
  invoiceNumber    String?    // assigned on finalize: {prefix}/{FY}/{seq}
  status           BillStatus @default(OPEN)
  subtotalPaise    Int        @default(0)
  discountPaise    Int        @default(0)
  discountReason   String?
  serviceChargePaise Int      @default(0)
  cgstPaise        Int        @default(0)
  sgstPaise        Int        @default(0)
  roundOffPaise    Int        @default(0)
  totalPaise       Int        @default(0)
  finalizedAt      DateTime?
  finalizedById    String?
  seating          Seating    @relation(fields: [seatingId], references: [id])
  lines            BillLine[]
  payments         Payment[]
  @@unique([outletId, invoiceNumber])
}

model BillLine {
  id            String @id @default(cuid())
  billId        String
  orderItemId   String?
  description   String
  hsnSac        String?
  quantity      Int
  unitPricePaise Int
  taxableValuePaise Int
  taxRateBps    Int
  cgstPaise     Int
  sgstPaise     Int
  bill          Bill   @relation(fields: [billId], references: [id])
}

model InvoiceSequence {        // gap-free per outlet per financial year
  outletId      String
  financialYear String       // "2026-27"
  next          Int
  @@id([outletId, financialYear])
}

model Payment {
  id             String        @id @default(cuid())
  organizationId String
  outletId       String
  billId         String
  method         PaymentMethod
  status         PaymentStatus
  amountPaise    Int
  reference      String?       // UPI ref / card last4 / razorpay payment id
  receivedById   String?
  createdAt      DateTime      @default(now())
  capturedAt     DateTime?
  bill           Bill          @relation(fields: [billId], references: [id])
}

// ───────────── Audit ─────────────
model AuditLog {
  id             String   @id @default(cuid())
  organizationId String
  outletId       String?
  actorType      String   // USER | DEVICE | SYSTEM | GUEST
  actorId        String?
  action         String   // "table.transition", "menu.item.update", ...
  entityType     String
  entityId       String
  before         Json?
  after          Json?
  requestId      String?
  ip             String?
  createdAt      DateTime @default(now())
  @@index([organizationId, createdAt])
  @@index([entityType, entityId])
}
```

Notes

- `Table.status` is a **denormalised projection**; the authoritative history is `TableEvent`. For joined tables,
  all tables in an open `Seating` always share one status (updated in the same transaction).
- Partial unique index guarantees at most one open seating per table (raw SQL in the migration).
- Relations to `Organization`/`Outlet` are added on every tenant model in the real file; omitted above where
  they'd only add noise.

---

## 4. Table state machine

Single source of truth: `packages/shared/src/table-machine/`. A **pure reducer**, no I/O:

```ts
transition(state: TableStatus, event: TableMachineEvent, ctx: MachineContext)
  => { ok: true; next: TableStatus; effects: Effect[] } | { ok: false; reason: RejectReason }

ctx = { settings, seating?: { hasAcceptedOrder, allFirstOrderServed, isPaid }, actorRole?, now }
Effect = CREATE_SEATING | CLOSE_SEATING | SET_SEATING_TS(field) | START_GREET_SLA | CANCEL_GREET_SLA
       | CREATE_TASK(type) | CANCEL_TASKS(types) | RAISE_ALERT(type) | RESOLVE_ALERTS(types)
```

`TableStateService` (API) loads table + open seating, calls the reducer, then in **one DB transaction** updates the
table(s) with an optimistic `version` check, writes `TableEvent` + `AuditLog`, executes DB effects; after commit it
executes queue effects (BullMQ) and broadcasts over Socket.IO (transactional-outbox style: queue/socket effects are
written to an `effects` list returned from the transaction and dispatched after commit).

Seated states: `OCCUPIED, GREETED, ORDERED, SERVED, BILL_REQUESTED, PAID`.

| # | From | Event (source) | Guard | To | Effects |
|---|---|---|---|---|---|
| 1 | VACANT | `HOST_SEAT` (staff) / `CAMERA_OCCUPIED` (camera) | — | OCCUPIED | CREATE_SEATING, START_GREET_SLA |
| 2 | RESERVED | `HOST_SEAT` | — | OCCUPIED | CREATE_SEATING (source RESERVATION), START_GREET_SLA |
| 3 | RESERVED | `CAMERA_OCCUPIED` | — | OCCUPIED | CREATE_SEATING, START_GREET_SLA, RAISE_ALERT(RESERVED_TABLE_TAKEN) |
| 4 | NEEDS_CLEANING | `HOST_SEAT` / `CAMERA_OCCUPIED` | — | OCCUPIED | CREATE_SEATING, START_GREET_SLA, RAISE_ALERT(SEATED_AT_DIRTY_TABLE), CANCEL_TASKS(CLEAN) |
| 5 | OCCUPIED | `GREET` (waiter "At table" / staff QR) | — | GREETED, or ORDERED if `hasAcceptedOrder` | SET greetedAt, CANCEL_GREET_SLA, CANCEL_TASKS(GREET), RESOLVE_ALERTS(SLA_*) |
| 6 | OCCUPIED | `CAMERA_STAFF_PRESENT` | `cameraGreetEnabled` ∧ seconds ≥ `staffPresentSeconds` ∧ conf ≥ min | same as 5 | same as 5 (greetedBy = null, source CAMERA) |
| 7 | OCCUPIED, GREETED | `ORDER_ACCEPTED` | from OCCUPIED: order source WAITER, or `qrOrderSatisfiesGreet` | ORDERED | SET firstOrderAt (+ greet effects if from OCCUPIED) |
| 7b | OCCUPIED | `ORDER_ACCEPTED` (QR, greet not satisfied) | — | OCCUPIED (no change) | SET firstOrderAt; SLA keeps running |
| 8 | ORDERED | `FIRST_ORDER_SERVED` | `allFirstOrderServed` | SERVED | SET servedAt |
| 9 | any seated except PAID | `REQUEST_BILL` (guest / waiter) | — | BILL_REQUESTED | SET billRequestedAt, CREATE_TASK(BILL) |
| 10 | BILL_REQUESTED, SERVED, ORDERED | `PAYMENT_CAPTURED` | `isPaid` (sum captured ≥ total) | PAID | SET paidAt, CANCEL_TASKS(BILL) |
| 11 | PAID | `CAMERA_VACATED` / `STAFF_MARK_LEFT` | — | NEEDS_CLEANING | SET leftAt, CLOSE_SEATING, CREATE_TASK(CLEAN) |
| 12 | seated, unpaid | `CAMERA_VACATED` | — | **no change** | RAISE_ALERT(LEFT_WITHOUT_PAYING) |
| 13 | seated, unpaid | `STAFF_MARK_LEFT` | role ∈ {MANAGER, OWNER, CASHIER} | NEEDS_CLEANING | SET leftAt, CLOSE_SEATING (bill stays OPEN, flagged), CREATE_TASK(CLEAN) |
| 14 | NEEDS_CLEANING | `CLEAN_CONFIRMED` (busser) | — | VACANT | SET cleanedAt, CANCEL_TASKS(CLEAN) |
| 15 | VACANT | `HOLD_FOR_RESERVATION` | — | RESERVED | — (P3 uses it; available manually now) |
| 16 | RESERVED | `RELEASE_HOLD` | — | VACANT | — |
| 17 | VACANT, NEEDS_CLEANING | `SET_OUT_OF_SERVICE` | manager | OUT_OF_SERVICE | — |
| 18 | OUT_OF_SERVICE | `RETURN_TO_SERVICE` | manager | VACANT | — |
| 19 | any | `FORCE_STATE(to)` | manager/owner | `to` | Reconcile: opening a seated state with no seating creates one; going to VACANT/NEEDS_CLEANING closes it; cancels SLA if leaving OCCUPIED |

Idempotency and noise rules (also unit-tested):

- `CAMERA_OCCUPIED` on an already-seated table → no-op (may update guest count). `CAMERA_*` on `OUT_OF_SERVICE` → ignored.
- `CAMERA_VACATED` on `VACANT` / `NEEDS_CLEANING` → no-op.
- Duplicate `eventId` → dropped before the reducer.
- `GUEST_COUNT_CHANGED` never changes state; updates `seating.partySize` if no staff-entered value.
- Camera never moves a table *backwards* except row 11 (and row 12 alerts only). Staff input always wins.
- Rejected transitions return a typed reason (`INVALID_FROM_STATE`, `GUARD_FAILED`, `FORBIDDEN`) → HTTP 409/403.

```
             HOST_SEAT / CAMERA_OCCUPIED
 VACANT ───────────────────────────────▶ OCCUPIED ──GREET──▶ GREETED ──ORDER_ACCEPTED──▶ ORDERED ──served──▶ SERVED
   ▲  ▲ HOLD/RELEASE ⇅ RESERVED            │  (SLA: assign → reassign → escalate until GREET)               │
   │  └─────────────── CLEAN_CONFIRMED ──┐ │                                                                 │
   │                                     │ ▼            REQUEST_BILL (from any seated state)                 ▼
   │                               NEEDS_CLEANING ◀── VACATED/MARK_LEFT ── PAID ◀── PAYMENT ── BILL_REQUESTED ◀┘
   └── RETURN_TO_SERVICE ── OUT_OF_SERVICE
```

---

## 5. Greet SLA, round robin and escalation

### Jobs (BullMQ queue `sla`)

BullMQ v5 rejects custom job ids containing `:`, so ids use `_`.

| Job id | Scheduled when | Delay | On fire (re-checks DB first; no-op if `greetedAt` set or seating closed) |
|---|---|---|---|
| `greet-sla_{seatingId}` | seating created | `greetSlaSeconds` | mark `slaBreachedAt`, select waiter, create `Assignment(attempt 1)` + GREET task, push + socket alert, schedule `reassign_{seatingId}_1` |
| `reassign_{seatingId}_{n}` | assignment n created | `reassignAfterSeconds` | if assignment n not acknowledged: set `expiredAt`, select next waiter (excluding those already tried for this seating, unless nobody else), create attempt n+1, schedule `reassign_…_{n+1}` |
| `escalate_{seatingId}` | seating created | `escalateAfterSeconds` | if not greeted: alert all MANAGER/OWNER on shift (`ESCALATION`, CRITICAL), set `escalatedAt`. Reassign loop continues. |

- An **acknowledged** assignment stops re-assignment but not escalation; only a greet stops escalation.
- On greet: `greetedAt` set and `queue.remove()` for all three job families (best effort — handlers re-check anyway).
- **Reconciler**: a repeatable job every 30 s scans open un-greeted seatings and (re)creates any missing job whose
  deadline has passed or is pending. Survives Redis flushes and API restarts.
- Times are computed from `seatedAt`, never from "now at scheduling", so restarts don't stretch SLAs.

### Waiter selection (`assignment/` module, pure core + DB adapter)

```ts
selectWaiter(candidates: Candidate[], cursor: Cursor | null, mode, exclude: Set<userId>) => { waiter?, nextCursor }
Candidate = { userId, checkInSeq, sectionIds, activeTables, maxTables, onBreak, checkedIn, checkedOut }
```

- **Eligible** = role WAITER, shift active now, checked in, not checked out, not on break, table's section ∈
  `sectionIds`, `activeTables < maxTables` (shift value, else outlet default).
- `activeTables` = open seatings where `servingWaiterId = user` + un-expired, un-acknowledged assignments.
- **ROUND_ROBIN**: sort eligible by `checkInSeq` (stable). Pick the first with `checkInSeq > cursor.lastCheckInSeq`,
  wrapping to the start. Advance the cursor to the pick.
- **LEAST_LOADED**: min `activeTables`; ties broken by the RR rule above (and cursor advanced).
- **FIXED_SECTION**: the waiter whose shift lists exactly that section first (primary), else RR within section.
- **Fallback**: no eligible in section → same algorithm outlet-wide with cursor key `*` → none → `NO_ELIGIBLE_WAITER`
  alert to managers (the reassign job still re-tries next tick).
- **Locking**: selection + assignment insert run in one transaction under
  `pg_advisory_xact_lock(hashtext('rr:' || outletId))`, so two simultaneous breaches never pick from a stale cursor.
- "Accept" sets `acknowledgedAt` (and `servingWaiterId`); "At table" = `GREET` (also sets `servingWaiterId`).

### Tests (Vitest)

- Reducer: every row of §4 table + every rejected pair (table-driven, ~120 cases).
- Selection: fairness over 100 seatings with 6 waiters (each gets 16–17), skip on break / at max / checked out,
  section fallback, exclude-tried, LEAST_LOADED tie-break, deterministic with same input.
- SLA integration (testcontainers Postgres + Redis, fake clock): greet before 5 min → no assignment; breach →
  assign → no ack → reassign → 10 min escalate; greet mid-loop cancels everything; duplicate scheduling is idempotent;
  reconciler recreates a deleted job; two concurrent breaches pick different waiters.

---

## 6. Event contracts

All schemas are zod in `packages/shared/src/contracts/`, exported as TS types and as JSON Schema (for the Python
service, generated into `services/vision/dinesense_vision/contracts/`).

### 6.1 Edge → API  `POST /edge/events`

Headers: `Authorization: Bearer <deviceId>.<secret>`, `X-DS-Timestamp`, `X-DS-Signature: hex(hmacSHA256(secret, ts + "." + body))`. Reject if |now − ts| > 5 min.

```jsonc
{ "deviceId": "edg_…", "sentAt": "2026-11-05T13:02:11.120Z",
  "events": [ /* 1..200, ordered */ {
    "eventId": "uuidv7",                 // idempotency key, time-ordered
    "type": "table.occupied",
    "occurredAt": "2026-11-05T13:01:40.000Z",
    "cameraId": "cam_…", "tableId": "tbl_…",
    "confidence": 0.93,
    "payload": { "guestCount": 3, "dwellSeconds": 30 }
  } ] }
```

| type | payload |
|---|---|
| `table.occupied` | `{ guestCount, dwellSeconds }` |
| `table.vacated` | `{ emptySeconds }` |
| `table.guest_count_changed` | `{ guestCount, previous }` |
| `table.staff_present` | `{ seconds, trackId }` |
| `camera.health` | `{ status: "ok"|"degraded"|"down", fps, latencyMs, lastFrameAt, reconnects, error? }` (cameraId, no tableId) |
| `device.heartbeat` | `{ version, uptimeS, queueDepth, gpu? }` |
| `entrance.crossing` *(P2 optional)* | `{ direction: "in"|"out", count }` |

Response: `{ accepted: string[], duplicates: string[], rejected: [{ eventId, reason }] }`. Device deletes
accepted + duplicates from its outbox.

`GET /edge/config` → `{ outletId, settings: { occupancyConfirmSeconds, vacancyConfirmSeconds, staffPresentSeconds }, cameras: [{ id, name, rtspUrl, fps, enabled, zones: [{ tableId, polygon }] }], configVersion }` (RTSP URL decrypted only on this device-authenticated route). Device polls every 60 s or on `configVersion` change.
`POST /edge/cameras/{id}/snapshot` (multipart JPEG, faces already blurred) for calibration.

### 6.2 Socket.IO (server → client)

Namespace `/rt`, auth via JWT / guest session token. Rooms: `outlet:{id}`, `table:{id}`, `role:{role}:{outletId}`,
`staff:{userId}`, `kds:{outletId}:{station}`, `seating:{id}` (guest cart).

| event | room(s) | payload |
|---|---|---|
| `table.updated` | outlet, table | `{ tableId, status, version, seatingId?, partySize?, seatedAt?, greetDeadline?, servingWaiter? }` |
| `seating.updated` | outlet, seating | seating summary |
| `alert.created` / `alert.updated` | role:MANAGER, role:HOST | Alert |
| `task.created` / `task.updated` | staff:{assignee}, role:{role} | Task |
| `assignment.created` | staff:{waiter}, outlet | `{ assignmentId, tableLabel, seatingId, attempt, ackDeadline }` |
| `order.created` / `order.updated` | outlet, seating, staff:{servingWaiter} | Order |
| `kds.ticket` / `kds.item.updated` | kds:{outlet}:{station} | ticket view |
| `cart.updated` | seating | `{ lines, version }` |
| `menu.availability` | outlet (guest clients join `outlet:{id}:menu`) | `{ menuItemId, isAvailable }` |
| `camera.health` | role:MANAGER | `{ cameraId, healthy, lastHealthAt }` |

Every payload carries `{ v: 1, emittedAt }`. Clients refetch on reconnect (sockets are a hint, REST is truth).

### 6.3 Internal domain events

`TableTransitioned`, `SeatingOpened`, `SeatingClosed`, `GreetRecorded`, `OrderAccepted`, `ItemReady`, `BillPaid` —
emitted on an in-process event bus (`@nestjs/event-emitter`) after commit. Extension point for P3 (feedback, CRM,
analytics) without touching core modules.

---

## 7. API surface

REST under `/api/v1`, zod-validated, OpenAPI at `/api/docs` (via `nestjs-zod`). Highlights:

- **Auth**: `POST /auth/login`, `/auth/pin-login` (requires registered device token), `/auth/refresh`, `/auth/logout`, `/devices/register`.
- **Floor**: CRUD `/outlets/:o/sections`, `/outlets/:o/tables`, `PUT /outlets/:o/floor-plan` (bulk save from editor), `GET /outlets/:o/floor` (snapshot for map), `GET /tables/:id/qr.png`.
- **Table state**: `POST /tables/:id/transitions` `{ event, payload, expectedVersion? }` — the *only* way to change state from apps. `POST /tables/:id/seat` (host flow: party size, notes, join tables). `GET /tables/:id/timeline`.
- **Staff**: users, roles, shifts, `POST /shifts/:id/check-in|check-out|break`, `GET /me/tables`, `GET /me/tasks`.
- **Assignments/Tasks**: `POST /assignments/:id/ack`, `POST /tasks/:id/accept|done`, `POST /staff-qr/:token/at-table`.
- **Menu**: categories, items, modifier groups, `PATCH /menu-items/:id/availability`.
- **Guest** (rate-limited, guest token): `GET /g/t/:qrToken`, `POST /g/sessions`, cart ops, `POST /g/orders`, `POST /g/actions` (call waiter/water/cutlery/bill), `GET /g/bill`.
- **Orders/KDS**: `POST /orders` (waiter), `POST /orders/:id/approve|reject`, `PATCH /order-items/:id` (status), `GET /kds/:station`.
- **Billing**: `POST /seatings/:id/bill`, discounts, `POST /bills/:id/finalize`, `POST /bills/:id/payments`, `GET /bills/:id/invoice` (HTML/PDF).
- **Edge**: §6.1. **Cameras**: CRUD, zones `PUT /cameras/:id/zones`.
- **Alerts, Audit, Reports, Settings, Privacy** (`GET /guests/:id/export`, `DELETE /guests/:id`).
- **Health**: `/health/live`, `/health/ready` (db, redis).

Error format everywhere: `{ error: { code: "TABLE_INVALID_TRANSITION", message, details?, requestId } }`.

---

## 8. Vision service design

`services/vision/` — Python 3.11, `uv` for deps, `ruff` + `mypy --strict` + `pytest`.

```
dinesense_vision/
  config.py            pydantic-settings; API URL, device creds, DEV_MODE
  api_client.py        signed requests, /edge/config polling
  sources/             RtspSource (auto-reconnect, backoff), FileSource (loops MP4 in DEV_MODE)
  detect/base.py       Detector protocol: detect(frame) -> list[Detection]
  detect/onnx_rtdetr.py, detect/onnx_yolox.py, detect/fake.py (scripted, for tests)
  pose/                Posture protocol: AspectRatioPosture (default), OnnxRtmPosePosture (flag)
  track.py             supervision.ByteTrack wrapper
  zones.py             point-in-polygon on bottom-centre point (or hip midpoint when pose on)
  occupancy.py         per-zone debounced state machine (pure, unit-tested): EMPTY→PENDING→OCCUPIED→PENDING_EMPTY→EMPTY
  staff.py             standing-track dwell at zone → staff_present candidates
  outbox.py            SQLite outbox; ordered replay; batch POST; exponential backoff
  worker.py            one process per camera (multiprocessing), target FPS sampling
  health.py            camera.health every 30 s, device.heartbeat
  privacy.py           face blur (YuNet face detector, Apache-2.0 via OpenCV zoo) for snapshots only
  cli.py               `ds-vision run | record | snapshot | eval`
samples/               dev MP4s (gitignored except one tiny CC0 clip) + labels/*.csv
```

- Frames never leave the process; nothing is written to disk except blurred calibration snapshots on request and
  footage you explicitly `record` (local, for labelling).
- `ds-vision eval --video x.mp4 --labels x.csv` replays footage through the exact pipeline and prints per-table
  accuracy, precision/recall of occupied, event latency vs labels; target ≥ 95%.
- Label CSV: `table_id,start_s,end_s,state` (state ∈ occupied/vacant).
- Runs in Docker (`--gpus all` optional, CPU ONNX fallback); Compose profile `edge`.

---

## 9. Cross-cutting

- **Tenancy**: JWT carries `orgId` and allowed `outletIds`. A Nest guard resolves `:outletId` from the route and
  rejects mismatches; a Prisma client extension auto-injects `organizationId` filters on tenant models and throws on
  unscoped writes. Integration tests assert cross-tenant reads return 404.
- **RBAC**: `@Roles('MANAGER','HOST')` decorator + guard on every controller method; default deny (a lint test
  fails the build if a route lacks `@Roles` or `@Public`).
- **Guest abuse**: per-IP + per-session rate limits (Redis), orders only with open seating, approval on by default,
  max cart lines / qty caps.
- **Logging**: `pino` JSON with `requestId`, `outletId`, `actor`; no PII in logs.
- **Secrets**: `.env.example` documents each; RTSP URLs encrypted at rest (AES-256-GCM).
- **i18n**: `next-intl`; IST formatting via `Intl` with `Asia/Kolkata`; INR via `Intl.NumberFormat('en-IN')`.
- **Privacy (DPDP)**: no face recognition, no video storage, consent flags, export/delete endpoints, retention job
  (configurable) that nulls guest phone/name after N days.
- **Accessibility**: shadcn/Radix primitives, colour + icon + text for table states (never colour alone), 44 px touch
  targets in guest/staff apps.

---

## 10. Milestone plan

Refinement vs brief: the **pure state machine moves into M2** (manual states need it from day one); M5 then adds
SLA/round robin on top. A tiny **M0** covers tooling so M1 is about the domain.

Each milestone ends with: `pnpm lint && pnpm typecheck && pnpm test` green (+ `pytest` for Python), a CLAUDE.md
update, and a demo script.

| M | Scope | Done when |
|---|---|---|
| **M0** | pnpm + Turborepo skeleton, `packages/config` (eslint/tsconfig/prettier/vitest), CI workflow (GitHub Actions: lint, typecheck, test), Docker Compose with postgres + redis, `.env.example`. | `pnpm i && pnpm build` works; CI green. |
| **M1** | Full Prisma schema + migrations (incl. partial index), seed (20 tables / 3 sections / 6 waiters / 2 bussers / 1 manager / 1 host / 1 chef / 1 cashier / 40 menu items / 4 stations), NestJS API skeleton (zod pipe, error filter, pino, health, OpenAPI), auth (password + device-bound PIN, refresh), tenancy guard, RBAC, audit interceptor. | Login works for each role; cross-tenant & RBAC integration tests pass. |
| **M2** | `packages/shared` table machine + tests; TableStateService; sections/tables CRUD; floor-plan editor (react-konva: drag, resize, rotate, capacity, section, join rules); staff & shifts UI + check-in/break; live floor map with manual transitions; Socket.IO gateway + rooms; host seat flow (walk-in, party size, notes, join tables); table drawer timeline. | Two browsers: seating a table in one updates the other < 1 s; reducer suite passes. |
| **M3** | Menu manager (categories, items, modifiers, Hindi names, availability windows, out-of-stock); guest PWA `/t/[qrToken]` (read-only when no seating, join session, shared cart via socket, place order, call waiter/water/cutlery, request bill); order approval; KDS per station (ageing colours, start/ready/bump); ready → push/socket to waiter. | Two phones share one cart; approved order appears on the right station KDS. |
| **M4** | Staff PWA (PIN login, check-in, break, my tables, task inbox Accept/At table/Done, take order, approve QR orders, mark served, request bill, busser clean queue); web push (VAPID); billing (bill from orders, discounts, service charge, CGST/SGST, gap-free invoice numbers per FY, printable/shareable HTML invoice, cashier marks paid); alerts centre; audit log viewer; Playwright e2e: seat → QR order → approve → KDS → serve → bill → pay → clean. | **P1 done**: full manual service runs end to end; e2e green. |
| **M5** | SLA queue + processors + reconciler; waiter selection (RR / least-loaded / fixed) with advisory lock; assignment ack; escalation; floor-map SLA countdown (amber 3 min, red 5 min); outlet settings UI; fake-clock integration tests. | Seat a table, ignore it: assignment at 5:00, reassign at 7:00, manager alert at 10:00 — in tests and live. |
| **M6** | Edge device registration + signed `/edge/events` + `/edge/config`; vision service (sources, detector interface + RT-DETR/YOLOX ONNX, ByteTrack, zones, debounce, staff-present, outbox, health); camera CRUD + snapshot + zone polygon drawing UI; camera wall (health + last snapshot + zone overlay; live preview via on-demand blurred JPEG stream from edge in LAN only); `record` + `eval` CLIs; camera-offline alerts. | Sample MP4 drives a table Vacant → Occupied → Assigned → Greeted; `eval` prints accuracy. |
| **M7** | Razorpay pay-at-table (test mode; orders API + webhook signature verify; UPI intent + cards), split bill (equal / by item / custom → multiple Payments), departure → NEEDS_CLEANING → busser task → VACANT, left-without-paying alert, reports (seatings today, avg seat-to-greet, SLA breaches per waiter, sales by hour). | **P2 done** on sample footage; payment webhook integration test passes. |

Rough effort (solo + Claude Code): M0–M1 1 wk, M2 1 wk, M3 1 wk, M4 1–1.5 wk, M5 1 wk, M6 1.5–2 wk, M7 1 wk.

---

## 11. Phase 3–4 extension points

- `Seating.reservationId`, `Seating.guestId`, `SeatingSource.WAITLIST`, `RESERVED` state + hold/release events → reservations & waitlist.
- Domain event bus (§6.3) → feedback scheduler, CRM, loyalty, analytics projections.
- `NotificationChannel` interface (`webpush`, `socket`; later `whatsapp`, `sms`, `fcm`).
- `PaymentProvider` interface (`manual`, `razorpay`; later `cashfree`, POS sync).
- `Detector` / `Posture` protocols in vision; edge event `type` is an open union (hand_raise, plates later).
- `services/ml` FastAPI stubs with fixed contracts; API calls them through `PredictionClient` with rule-based fallbacks.
- `Outlet` already multi-outlet; dashboard has an outlet switcher from M2.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Camera can't tell staff from guests | Greet = staff tap / QR by default; camera greet behind `cameraGreetEnabled`, off by default. |
| Occupancy flicker (occlusion, people standing up) | Debounce per zone, hysteresis, track-level dwell; tune via `eval` on real footage. |
| Timer drift / lost jobs | Deadlines derived from `seatedAt`; reconciler every 30 s; handlers re-check DB. |
| Race on round-robin cursor | Postgres advisory transaction lock per outlet. |
| Web push unreliable on iOS / locked phones | Socket + in-app sound when open; push as backup; native Expo app in P4. |
| GST invoice compliance | Gap-free FY sequences, per-line HSN/SAC + tax, GSTIN on invoice; have your CA review the template before pilot. |
| Model licence | Apache-2.0 detector by default (D1). |
