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
  /** Public booking page path segment: /b/{slug}. */
  slug: string;
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
  onlineBookable: boolean;
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

export interface BillLine {
  id: string;
  description: string;
  quantity: number;
  unitPricePaise: number;
  discountPaise: number;
  taxableValuePaise: number;
  taxRateBps: number;
}

export interface Payment {
  id: string;
  method: 'CASH' | 'UPI' | 'CARD' | 'RAZORPAY' | 'OTHER';
  status: string;
  amountPaise: number;
  reference: string | null;
  capturedAt: string | null;
  shareKey: string | null;
  provider: string | null;
  createdAt: string;
}

export interface BillShare {
  key: string;
  label: string | null;
  amountPaise: number;
  lineIds?: string[];
  paidPaise: number;
  duePaise: number;
}

export interface Bill {
  id: string;
  seatingId: string;
  invoiceNumber: string | null;
  status: 'OPEN' | 'FINALIZED' | 'PAID' | 'VOID';
  subtotalPaise: number;
  discountPaise: number;
  discountReason: string | null;
  serviceChargeBps: number;
  serviceChargePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  createdAt: string;
  invoiceUrl: string;
  lines: BillLine[];
  payments: Payment[];
  split: { mode: 'EQUAL' | 'BY_ITEM' | 'CUSTOM'; shares: BillShare[] } | null;
}

export interface AuditEntry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export type Point = [number, number];

export interface CameraHealthReport {
  status: 'ok' | 'degraded' | 'down';
  fps: number;
  latencyMs: number;
  lastFrameAt: string | null;
  reconnects: number;
  error?: string;
}

export interface CameraZone {
  id: string;
  tableId: string;
  polygon: Point[];
  calibratedAt: string;
}

export interface Camera {
  id: string;
  name: string;
  edgeDevice: { id: string; name: string; lastSeenAt: string | null };
  /** Host only (credentials are never returned). */
  streamHost: string;
  fps: number;
  enabled: boolean;
  healthy: boolean;
  lastHealthAt: string | null;
  lastHealth: CameraHealthReport | null;
  snapshotAt: string | null;
  hasSnapshot: boolean;
  /** Entrance zone for party-size estimates. */
  door: Point[] | null;
  zones: CameraZone[];
}

export interface EdgeDevice {
  id: string;
  name: string;
  version: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  _count: { cameras: number };
}

export interface DayReport {
  date: string;
  timeZone: string;
  greetSlaSeconds: number;
  seatings: {
    total: number;
    covers: number;
    greeted: number;
    avgSeatToGreetSeconds: number | null;
    medianSeatToGreetSeconds: number | null;
    greetedWithinSlaPct: number | null;
    slaBreaches: number;
    escalations: number;
    leftWithoutPaying: number;
  };
  waiters: {
    waiterId: string;
    name: string;
    greets: number;
    assignments: number;
    acknowledged: number;
    missed: number;
    avgAckSeconds: number | null;
  }[];
  salesByHour: { hour: number; bills: number; totalPaise: number }[];
  payments: { method: Payment['method']; count: number; amountPaise: number }[];
  sales: { bills: number; totalPaise: number; avgBillPaise: number | null };
}

export type ConsentFlags = Partial<Record<'WHATSAPP' | 'FEEDBACK' | 'MARKETING', boolean>>;

export interface GuestProfile {
  id: string;
  phone: string | null;
  phoneMasked: string | null;
  name: string | null;
  birthday: string | null;
  notes: string | null;
  allergies: string | null;
  consents: ConsentFlags;
  visits: number;
  lastVisitAt: string | null;
  totalSpendPaise: number;
  favourites: { name: string; count: number }[];
  erased: boolean;
  createdAt: string;
  upcoming: { id: string; outletId: string; startsAt: string; partySize: number; tableIds: string[] }[];
}

export interface Reservation {
  id: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  status: 'CONFIRMED' | 'SEATED' | 'CANCELLED' | 'NO_SHOW';
  channel: 'ONLINE' | 'STAFF';
  tableIds: string[];
  sectionId: string | null;
  notes: string | null;
  heldAt: string | null;
  seatingId: string | null;
  guest: {
    id: string;
    name: string | null;
    phone: string | null;
    phoneMasked: string | null;
    visits: number;
    allergies: string | null;
    notes: string | null;
    erased: boolean;
  };
  messages?: GuestMessage[];
}

export interface BookingSlot {
  time: string;
  startsAt: string;
  available: boolean;
}

export interface OpeningWindow {
  dayOfWeek: number;
  opens: string;
  closes: string;
}

export interface GuestMessage {
  id: string;
  entityId: string;
  purpose: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED';
  channel: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface WaitlistItem {
  id: string;
  status: 'WAITING' | 'NOTIFIED' | 'SEATED' | 'LEFT' | 'REMOVED';
  partySize: number;
  source: 'QR' | 'HOST';
  notes: string | null;
  quotedMinutes: number | null;
  notifiedAt: string | null;
  notifiedTableIds: string[];
  holdUntil: string | null;
  createdAt: string;
  position: number | null;
  wait: { low: number; high: number } | null;
  suggestedTableIds: string[];
  messages: GuestMessage[];
  guest: {
    id: string;
    name: string | null;
    phone: string | null;
    phoneMasked: string | null;
    visits: number;
    allergies: string | null;
  };
}

export interface DoorArrival {
  id: string;
  count: number;
  at: string;
  suggestedTableIds: string[];
}
