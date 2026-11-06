import type { Course } from '../enums';

/**
 * Service-quality rules on the floor (pure): idle tables, course pacing, dessert offers, mid-meal check-in.
 * The API loads facts for every open seating and runs `decideService` from a 30 s idempotent sweep; each prompt
 * carries its own "already done" marker, so running the sweep twice never doubles a task or alert.
 */

export type ServiceItemStatus = 'HELD' | 'QUEUED' | 'COOKING' | 'READY' | 'SERVED' | 'VOID';

export interface ServiceItem {
  course: Course;
  status: ServiceItemStatus;
  servedAt: Date | null;
}

export interface ServiceFacts {
  /** Table status of the seating's primary table. */
  status: string;
  seatedAt: Date;
  greetedAt: Date | null;
  lastStaffTouchAt: Date | null;
  idleNudgedAt: Date | null;
  idleAlertedAt: Date | null;
  fireMainsPromptAt: Date | null;
  dessertOfferAt: Date | null;
  /** Items of accepted orders. */
  items: ServiceItem[];
}

export interface ServiceConfig {
  idleNudgeMinutes: number;
  idleAlertMinutes: number;
  pacingEnabled: boolean;
  fireMainsAfterMinutes: number;
  autoFireMinutes: number;
  dessertOfferMinutes: number;
}

export interface ServiceDecision {
  /** CHECK_TABLE task for the serving waiter. */
  nudge: boolean;
  /** IDLE_TABLE alert for managers. */
  idleAlert: boolean;
  /** FIRE_COURSE task ("starters are done — fire mains?"). */
  firePrompt: boolean;
  /** Send held items to the kitchen now. */
  autoFire: boolean;
  /** OFFER_DESSERT task. */
  offerDessert: boolean;
  /** Minutes since the last staff touch (for messages). */
  idleMinutes: number;
}

/** Tables where "nobody has been here for a while" matters; earlier stages have the greet SLA, later the bill. */
export const IDLE_WATCH_STATUSES = ['GREETED', 'ORDERED', 'SERVED'] as const;

const MIN = 60_000;
const live = (items: ServiceItem[]) => items.filter((i) => i.status !== 'VOID');
const latest = (dates: (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

/** The last time someone from the staff was at (or did something for) this table. */
export function lastTouch(f: Pick<ServiceFacts, 'seatedAt' | 'greetedAt' | 'lastStaffTouchAt'>): Date {
  return latest([f.seatedAt, f.greetedAt, f.lastStaffTouchAt]) ?? f.seatedAt;
}

/**
 * Course pacing: should newly ordered mains wait? Yes while any starter of the seating (already ordered or in this
 * order) is not served yet.
 */
export function shouldHoldMains(items: Pick<ServiceItem, 'course' | 'status'>[]): boolean {
  return items.some((i) => i.course === 'STARTER' && i.status !== 'SERVED' && i.status !== 'VOID');
}

/** When the last starter went out, or null while starters are still to come (or there are none). */
export function startersDoneAt(items: ServiceItem[]): Date | null {
  const starters = live(items).filter((i) => i.course === 'STARTER');
  if (!starters.length || starters.some((i) => i.status !== 'SERVED')) return null;
  return latest(starters.map((i) => i.servedAt));
}

export function decideService(f: ServiceFacts, cfg: ServiceConfig, now: Date): ServiceDecision {
  const out: ServiceDecision = {
    nudge: false,
    idleAlert: false,
    firePrompt: false,
    autoFire: false,
    offerDessert: false,
    idleMinutes: 0,
  };
  const items = live(f.items);

  // Idle table: one nudge and one alert per idle episode (an episode ends with the next staff touch).
  if ((IDLE_WATCH_STATUSES as readonly string[]).includes(f.status)) {
    const touch = lastTouch(f);
    const idle = now.getTime() - touch.getTime();
    out.idleMinutes = Math.floor(idle / MIN);
    const fresh = (marker: Date | null) => !marker || marker < touch;
    if (cfg.idleNudgeMinutes > 0 && idle >= cfg.idleNudgeMinutes * MIN && fresh(f.idleNudgedAt))
      out.nudge = true;
    if (cfg.idleAlertMinutes > 0 && idle >= cfg.idleAlertMinutes * MIN && fresh(f.idleAlertedAt))
      out.idleAlert = true;
  }

  // Held courses: prompt to fire once starters are done, fire anyway if nobody does. Held items with no
  // starters left to wait for (e.g. starters voided) go straight to the kitchen.
  if (items.some((i) => i.status === 'HELD')) {
    const waitingOnStarters = shouldHoldMains(items);
    const done = startersDoneAt(items);
    // Pacing switched off with courses still held, or nothing left to wait for: send them now.
    if (!cfg.pacingEnabled || (!waitingOnStarters && !done)) out.autoFire = true;
    else if (done) {
      const since = now.getTime() - done.getTime();
      if (cfg.autoFireMinutes > 0 && since >= cfg.autoFireMinutes * MIN) out.autoFire = true;
      else if (
        since >= cfg.fireMainsAfterMinutes * MIN &&
        (!f.fireMainsPromptAt || f.fireMainsPromptAt < done)
      )
        out.firePrompt = true;
    }
  }

  // Dessert: every main served a while ago, nothing sweet ordered, bill not asked for yet.
  const mains = items.filter((i) => i.course === 'MAIN');
  if (
    cfg.dessertOfferMinutes > 0 &&
    !f.dessertOfferAt &&
    (f.status === 'SERVED' || f.status === 'ORDERED') &&
    mains.length &&
    mains.every((i) => i.status === 'SERVED') &&
    !items.some((i) => i.course === 'DESSERT')
  ) {
    const lastMain = latest(mains.map((i) => i.servedAt));
    if (lastMain && now.getTime() - lastMain.getTime() >= cfg.dessertOfferMinutes * MIN)
      out.offerDessert = true;
  }
  return out;
}

/** Ask "How's everything?" once the first item has been on the table for a while (QR guests, once per device). */
export function midMealCheckDue(
  firstServedAt: Date | null,
  minutes: number,
  alreadyAnswered: boolean,
  now: Date,
): boolean {
  if (!firstServedAt || minutes <= 0 || alreadyAnswered) return false;
  return now.getTime() - firstServedAt.getTime() >= minutes * MIN;
}
