import { floorPlanSchema } from '@dinesense/shared';
import { describe, expect, it } from 'vitest';
import { type DraftTable, newTable, nextLabel, removeTable, toggleJoin, toPlan } from './editor';

const base = (key: string, label: string): DraftTable => ({
  key,
  label,
  sectionId: 's1',
  capacity: 4,
  minCapacity: 2,
  shape: 'RECT',
  x: 0,
  y: 0,
  w: 80,
  h: 80,
  rotation: 0,
  joinableWith: [],
});

describe('floor editor helpers', () => {
  it('picks the next free label', () => {
    expect(nextLabel([{ label: 'T1' }, { label: 'T7' }, { label: 'Bar' }])).toBe('T8');
    expect(nextLabel([])).toBe('T1');
  });

  it('joins symmetrically and unjoins both sides', () => {
    let t = [base('a', 'T1'), base('b', 'T2')];
    t = toggleJoin(t, 'a', 'b');
    expect(t.map((x) => x.joinableWith)).toEqual([['b'], ['a']]);
    t = toggleJoin(t, 'b', 'a');
    expect(t.map((x) => x.joinableWith)).toEqual([[], []]);
  });

  it('drops join references when a table is removed', () => {
    const t = removeTable(toggleJoin([base('a', 'T1'), base('b', 'T2')], 'a', 'b'), 'b');
    expect(t).toEqual([base('a', 'T1')]);
  });

  it('produces a plan the API schema accepts, new tables without ids', () => {
    const tables = [base('existing-id', 'T1')];
    tables.push(newTable(tables, 's1', { x: 103, y: 47 }));
    const plan = toPlan(toggleJoin(tables, 'existing-id', tables[1]!.key));
    expect(plan.tables[1]).toMatchObject({ id: undefined, label: 'T2', x: 100, y: 50 });
    expect(floorPlanSchema.safeParse(plan).success).toBe(true);
  });
});
