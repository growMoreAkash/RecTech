import { describe, expect, it } from 'vitest';
import { addLine, draftTotal, setQuantity, toOrderItems } from './order-draft';
import { sortTasks, taskAction } from './task-actions';
import type { Task } from './types';

describe('order draft', () => {
  const dal = { menuItemId: 'dal', modifierIds: ['full', 'butter'], quantity: 1, unitPricePaise: 32_000 };

  it('merges identical lines regardless of option order and caps quantity', () => {
    let lines = addLine([], dal);
    lines = addLine(lines, { ...dal, modifierIds: ['butter', 'full'], quantity: 2 });
    expect(lines).toEqual([{ ...dal, quantity: 3 }]);
    lines = addLine(lines, { ...dal, note: 'no onion' });
    expect(lines).toHaveLength(2);
    expect(setQuantity(lines, 0, 99)[0]!.quantity).toBe(50);
  });

  it('removes at zero, totals and builds the API payload without prices', () => {
    const lines = addLine(addLine([], dal), {
      menuItemId: 'lassi',
      modifierIds: [],
      quantity: 2,
      unitPricePaise: 12_000,
    });
    expect(draftTotal(lines)).toBe(56_000);
    expect(setQuantity(lines, 0, 0)).toHaveLength(1);
    expect(toOrderItems(lines)).toEqual([
      { menuItemId: 'dal', modifierIds: ['full', 'butter'], quantity: 1 },
      { menuItemId: 'lassi', modifierIds: [], quantity: 2 },
    ]);
  });
});

describe('task actions', () => {
  it('maps each task type to how it is finished', () => {
    expect(taskAction('WATER')).toBe('done');
    expect(taskAction('GREET')).toBe('greet');
    expect(taskAction('CLEAN')).toBe('clean');
    expect(taskAction('SERVE')).toBe('openTable');
    expect(taskAction('FIRE_COURSE')).toBe('fire');
    expect(taskAction('CHECK_TABLE')).toBe('done');
  });

  it('puts waiting guests first, then oldest first', () => {
    const t = (type: Task['type'], createdAt: string) => ({ id: type + createdAt, type, createdAt }) as Task;
    const sorted = sortTasks([
      t('WATER', '2026-11-05T10:00:00Z'),
      t('GREET', '2026-11-05T10:05:00Z'),
      t('WATER', '2026-11-05T09:00:00Z'),
    ]);
    expect(sorted.map((x) => x.id)).toEqual([
      'GREET2026-11-05T10:05:00Z',
      'WATER2026-11-05T09:00:00Z',
      'WATER2026-11-05T10:00:00Z',
    ]);
  });
});
