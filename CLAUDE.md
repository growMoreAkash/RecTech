# CLAUDE.md — DineSense

AI restaurant floor & guest-journey platform. Product brief: `docs/PRD.md`. Engineering plan: `docs/PLAN.md`.

## Current status

- **Phase:** planning. `docs/PLAN.md` is a draft awaiting owner approval. Do not write application code until it is
  approved.
- **Next milestone:** M0 (tooling skeleton), then M1.

## How we work

1. Plan first; get approval before writing code for a new milestone or changing the stack.
2. One milestone at a time. After each: `pnpm lint && pnpm typecheck && pnpm test` (and `pytest` in Python
   services) must pass; then update this file and write a short demo script in the PR.
3. Ask before adding any paid service or new infrastructure. Every secret goes in `.env.example` with a comment.
4. Do not build Phase 3–4 features; leave extension points (see PLAN §11).

## Architecture (short)

- `apps/api` (NestJS + Prisma + BullMQ + Socket.IO) is the **only** component that changes table state.
- Apps talk REST to the API and receive live updates over Socket.IO. The edge vision service only sends events.
- Table state machine: pure reducer in `packages/shared/src/table-machine`; side effects in `TableStateService`.
- Greet SLA: BullMQ delayed jobs + a 30 s reconciler; job handlers always re-check the DB.
- Video never leaves the restaurant. No face recognition. No video storage.

## Conventions

- TypeScript strict everywhere; zod for every input (shared schemas in `packages/shared`).
- Multi-tenant: every tenant row carries `organizationId` (+ `outletId`); never query tenant data without scope.
- RBAC: every route has `@Roles(...)` or `@Public()`; default deny.
- Money in **paise** (`Int`), tax rates in **basis points**. Never use floats for money.
- Times stored UTC (`timestamptz`), displayed in `Asia/Kolkata`.
- UI strings only via i18n catalogs (`packages/i18n`: `en`, `hi`). No hard-coded user-facing text.
- Error shape: `{ error: { code, message, details?, requestId } }`.
- BullMQ custom job ids use `_` separators (`:` is not allowed).
- Tests: Vitest (TS), pytest (Python), Playwright (e2e), testcontainers for DB/Redis integration.
- Commits: conventional commits (`feat(api): …`, `fix(vision): …`).

## Commands (planned — become real in M0)

```bash
pnpm i                    # install
pnpm dev                  # all apps via turbo
pnpm lint | typecheck | test | build
pnpm --filter api prisma migrate dev
pnpm --filter api seed
docker compose -f infra/docker-compose.yml up -d postgres redis
cd services/vision && uv run ds-vision run --dev   # sample MP4s as cameras
pnpm e2e                  # Playwright
```

## Decisions log

| Date | Decision | Status |
|---|---|---|
| 2026-11-05 | Stack as in brief (pnpm/Turborepo, NestJS/Prisma/Postgres, Redis/BullMQ, Socket.IO, Next.js, Python vision) | Accepted (brief) |
| 2026-11-05 | D1 Apache-2.0 detector (RT-DETR/D-FINE or YOLOX), not Ultralytics AGPL | Proposed |
| 2026-11-05 | D2 Aspect-ratio posture first, RTMPose behind flag | Proposed |
| 2026-11-05 | D3 HTTPS + HMAC + SQLite outbox for edge events; MQTT deferred | Proposed |
| 2026-11-05 | D4 VAPID Web Push first; FCM with Expo app later | Proposed |
| 2026-11-05 | D5 Own auth: password for managers, device-bound PIN for floor staff | Proposed |
| 2026-11-05 | D6 `SeatingTable` join model for joined tables | Proposed |
| 2026-11-05 | D7 Paise + basis points for money/tax | Proposed |
| 2026-11-05 | D8 Node 22, NestJS 11, Prisma 6, Next 15, React 19, Tailwind 4, Vitest | Proposed |
| 2026-11-05 | D9 next-intl, shared catalogs in `packages/i18n` | Proposed |
| 2026-11-05 | D10 KDS as a route group inside `apps/dashboard` | Proposed |
| 2026-11-05 | State machine reducer moved from M5 into M2; added M0 for tooling | Proposed |
