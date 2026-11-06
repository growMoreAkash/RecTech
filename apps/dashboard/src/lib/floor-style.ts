import type { TableStatus } from '@dinesense/shared';

/**
 * Visual language for table states. Colour is never the only signal: the map also prints a status
 * icon letter and the drawer prints the status name (accessibility).
 */
export const STATUS_STYLE: Record<
  TableStatus,
  { fill: string; stroke: string; text: string; glyph: string }
> = {
  VACANT: { fill: '#f1f5f9', stroke: '#94a3b8', text: '#0f172a', glyph: '○' },
  RESERVED: { fill: '#ede9fe', stroke: '#7c3aed', text: '#2e1065', glyph: 'R' },
  OCCUPIED: { fill: '#dbeafe', stroke: '#2563eb', text: '#172554', glyph: '●' },
  GREETED: { fill: '#cffafe', stroke: '#0891b2', text: '#083344', glyph: '✓' },
  ORDERED: { fill: '#fef9c3', stroke: '#ca8a04', text: '#422006', glyph: '≡' },
  SERVED: { fill: '#dcfce7', stroke: '#16a34a', text: '#052e16', glyph: '◆' },
  BILL_REQUESTED: { fill: '#ffedd5', stroke: '#ea580c', text: '#431407', glyph: '₹' },
  PAID: { fill: '#d1fae5', stroke: '#059669', text: '#022c22', glyph: '✔' },
  NEEDS_CLEANING: { fill: '#fee2e2', stroke: '#b91c1c', text: '#450a0a', glyph: '!' },
  OUT_OF_SERVICE: { fill: '#e5e7eb', stroke: '#4b5563', text: '#111827', glyph: '×' },
};

export type SlaLevel = 'none' | 'ok' | 'warn' | 'breach';

/**
 * Greet SLA level for a table: only while seated and not yet greeted.
 * Amber at 60% of the SLA (3 of 5 minutes, per the brief), red once the SLA has passed.
 */
/** Seconds since `iso`, never negative (server and browser clocks drift slightly). */
export function elapsedSince(iso: string, now: number): number {
  return Math.max(0, (now - Date.parse(iso)) / 1000);
}

export function slaLevel(
  status: TableStatus,
  seatedAt: string | null,
  greetedAt: string | null,
  slaSeconds: number,
  now: number,
): SlaLevel {
  if (status !== 'OCCUPIED' || !seatedAt || greetedAt) return 'none';
  const elapsed = elapsedSince(seatedAt, now);
  if (elapsed >= slaSeconds) return 'breach';
  if (elapsed >= slaSeconds * 0.6) return 'warn';
  return 'ok';
}

/** Seconds left until the greet SLA (negative once breached). */
export function slaRemaining(seatedAt: string, slaSeconds: number, now: number): number {
  return Math.round(slaSeconds - elapsedSince(seatedAt, now));
}

/** 75 → "1:15", -5 → "-0:05", 3725 → "1:02:05". */
export function formatDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const s = Math.abs(Math.trunc(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${sign}${h}:${String(m).padStart(2, '0')}:${sec}` : `${sign}${m}:${sec}`;
}

export const SLA_COLORS: Record<Exclude<SlaLevel, 'none'>, string> = {
  ok: '#2563eb',
  warn: '#d97706',
  breach: '#dc2626',
};

/** Initials for a waiter avatar: "Anil Sharma" → "AS". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
