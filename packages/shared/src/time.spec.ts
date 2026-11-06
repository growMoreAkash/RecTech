import { describe, expect, it } from 'vitest';
import { localDate, localDayRange } from './time';

describe('time', () => {
  it('maps instants to IST calendar days', () => {
    expect(localDate(new Date('2026-11-05T18:29:59Z'))).toBe('2026-11-05');
    expect(localDate(new Date('2026-11-05T18:30:00Z'))).toBe('2026-11-06');
  });

  it('gives the UTC bounds of an IST day', () => {
    const { start, end } = localDayRange('2026-11-05');
    expect(start.toISOString()).toBe('2026-11-04T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-11-05T18:30:00.000Z');
  });

  it('handles DST zones', () => {
    const { start, end } = localDayRange('2026-03-08', 'America/New_York'); // 23-hour day
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });
});
