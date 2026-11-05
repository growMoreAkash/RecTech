import { SEATED_STATUSES, type Role, type TableStatus } from '../enums';
import type {
  Actor,
  Effect,
  MachineContext,
  RejectReason,
  TableMachineEvent,
  TableMachineEventType,
  TaskTypeName,
  TransitionResult,
} from './types';

/**
 * DineSense table state machine — the single source of truth (docs/PLAN.md §4).
 * Pure: no I/O, no clock. The API's TableStateService loads context, calls `transition`, and executes effects.
 */

const SEATED: ReadonlySet<TableStatus> = new Set(SEATED_STATUSES);
export const isSeated = (s: TableStatus) => SEATED.has(s);

const MANAGERS: readonly Role[] = ['OWNER', 'MANAGER'];
const FLOOR: readonly Role[] = ['OWNER', 'MANAGER', 'HOST', 'WAITER', 'BUSSER', 'CASHIER'];

/** Which actors may send which events. Staff events list the roles allowed; SYSTEM may send any non-camera event. */
const PERMISSIONS: Record<TableMachineEventType, { staff?: readonly Role[]; camera?: true; guest?: true }> = {
  HOST_SEAT: { staff: ['OWNER', 'MANAGER', 'HOST', 'WAITER'] },
  GREET: { staff: ['OWNER', 'MANAGER', 'WAITER'] },
  REQUEST_BILL: { staff: ['OWNER', 'MANAGER', 'HOST', 'WAITER', 'CASHIER'], guest: true },
  STAFF_MARK_LEFT: { staff: FLOOR },
  CLEAN_CONFIRMED: { staff: ['OWNER', 'MANAGER', 'HOST', 'WAITER', 'BUSSER'] },
  HOLD_FOR_RESERVATION: { staff: ['OWNER', 'MANAGER', 'HOST'] },
  RELEASE_HOLD: { staff: ['OWNER', 'MANAGER', 'HOST'] },
  SET_OUT_OF_SERVICE: { staff: MANAGERS },
  RETURN_TO_SERVICE: { staff: MANAGERS },
  FORCE_STATE: { staff: MANAGERS },
  CAMERA_OCCUPIED: { camera: true },
  CAMERA_VACATED: { camera: true },
  CAMERA_STAFF_PRESENT: { camera: true },
  GUEST_COUNT_CHANGED: { camera: true },
  ORDER_ACCEPTED: {},
  FIRST_ORDER_SERVED: {},
  PAYMENT_CAPTURED: {},
};

/** Staff events, for API input validation and UI. */
export const STAFF_EVENTS = (Object.keys(PERMISSIONS) as TableMachineEventType[]).filter(
  (e) => PERMISSIONS[e].staff !== undefined,
);

export function canSend(actor: Actor, event: TableMachineEventType): boolean {
  const p = PERMISSIONS[event];
  switch (actor.kind) {
    case 'SYSTEM':
      return !p.camera;
    case 'CAMERA':
      return p.camera === true;
    case 'GUEST':
      return p.guest === true;
    case 'STAFF':
      return p.staff?.some((r) => actor.roles.includes(r)) ?? false;
  }
}

/** Tasks that only make sense while guests are seated; cancelled when a seating closes. */
const SERVICE_TASKS: readonly TaskTypeName[] = [
  'GREET',
  'CALL_WAITER',
  'WATER',
  'CUTLERY',
  'BILL',
  'SERVE',
  'APPROVE_ORDER',
];
const SLA_ALERTS = ['SLA_BREACH', 'REASSIGNED', 'ESCALATION', 'NO_ELIGIBLE_WAITER'] as const;

const greetEffects = (): Effect[] => [
  { type: 'SET_SEATING_TS', field: 'greetedAt' },
  { type: 'CANCEL_GREET_SLA' },
  { type: 'CANCEL_TASKS', tasks: ['GREET'] },
  { type: 'RESOLVE_ALERTS', alerts: SLA_ALERTS },
];

const closeEffects = (): Effect[] => [
  { type: 'SET_SEATING_TS', field: 'leftAt' },
  { type: 'CLOSE_SEATING' },
  { type: 'CANCEL_GREET_SLA' },
  { type: 'CANCEL_TASKS', tasks: SERVICE_TASKS },
  { type: 'RESOLVE_ALERTS', alerts: SLA_ALERTS },
  { type: 'CREATE_TASK', task: 'CLEAN' },
];

