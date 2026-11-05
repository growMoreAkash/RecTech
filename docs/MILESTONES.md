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
