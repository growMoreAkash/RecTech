/** Field-level changes between two audit snapshots (top-level keys; nested values compared as JSON). */
export interface FieldChange {
  key: string;
  before: unknown;
  after: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const IGNORED = new Set(['updatedAt', 'createdAt']);

export function diffSnapshots(before: unknown, after: unknown): FieldChange[] {
  if (!isObj(before) && !isObj(after)) return before === after ? [] : [{ key: '', before, after }];
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => !IGNORED.has(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .sort()
    .map((key) => ({ key, before: b[key], after: a[key] }));
}

export const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
