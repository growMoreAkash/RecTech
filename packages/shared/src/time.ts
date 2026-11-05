/** Time helpers. Storage is UTC; outlet-local calendar days default to Asia/Kolkata. */

export const DEFAULT_TZ = 'Asia/Kolkata';

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(at: Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Offset (ms) of `timeZone` from UTC at instant `at`. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** [start, end) instants of a local calendar day (YYYY-MM-DD) in `timeZone`. */
export function localDayRange(date: string, timeZone = DEFAULT_TZ): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid date ${date}`);
  const midnightUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = new Date(midnightUtc - offsetMs(new Date(midnightUtc), timeZone));
  const nextUtc = midnightUtc + 86_400_000;
  const end = new Date(nextUtc - offsetMs(new Date(nextUtc), timeZone));
  return { start, end };
}
