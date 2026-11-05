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
