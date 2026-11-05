import type { Role, TableStatus } from './enums';

/** Socket.IO namespace and room names (docs/PLAN.md §6.2). */
export const RT_NAMESPACE = '/rt';
export const rooms = {
  outlet: (outletId: string) => `outlet:${outletId}`,
  table: (tableId: string) => `table:${tableId}`,
  role: (role: Role, outletId: string) => `role:${role}:${outletId}`,
  staff: (userId: string) => `staff:${userId}`,
  kds: (outletId: string, station: string) => `kds:${outletId}:${station}`,
  seating: (seatingId: string) => `seating:${seatingId}`,
};

export interface Envelope {
  v: 1;
  emittedAt: string;
}

export interface SeatingSummary {
  id: string;
  partySize: number | null;
  seatedAt: string;
  greetedAt: string | null;
  firstOrderAt: string | null;
  billRequestedAt: string | null;
  paidAt: string | null;
  notes: string | null;
  servingWaiter: { id: string; name: string } | null;
  tableIds: string[];
}

export interface TableUpdatedPayload extends Envelope {
  tableId: string;
  outletId: string;
  status: TableStatus;
  version: number;
  statusChangedAt: string;
  seating: SeatingSummary | null;
}

export interface AlertPayload extends Envelope {
  id: string;
  outletId: string;
  type: string;
  severity: string;
  status: string;
  tableId: string | null;
  message: string;
  createdAt: string;
}

export interface ShiftUpdatedPayload extends Envelope {
  outletId: string;
  shiftId: string;
  userId: string;
}

/** Server → client events and their payloads. */
export interface ServerToClientEvents {
  'table.updated': (p: TableUpdatedPayload) => void;
  'alert.created': (p: AlertPayload) => void;
  'alert.updated': (p: AlertPayload) => void;
  'shift.updated': (p: ShiftUpdatedPayload) => void;
  'floor.changed': (p: Envelope & { outletId: string }) => void;
}
