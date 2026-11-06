/** A waiter's order being built at the table (before it is sent to the kitchen). */
export interface DraftLine {
  menuItemId: string;
  modifierIds: string[];
  note?: string;
  quantity: number;
  unitPricePaise: number;
}

const sameLine = (a: DraftLine, b: Omit<DraftLine, 'quantity' | 'unitPricePaise'>) =>
  a.menuItemId === b.menuItemId &&
  (a.note ?? '') === (b.note ?? '') &&
  [...a.modifierIds].sort().join() === [...b.modifierIds].sort().join();

/** Adds a line, merging with an identical one (same dish, options and note). */
export function addLine(lines: DraftLine[], line: DraftLine): DraftLine[] {
  const i = lines.findIndex((l) => sameLine(l, line));
  if (i === -1) return [...lines, line];
  return lines.map((l, j) => (j === i ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l));
}

/** Changes a line's quantity; 0 removes it. */
export function setQuantity(lines: DraftLine[], index: number, quantity: number): DraftLine[] {
  return quantity <= 0
    ? lines.filter((_, j) => j !== index)
    : lines.map((l, j) => (j === index ? { ...l, quantity: Math.min(50, quantity) } : l));
}

export const draftTotal = (lines: DraftLine[]) =>
  lines.reduce((s, l) => s + l.unitPricePaise * l.quantity, 0);

/** API payload (prices are recomputed server-side). */
export const toOrderItems = (lines: DraftLine[]) =>
  lines.map(({ menuItemId, modifierIds, note, quantity }) => ({
    menuItemId,
    modifierIds,
    quantity,
    ...(note ? { note } : {}),
  }));
