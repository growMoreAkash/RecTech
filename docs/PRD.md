# DineSense — Product Requirements (source brief)

> Source: "Smart Restaurant System — Features & Claude Code Build Prompt", Nov 5, 2026 · @Akasuya.
> This file is the product brief. The engineering plan lives in [`PLAN.md`](./PLAN.md).

## Overview

DineSense turns every table into a live, camera-tracked state and drives staff, kitchen and billing from those
states, so no guest waits unnoticed from the door to the exit.

Five surfaces share one backend:

- **Manager dashboard** (browser): live floor map, camera feeds, alerts, analytics, settings.
- **Vision engine** (edge PC at the restaurant): reads IP cameras, detects table occupancy and events, sends only
  events (not video) to the cloud.
- **Guest web app** (QR on table, no install): menu, order, call waiter, bill, pay, feedback.
- **Staff app** (waiter / host / busser): task queue, table assignments, order taking, push alerts.
- **Kitchen display (KDS)**: tickets by station, prep timers, ready alerts.

Customer journey (9 stages): Discover & book → Arrive & wait → Seat → First contact (5-min SLA) → Order →
Kitchen & serve → Dine → Bill & pay → Exit, clean & follow-up.

Phase tags: **P1** core ops without cameras · **P2** vision + 5-min SLA + round robin + payments ·
**P3** guest growth, CRM, analytics · **P4** advanced AI.

## Feature list

### 1. Discover & book

| Feature                           | What it does                                                                    | Phase |
| --------------------------------- | ------------------------------------------------------------------------------- | ----- |
| Online table booking              | Date, time, party size, seating preference; link for website, Google, Instagram | P3    |
| WhatsApp confirmation & reminders | Confirm, remind 2 h before, one-tap cancel or reschedule                        | P3    |
| AI voice reservation agent (Vapi) | Answers calls, books or changes tables, adds to waitlist, logs to CRM           | P4    |
| Pre-order for bookings            | Groups order ahead so food lands soon after seating                             | P4    |
| No-show prediction                | Flags risky bookings; suggests deposit or controlled overbooking                | P4    |

### 2. Arrive & wait

| Feature                     | What it does                                                                     | Phase |
| --------------------------- | -------------------------------------------------------------------------------- | ----- |
| Host stand app              | Check in booking or walk-in, party size, notes (kids, wheelchair, occasion)      | P1    |
| Smart table allocation      | Best-fit table by party size, section load, waiter load; suggests joining tables | P2    |
| Entrance people counter     | Door camera counts in/out; live headcount on dashboard                           | P2    |
| Party-size estimate         | Groups people arriving together and suggests table size to host                  | P3    |
| Digital waitlist            | Guest joins queue by QR at door; WhatsApp ping when table is ready               | P3    |
| Wait-time prediction        | ETA from live dwell times of currently seated tables                             | P3    |
| Returning-guest recognition | By phone number at check-in; shows favourites and last visit to staff            | P3    |

### 3. Seat

| Feature                        | What it does                                                                    | Phase |
| ------------------------------ | ------------------------------------------------------------------------------- | ----- |
| Live table occupancy           | Camera marks a table Occupied when people stay seated in its zone for N seconds | P2    |
| Seated timestamp & guest count | Recorded per seating; starts all journey timers                                 | P2    |
| Manual override                | Host or waiter sets any table state when the camera is unsure or offline        | P1    |
| Reserved-table hold            | Blocks a table before a booking; alerts if a walk-in sits there                 | P3    |

### 4. First contact — the 5-minute rule

| Feature                     | What it does                                                                                               | Phase |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ----- |
| Seated-to-greet timer       | Starts at the seat event; countdown shown on the floor map                                                 | P2    |
| Greet detection             | Waiter taps "At table" or scans the table's staff QR; camera staff-presence as a second signal             | P2    |
| Round-robin auto-assignment | No greet in 5 min → assign next on-shift waiter in that section, skipping anyone at max tables or on break | P2    |
| Escalation ladder           | 5 min assign → 2 min more re-assign → 10 min manager alert (all configurable)                              | P2    |
| Assignment modes            | Round robin, least-loaded, or fixed section; per outlet and per shift                                      | P2    |

### 5. Order

| Feature                       | What it does                                                                      | Phase |
| ----------------------------- | --------------------------------------------------------------------------------- | ----- |
| QR table ordering             | Table-bound QR opens menu in browser, no install; one session per seating         | P1    |
| Shared group cart             | Several phones at one table add to one order                                      | P1    |
| Rich menu                     | Photos, veg/non-veg/egg marks, allergens, spice level, English + Hindi + regional | P1    |
| Modifiers, combos, add-ons    | Size, extra cheese, half/full, notes to kitchen                                   | P1    |
| Waiter-assisted order         | Waiter app takes the order for guests who don't scan                              | P1    |
| Order approval (optional)     | Waiter confirms QR orders before kitchen, to stop prank orders                    | P1    |
| Call waiter / water / cutlery | One tap creates a task for the assigned waiter                                    | P1    |
| AI recommendations & upsell   | Pairings, bestsellers, time-of-day and weather-based suggestions                  | P3    |
| Chat ordering assistant       | "Something spicy, veg, under ₹300" → suggested items                              | P4    |

