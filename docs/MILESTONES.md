# Milestone log & demo scripts

Each milestone ends with lint, typecheck, tests and build green, plus a demo script you can follow by hand.

Common setup (once):

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis   # or local Postgres 16 + Redis 7
pnpm i
pnpm --filter @dinesense/api db:migrate
pnpm --filter @dinesense/api seed      # dev DB only — wipes and re-seeds
```

Seed logins: `owner|manager|host|cashier|chef@demo.dinesense.in` / `dinesense123`. Staff terminal header
`x-device-token: sd_demo_floor_terminal_dev_only`; PINs printed by the seed (waiters 1001–1006).

---

## M0 + M1 — Foundations (done 2026-11-05)

Monorepo tooling, CI, Docker Compose; full Prisma schema; demo seed; NestJS API with zod validation, error
shape, OpenAPI, auth (password + device-bound PIN with lockout, rotating refresh), tenancy, RBAC, audit log.

Demo:

1. `pnpm --filter @dinesense/api dev`, open http://localhost:4000/api/docs.
2. `POST /api/v1/auth/login` as the manager → copy `accessToken` → Authorize.
3. `PATCH /api/v1/outlets/{id}/settings` with `{"greetSlaSeconds":240}` → `GET .../audit-logs` shows 300 → 240.
4. `POST /api/v1/auth/pin-login` with the terminal header and a waiter id + PIN; the same PATCH returns
   `FORBIDDEN` for the waiter.

## M2 — Floor, live state, staff & shifts (done 2026-11-05)

- Table state machine (pure reducer in `packages/shared`), applied transactionally by `TableStateService`.
- Floor snapshot, bulk floor-plan save, sections; seat / transition / timeline; staff and shifts with
  check-in order and breaks; alerts list / ack / resolve.
- Socket.IO `/rt` with outlet/role/staff rooms; dashboard patches the floor in place on `table.updated`.
- Dashboard (Next.js): login, live floor map (canvas + accessible list), table drawer with actions driven by the
  shared state machine, manager override, timeline, floor-plan editor, staff & shifts, alerts panel, English/Hindi.

Demo (two browser windows):

1. `pnpm dev` (API on :4000, dashboard on http://localhost:3000). Sign in as the manager in **two** windows.
2. Window A: click **T3** → _Seat a party_: 3 guests, note "Anniversary" → **Seat party**.
   Window B shows T3 as **Occupied** with "3 guests" and a 5:00 greet countdown within a second (measured ~150 ms).
3. Wait 3 minutes: T3's outline turns amber; at 5:00 it turns red (the auto-assignment itself arrives in M5).
4. Window A: **At table (greet)** → Greeted (the waiter avatar appears when a waiter greets).
   **Request bill** → **Guests left** → **Cleaned**: B mirrors each step; the drawer timeline lists them with who did it.
5. Seat **T1** with _Join tables → T2_ (T1/T2 must be marked joinable in the editor first): both tables move together.
6. **Floor plan**: drag a table, resize/rotate with the handles, change seats/shape/section, tick joinable tables,
   **Save floor plan**. Removing a table that is in service is refused and names the table.
7. **Staff & shifts**: today's seeded shifts → **Check in** two waiters (rotation #1, #2 — the round-robin order for
   M5), **Start break**, **Check out**; _Team_ → add a waiter with a PIN (managers cannot add managers; owners can).
8. Language menu → हिन्दी: the whole UI switches.
9. Override: as manager open any table → _Override state_ → pick a state → **Set state** (seating opened/closed
   consistently; audit-logged).

Automated: `pnpm test` (state machine matrix, API integration incl. concurrency, joins, tenancy, camera dedupe and
socket delivery). A two-browser Playwright run of steps 2–6 was executed during development; it becomes part of the
committed e2e suite in M4.

## M3 — Menu, guest QR ordering, approval, KDS (done 2026-11-05)

- Menu manager (dishes with English/Hindi names, veg marks, allergens, spice, GST slab, station, option groups with
  price changes); sold-out toggle for the kitchen that reaches every guest phone instantly.
- Guest PWA (`apps/guest`, :3001): table QR → menu (read-only until seated), item options with live price, shared
  table cart across phones, place order, order tracking with item status, running bill with CGST/SGST, call waiter /
  water / cutlery / bill. English/Hindi.
- Orders: QR orders wait for a waiter's approval (configurable); waiter orders go straight to the kitchen.
- KDS per station: tickets age (amber 8 min, red 15 min); tap an item to cook → ready; **Bump** readies a ticket.
- Floor drawer shows a table's orders with Approve/Reject and **Served** for ready items; serving the whole first
  order moves the table to _Served_. Printable QR sheet for all tables.

Demo (four windows: manager, chef, two phones — or a phone and a mobile-sized browser window):

1. `pnpm dev`. Manager → **Floor plan → Table QR codes**: open T3's QR link (or scan it) on **two phones**.
   Both show the menu with "Please wait to be seated".
2. Manager: seat **T3** (2 guests). Within ~15 s the phones switch to ordering.
3. Phone A: **Dal Makhani** → _Full_ is pre-selected, tick _Extra butter_ → **Add to table order**.
   Phone B's cart button turns to _Cart (1)_ immediately. Phone B adds **Sweet Lassi**.
4. Phone A: **Cart** shows both lines ("Added by you" on yours), GST split → **Place order** → _Waiting for confirmation_.
5. Manager's floor: an amber "1 order waiting for approval" card → **Approve** (or type a reason → **Reject**:
   the phone shows why). The phone flips to _In the kitchen_.
6. Chef (`chef@demo.dinesense.in`) → **Kitchen → Curry & Rice**: ticket #1 for T3. Tap the dal twice
   (Cooking → Ready; the phone shows each step). **Kitchen → Bar & Beverages** → **Bump**.
7. Manager: open T3 → **At table (greet)** (a QR order alone does not count as the greet) → both items show
   **Served** buttons → tap them: T3 becomes _Served_; the phone shows _Served_ and the running bill.
8. Phone B: **Bill** → T3 turns _Bill requested_ on the floor. **Water** / **Call waiter** create tasks for the
   serving waiter (shown in the staff app in M4).
9. **Menu**: toggle _Sold out_ on a dish → it greys out on the phones without a reload. Edit a dish, add an option group.
10. Phones: tap **हिं** — the guest UI switches to Hindi, dish names included.

Automated: `pnpm test` covers pricing/availability rules, the full QR → approval → KDS → served → bill loop,
rejection, approval-off mode, waiter orders, role checks per item move, token separation and session expiry.
The four-window Playwright run above was executed during development (no page errors); it joins the committed
e2e suite in M4.

## M4 — Staff app, billing, alerts, audit, e2e (done 2026-11-05) — **Phase 1 complete**

- **Staff PWA** (`apps/staff`, :3002): a manager registers the phone/tablet once; then staff pick their name and
  enter a PIN. Tabs: **Tasks** (accept / done / greet / clean / open table), **Tables** (my tables first; At table,
  take order with options, approve or reject QR orders, mark served, print bill, guests left), **Clean** (busser
  queue), **My shift** (check in, break, check out; turn on push alerts).
- **Web push**: set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (`pnpm dlx web-push generate-vapid-keys`). New tasks
  go to the assignee, or to on-shift staff whose role handles them; alerts go to managers.
- **Billing**: open bill → discount (with reason) and service charge → finalise (invoice number `SR/2026-27/00001`,
  gap-free per financial year) → cash / UPI / card, split allowed → table becomes _Paid_. Printable, shareable
  GST tax invoice (GSTIN, SAC, CGST/SGST by rate, round-off). Cash desk page with the day's collections.
- **Alerts centre** with history and **audit log** viewer with field-level before/after.
- **E2E** (`pnpm build && pnpm e2e`, also in CI): five browser contexts run a full service.

Demo (dashboard + a phone for the staff app + a phone for the guest):

1. `pnpm dev`. Open the staff app on a phone (http://<your-ip>:3002). Sign in once as the manager →
   **Register device**. The PIN screen lists the team.
2. Tap **Anil Sharma**, PIN **1001** → _My shift_ → **Check in** → **Turn on alerts** (needs VAPID keys).
3. Dashboard (host): seat **T5**. Guest phone: scan T5's QR, order **Paneer Tikka**, **Place order**.
4. Staff app **Tasks**: "Approve QR order — table T5" → **Open table** → **Approve**. Tap **At table (greet)**.
5. Chef → **Kitchen → Tandoor**: tap the item twice (Cooking → Ready). Staff app: **Served** → T5 is _Served_.
6. Guest: **Bill**. Cashier (`cashier@demo.dinesense.in`) → Floor → T5 → **Create bill** → enter a ₹50 discount
   with a reason → **Apply** → **Finalise bill** → **Record payment** (Cash). T5 turns _Paid_.
   **Print / share invoice** opens the tax invoice. **Bills** shows the day's collections by method.
7. Staff app: T5 → **Guests left**. **Switch user** → **Lakshmi Pillai** (2002) → **Clean** → **Cleaned**. T5 is
   _Vacant_ again.
8. Manager → **Audit log**: every step above, who did it, with before/after. **Alerts**: open/acknowledged/resolved.

Automated: 470 unit/integration tests (incl. a 500-bill randomised GST invariant sweep) and the e2e full service.

## M5 — The 5-minute rule: greet SLA, round robin, escalation (done 2026-11-05)

- When guests sit, a timer starts. If nobody taps **At table** within the greet SLA (default 5 min), the table is
  assigned to the next on-shift waiter in its section (round robin in check-in order; or least-loaded / fixed
  section), who gets a GREET task and a push. Waiters on break or at their table limit are skipped; if nobody covers
  the section, anyone on shift is picked.
- If the waiter doesn't tap **On my way** within the re-assign window (default 2 min), the table moves to the next
  waiter. At the escalation time (default 10 min) managers get a critical alert and a push. A greet by anyone stops
  everything and resolves the SLA alerts.
- Floor map: amber avatar = assigned, waiting for "On my way"; dark = acknowledged or serving. The drawer shows
  "Must greet: name (attempt n) · on the way / not yet acknowledged".
- **Settings** page (managers): greet / re-assign / escalate times, assignment mode, max tables, QR rules, service
  charge, camera thresholds.

Demo (dashboard + staff app on a phone):

1. Manager → **Settings**: set _Greet within_ to **0.5** min (30 s) for the demo → **Save**.
2. Staff app: sign in as **Anil Sharma** (1001) and **Sunita Reddy** (1002) on two phones (or one after the other);
   each taps **My shift → Check in** (check-in order = rotation order).
3. Host seats **T1** (Main Hall). Watch the countdown on the floor map; at 0:30 it turns red, T1 gets Anil's
   initials in amber, and Anil's phone shows "Greet table T1" (with a buzz if alerts are on).
4. Do nothing for 2 minutes: the table passes to Sunita (attempt 2); the Alerts centre shows _Greet reassigned_.
5. Sunita taps **On my way** (avatar turns dark), then **At table (greet)**: T1 is _Greeted_, alerts resolve.
6. Seat another table and ignore it for 10 minutes (or set _Alert managers after_ to 1.5 min): managers get the
   critical _Escalated_ alert. Put both waiters on break: the next table raises _No waiter available_.
7. Set the greet time back to 5 minutes.

Automated: waiter-selection unit tests (fairness over 100 seatings, breaks, limits, fallback, modes), fake-clock
integration tests of the whole ladder (incl. idempotency and two tables breaching at once), and an e2e test where a
real 30-second timer assigns the table on the live stack.

## M6 — Vision: edge service, cameras, zone calibration, camera health (done 2026-11-05)

- **Edge service** (`services/vision`, Python 3.11): reads each camera at 3 fps, detects people (YOLOX ONNX,
  Apache-2.0), estimates seated/standing from the box shape, tracks them, maps them into table zones and debounces:
  a table is reported _occupied_ after N s of seated guests, _empty_ after M s without them (outlet settings).
  A standing person at an occupied table for the staff-present time is reported as a staff visit, which counts as
  the greet only if **Settings → Camera may count a staff visit** is on. Events go through a SQLite outbox
  (survives outages, replayed in order, exactly-once on the API) as HMAC-signed batches; the device secret is never
  sent. Health (fps, latency, last frame, reconnects) every 30 s; silent cameras/devices raise alerts.
- **Privacy**: frames stay in memory. Only calibration snapshots leave the box, with heads/faces pixelated. No face
  recognition, no video storage. `ds-vision record` (local footage for labelling) warns about consent.
- **Cameras** page (managers): register the edge box (id + secret shown once, as `.env` lines), add cameras (RTSP URL
  stored encrypted, never shown again), camera wall with health and the last snapshot with zone overlay, and zone
  calibration: draw a polygon per table on the snapshot (click points, click the first to close, drag to adjust),
  or type a rectangle in percent (keyboard path).
- **Dev mode without cameras**: `ds-vision synth` renders labelled synthetic footage (guests walk in, sit, a waiter
  visits, they leave, with noise and missed detections); `--detector synthetic` reads it. `ds-vision eval` replays
  a video through the same pipeline and prints accuracy against labels.

Demo (API + dashboard running; from `services/vision`):

1. `uv sync && uv run ds-vision synth --out samples --seconds 900` → `samples/dining-room.{mp4,labels.csv,zones.json}`.
2. `uv run ds-vision eval --detector synthetic --video samples/dining-room.mp4 --labels samples/dining-room.labels.csv
--zones samples/dining-room.zones.json` → per-table table; _accuracy outside debounce windows_ 100 % (target
   ≥ 95 %), occupy/vacate latency ≈ the configured 30 s / 90 s.
3. Dashboard → **Settings**: Seated after **10** s, Empty after **30** s, Greet within **0.5** min, camera greet
   **on** → Save. **Staff & shifts**: check in the waiters.
4. **Cameras** → _Register edge device_ "Demo mini-PC" → copy the three `DS_*` lines into `services/vision/.env`.
5. _Add camera_ "Main hall", URL `file:///<repo>/services/vision/samples/dining-room.mp4`, 3 fps.
6. `uv run ds-vision run --dev --detector synthetic`. Within seconds the camera turns _Healthy_ and a snapshot
   appears. **Calibrate zones**: draw a zone around each of the four drawn tables (or _Rectangle_) for four real
   tables → **Save zones** (the box picks them up within 30 s).
