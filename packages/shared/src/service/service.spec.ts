import { describe, expect, it } from 'vitest';
import {
  decideService,
  midMealCheckDue,
  orderEta,
  predictPrepSeconds,
  prepAccuracy,
  prepStats,
  type ServiceConfig,
  type ServiceFacts,
  shouldHoldMains,
  tipForPct,
} from '../index';

const t0 = new Date('2026-11-06T13:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const cfg: ServiceConfig = {
  idleNudgeMinutes: 15,
  idleAlertMinutes: 25,
  pacingEnabled: true,
  fireMainsAfterMinutes: 8,
  autoFireMinutes: 20,
  dessertOfferMinutes: 15,
};
const facts = (over: Partial<ServiceFacts> = {}): ServiceFacts => ({
  status: 'GREETED',
  seatedAt: t0,
  greetedAt: at(2),
  lastStaffTouchAt: null,
  idleNudgedAt: null,
  idleAlertedAt: null,
  fireMainsPromptAt: null,
  dessertOfferAt: null,
  items: [],
  ...over,
});

describe('idle table', () => {
  it('nudges after the nudge time, alerts after the alert time, counted from the last touch', () => {
    expect(decideService(facts(), cfg, at(16)).nudge).toBe(false);
    expect(decideService(facts(), cfg, at(17)).nudge).toBe(true);
    expect(decideService(facts(), cfg, at(17)).idleAlert).toBe(false);
    const d = decideService(facts({ idleNudgedAt: at(17) }), cfg, at(27));
    expect(d).toMatchObject({ nudge: false, idleAlert: true, idleMinutes: 25 });
  });

  it('a staff touch starts a new episode', () => {
    const f = facts({ idleNudgedAt: at(17), idleAlertedAt: at(27), lastStaffTouchAt: at(30) });
    expect(decideService(f, cfg, at(40)).nudge).toBe(false);
    expect(decideService(f, cfg, at(45)).nudge).toBe(true);
    expect(decideService(f, cfg, at(55)).idleAlert).toBe(true);
  });

  it('ignores tables before the greet and after the bill request, and can be switched off', () => {
    expect(decideService(facts({ status: 'OCCUPIED' }), cfg, at(60)).nudge).toBe(false);
    expect(decideService(facts({ status: 'BILL_REQUESTED' }), cfg, at(60)).idleAlert).toBe(false);
    const off = { ...cfg, idleNudgeMinutes: 0, idleAlertMinutes: 0 };
    expect(decideService(facts(), off, at(60))).toMatchObject({ nudge: false, idleAlert: false });
  });
});

describe('course pacing', () => {
  const starter = (status: 'QUEUED' | 'SERVED', servedAt: Date | null = null) =>
    ({ course: 'STARTER', status, servedAt }) as const;
  const heldMain = { course: 'MAIN', status: 'HELD', servedAt: null } as const;

  it('holds mains while a starter is still to come', () => {
    expect(shouldHoldMains([starter('QUEUED')])).toBe(true);
    expect(shouldHoldMains([starter('SERVED', at(5))])).toBe(false);
    expect(shouldHoldMains([{ course: 'MAIN', status: 'QUEUED' }])).toBe(false);
  });

  it('prompts once after the starters are served, then fires anyway', () => {
    const f = facts({ status: 'SERVED', items: [starter('SERVED', at(10)), heldMain] });
    expect(decideService(f, cfg, at(17)).firePrompt).toBe(false);
    expect(decideService(f, cfg, at(18)).firePrompt).toBe(true);
    expect(decideService({ ...f, fireMainsPromptAt: at(18) }, cfg, at(25)).firePrompt).toBe(false);
    expect(decideService({ ...f, fireMainsPromptAt: at(18) }, cfg, at(30))).toMatchObject({
      autoFire: true,
      firePrompt: false,
    });
    expect(decideService(f, { ...cfg, autoFireMinutes: 0 }, at(90)).autoFire).toBe(false);
  });

  it('waits while starters cook and fires at once if the starters were voided', () => {
    expect(decideService(facts({ items: [starter('QUEUED'), heldMain] }), cfg, at(90))).toMatchObject({
      firePrompt: false,
      autoFire: false,
    });
    const voided = { course: 'STARTER', status: 'VOID', servedAt: null } as const;
    expect(decideService(facts({ items: [voided, heldMain] }), cfg, at(1)).autoFire).toBe(true);
    const off = { ...cfg, pacingEnabled: false };
    expect(decideService(facts({ items: [starter('QUEUED'), heldMain] }), off, at(1)).autoFire).toBe(true);
  });
});

