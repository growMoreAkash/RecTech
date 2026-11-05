# DineSense — Phase 3 plan (guest growth, CRM, analytics)

> Status: **approved by the owner** (2026-11-05). M8 and M9 done. Builds on the approved [`PLAN.md`](./PLAN.md) (P1–P2 done,
> M0–M7). Source features: every **P3** row of [`PRD.md`](./PRD.md). P4 (voice agent, pre-order, no-show model,
> chat ordering, hand-raise, plates/glass AI, demand forecast, native app) stays out; only extension points.

## 1. What Phase 3 delivers

The journey before the door and after the bill: guests can **book**, **join a waitlist**, get **WhatsApp**
confirmations, are **recognised** when they return, are asked for **feedback**, earn **loyalty**, and receive
**consented** offers. Inside the restaurant, service gets smarter (idle tables, course pacing, prep ETAs, dirty
tables), and managers get real **analytics** across **outlets**, plus **recipe inventory**.

| PRD area           | P3 features                                                                                               | Milestone |
| ------------------ | --------------------------------------------------------------------------------------------------------- | --------- |
| 1 Discover & book  | Online booking · WhatsApp confirm/remind/cancel/reschedule · Reserved-table hold                          | M8, M9    |
| 2 Arrive & wait    | Digital waitlist · Wait-time prediction · Party-size estimate · Returning-guest recognition               | M8, M9    |
| 5 Order            | AI recommendations & upsell (rule/statistics based)                                                       | M11       |
| 6 Kitchen & serve  | Prep-time prediction · Recipe-based inventory                                                             | M10, M12  |
| 7 Dine             | Idle-table alert · Course pacing · Mid-meal check-in                                                      | M10       |
| 8 Bill & pay       | Tips per waiter · Loyalty & coupons · POS integration (see decision P3-D4)                                | M10–M12   |
| 9 Exit & follow-up | Dirty-table check (camera) · WhatsApp feedback · Review routing · Guest CRM & campaigns                   | M10, M11  |
| Management         | Analytics (turnover, dwell per stage, waiter scorecard, sales by item) · Occupancy heatmap · Multi-outlet | M12       |

Also closes a P1 privacy item from the brief that only makes sense once we store guest data: **DPDP consent
flags, data export and delete endpoints, retention job** (M8).

## 2. Decisions that need the owner (paid services / external accounts)

| #     | Decision                    | Recommendation                                                                                                                                                                                                                                         | Cost / account                                                                                                                       |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| P3-D1 | **WhatsApp provider**       | **Meta WhatsApp Cloud API directly** (no reseller markup), behind a `NotificationChannel` so a BSP (Gupshup / Interakt / AiSensy) can be swapped in. Dev and tests use a `console` channel; nothing is sent until you approve and add credentials.     | **Paid**: per-conversation fees by category (utility/marketing); needs a Meta Business account, verified number, approved templates. |
| P3-D2 | SMS fallback                | **Skip** in P3 (WhatsApp + web link only). Revisit if delivery rates are poor.                                                                                                                                                                         | Would be paid (DLT registration in India).                                                                                           |
| P3-D3 | Weather for recommendations | **Open-Meteo** (free, no key, no account), cached hourly per outlet; feature works without it.                                                                                                                                                         | Free.                                                                                                                                |
| P3-D4 | **POS integration**         | **Defer Petpooja/Posist sync** (needs partner API agreements). DineSense already _is_ a standalone POS (menu, KDS, GST billing, payments). In P3 ship a **daily CSV/JSON sales export** + a `PosSync` interface, so an integration is a plug-in later. | Partner agreements; usually free API but commercial terms vary.                                                                      |
| P3-D5 | Google review link          | Manager pastes the outlet's Google **Place ID** in settings; we build the "write a review" link. No Google API calls.                                                                                                                                  | Free.                                                                                                                                |
| P3-D6 | Booking page hosting        | Inside the existing guest app (`/b/[outletSlug]`), embeddable link/QR for website, Google Business profile and Instagram bio. No new infra.                                                                                                            | Free.                                                                                                                                |
| P3-D7 | Predictions                 | **Statistics + rules in TypeScript** (medians/percentiles over recent history) with the `PredictionClient` interface from PLAN §11; the Python `services/ml` stays a P4 stub. Explainable, no training pipeline, no GPU.                               | Free.                                                                                                                                |