7. Watch **Floor**: a table goes _Vacant_ → _Occupied_ (party size from the camera) → assigned to a waiter at the
   30 s greet deadline (amber avatar) → _Greeted_ when the synthetic waiter stands at it. Verified live: four tables
   went Occupied → assigned round-robin (Anil, Farhan, Sunita, Deepa) → Greeted.
8. Stop the vision process: after ~90 s the camera shows _Offline_ and the Alerts centre has _Camera offline_ /
   _Edge device offline_; restart it and the camera alert resolves.
9. Real cameras: `uv run ds-vision fetch-model` (YOLOX-S, Apache-2.0, checksum-verified), set the RTSP URL, run
   without `--dev`, or `docker compose -f infra/docker-compose.yml --profile edge up -d vision`.

Automated: 38 pytest tests (signing vector shared with TypeScript, JSON-Schema contract checks of every event,
debounce/zone/tracker/staff rules, outbox + signed sender against a mock API, synthetic end-to-end ≥ 95 %, service
loop), API integration tests for signatures/replay/dedupe/health, and dashboard zone helper tests.

## M7 — Split bills, pay-at-table (Razorpay test mode), departure, reports (done 2026-11-05) — **Phase 2 complete**

- **Split bill** (cash desk and waiters, from the table drawer): _Equally_ (whole rupees where possible), _By item_
  (tick who had what; shared dishes are divided equally; GST, service charge and round-off follow the items) or
  _Custom amounts_ (must add up). The shares always add up to the invoice total to the paisa; the invoice itself is
  one legal document. Each share is paid separately (cash / UPI / card at the counter, or online by the guest).
  Re-splitting is refused once money was taken or while a guest checkout is in progress.