describe('dessert offer', () => {
  const main = (servedAt: Date | null) =>
    ({ course: 'MAIN', status: servedAt ? 'SERVED' : 'COOKING', servedAt }) as const;
  it('offers once all mains have been served for a while and nothing sweet is ordered', () => {
    const f = facts({ status: 'SERVED', items: [main(at(30)), main(at(32))] });
    expect(decideService(f, cfg, at(46)).offerDessert).toBe(false);
    expect(decideService(f, cfg, at(47)).offerDessert).toBe(true);
    expect(decideService({ ...f, dessertOfferAt: at(47) }, cfg, at(60)).offerDessert).toBe(false);
    const sweet = { course: 'DESSERT', status: 'QUEUED', servedAt: null } as const;
    expect(decideService({ ...f, items: [...f.items, sweet] }, cfg, at(60)).offerDessert).toBe(false);
    expect(decideService({ ...f, status: 'BILL_REQUESTED' }, cfg, at(60)).offerDessert).toBe(false);
    expect(decideService({ ...f, items: [main(at(30)), main(null)] }, cfg, at(60)).offerDessert).toBe(false);
  });
});

describe('mid-meal check-in', () => {
  it('is due a while after the first item is served, once', () => {
    expect(midMealCheckDue(null, 12, false, at(60))).toBe(false);
    expect(midMealCheckDue(at(10), 12, false, at(21))).toBe(false);
    expect(midMealCheckDue(at(10), 12, false, at(22))).toBe(true);
    expect(midMealCheckDue(at(10), 12, true, at(22))).toBe(false);
    expect(midMealCheckDue(at(10), 0, false, at(90))).toBe(false);
  });
});

describe('prep time', () => {
  const samples = (menuItemId: string, stationId: string, mins: number[]) =>
    mins.map((m) => ({ menuItemId, stationId, seconds: m * 60 }));

  it('uses the dish median with enough samples, else the station, else the default', () => {
    const stats = prepStats([
      ...samples('paneer', 'tandoor', [10, 12, 14, 11, 13]),
      ...samples('naan', 'tandoor', [4, 5]),
    ]);
    expect(predictPrepSeconds({ menuItemId: 'paneer', stationId: 'tandoor' }, stats, 0)).toBe(12 * 60);
    // naan has 2 samples → station median over all 7 tandoor samples (11 min)
    expect(predictPrepSeconds({ menuItemId: 'naan', stationId: 'tandoor' }, stats, 0)).toBe(11 * 60);
    expect(predictPrepSeconds({ menuItemId: 'x', stationId: 'bar' }, stats, 0)).toBe(15 * 60);
  });

  it('stretches with the station queue, capped', () => {
    const stats = prepStats(samples('a', 's', [10, 10, 10, 10, 10]));
    expect(predictPrepSeconds({ menuItemId: 'a', stationId: 's' }, stats, 10)).toBe(15 * 60);
    expect(predictPrepSeconds({ menuItemId: 'a', stationId: 's' }, stats, 500)).toBe(20 * 60);
  });

  it('order ETA is the latest cooking item, never in the past; held items have none', () => {
    const items = [
      { status: 'QUEUED', queuedAt: t0, etaReadyAt: at(12) },
      { status: 'COOKING', queuedAt: t0, etaReadyAt: at(9) },
      { status: 'READY', queuedAt: t0, etaReadyAt: at(30) },
      { status: 'HELD', queuedAt: t0, etaReadyAt: null },
    ];
    expect(orderEta(items, at(1))).toEqual(at(12));
    expect(orderEta(items, at(20))).toEqual(at(21));
    expect(orderEta([items[3]!], at(1))).toBeNull();
  });

  it('measures accuracy', () => {
    const r = prepAccuracy([
      { queuedAt: t0, etaReadyAt: at(10), readyAt: at(12) },
      { queuedAt: t0, etaReadyAt: at(10), readyAt: at(20) },
      { queuedAt: t0, etaReadyAt: null, readyAt: at(5) },
    ]);
    expect(r).toEqual({ items: 2, meanAbsErrorSeconds: 360, within5MinPct: 50 });
  });
});

describe('tips', () => {
  it('rounds percentage tips to whole rupees', () => {
    expect(tipForPct(123_456, 10)).toBe(12_300);
    expect(tipForPct(100_000, 0)).toBe(0);
  });
});
