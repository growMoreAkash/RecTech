import type { Role, SeatingSummary, TableStatus } from '@dinesense/shared';

export interface Me {
  id: string;
  name: string;
  outlets: Record<string, Role[]>;
  deviceId: string | null;
}

export interface DeviceInfo {
  device: { id: string; name: string; kind: string };
  outlet: { id: string; name: string };
  staff: { id: string; name: string; roles: Role[] }[];
}

export interface FloorTable {
  id: string;
  label: string;
  sectionId: string;
  capacity: number;
  live: { status: TableStatus; version: number; seating: SeatingSummary | null };
}

export interface Floor {
  sections: { id: string; name: string }[];
  greetSlaSeconds: number;
  tables: FloorTable[];
}

export interface Task {
  id: string;
  type:
    | 'GREET'
    | 'CALL_WAITER'
    | 'WATER'
    | 'CUTLERY'
    | 'BILL'
    | 'SERVE'
    | 'CLEAN'
    | 'APPROVE_ORDER'
    | 'CHECK_TABLE'
    | 'FIRE_COURSE'
    | 'OFFER_DESSERT'
    | 'SERVICE_RECOVERY';
  status: 'OPEN' | 'ACCEPTED';
  tableId: string | null;
  tableLabel: string | null;
  orderId: string | null;
  assigneeId: string | null;
  mine: boolean;
  createdAt: string;
}

export interface Shift {
  id: string;
  userId: string;
  role: Role;
  startsAt: string;
  endsAt: string;
  checkedInAt: string | null;
  checkInSeq: number | null;
  checkedOutAt: string | null;
  onBreak: boolean;
}

export interface OrderItem {
  id: string;
  nameSnapshot: unknown;
  quantity: number;
  modifiers: { name: unknown }[];
  note: string | null;
  status: 'HELD' | 'QUEUED' | 'COOKING' | 'READY' | 'SERVED' | 'VOID';
  etaReadyAt?: string | null;
}

export interface Order {
  id: string;
  number: number;
  source: 'QR' | 'WAITER';
  status: 'PENDING_APPROVAL' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  items: OrderItem[];
}

export interface MenuModifierGroup {
  id: string;
  name: unknown;
  minSelect: number;
  maxSelect: number;
  modifiers: { id: string; name: unknown; priceDeltaPaise: number; isAvailable: boolean }[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: unknown;
  vegType: string;
  pricePaise: number;
  isAvailable: boolean;
  modifierGroups: MenuModifierGroup[];
}

export interface Menu {
  categories: { id: string; name: unknown }[];
  items: MenuItem[];
}

export interface Bill {
  id: string;
  status: 'OPEN' | 'FINALIZED' | 'PAID' | 'VOID';
  totalPaise: number;
  duePaise: number;
  invoiceUrl: string;
}