export function transition(
  from: TableStatus,
  event: TableMachineEvent,
  ctx: MachineContext,
): TransitionResult {
  const ok = (next: TableStatus, effects: Effect[] = []): TransitionResult => ({
    ok: true,
    from,
    next,
    effects,
    noop: next === from && effects.length === 0,
  });
  const noop = () => ok(from);
  const reject = (reason: RejectReason, message: string): TransitionResult => ({
    ok: false,
    from,
    reason,
    message,
  });
  const invalid = () =>
    reject('INVALID_FROM_STATE', `${event.type} is not allowed when the table is ${from}`);

  if (!canSend(ctx.actor, event.type)) {
    return reject('FORBIDDEN', `${ctx.actor.kind.toLowerCase()} may not send ${event.type}`);
  }

  const seated = isSeated(from);
  const seatedByCamera =
    ctx.actor.kind === 'CAMERA' ? 'CAMERA' : ctx.actor.kind === 'STAFF' ? 'STAFF' : 'SYSTEM';

  switch (event.type) {
    // ── Seat (rows 1–4) ──
    case 'HOST_SEAT':
    case 'CAMERA_OCCUPIED': {
      const isCamera = event.type === 'CAMERA_OCCUPIED';
      const partySize = event.type === 'CAMERA_OCCUPIED' ? event.guestCount : event.partySize;
      const requested = event.type === 'HOST_SEAT' ? event.source : undefined;
      if (seated) {
        // Camera re-confirming an occupied table is noise; at most it refines the guest count.
        if (isCamera) return partySize ? ok(from, [{ type: 'UPDATE_PARTY_SIZE', partySize }]) : noop();
        return invalid();
      }
      if (from === 'OUT_OF_SERVICE') return isCamera ? noop() : invalid();
      const source = requested ?? (from === 'RESERVED' && !isCamera ? 'RESERVATION' : 'WALK_IN');
      const effects: Effect[] = [
        { type: 'CREATE_SEATING', source, seatedBy: seatedByCamera, ...(partySize ? { partySize } : {}) },
        { type: 'START_GREET_SLA' },
      ];
      if (from === 'RESERVED' && isCamera) {
        effects.push({ type: 'RAISE_ALERT', alert: 'RESERVED_TABLE_TAKEN', severity: 'WARNING' });
      }
      if (from === 'NEEDS_CLEANING') {
        effects.push(
          { type: 'CANCEL_TASKS', tasks: ['CLEAN'] },
          { type: 'RAISE_ALERT', alert: 'SEATED_AT_DIRTY_TABLE', severity: 'WARNING' },
        );
      }
      return ok('OCCUPIED', effects);
    }

    // ── Greet (rows 5–6) ──
    case 'GREET':
    case 'CAMERA_STAFF_PRESENT': {
      if (event.type === 'CAMERA_STAFF_PRESENT') {
        const s = ctx.settings;
        const strongEnough =
          event.seconds >= s.staffPresentSeconds && event.confidence >= s.staffPresentMinConfidence;
        if (from !== 'OCCUPIED' || !s.cameraGreetEnabled || !strongEnough) return noop();
      }
      if (from === 'OCCUPIED')
        return ok(ctx.seating?.hasAcceptedOrder ? 'ORDERED' : 'GREETED', greetEffects());
      return seated ? noop() : invalid(); // a repeat "At table" tap is harmless
    }

    // ── Order (row 7) ──
    case 'ORDER_ACCEPTED': {
      const firstOrder: Effect = { type: 'SET_SEATING_TS', field: 'firstOrderAt' };
      if (from === 'GREETED') return ok('ORDERED', [firstOrder]);
      if (from === 'OCCUPIED') {
        const countsAsGreet = event.orderSource === 'WAITER' || ctx.settings.qrOrderSatisfiesGreet;
        return countsAsGreet ? ok('ORDERED', [...greetEffects(), firstOrder]) : ok('OCCUPIED', [firstOrder]);
      }
      // Additional orders later in the meal don't move the table.
      return seated && from !== 'PAID' ? noop() : invalid();
    }

    // ── Serve (row 8) ──
    case 'FIRST_ORDER_SERVED':
      if (from !== 'ORDERED') return seated ? noop() : invalid();
      if (!ctx.seating?.allFirstOrderServed)
        return reject('GUARD_FAILED', 'Not every item of the first order is served');
      return ok('SERVED', [{ type: 'SET_SEATING_TS', field: 'servedAt' }]);

    // ── Bill (row 9) ──
    case 'REQUEST_BILL':
      if (from === 'BILL_REQUESTED') return noop();
      if (!seated || from === 'PAID') return invalid();
      return ok('BILL_REQUESTED', [
        { type: 'SET_SEATING_TS', field: 'billRequestedAt' },
        { type: 'CREATE_TASK', task: 'BILL' },
      ]);

    // ── Pay (row 10) ──
    case 'PAYMENT_CAPTURED':
      if (from === 'PAID') return noop();
      if (!seated) return invalid();
      if (!ctx.seating?.isPaid) return reject('GUARD_FAILED', 'Captured payments do not cover the bill');
      return ok('PAID', [
        { type: 'SET_SEATING_TS', field: 'paidAt' },
        { type: 'CANCEL_TASKS', tasks: ['BILL'] },
      ]);

    // ── Leave (rows 11–13) ──
    case 'CAMERA_VACATED': {
      if (!seated) return noop();
      if (from === 'PAID') return ok('NEEDS_CLEANING', closeEffects());
      // Never auto-close an unpaid table: the camera may be wrong, and money may be owed.
      if (ctx.seating?.hasAcceptedOrder && !ctx.seating.isPaid) {
        return ok(from, [{ type: 'RAISE_ALERT', alert: 'LEFT_WITHOUT_PAYING', severity: 'CRITICAL' }]);
      }
      return noop();
    }
    case 'STAFF_MARK_LEFT': {
      if (!seated) return invalid();
      const owes =
        from !== 'PAID' && (ctx.seating?.hasAcceptedOrder ?? false) && !(ctx.seating?.isPaid ?? false);
      if (owes && !hasRole(ctx.actor, ['OWNER', 'MANAGER', 'CASHIER'])) {
        return reject('FORBIDDEN', 'Only a manager or cashier can close a table with an unpaid order');
      }
      return ok('NEEDS_CLEANING', closeEffects());
    }

    // ── Clean (row 14) ──
    case 'CLEAN_CONFIRMED':
      if (from === 'VACANT') return noop();
      if (from !== 'NEEDS_CLEANING') return invalid();
      return ok('VACANT', [{ type: 'MARK_CLEANED' }, { type: 'CANCEL_TASKS', tasks: ['CLEAN'] }]);

    // ── Holds and service (rows 15–18) ──
    case 'HOLD_FOR_RESERVATION':
      return from === 'VACANT' ? ok('RESERVED') : from === 'RESERVED' ? noop() : invalid();
    case 'RELEASE_HOLD':
      return from === 'RESERVED' ? ok('VACANT') : from === 'VACANT' ? noop() : invalid();
    case 'SET_OUT_OF_SERVICE':
      if (from === 'OUT_OF_SERVICE') return noop();
      if (from === 'VACANT') return ok('OUT_OF_SERVICE');
      if (from === 'NEEDS_CLEANING')
        return ok('OUT_OF_SERVICE', [{ type: 'CANCEL_TASKS', tasks: ['CLEAN'] }]);
      return invalid();
    case 'RETURN_TO_SERVICE':
      return from === 'OUT_OF_SERVICE' ? ok('VACANT') : from === 'VACANT' ? noop() : invalid();

    // ── Manager override (row 19) ──
    case 'FORCE_STATE':
      return force(from, event.to, ctx);

    // ── Camera guest count ──
    case 'GUEST_COUNT_CHANGED':
      return seated ? ok(from, [{ type: 'UPDATE_PARTY_SIZE', partySize: event.guestCount }]) : noop();
  }
}

