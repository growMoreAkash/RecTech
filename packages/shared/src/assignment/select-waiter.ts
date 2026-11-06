import type { AssignmentMode } from '../enums';

/**
 * Picks the waiter for an un-greeted table (docs/PLAN.md §5). Pure and deterministic.
 *
 * Eligible = checked in, not checked out, not on break, below their table limit.
 * Pool     = eligible waiters covering the table's section; if none, every eligible waiter (outlet-wide fallback).
 *            Waiters already tried for this seating are skipped unless nobody else is left.
 * Mode     = ROUND_ROBIN: next after the section's cursor in check-in order (wrapping);
 *            LEAST_LOADED: fewest active tables, ties broken round-robin;
 *            FIXED_SECTION: waiters whose *primary* section (first listed) is the table's, then round-robin.
 */
export interface WaiterCandidate {
  userId: string;
  /** Per-outlet check-in order: the stable round-robin order. */
  checkInSeq: number;
  /** Empty = covers every section. */
  sectionIds: readonly string[];
  activeTables: number;
  maxTables: number;
  onBreak: boolean;
}

export interface SelectInput {
  candidates: readonly WaiterCandidate[];
  mode: AssignmentMode;
  sectionId: string;
  /** Last check-in sequence picked, per cursor key (section id or "*"). */
  cursors: Readonly<Record<string, number | undefined>>;
  /** Waiters already tried for this seating. */
  exclude?: ReadonlySet<string>;
}

export type SelectResult =
  | { ok: true; userId: string; cursorKey: string; checkInSeq: number; fallback: boolean; retried: boolean }
  | { ok: false; reason: 'NO_ELIGIBLE_WAITER' };

export const OUTLET_CURSOR = '*';

const covers = (c: WaiterCandidate, sectionId: string) =>
  c.sectionIds.length === 0 || c.sectionIds.includes(sectionId);

export function selectWaiter(input: SelectInput): SelectResult {
  const eligible = input.candidates.filter((c) => !c.onBreak && c.activeTables < c.maxTables);
  const attempt = (exclude: ReadonlySet<string>): SelectResult | null => {
    const fresh = eligible.filter((c) => !exclude.has(c.userId));
    const inSection = fresh.filter((c) => covers(c, input.sectionId));
    const fallback = inSection.length === 0;
    let pool = fallback ? fresh : inSection;
    if (!pool.length) return null;
    const cursorKey = fallback ? OUTLET_CURSOR : input.sectionId;

    if (input.mode === 'FIXED_SECTION' && !fallback) {
      const primary = pool.filter((c) => c.sectionIds[0] === input.sectionId);
      if (primary.length) pool = primary;
    }
    if (input.mode === 'LEAST_LOADED') {
      const min = Math.min(...pool.map((c) => c.activeTables));
      pool = pool.filter((c) => c.activeTables === min);
    }
    const ordered = [...pool].sort((a, b) => a.checkInSeq - b.checkInSeq || a.userId.localeCompare(b.userId));
    const last = input.cursors[cursorKey] ?? 0;
    const pick = ordered.find((c) => c.checkInSeq > last) ?? ordered[0]!;
    return {
      ok: true,
      userId: pick.userId,
      cursorKey,
      checkInSeq: pick.checkInSeq,
      fallback,
      retried: false,
    };
  };

  const exclude = input.exclude ?? new Set<string>();
  const first = attempt(exclude);
  if (first) return first;
  // Everyone has been tried: go round again rather than leave the table alone.
  if (exclude.size) {
    const again = attempt(new Set());
    if (again && again.ok) return { ...again, retried: true };
  }
  return { ok: false, reason: 'NO_ELIGIBLE_WAITER' };
}
