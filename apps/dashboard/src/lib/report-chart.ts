/** Fills the hour gaps between the first and last trading hour so the bars sit on a true time axis. */
export function hourSeries(
  rows: { hour: number; bills: number; totalPaise: number }[],
): { hour: number; bills: number; totalPaise: number }[] {
  if (!rows.length) return [];
  const by = new Map(rows.map((r) => [r.hour, r]));
  const lo = Math.min(...rows.map((r) => r.hour));
  const hi = Math.max(...rows.map((r) => r.hour));
  return Array.from(
    { length: hi - lo + 1 },
    (_, i) => by.get(lo + i) ?? { hour: lo + i, bills: 0, totalPaise: 0 },
  );
}

/** "1:05" (m:ss) for seat-to-greet style durations; "—" when unknown. */
export function minSec(seconds: number | null): string {
  if (seconds === null) return '—';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
