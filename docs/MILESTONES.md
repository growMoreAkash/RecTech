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

Seed logins: `owner|manager|host|cashier@demo.dinesense.in` / `dinesense123`. Staff terminal header
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
