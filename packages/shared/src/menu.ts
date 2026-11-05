import { gstForLine } from './money';
import { DEFAULT_TZ } from './time';

/**
 * Menu rules shared by the API (authoritative) and the apps (instant feedback).
 * Pure: no I/O, no clock unless passed in.
 */

/** Weekly window in outlet-local time. days: 1 = Monday … 7 = Sunday. `to` may be past midnight (e.g. 22:00–02:00). */
export interface AvailabilityWindow {
  days: number[];
  from: string; // "HH:MM"
  to: string; // "HH:MM"
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function localParts(at: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** True when there are no windows (always available) or `at` falls inside one of them. */
export function isWithinWindows(
  windows: AvailabilityWindow[] | null | undefined,
  at: Date,
  timeZone = DEFAULT_TZ,
): boolean {
  if (!windows?.length) return true;
  const { day, minute } = localParts(at, timeZone);
  const prevDay = day === 1 ? 7 : day - 1;
  return windows.some((w) => {
    const from = minutes(w.from);
    const to = minutes(w.to);
    if (from <= to) return w.days.includes(day) && minute >= from && minute < to;
    // Overnight window: the late part belongs to the start day, the early part to the next day.
    return (w.days.includes(day) && minute >= from) || (w.days.includes(prevDay) && minute < to);
  });
}

export interface PricedModifierGroup {
  id: string;
  minSelect: number;
  maxSelect: number;
  modifiers: { id: string; priceDeltaPaise: number; isAvailable: boolean; name: unknown }[];
}

export interface PricedItem {
  pricePaise: number;
  modifierGroups: PricedModifierGroup[];
}

export type ModifierError =
  | { code: 'UNKNOWN_MODIFIER'; modifierId: string }
  | { code: 'MODIFIER_UNAVAILABLE'; modifierId: string }
  | { code: 'TOO_FEW'; groupId: string; min: number }
  | { code: 'TOO_MANY'; groupId: string; max: number }
  | { code: 'NEGATIVE_PRICE' };

export type PriceResult =
  | {
      ok: true;
      unitPricePaise: number;
      modifiers: { id: string; groupId: string; name: unknown; priceDeltaPaise: number }[];
    }
  | { ok: false; errors: ModifierError[] };

/** Validates a modifier selection against the item's groups and returns the unit price (item + deltas). */
export function priceLine(item: PricedItem, selectedIds: readonly string[]): PriceResult {
  const errors: ModifierError[] = [];
  const unique = [...new Set(selectedIds)];
  const byId = new Map(
    item.modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, { ...m, groupId: g.id }] as const)),
  );

  const chosen = [];
  for (const id of unique) {
    const m = byId.get(id);
    if (!m) errors.push({ code: 'UNKNOWN_MODIFIER', modifierId: id });
    else if (!m.isAvailable) errors.push({ code: 'MODIFIER_UNAVAILABLE', modifierId: id });
    else chosen.push(m);
  }
  for (const g of item.modifierGroups) {
    const n = chosen.filter((m) => m.groupId === g.id).length;
    if (n < g.minSelect) errors.push({ code: 'TOO_FEW', groupId: g.id, min: g.minSelect });
    if (n > g.maxSelect) errors.push({ code: 'TOO_MANY', groupId: g.id, max: g.maxSelect });
  }
  const unitPricePaise = item.pricePaise + chosen.reduce((s, m) => s + m.priceDeltaPaise, 0);
  if (unitPricePaise < 0) errors.push({ code: 'NEGATIVE_PRICE' });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    unitPricePaise,
    modifiers: chosen.map((m) => ({
      id: m.id,
      groupId: m.groupId,
      name: m.name,
      priceDeltaPaise: m.priceDeltaPaise,
    })),
  };
}

export interface TotalLine {
  unitPricePaise: number;
  quantity: number;
  taxRateBps: number;
}

/**
 * Running total shown to guests and waiters: per-line GST (CGST = SGST), prices exclusive of tax.
 * The final GST invoice (M4) adds service charge, discounts and round-off.
 */
export function runningTotal(lines: readonly TotalLine[]) {
  let subtotalPaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  for (const l of lines) {
    const g = gstForLine(l.unitPricePaise * l.quantity, l.taxRateBps);
    subtotalPaise += g.taxableValuePaise;
    cgstPaise += g.cgstPaise;
    sgstPaise += g.sgstPaise;
  }
  return { subtotalPaise, cgstPaise, sgstPaise, totalPaise: subtotalPaise + cgstPaise + sgstPaise };
}

/** Picks the label for a locale from a `{ en, hi, … }` JSON name, falling back to English. */
export function localized(name: unknown, locale: string): string {
  if (typeof name === 'string') return name;
  const n = (name ?? {}) as Record<string, unknown>;
  const v = n[locale] ?? n.en ?? Object.values(n)[0];
  return typeof v === 'string' ? v : '';
}
