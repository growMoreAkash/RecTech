import { describe, expect, it } from 'vitest';
import { hourSeries, minSec } from './report-chart';

describe('report helpers', () => {
  it('fills hour gaps', () => {
    expect(
      hourSeries([
        { hour: 14, bills: 1, totalPaise: 5 },
        { hour: 12, bills: 2, totalPaise: 9 },
      ]).map((h) => h.hour),
    ).toEqual([12, 13, 14]);
    expect(hourSeries([])).toEqual([]);
  });
  it('formats durations', () => {
    expect(minSec(65.4)).toBe('1:05');
    expect(minSec(null)).toBe('—');
  });
});