- **Pay at table**: with **Settings → Online payments** on and `RAZORPAY_*` keys on the server, the guest QR page
  shows **Pay bill** — one button per unpaid share. The API creates a Razorpay order for the exact amount due,
  the phone opens Razorpay Checkout (UPI intent / cards), the API verifies the checkout signature, and the
  Razorpay webhook (HMAC of the raw body) confirms the same payment independently — whichever arrives first wins,
  the second changes nothing. Money arriving for an already-settled bill is still recorded and flagged
  (`bill.payment.excess` in the audit log) for a refund from the Razorpay dashboard. Without keys, guests are told
  to pay at the counter.
- **Departure**: paid table + camera sees it empty (or staff taps _Guests left_) → _Needs cleaning_ + CLEAN task for
  bussers → _Cleaned_ → _Vacant_. Unpaid table with orders emptied by the camera → critical _Left without paying_
  alert; the table is not closed automatically.
- **Reports** (managers): seatings and covers, average/median seat-to-greet, % greeted within the SLA, SLA breaches
  and escalations, left-without-paying count; per waiter: greets, assigned, acknowledged, missed (passed on), average
  acknowledgement time; invoiced sales by hour (chart with a table view), average bill, collections by method.

Demo (dashboard + guest phone; for a real sandbox checkout add Razorpay **test** keys — `rzp_test_…` — to `.env`):

