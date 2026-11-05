import { formatInr } from '@dinesense/shared';

/** INR amount from paise, e.g. 34000 → ₹340.00, with tabular figures. */
export function Money({ paise, className }: { paise: number; className?: string }) {
  return <span className={`tabular-nums ${className ?? ''}`}>{formatInr(paise)}</span>;
}
