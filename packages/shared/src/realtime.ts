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
  /** Guests of an outlet: menu availability changes. */
  menu: (outletId: string) => `menu:${outletId}`,
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

export interface CartLineView {
  id: string;
  menuItemId: string;
  name: unknown;
  vegType: string;
  quantity: number;
  unitPricePaise: number;
  taxRateBps: number;
  modifiers: { id: string; name: unknown }[];
  note: string | null;
  /** True for lines added from this device (filled per request, not over the socket). */
  mine?: boolean;
}

export interface CartUpdatedPayload extends Envelope {
  seatingId: string;
}

export interface OrderUpdatedPayload extends Envelope {
  outletId: string;
  orderId: string;
  seatingId: string;
  tableIds: string[];
  status: string;
}

export interface KdsChangedPayload extends Envelope {
  outletId: string;
  stationCode: string;
}

export interface MenuAvailabilityPayload extends Envelope {
  outletId: string;
  menuItemId: string;
  isAvailable: boolean;
}

export interface TaskPayload extends Envelope {
  id: string;
  outletId: string;
  type: string;
  status: string;
  tableId: string | null;
  assigneeId: string | null;
}

export interface BillUpdatedPayload extends Envelope {
  outletId: string;
  billId: string;
  seatingId: string;
  status: string;
}

/** Server → client events and their payloads. */
export interface ServerToClientEvents {
  'bill.updated': (p: BillUpdatedPayload) => void;
  'cart.updated': (p: CartUpdatedPayload) => void;
  'order.updated': (p: OrderUpdatedPayload) => void;
  'kds.changed': (p: KdsChangedPayload) => void;
  'menu.availability': (p: MenuAvailabilityPayload) => void;
  'menu.changed': (p: Envelope & { outletId: string }) => void;
  'task.created': (p: TaskPayload) => void;
  'task.updated': (p: TaskPayload) => void;
  'table.updated': (p: TableUpdatedPayload) => void;
  'alert.created': (p: AlertPayload) => void;
  'alert.updated': (p: AlertPayload) => void;
  'shift.updated': (p: ShiftUpdatedPayload) => void;
  'floor.changed': (p: Envelope & { outletId: string }) => void;
}