1. Manager → **Settings → Online payments** → tick → Save.
2. Seat **T11** and take an order (3 items). Drawer → **Create bill** → **Split bill** → _By item_ → 3 people
   (Asha, Ravi, —), tick who had what (share the first dish) → **Save split**: the bill is finalised and shows three
   shares that add up to the total.
3. Cash desk: pick _Ravi_ in the payment form → **Record payment** (UPI) → Ravi's share shows _Paid_.
4. Guest phone (T11 QR) → **Pay bill** → _Pay Asha's share_ → Razorpay test checkout → test UPI `success@razorpay`
   → back on the page the share shows _Paid_; the dashboard updates live. Pay the last share the same way (or at the
   counter): T11 turns _Paid_.
5. Staff app: **Guests left** (or the camera reports the table empty) → _Needs cleaning_; a busser taps **Cleaned**
   → _Vacant_.
6. Seat T12 and order; with the M6 dev camera running, let the synthetic guests at T12's zone leave before paying
   (or have the edge send a `table.vacated` event) → critical _Left without paying_ alert; T12 stays open.
7. **Reports**: today's seatings, greet times, waiter table, sales by hour and collections by method.

Automated: split maths unit tests (incl. a 300-bill randomised by-item sweep), payments integration tests against a
mock Razorpay API (order creation with Basic auth, forged checkout and webhook signatures rejected, idempotent
capture, webhook-only settlement, provider outage, abandoned checkout, late excess capture), camera departure chain
(paid → empty → clean → vacant; unpaid → alert), reports unit + integration tests.

