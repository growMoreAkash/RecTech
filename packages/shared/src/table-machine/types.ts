import type { Role, TableStatus } from '../enums';

export type SeatingSource = 'WALK_IN' | 'RESERVATION' | 'WAITLIST';
export type TaskTypeName =
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
  | 'OFFER_DESSERT';
export type AlertTypeName =
  | 'SLA_BREACH'
  | 'REASSIGNED'
  | 'ESCALATION'
  | 'NO_ELIGIBLE_WAITER'
  | 'LEFT_WITHOUT_PAYING'
  | 'SEATED_AT_DIRTY_TABLE'
  | 'RESERVED_TABLE_TAKEN'
  | 'IDLE_TABLE';
export type AlertSeverityName = 'INFO' | 'WARNING' | 'CRITICAL';
export type SeatingTimestamp =
  'greetedAt' | 'firstOrderAt' | 'servedAt' | 'billRequestedAt' | 'paidAt' | 'leftAt';

/** Who is asking for the transition. */
export type Actor =
  | { kind: 'STAFF'; userId: string; roles: readonly Role[] }
  | { kind: 'CAMERA'; deviceId: string }
  | { kind: 'SYSTEM' }
  | { kind: 'GUEST'; sessionId: string };

export type TableMachineEvent =
  // staff
  | { type: 'HOST_SEAT'; partySize?: number; source?: SeatingSource }
  | { type: 'GREET' }
  | { type: 'REQUEST_BILL' }
  | { type: 'STAFF_MARK_LEFT' }
  | { type: 'CLEAN_CONFIRMED' }
  | { type: 'HOLD_FOR_RESERVATION' }
  | { type: 'RELEASE_HOLD' }
  | { type: 'SET_OUT_OF_SERVICE' }
  | { type: 'RETURN_TO_SERVICE' }
  | { type: 'FORCE_STATE'; to: TableStatus }
  // camera (edge vision)
  | { type: 'CAMERA_OCCUPIED'; guestCount?: number }
  | { type: 'CAMERA_VACATED' }
  | { type: 'CAMERA_STAFF_PRESENT'; seconds: number; confidence: number }
  | { type: 'GUEST_COUNT_CHANGED'; guestCount: number }
  /** Cups, plates or cutlery left on an empty table. */
  | { type: 'CAMERA_DIRTY'; seconds: number }
  // system (other modules)
  | { type: 'ORDER_ACCEPTED'; orderSource: 'QR' | 'WAITER' }
  | { type: 'FIRST_ORDER_SERVED' }
  | { type: 'PAYMENT_CAPTURED' };

export type TableMachineEventType = TableMachineEvent['type'];

export interface MachineSettings {
  cameraGreetEnabled: boolean;
  staffPresentSeconds: number;
  staffPresentMinConfidence: number;
  qrOrderSatisfiesGreet: boolean;
}

/** Facts about the open seating the reducer needs; `null` when the table has no open seating. */
export interface SeatingFacts {
  hasAcceptedOrder: boolean;
  allFirstOrderServed: boolean;
  isPaid: boolean;
}

export interface MachineContext {
  settings: MachineSettings;
  seating: SeatingFacts | null;
  actor: Actor;
}

export type Effect =
  | {
      type: 'CREATE_SEATING';
      source: SeatingSource;
      seatedBy: 'CAMERA' | 'STAFF' | 'SYSTEM';
      partySize?: number;
    }
  | { type: 'CLOSE_SEATING' }
  /** Set the timestamp on the open seating if it is not already set. `greetedAt` also records greeter/serving waiter. */
  | { type: 'SET_SEATING_TS'; field: SeatingTimestamp }
  | { type: 'MARK_CLEANED' }
  | { type: 'START_GREET_SLA' }
  | { type: 'CANCEL_GREET_SLA' }
  | { type: 'CREATE_TASK'; task: TaskTypeName }
  | { type: 'CANCEL_TASKS'; tasks: readonly TaskTypeName[] }
  | { type: 'RAISE_ALERT'; alert: AlertTypeName; severity: AlertSeverityName }
  | { type: 'RESOLVE_ALERTS'; alerts: readonly AlertTypeName[] }
  /** Camera guest count; the service only applies it when staff have not entered a party size. */
  | { type: 'UPDATE_PARTY_SIZE'; partySize: number };

export type RejectReason = 'INVALID_FROM_STATE' | 'GUARD_FAILED' | 'FORBIDDEN';

export type TransitionResult =
  | { ok: true; from: TableStatus; next: TableStatus; effects: Effect[]; noop: boolean }
  | { ok: false; from: TableStatus; reason: RejectReason; message: string };
