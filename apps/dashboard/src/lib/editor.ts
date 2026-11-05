import type { FloorPlanInput, FloorTableInput } from '@dinesense/shared';
import type { FloorTable, TableShape } from './types';

/** Editor working copy of a table: `key` is the id for saved tables, a temp key for new ones. */
export type DraftTable = FloorTableInput & { key: string };

export const GRID = 10;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

/** Editable layout only: live state and the QR token are not part of the floor plan the API accepts. */
export function toDraft(t: FloorTable): DraftTable {
  const { live: _live, qrToken: _qr, ...layout } = t;
  return { ...layout, key: t.id };
}

let seq = 0;
/** Next free label like "T21" given existing labels. */
export function nextLabel(tables: { label: string }[]): string {
  const nums = tables
    .map((t) => /^T(\d+)$/i.exec(t.label)?.[1])
    .filter(Boolean)
    .map(Number);
  return `T${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

export function newTable(
  tables: DraftTable[],
  sectionId: string,
  at: { x: number; y: number },
  shape: TableShape = 'RECT',
): DraftTable {
  return {
    key: `new-${Date.now().toString(36)}-${seq++}`,
    label: nextLabel(tables),
    sectionId,
    capacity: 4,
    minCapacity: 2,
    shape,
    x: snap(at.x),
    y: snap(at.y),
    w: 80,
    h: 80,
    rotation: 0,
    joinableWith: [],
    onlineBookable: true,
  };
}

/** Removes a table and any join references to it. */
export function removeTable(tables: DraftTable[], key: string): DraftTable[] {
  return tables
    .filter((t) => t.key !== key)
    .map((t) => ({ ...t, joinableWith: t.joinableWith.filter((k) => k !== key) }));
}

/** Toggles a symmetric join between two tables. */
export function toggleJoin(tables: DraftTable[], a: string, b: string): DraftTable[] {
  const joined = tables.find((t) => t.key === a)?.joinableWith.includes(b) ?? false;
  const edit = (t: DraftTable, other: string) =>
    joined ? t.joinableWith.filter((k) => k !== other) : [...new Set([...t.joinableWith, other])];
  return tables.map((t) =>
    t.key === a ? { ...t, joinableWith: edit(t, b) } : t.key === b ? { ...t, joinableWith: edit(t, a) } : t,
  );
}

export function toPlan(tables: DraftTable[]): FloorPlanInput {
  return {
    tables: tables.map((t) => ({
      ...t,
      id: t.key.startsWith('new-') ? undefined : t.key,
      x: Math.round(t.x),
      y: Math.round(t.y),
      w: Math.round(t.w),
      h: Math.round(t.h),
      rotation: Math.round(t.rotation),
      minCapacity: Math.min(t.minCapacity, t.capacity),
    })),
  };
}