## M8 — Guests, privacy & bookings (done 2026-11-05) — Phase 3 starts

- **Returning guests**: the host types the party's mobile number when seating (optional). A known number shows a
  card — visit number, last visit, spend, usual order, **allergies in red**, notes; a new number asks for a name and
  the guest's opt-ins (never pre-ticked). The table drawer and staff views show who is at the table. Phone only — no
  photos, no faces.
- **Privacy (DPDP)**: consent per purpose with full history; every look at a profile is audited (field names only,
  never the data); managers can **export** a guest's data (JSON) and **erase** it (PII nulled, future bookings
  cancelled, anonymous counts kept); owners set the **retention period** (default 730 days) and a sweep erases
  inactive guests automatically.
- **Online booking** at `/b/{outlet-slug}` on the guest app (link + hours in Settings): party size, day, time slots
  computed from opening hours, turn times by party size, lead time, horizon, covers per slot and the tables marked
  "bookable online" in the floor-plan editor. Six phones racing for the last tables can never double-book.
  Confirmation gives a signed **manage link**: change time/party, cancel, change opt-ins.
- **Front desk** (`/bookings`): the day's bookings with guest history and allergies, phone bookings on any table,
  change table, cancel, no-show, **check in** (seats the party on the booked tables; the seating carries the guest
  and the booking). The table drawer shows today's bookings for that table with check-in.
- **Table holds**: tables turn _Reserved_ 20 min before a booking (setting); a walk-in seated there (by the host or
  the camera) raises _Reserved table taken_; if the booked table is still occupied when the hold starts, the host is
  warned once; bookings not checked in 15 min after their time become no-shows and the table is released.

Demo (dashboard + a phone):

1. Manager → **Settings → Opening hours** → _Every day 12:00–23:00_ → Save hours; **Bookings** section → tick
   _Guests can book online_ → Save settings. Copy the booking link.
2. Phone → booking link → 3 guests → tomorrow → 19:30 → name, mobile, tick _WhatsApp me…_ → **Confirm booking** →
   _Manage my booking_: change to 20:00 (or 4 guests), untick an opt-in, see it saved.
3. Dashboard → **Bookings** → next day: the booking with its table. **Change table**, then back on the phone the
   manage page still shows the right time.
4. **Floor** → a vacant table → type the same mobile number → the guest card appears (first visit, allergies if
   set) → Seat party. Later visits show _Visit 2_, the usual order and spend.
5. Book a table for 15 minutes from now (Bookings → New booking). Within 30 s it turns _Reserved_. Seat a walk-in
   there from the drawer → _Reserved table taken_ alert. Leave another booking unseated → after 15 min it is a
   no-show and the table is free again.
6. **Guests** (managers): search, open Asha's profile, add an allergy, **Export data** (JSON download), **Erase
   personal data** → the profile shows _Data erased_, the booking is cancelled, lookups no longer find the number.

