import type { Role, SeatingSummary, TableStatus } from '@dinesense/shared';

export interface Me {
  id: string;
  organizationId: string;
  name: string;
  outlets: Record<string, Role[]>;
}

export interface Outlet {
  id: string;
  name: string;
  timezone: string;
}

export interface Section {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
}

export type TableShape = 'RECT' | 'SQUARE' | 'ROUND' | 'BOOTH';

export interface TableLayout {
  id: string;
  label: string;
  sectionId: string;
  capacity: number;
  minCapacity: number;
  shape: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  joinableWith: string[];
  qrToken: string;
}

export interface TableLive {
  tableId: string;
  outletId: string;
  status: TableStatus;
  version: number;
  statusChangedAt: string;
  seating: SeatingSummary | null;
}

export interface FloorTable extends TableLayout {
  live: TableLive;
}

export interface FloorSnapshot {
  sections: Section[];
  greetSlaSeconds: number;
  tables: FloorTable[];
}

export interface TimelineEvent {
  id: string;
  type: string;
  source: string;
  fromStatus: TableStatus | null;
  toStatus: TableStatus | null;
  occurredAt: string;
  actorName: string | null;
}

export interface Timeline {
  table: { id: string; label: string; status: TableStatus; version: number };
  events: TimelineEvent[];
}

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  hasPin: boolean;
  roles: Role[];
}

export interface Shift {
  id: string;
  userId: string;
  role: Role;
  startsAt: string;
  endsAt: string;
  sectionIds: string[];
  maxTables: number | null;
  checkedInAt: string | null;
  checkInSeq: number | null;
  checkedOutAt: string | null;
  onBreak: boolean;
  user: { id: string; name: string };
}

export interface Alert {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: string;
  tableId: string | null;
  createdAt: string;
}

export interface Station {
  id: string;
  code: string;
  name: { en: string; hi?: string };
}

export interface Modifier {
  id: string;
  name: { en: string; hi?: string };
  priceDeltaPaise: number;
  isAvailable: boolean;
}

export interface ModifierGroup {
  id: string;
  name: { en: string; hi?: string };
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

export interface MenuCategory {
  id: string;
  name: { en: string; hi?: string };
  sortOrder: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  stationId: string;
  name: { en: string; hi?: string };
  description: { en: string; hi?: string } | null;
  vegType: 'VEG' | 'NON_VEG' | 'EGG';
  allergens: string[];
  spiceLevel: number;
  pricePaise: number;
  taxRateBps: number;
  isAvailable: boolean;
  sortOrder: number;
  modifierGroups: ModifierGroup[];
}

export interface Menu {
  stations: Station[];
  categories: MenuCategory[];
  items: MenuItem[];
  modifierGroups: ModifierGroup[];
}

export type OrderItemStatus = 'QUEUED' | 'COOKING' | 'READY' | 'SERVED' | 'VOID';

export interface OrderItem {
  id: string;
  nameSnapshot: unknown;
  quantity: number;
  unitPricePaise: number;
  modifiers: { name: unknown }[];
  note: string | null;
  status: OrderItemStatus;
}

export interface Order {
  id: string;
  number: number;
  source: 'QR' | 'WAITER';
  status: 'PENDING_APPROVAL' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  rejectedReason: string | null;
  items: OrderItem[];
  seating: { id: string; tables: { table: { id: string; label: string } }[] };
}

export interface KdsTicket {
  orderId: string;
  number: number;
  source: 'QR' | 'WAITER';
  tables: string[];
  partySize: number | null;
  firedAt: string;
  items: {
    id: string;
    name: unknown;
    quantity: number;
    modifiers: { name: unknown }[];
    note: string | null;
    status: OrderItemStatus;
    queuedAt: string;
  }[];
}

export interface KdsBoard {
  station: Station;
  tickets: KdsTicket[];
}