### 6. Kitchen & serve

| Feature                | What it does                                                | Phase |
| ---------------------- | ----------------------------------------------------------- | ----- |
| Kitchen display (KDS)  | Tickets routed by station (tandoor, Chinese, bar, desserts) | P1    |
| Ticket ageing          | Colour changes with age; bump when done                     | P1    |
| Ready-to-serve alert   | Push to the table's waiter when an item is ready            | P1    |
| Out-of-stock toggle    | Marks item unavailable on every guest menu instantly        | P1    |
| Prep-time prediction   | ETA per order shown to guest and waiter                     | P3    |
| Recipe-based inventory | Deducts stock per sale; low-stock alerts                    | P3    |

### 7. Dine

| Feature                       | What it does                                                    | Phase |
| ----------------------------- | --------------------------------------------------------------- | ----- |
| Idle-table alert              | No staff visit for X min during the meal → nudge waiter         | P3    |
| Course pacing                 | Prompts waiter to fire mains or offer dessert at the right time | P3    |
| Mid-meal check-in             | "How's everything?" prompt on the guest's QR page               | P3    |
| Hand-raise detection          | Pose model spots a raised hand → "Table 7 needs attention"      | P4    |
| Empty plate / glass detection | Triggers clear-plates, refill or dessert offer                  | P4    |

### 8. Bill & pay

| Feature                 | What it does                                                    | Phase |
| ----------------------- | --------------------------------------------------------------- | ----- |
| Request bill from phone | Alerts waiter; shows running bill to guest                      | P1    |
| GST-compliant invoice   | CGST/SGST, service charge, discounts; e-bill on WhatsApp or SMS | P1    |
| Pay at table            | UPI, cards via Razorpay or Cashfree from the QR page            | P2    |
| Split bill              | Equal, by item, or custom amounts                               | P2    |
| Tips per waiter         | Tracked against the assigned waiter                             | P3    |
| Loyalty & coupons       | Points, offers, membership tiers                                | P3    |
| POS integration         | Sync with Petpooja / Posist, or run as standalone POS           | P3    |

### 9. Exit, clean & follow-up

| Feature               | What it does                                                  | Phase |
| --------------------- | ------------------------------------------------------------- | ----- |
| Departure detection   | Occupied table goes empty after payment → Needs cleaning      | P2    |
| Busser task           | Cleaning task to busser; table Vacant once confirmed          | P2    |
| Dirty-table check     | Camera spots plates left on an empty table                    | P3    |
| WhatsApp feedback     | Sent 30 min after exit; 1–5 stars + comment                   | P3    |
| Review routing        | 4–5 stars → Google review link; 1–3 stars → manager alert     | P3    |
| Guest CRM & campaigns | Visits, spend, favourites; birthday offers, win-back messages | P3    |

### Manager dashboard & admin

| Feature                    | What it does                                                                                  | Phase |
| -------------------------- | --------------------------------------------------------------------------------------------- | ----- |
| Live floor map             | Every table's state, timer, guest count and waiter, updating in real time                     | P1    |
| Alerts centre              | SLA breaches, call-waiter requests, long waits, camera offline                                | P1    |
| Floor-plan editor          | Drag tables, set capacity, sections, join rules                                               | P1    |
| Staff & shifts             | Roles, sections, check-in/out, breaks, max tables per waiter                                  | P1    |
| Menu management            | Categories, items, prices, taxes, availability windows                                        | P1    |
| Camera wall                | Live feeds with table zones and detections overlaid                                           | P2    |
| Zone calibration           | Draw a polygon for each table on a camera snapshot                                            | P2    |
| Analytics                  | Turnover, dwell per stage, greet time, SLA breaches, waiter scorecard, sales by hour and item | P3    |
| Occupancy heatmap          | Which tables and sections fill first and earn most                                            | P3    |
| Demand & staffing forecast | Covers per hour next week; suggested waiters per shift                                        | P4    |
| Multi-outlet               | One login, many branches, outlet comparison                                                   | P3    |
| Audit log                  | Who changed what, when                                                                        | P1    |

## AI, ML & computer vision

The camera's core job is narrow and reliable: decide, per table zone, whether guests are seated, and emit events.
Everything else (timers, assignment, alerts) is plain backend logic reacting to those events.

### Vision capabilities

| Capability                  | How it works                                                                                                    | Starting model / tool                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Person detection & tracking | Detect people at 2–5 FPS per camera, track IDs across frames                                                    | Object detector (YOLO-family / RT-DETR) + ByteTrack |
| Table occupancy             | Lower-body point inside a table polygon; Occupied after 30 s, Vacant after 90 s empty (debounced, configurable) | Point-in-polygon on tracked boxes                   |
| Seated vs standing          | Seated = guests; a standing person briefly at the table = likely staff                                          | Pose keypoints (hip–knee angle) or box aspect ratio |
| Staff vs guest              | Classify by uniform colour/apron; fallback to the waiter's "At table" tap                                       | Small classifier fine-tuned on staff crops          |
| Entrance counting           | Tracks crossing a virtual line at the door, in vs out                                                           | Line-crossing on tracks                             |
| Hand-raise                  | Wrist above shoulder for 2 s while seated                                                                       | Pose model keypoints                                |
| Plates, glasses, leftovers  | Detect cups, bowls, glasses; empty table with items = dirty                                                     | COCO classes first, then fine-tune                  |
| Privacy blur                | Faces blurred in any stored snapshot                                                                            | Face detector + blur                                |

