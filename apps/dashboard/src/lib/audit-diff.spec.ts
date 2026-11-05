import { describe, expect, it } from 'vitest';
import { diffSnapshots, show } from './audit-diff';

describe('audit diff', () => {
  it('lists only changed fields, ignoring timestamps', () => {
    expect(
      diffSnapshots(
        { greetSlaSeconds: 300, mode: 'ROUND_ROBIN', updatedAt: 'a', same: [1] },
        { greetSlaSeconds: 240, mode: 'ROUND_ROBIN', updatedAt: 'b', same: [1], added: true },
      ),
    ).toEqual([
      { key: 'added', before: undefined, after: true },
      { key: 'greetSlaSeconds', before: 300, after: 240 },
    ]);
  });

  it('handles create (no before) and scalar snapshots', () => {
    expect(diffSnapshots(null, { a: 1 })).toEqual([{ key: 'a', before: undefined, after: 1 }]);
    expect(diffSnapshots(null, null)).toEqual([]);
    expect(show(undefined)).toBe('—');
    expect(show({ x: 1 })).toBe('{"x":1}');
  });
});