/** Manager override: move to any state, reconciling the seating and timers so the data stays consistent. */
function force(from: TableStatus, to: TableStatus, ctx: MachineContext): TransitionResult {
  if (to === from) return { ok: true, from, next: to, effects: [], noop: true };
  const effects: Effect[] = [];
  const toSeated = isSeated(to);
  const hasSeating = ctx.seating !== null;

  if (from === 'NEEDS_CLEANING') effects.push({ type: 'CANCEL_TASKS', tasks: ['CLEAN'] });

  if (toSeated && !hasSeating) {
    effects.push({ type: 'CREATE_SEATING', source: 'WALK_IN', seatedBy: 'STAFF' });
    // Only a freshly seated (not yet greeted) table needs the greet timer.
    if (to === 'OCCUPIED') effects.push({ type: 'START_GREET_SLA' });
  } else if (toSeated && hasSeating) {
    if (from === 'OCCUPIED') effects.push(...greetEffects());
  } else if (hasSeating) {
    // Leaving the seated states: close the seating like a departure (cleaning only if that's the target).
    effects.push(...closeEffects().filter((e) => e.type !== 'CREATE_TASK'));
    if (to === 'NEEDS_CLEANING') effects.push({ type: 'CREATE_TASK', task: 'CLEAN' });
  } else if (to === 'NEEDS_CLEANING') {
    effects.push({ type: 'CREATE_TASK', task: 'CLEAN' });
  }
  return { ok: true, from, next: to, effects, noop: false };
}

function hasRole(actor: Actor, roles: readonly Role[]): boolean {
  return actor.kind === 'SYSTEM' || (actor.kind === 'STAFF' && actor.roles.some((r) => roles.includes(r)));
}