### ML & AI on the data

| Capability                 | How it works                                                    | Starting approach                           |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| Wait-time prediction       | When current tables free up from party size, stage, time of day | Gradient boosting on historical dwell times |
| Prep-time prediction       | Per-order ETA from items, kitchen load, station queue           | Gradient boosting; rules until data exists  |
| Menu recommendations       | "Goes well with", popular now, personal favourites              | Item co-occurrence, then embeddings         |
| Demand & staffing forecast | Covers per hour for next 7 days; waiters needed                 | Time-series with holidays, weekday, weather |
| No-show prediction         | Probability a booking won't show                                | Logistic regression on booking history      |
| Feedback analysis          | Sentiment + topic + weekly summary                              | LLM (Claude API)                            |
| Voice reservations         | Phone bookings, waitlist, FAQs                                  | Vapi agent calling the booking API          |
| Anomaly alerts             | Unusual voids, discounts, or table times                        | Statistical thresholds                      |

## Architecture & tech stack (as briefed)

Video stays inside the restaurant: an edge box runs the vision models and sends only small events ("table T7
occupied, 3 guests") to the cloud backend, which owns all rules, timers and apps. The API is the only thing that
changes table states.

| Layer           | Choice                                                            |
| --------------- | ----------------------------------------------------------------- |
| Monorepo        | pnpm workspaces + Turborepo                                       |
| Backend API     | NestJS (TypeScript) + Prisma                                      |
| Database        | PostgreSQL                                                        |
| Timers & jobs   | Redis + BullMQ delayed jobs                                       |
| Real-time       | Socket.IO (rooms per outlet, table, role)                         |
| Dashboard + KDS | Next.js + Tailwind + shadcn/ui; floor map in react-konva          |
| Guest QR app    | Next.js PWA, mobile-first                                         |
| Staff app       | PWA with web push first; Expo app later                           |
| Vision engine   | Python 3.11, OpenCV, ONNX Runtime, supervision                    |
| Edge → cloud    | MQTT or HTTPS with signed device token; local buffer when offline |
| ML service      | Python FastAPI                                                    |
| Payments        | Razorpay (UPI, cards)                                             |
| Messaging       | WhatsApp Cloud API, FCM push, SMS fallback                        |
| Deploy          | Docker Compose on a VPS; edge box as a Docker service             |

## Roadmap

1. **P1 — Core operations.** Done when one full service runs end to end with no camera — seat, order, cook, serve,
   bill, clean.
2. **P2 — Vision + 5-minute rule.** Done when a test table goes Vacant → Occupied → Assigned → Greeted on its own,
   with occupancy accuracy above 95% on recorded footage.
3. **P3 — Guests & insight.** Done when a pilot restaurant uses it for 2 weeks and the manager reads the weekly report.
4. **P4 — Advanced AI (ongoing).**

## Build brief (engineering requirements)

The detailed engineering brief (roles, data model, state machine, SLA & round robin, QR rules, vision service,
dashboard, staff app, billing, quality bar, milestones M1–M7) is reproduced and refined in [`PLAN.md`](./PLAN.md).
Key non-negotiables:

- Plan first, build one milestone at a time; lint + type-check + tests after each, plus a demo script.
- Ask before adding any paid service or changing the stack. Every secret in `.env.example` with comments.
- Do not build Phase 3–4 now; leave clean extension points.
- Multi-tenant: every row carries `organizationId` and `outletId`. RBAC on every endpoint.
- IST, INR, GST (CGST/SGST), English + Hindi UI strings.
- Privacy (India DPDP Act 2023): no face recognition, no video storage, consent flags, data export/delete.
- Seed: 20 tables in 3 sections, 6 waiters, 2 bussers, 1 manager, 40 Indian menu items with veg marks.

## Practical notes

- The camera part succeeds or fails on mounting, lighting and a manual fallback, not on the model.
- Cameras: wired PoE IP cameras, RTSP/ONVIF, 2–4 MP, mounted high and angled down.
- Edge box: Jetson-class or mini PC with a GPU; benchmark streams at 3 FPS before scaling.
- Accuracy: record 2–3 days of real service, hand-label a sample, tune with the evaluation script. Never remove the
  manual tap.
- Greet detection: rely on "At table" tap / staff-QR first; camera staff-presence is a supporting signal.
- Model licensing: Ultralytics YOLO is AGPL-3.0 — use an Apache/MIT model or buy a licence.
- QR abuse: only allow orders with an open seating; keep waiter approval on by default.
- Pilot: run P1 + P2 in one friendly restaurant before selling.