Nothing in this plan adds infrastructure beyond what runs today (Postgres, Redis/BullMQ, the Next apps, the edge
box). No new paid service is wired until you approve P3-D1.

## 3. Milestones

Each milestone ends like before: `pnpm lint && pnpm typecheck && pnpm test` (+ `pytest`), e2e green, CLAUDE.md
updated, demo script in `docs/MILESTONES.md`.

### M8 — Guests, privacy & bookings (≈1.5 wk)

- **Guest profiles (CRM core)**: phone (E.164, normalised), name, consent per purpose (`service`, `whatsapp`,
  `feedback`, `marketing`) with timestamp + source; visit stats (visits, last visit, spend, favourite items) as a
  projection updated on seating close.
- **Returning-guest recognition**: host enters/looks up a phone at seat time (or the booking/waitlist entry carries
  it) → drawer shows "3rd visit · last 12 Oct · usually Paneer Tikka, Masala Chai · allergy note". No cameras, no
  faces — phone number only.
- **DPDP**: `GET /guests/:id/export` (JSON of everything we hold), `DELETE /guests/:id` (erase PII, keep anonymous
  aggregates and GST invoices as legally required), consent withdrawal link in every message, nightly **retention
  job** (configurable N days: null phone/name of inactive guests), audit of every access to guest PII.
- **Reservations**: `Reservation` (time, party size, preference: indoor/outdoor/section, notes, status
  PENDING → CONFIRMED → SEATED / CANCELLED / NO_SHOW), slot rules per outlet (opening hours, slot length, turn
  time by party size, max covers per slot, lead time, online-bookable tables/sections).
  - **Availability** = pure function over tables, capacities, join rules, existing reservations and predicted
    turn times → bookable slots; tested with property tests (never double-books a table).
  - **Guest booking page** `/b/[outlet]` (mobile, en/hi): pick date/time/party size → phone + name + consent →
    confirmation page with manage link (cancel/reschedule via signed token).
  - **Host view**: today's bookings timeline on the floor page; assign/auto-assign table; check-in seats it
    (`Seating.reservationId`, source RESERVATION).
- **Reserved-table hold**: table goes `RESERVED` X min before (setting), released at Y min no-show grace →
  `NO_SHOW`; a walk-in seated (by host or camera) on a held table raises **RESERVED_TABLE_TAKEN** (already in the
  alert enum) with a suggested alternative table. Table machine gains the RESERVED transitions already sketched in
  PLAN §5 (tests first).

### M9 — WhatsApp, waitlist & wait times (≈1.5 wk)

- **Messaging**: `NotificationChannel` → `whatsapp` implementation (Cloud API, template messages with variables,
  per-outlet sender), `console` for dev/test, delivery/read webhooks (signed), per-guest **opt-out**, quiet hours,
  rate limits, every send recorded (`MessageLog`) and idempotent by `(purpose, entity, guest)`.
  Templates (submitted for Meta approval): booking confirmed, reminder (2 h before), waitlist joined, table ready,
  feedback request, offer.
- **Booking messages**: confirm on create; reminder 2 h before (BullMQ delayed job, reconciled like the SLA timers);
  one-tap **cancel / reschedule** links (signed, no login).
- **Digital waitlist**: door QR → `/w/[outlet]`: name, phone, party size, consent → live position + ETA page;
  host's waitlist panel (call, seat, skip, remove); when a fitting table turns VACANT the host gets a suggestion
  and one tap sends **"your table is ready"** (WhatsApp + live page), with a hold timer.
- **Wait-time prediction**: for each party size, ETA = when enough tables of a fitting size are expected free:
  remaining dwell per occupied table from its stage (seated/ordered/served/bill) using the outlet's recent median
  stage durations (P3-D7), plus queue ahead. Shown to host and guest; accuracy tracked (predicted vs actual seat
  time) in analytics.
