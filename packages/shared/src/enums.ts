/**
 * Domain enums. These MUST match the Prisma enums in apps/api/prisma/schema.prisma;
 * apps/api has a test that fails if they drift.
 */
const values = <const T extends readonly string[]>(...v: T) => v;

export const ROLES = values('OWNER', 'MANAGER', 'HOST', 'WAITER', 'BUSSER', 'CHEF', 'CASHIER');
export type Role = (typeof ROLES)[number];

export const TABLE_STATUSES = values(
  'VACANT',
  'RESERVED',
  'OCCUPIED',
  'GREETED',
  'ORDERED',
  'SERVED',
  'BILL_REQUESTED',
  'PAID',
  'NEEDS_CLEANING',
  'OUT_OF_SERVICE',
);
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const SEATED_STATUSES = values('OCCUPIED', 'GREETED', 'ORDERED', 'SERVED', 'BILL_REQUESTED', 'PAID');

export const TABLE_SHAPES = values('RECT', 'SQUARE', 'ROUND', 'BOOTH');
export const ASSIGNMENT_MODES = values('ROUND_ROBIN', 'LEAST_LOADED', 'FIXED_SECTION');
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];
export const SEATING_SOURCES = values('WALK_IN', 'RESERVATION', 'WAITLIST');
export const SEATING_STATUSES = values('OPEN', 'CLOSED');
export const ASSIGNMENT_REASONS = values(
  'ROUND_ROBIN',
  'LEAST_LOADED',
  'FIXED_SECTION',
  'MANUAL',
  'ESCALATION',
);
export const EVENT_SOURCES = values('CAMERA', 'STAFF', 'SYSTEM', 'GUEST');
export const TASK_TYPES = values(
  'GREET',
  'CALL_WAITER',
  'WATER',
  'CUTLERY',
  'BILL',
  'SERVE',
  'CLEAN',
  'APPROVE_ORDER',
  'CHECK_TABLE',
  'FIRE_COURSE',
  'OFFER_DESSERT',
  'SERVICE_RECOVERY',
);
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_STATUSES = values('OPEN', 'ACCEPTED', 'DONE', 'CANCELLED', 'EXPIRED');
export const VEG_TYPES = values('VEG', 'NON_VEG', 'EGG');
export type VegType = (typeof VEG_TYPES)[number];
export const ORDER_SOURCES = values('QR', 'WAITER');
export const ORDER_STATUSES = values('PENDING_APPROVAL', 'ACCEPTED', 'REJECTED', 'CANCELLED');
export const ORDER_ITEM_STATUSES = values('HELD', 'QUEUED', 'COOKING', 'READY', 'SERVED', 'VOID');
export const BILL_STATUSES = values('OPEN', 'FINALIZED', 'PAID', 'VOID');
export const PAYMENT_METHODS = values('CASH', 'UPI', 'CARD', 'RAZORPAY', 'OTHER');
export const PAYMENT_STATUSES = values('PENDING', 'CAPTURED', 'FAILED', 'REFUNDED');
export const ALERT_TYPES = values(
  'SLA_BREACH',
  'REASSIGNED',
  'ESCALATION',
  'NO_ELIGIBLE_WAITER',
  'CALL_WAITER',
  'LONG_WAIT',
  'CAMERA_OFFLINE',
  'EDGE_OFFLINE',
  'LEFT_WITHOUT_PAYING',
  'SEATED_AT_DIRTY_TABLE',
  'RESERVED_TABLE_TAKEN',
  'IDLE_TABLE',
  'GUEST_UNHAPPY',
);
export const COURSES = values('DRINK', 'STARTER', 'MAIN', 'DESSERT', 'OTHER');
export type Course = (typeof COURSES)[number];
export const FEEDBACK_KINDS = values('MID_MEAL');
export const ALERT_SEVERITIES = values('INFO', 'WARNING', 'CRITICAL');
export const ALERT_STATUSES = values('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
export const DEVICE_KINDS = values('STAFF_TERMINAL', 'KDS');
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** All enums keyed by their Prisma enum name (used by the drift test). */
export const RESERVATION_STATUSES = ['CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const RESERVATION_CHANNELS = ['ONLINE', 'STAFF'] as const;
export type ReservationChannel = (typeof RESERVATION_CHANNELS)[number];

export const MESSAGE_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const WAITLIST_STATUSES = ['WAITING', 'NOTIFIED', 'SEATED', 'LEFT', 'REMOVED'] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const PRISMA_ENUMS = {
  Role: ROLES,
  TableStatus: TABLE_STATUSES,
  TableShape: TABLE_SHAPES,
  AssignmentMode: ASSIGNMENT_MODES,
  SeatingSource: SEATING_SOURCES,
  SeatingStatus: SEATING_STATUSES,
  AssignmentReason: ASSIGNMENT_REASONS,
  EventSource: EVENT_SOURCES,
  TaskType: TASK_TYPES,
  TaskStatus: TASK_STATUSES,
  VegType: VEG_TYPES,
  OrderSource: ORDER_SOURCES,
  OrderStatus: ORDER_STATUSES,
  OrderItemStatus: ORDER_ITEM_STATUSES,
  BillStatus: BILL_STATUSES,
  PaymentMethod: PAYMENT_METHODS,
  PaymentStatus: PAYMENT_STATUSES,
  AlertType: ALERT_TYPES,
  AlertSeverity: ALERT_SEVERITIES,
  AlertStatus: ALERT_STATUSES,
  DeviceKind: DEVICE_KINDS,
  ReservationStatus: RESERVATION_STATUSES,
  ReservationChannel: RESERVATION_CHANNELS,
  MessageStatus: MESSAGE_STATUSES,
  WaitlistStatus: WAITLIST_STATUSES,
  Course: COURSES,
  FeedbackKind: FEEDBACK_KINDS,
} as const;