Automated: phone normalisation, local-time helpers, table picking (incl. joins, sections, online-only tables) and
slots, a 50-run property test that never double-books; integration tests for recognition + visit stats, export/
erase/retention, the concurrent booking race, manage link (forged token, reschedule, consent history, cancel),
booking closed, front-desk book/check-in, holds/walk-in alert/no-shows.

## M9 — WhatsApp, waitlist & wait times, door camera (done 2026-11-05)

- **Guest messages**: booking confirmed, booking changed and a reminder (default 2 h before; only for bookings made
  earlier than that), "you're in line" and "table ready". Sent through **WhatsApp Cloud API** once Meta credentials
  are set; until then the **console channel** logs each message and the dashboard shows "logged only — WhatsApp not
  connected yet". Messages are written in the same transaction as the booking/queue change and sent by a
  dispatcher (one per purpose, retried with backoff, permanent errors fail without retry). Nothing goes to a guest
  who didn't opt in to WhatsApp; replying **STOP** withdraws the consent. Delivery ticks (sent → delivered → read)
  come from Meta's signed webhook. Templates to register: `docs/whatsapp-templates.md`.
- **Digital waitlist**: door QR (Waitlist page → _Door QR_) → `/w/{outlet}`: current wait, name, mobile, party size,
  opt-ins → a live status page (place in line + ETA range, refreshes itself). Host **Waitlist** page: queue with
  waiting time, ETA, suggested free table (★), message status; **Table ready** holds the table (Reserved) and
  messages the guest — their page turns green with the table number and a countdown; **Seat** seats them through the
  state machine (source _Waitlist_, guest linked); **Remove**; walk-ins without a phone can be added by the host.
  Holds that run out are released automatically.
- **Wait-time prediction**: each table's expected free time from its stage (seated/ordered/served/bill/paid/
  cleaning) and this outlet's median dwell over the last 4 weeks, then the queue is played forward; shown as ranges
  ("15–25 min"); the quoted wait is stored for accuracy analytics (M12).
- **Party size at the door (camera)**: draw an _Entrance_ zone on the entrance camera (Cameras → Calibrate). People
  first seen in the doorway within 2 s of each other form a party → the host sees "Party of ~3 just came in · free
  now: T6". On synthetic footage (4 seeds): 91 % of parties detected, exact size 65 % (mean error ±0.5 person), no
  false arrivals — a hint for the host, never an automatic action. Real footage will tell the true numbers.

Demo:

1. Settings → **Waitlist**: tick _Guests can join the waitlist by QR_ → Save. Waitlist page → _Door QR_ → open the
   link on a phone.
2. Phone: 3 guests, name, mobile, tick _WhatsApp me when my table is ready_ → **Join the waitlist** → place 1, ETA.
   The API log shows `WhatsApp(console) → … [ds_waitlist_joined/en] Hi …, you're number 1 …`.
3. Dashboard → **Waitlist**: the party with ★ suggested table → **Table ready**: the table turns _Reserved_ on the
   floor, the phone turns green ("Your table is ready! Table T13 · come within 10 min"), the console logs
   `ds_table_ready`. **Seat** → the table is _Occupied_ and the floor drawer shows the guest.
4. Seat parties on every table, join again from the phone: the ETA becomes a real range (e.g. 35–55 min).
5. Bookings: make a booking with WhatsApp ticked → the booking row shows _Confirmation: logged only…_; change its
   time from the manage link → _Change_.
6. Door camera: `uv run ds-vision synth --out samples` then `uv run ds-vision eval --detector synthetic --video
samples/dining-room.mp4 --labels samples/dining-room.labels.csv --zones samples/dining-room.zones.json --arrivals
samples/dining-room.arrivals.csv` prints the door line; live, add an Entrance zone in Cameras → Calibrate and run
   `ds-vision run --dev --detector synthetic` — arrivals appear at the top of the Waitlist page.

Automated: wait-time prediction (stages, joins, no head-of-line blocking, ranges); integration tests for consent-
gated confirmations, dispatch, dedupe, reminders, Meta webhook (verify token, forged signature, status order, STOP),
the WhatsApp Cloud API request shape and permanent failures against a mock, the waitlist (QR join, duplicate phone,
ETA in a full room, table ready → hold + message, seat, leave, remove, hold expiry), door arrivals with table
suggestions; pytest for the arrival grouper, the `party.arrived` contract and synthetic door footage.