- **Party-size estimate (camera)**: optional door/entrance zone on a camera; the edge groups people entering
  together (tracks crossing the zone within a few seconds) → `party.arrived { count }` event (new edge event type,
  contract + JSON Schema + pytest) → host sees "Party of ~4 at the door · suggested T6 (4-top)". Evaluated with the
  synthetic generator (new door scenario).

### M10 — Service quality on the floor (≈1 wk)

- **Idle-table alert**: occupied table with no staff touch (tap, task done, staff-present from camera) for X min
  after a configurable stage → nudge task to the serving waiter, escalate like the greet ladder (reuses SlaEngine
  pattern: one idempotent `evaluate`, delayed jobs, sweep).
- **Course pacing**: per-category "course" (starter/main/dessert/drinks) and pacing rules: prompt "fire mains"
  N min after starters are served, "offer dessert" N min after mains cleared; KDS shows held courses.
- **Prep-time prediction**: per item × station, median of recent QUEUED→READY (with load factor = items in
  station queue) → order ETA on guest page ("ready in ~12 min"), staff app and KDS; accuracy tracked.
- **Mid-meal check-in**: N min after first items are served the guest QR page asks "How's everything?" (👍 / 👎 +
  comment); 👎 creates a manager task immediately (service recovery while they're still there).
- **Dirty-table check (camera)**: the COCO classes YOLOX already detects (cup, bowl, bottle, wine glass, fork,
  knife, spoon) inside a VACANT/NEEDS_CLEANING table zone for > N s → `table.dirty` edge event → CLEAN task /
  "seated at dirty table" alert; snapshot evidence stays local (blurred) unless a manager requests it.
- **Tips per waiter**: tip amount on payments (counter and online — Razorpay order carries tip separately so GST
  is unaffected), attributed to the serving waiter (or split rules), shown in reports; tips are never part of the
  taxable value.

### M11 — Feedback, loyalty & growth (≈1.5 wk)

- **WhatsApp feedback**: 30 min after the seating closes (consented guests) → 1–5 stars + comment page (signed
  link). **Review routing**: 4–5 ★ → Google review link (P3-D5); 1–3 ★ → manager alert with the bill, waiter and
  timeline attached. Response rate and NPS-style scores in analytics.
- **Loyalty**: points per ₹ spent (configurable), tiers (e.g. Silver/Gold by visits/spend in 12 months), points
  redemption as a bill discount (goes through the existing pro-rata pre-tax discount), ledger with expiry; every
  change audited.
- **Coupons**: codes or auto-offers (percentage/flat, min bill, valid dates/days/hours, per-guest limit, items or
  categories), validated server-side at billing; usage tracked.
- **CRM & campaigns**: segments (new, regulars, lapsed 45+ days, birthday this week, high spenders, by favourite
  category) as saved filters; campaigns send a template to a segment **only for marketing-consented guests**, with
  frequency caps, quiet hours, preview & test send, scheduling, and attribution (visits/revenue within N days).
  Birthday and win-back as scheduled automations.
- **Recommendations & upsell**: guest page "Goes well with…" (item co-occurrence from past orders, lift-ranked),
  "Bestsellers", time-of-day picks, and weather nudges (P3-D3: hot → cold drinks, rain → chai/pakora); waiter app
  shows the same as suggestions. Rules are transparent and switchable per outlet; uplift measured in analytics.

### M12 — Analytics, inventory, multi-outlet (≈1.5 wk)

- **Analytics** (dashboard section, date ranges, outlet filter, CSV export): covers and seatings, table
  **turnover**, **dwell per stage** (seat→greet→order→serve→bill→pay→leave, medians and p90), greet SLA, waiter
  **scorecard** (greet time, SLA misses, tables, sales, tips, feedback), sales by hour/day/**item**/category, discount
  and coupon cost, loyalty liability, feedback scores, prediction accuracy. Built on read-optimised **daily
  rollup tables** maintained by jobs from domain events (the event bus from PLAN §6.3), so the live DB isn't
  scanned for every chart.
- **Occupancy heatmap**: per table/section, share of time occupied and revenue per seat-hour by hour of week,
  drawn on the floor plan (with an accessible table equivalent).
- **Multi-outlet**: org-level dashboard for owners (outlet comparison of the KPIs above), outlet-scoped roles stay
  as they are; guest profiles and loyalty are **org-wide** (one guest, many branches), consents per org.
- **Recipe-based inventory**: ingredients (unit, cost, par level), recipes per item/modifier (quantities),
  stock-in (purchases), wastage and manual counts; each accepted order item deducts stock; low-stock alerts and
  86-ing (auto mark items unavailable when an ingredient runs out — reuses menu availability + realtime); daily
  food-cost % report.
- **POS**: daily sales export (CSV/JSON: invoices, lines, GST, payments) and the `PosSync` interface (P3-D4).

## 4. Data model additions (summary)

`Guest` (+ `phoneHash` for lookups, `birthday`, `notes`, `allergies`, `tier`), `Consent` (purpose, granted,
source, at), `GuestVisitStats` (projection), `Reservation`, `BookingRule` / `OutletHours`, `WaitlistEntry`,
`MessageTemplate`, `MessageLog`, `Feedback`, `LoyaltyAccount` + `LoyaltyLedger`, `Coupon` + `CouponRedemption`,
`Campaign` + `Segment`, `Payment.tipPaise`, `MenuCategory.course`, `Ingredient`, `RecipeLine`, `StockMovement`,
`DailyRollup*` tables, `DomainEvent` (outbox). New table states/events only where PLAN §5 already reserved them
(RESERVED hold/release). New edge events: `party.arrived`, `table.dirty`.

## 5. Architecture changes

- **Domain event outbox**: state changes write a `DomainEvent` row in the same transaction; a BullMQ worker fans out
  to consumers (messages, CRM stats, loyalty, rollups). Exactly-once per consumer via a processed-events table.
  Deferred to M9 (its first cross-process consumers); M8 uses an in-process `SeatingEvents` hook for visit stats.
- **Scheduler**: reminders, feedback, campaigns, holds and pacing all use the existing pattern (deterministic job ids
  - reconcile sweep) — no new infrastructure.
- **Public guest surfaces** (booking, waitlist, feedback, manage-booking): signed tokens, rate limits, CAPTCHA-free
  abuse controls (per-phone/day caps, OTP only if abuse appears — OTP would use WhatsApp, not paid SMS).
- **Privacy by design**: PII only in `Guest`; everything else references `guestId`; erasure nulls PII and keeps
  aggregates; analytics never store phone numbers.

## 6. Risks

| Risk                                         | Mitigation                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| WhatsApp template approval delays / costs    | Console channel in dev; all flows also work with links/pages; utility templates first.                |
| Spam / DPDP complaints from campaigns        | Marketing only with explicit consent, opt-out in every message, frequency caps, audit trail.          |
| Double-booked tables                         | Availability is a pure, property-tested function; booking creation re-checks under a per-outlet lock. |
| Bad ETAs erode trust                         | Show ranges ("15–25 min"), track accuracy, fall back to conservative defaults with little history.    |
| Camera party-size / dirty-table false alarms | Suggestions only (never auto-actions); thresholds per outlet; `ds-vision eval` scenarios.             |
| Inventory drift                              | Manual counts reset stock; variance report; deductions are idempotent per order item.                 |

## 7. Effort and order

M8 1.5 wk · M9 1.5 wk · M10 1 wk · M11 1.5 wk · M12 1.5 wk (solo + Claude Code). M8 first (everything else needs
guest profiles and consent). M10 can run before M9 if WhatsApp approval (P3-D1) is slow, since it needs no
external service.

## 8. Questions for the owner

1. Approve this plan and milestone order (M8 → M12)?
2. P3-D1: WhatsApp via Meta Cloud API directly (paid per conversation) — OK to build against the console channel now
   and wire Meta when you have the Business account and number?
3. P3-D4: OK to defer Petpooja/Posist sync and ship sales export + interface instead?
4. Loyalty defaults: points per ₹100, tiers and expiry — any preference, or should I use common Indian
   casual-dining defaults (1 point per ₹100, 1 point = ₹1, 12-month expiry)?
