import { describe, expect, it } from 'vitest';
import { TABLE_STATUSES, type Role, type TableStatus } from '../enums';
import { isSeated, transition } from './machine';
import type {
  Actor,
  Effect,
  MachineContext,
  SeatingFacts,
  TableMachineEvent,
  TransitionResult,
} from './types';

const settings = {
  cameraGreetEnabled: false,
  staffPresentSeconds: 10,
  staffPresentMinConfidence: 0.7,
  qrOrderSatisfiesGreet: false,
};
const staff = (...roles: Role[]): Actor => ({ kind: 'STAFF', userId: 'u1', roles });
const MANAGER = staff('MANAGER');
const WAITER = staff('WAITER');
const CAMERA: Actor = { kind: 'CAMERA', deviceId: 'edge1' };
const SYSTEM: Actor = { kind: 'SYSTEM' };
const GUEST: Actor = { kind: 'GUEST', sessionId: 'g1' };

const facts = (f: Partial<SeatingFacts> = {}): SeatingFacts => ({
  hasAcceptedOrder: false,
  allFirstOrderServed: false,
  isPaid: false,
  ...f,
});

function run(
  from: TableStatus,
  event: TableMachineEvent,
  actor: Actor,
  opts: { seating?: Partial<SeatingFacts> | null; settings?: Partial<typeof settings> } = {},
): TransitionResult {
  const seating =
    opts.seating === undefined ? (isSeated(from) ? facts() : null) : opts.seating && facts(opts.seating);
  const ctx: MachineContext = { settings: { ...settings, ...opts.settings }, seating, actor };
  return transition(from, event, ctx);
}

const types = (r: TransitionResult) => (r.ok ? r.effects.map((e) => e.type) : []);
const next = (r: TransitionResult) => (r.ok ? r.next : `REJECT:${r.reason}`);
const effect = <T extends Effect['type']>(r: TransitionResult, t: T) =>
  r.ok ? (r.effects.find((e) => e.type === t) as Extract<Effect, { type: T }> | undefined) : undefined;

const SEATED: TableStatus[] = ['OCCUPIED', 'GREETED', 'ORDERED', 'SERVED', 'BILL_REQUESTED', 'PAID'];
const UNSEATED = TABLE_STATUSES.filter((s) => !SEATED.includes(s));

describe('table state machine', () => {
  describe('seating (rows 1–4)', () => {
    it('host seats a vacant table: creates seating and starts the greet SLA', () => {
      const r = run('VACANT', { type: 'HOST_SEAT', partySize: 4 }, staff('HOST'));
      expect(next(r)).toBe('OCCUPIED');
      expect(effect(r, 'CREATE_SEATING')).toEqual({
        type: 'CREATE_SEATING',
        source: 'WALK_IN',
        seatedBy: 'STAFF',
        partySize: 4,
      });
      expect(types(r)).toContain('START_GREET_SLA');
    });

    it('camera seats a vacant table with its guest count', () => {
      const r = run('VACANT', { type: 'CAMERA_OCCUPIED', guestCount: 3 }, CAMERA);
      expect(next(r)).toBe('OCCUPIED');
      expect(effect(r, 'CREATE_SEATING')).toMatchObject({ seatedBy: 'CAMERA', partySize: 3 });
    });

    it('host seating a reserved table defaults to a RESERVATION seating', () => {
      expect(effect(run('RESERVED', { type: 'HOST_SEAT' }, staff('HOST')), 'CREATE_SEATING')?.source).toBe(
        'RESERVATION',
      );
    });

    it('camera seeing guests at a reserved table seats them and alerts the host', () => {
      const r = run('RESERVED', { type: 'CAMERA_OCCUPIED' }, CAMERA);
      expect(next(r)).toBe('OCCUPIED');
      expect(effect(r, 'RAISE_ALERT')).toMatchObject({ alert: 'RESERVED_TABLE_TAKEN' });
    });

    it('a host seating a walk-in on a held table alerts; seating the booking does not', () => {
      const walkIn = run('RESERVED', { type: 'HOST_SEAT', source: 'WALK_IN' }, staff('HOST'));
      expect(effect(walkIn, 'RAISE_ALERT')).toMatchObject({ alert: 'RESERVED_TABLE_TAKEN' });
      expect(effect(run('RESERVED', { type: 'HOST_SEAT' }, staff('HOST')), 'RAISE_ALERT')).toBeUndefined();
    });

    it('seating a dirty table cancels the clean task and alerts', () => {
      const r = run('NEEDS_CLEANING', { type: 'HOST_SEAT', partySize: 2 }, staff('HOST'));
      expect(next(r)).toBe('OCCUPIED');
      expect(effect(r, 'CANCEL_TASKS')?.tasks).toEqual(['CLEAN']);
      expect(effect(r, 'RAISE_ALERT')?.alert).toBe('SEATED_AT_DIRTY_TABLE');
    });

    it.each(SEATED)('host cannot seat an already seated table (%s)', (from) => {
      expect(next(run(from, { type: 'HOST_SEAT' }, staff('HOST')))).toBe('REJECT:INVALID_FROM_STATE');
    });

    it.each(SEATED)('camera re-confirming %s is a no-op (or just a count update)', (from) => {
      expect(run(from, { type: 'CAMERA_OCCUPIED' }, CAMERA)).toMatchObject({
        ok: true,
        next: from,
        noop: true,
      });
      expect(types(run(from, { type: 'CAMERA_OCCUPIED', guestCount: 5 }, CAMERA))).toEqual([
        'UPDATE_PARTY_SIZE',
      ]);
    });

    it('out-of-service tables ignore the camera and reject seating', () => {
      expect(run('OUT_OF_SERVICE', { type: 'CAMERA_OCCUPIED' }, CAMERA)).toMatchObject({
        ok: true,
        noop: true,
      });
      expect(next(run('OUT_OF_SERVICE', { type: 'HOST_SEAT' }, MANAGER))).toBe('REJECT:INVALID_FROM_STATE');
    });
  });

  describe('greet (rows 5–6)', () => {
    it('"At table" greets an occupied table and clears the SLA', () => {
      const r = run('OCCUPIED', { type: 'GREET' }, WAITER);
      expect(next(r)).toBe('GREETED');
      expect(types(r)).toEqual(['SET_SEATING_TS', 'CANCEL_GREET_SLA', 'CANCEL_TASKS', 'RESOLVE_ALERTS']);
    });

    it('greeting after a QR order already landed goes straight to ORDERED', () => {
      expect(next(run('OCCUPIED', { type: 'GREET' }, WAITER, { seating: { hasAcceptedOrder: true } }))).toBe(
        'ORDERED',
      );
    });

    it.each(SEATED.filter((s) => s !== 'OCCUPIED'))('repeat greet on %s is a harmless no-op', (from) => {
      expect(run(from, { type: 'GREET' }, WAITER)).toMatchObject({ ok: true, noop: true });
    });

    it.each(UNSEATED)('greet on %s is rejected', (from) => {
      expect(next(run(from, { type: 'GREET' }, WAITER))).toBe('REJECT:INVALID_FROM_STATE');
    });

    it('busser and host cannot greet', () => {
      expect(next(run('OCCUPIED', { type: 'GREET' }, staff('BUSSER')))).toBe('REJECT:FORBIDDEN');
      expect(next(run('OCCUPIED', { type: 'GREET' }, staff('HOST')))).toBe('REJECT:FORBIDDEN');
    });

    describe('camera staff-present', () => {
      const present = (seconds: number, confidence: number) => ({
        type: 'CAMERA_STAFF_PRESENT' as const,
        seconds,
        confidence,
      });

      it('is ignored while camera greet is disabled (the default)', () => {
        expect(run('OCCUPIED', present(30, 0.99), CAMERA)).toMatchObject({ ok: true, noop: true });
      });

      it('greets when enabled and strong enough', () => {
        const on = { settings: { cameraGreetEnabled: true } };
        expect(next(run('OCCUPIED', present(10, 0.7), CAMERA, on))).toBe('GREETED');
        expect(run('OCCUPIED', present(9, 0.9), CAMERA, on)).toMatchObject({ noop: true });
        expect(run('OCCUPIED', present(20, 0.5), CAMERA, on)).toMatchObject({ noop: true });
        expect(run('GREETED', present(20, 0.9), CAMERA, on)).toMatchObject({ noop: true });
      });
    });
  });

  describe('order and serve (rows 7–8)', () => {
    it('first order on a greeted table → ORDERED', () => {
      const r = run('GREETED', { type: 'ORDER_ACCEPTED', orderSource: 'QR' }, SYSTEM);
      expect(next(r)).toBe('ORDERED');
      expect(effect(r, 'SET_SEATING_TS')?.field).toBe('firstOrderAt');
    });

    it('a waiter-taken order on an occupied table also counts as greet', () => {
      const r = run('OCCUPIED', { type: 'ORDER_ACCEPTED', orderSource: 'WAITER' }, SYSTEM);
      expect(next(r)).toBe('ORDERED');
      expect(types(r)).toContain('CANCEL_GREET_SLA');
    });

    it('a QR order does not satisfy greet unless configured', () => {
      const r = run('OCCUPIED', { type: 'ORDER_ACCEPTED', orderSource: 'QR' }, SYSTEM);
      expect(next(r)).toBe('OCCUPIED');
      expect(types(r)).toEqual(['SET_SEATING_TS']); // SLA keeps running
      const r2 = run('OCCUPIED', { type: 'ORDER_ACCEPTED', orderSource: 'QR' }, SYSTEM, {
        settings: { qrOrderSatisfiesGreet: true },
      });
      expect(next(r2)).toBe('ORDERED');
    });

    it.each(['ORDERED', 'SERVED', 'BILL_REQUESTED'] as const)(
      'later orders on %s do not move the table',
      (from) => {
        expect(run(from, { type: 'ORDER_ACCEPTED', orderSource: 'QR' }, SYSTEM)).toMatchObject({
          ok: true,
          noop: true,
        });
      },
    );

    it('orders cannot be accepted on a paid or unseated table', () => {
      for (const from of [...UNSEATED, 'PAID' as const]) {
        expect(next(run(from, { type: 'ORDER_ACCEPTED', orderSource: 'QR' }, SYSTEM))).toBe(
          'REJECT:INVALID_FROM_STATE',
        );
      }
    });

    it('staff cannot fake order/serve/payment events', () => {
      expect(next(run('GREETED', { type: 'ORDER_ACCEPTED', orderSource: 'WAITER' }, MANAGER))).toBe(
        'REJECT:FORBIDDEN',
      );
      expect(next(run('ORDERED', { type: 'FIRST_ORDER_SERVED' }, MANAGER))).toBe('REJECT:FORBIDDEN');
      expect(next(run('BILL_REQUESTED', { type: 'PAYMENT_CAPTURED' }, MANAGER))).toBe('REJECT:FORBIDDEN');
    });

    it('serve requires every item of the first order served', () => {
      expect(next(run('ORDERED', { type: 'FIRST_ORDER_SERVED' }, SYSTEM))).toBe('REJECT:GUARD_FAILED');
      const r = run('ORDERED', { type: 'FIRST_ORDER_SERVED' }, SYSTEM, {
        seating: { allFirstOrderServed: true },
      });
      expect(next(r)).toBe('SERVED');
      expect(effect(r, 'SET_SEATING_TS')?.field).toBe('servedAt');
    });
  });

  describe('bill and pay (rows 9–10)', () => {
    it.each(['OCCUPIED', 'GREETED', 'ORDERED', 'SERVED'] as const)(
      'bill can be requested from %s',
      (from) => {
        const r = run(from, { type: 'REQUEST_BILL' }, GUEST);
        expect(next(r)).toBe('BILL_REQUESTED');
        expect(effect(r, 'CREATE_TASK')?.task).toBe('BILL');
      },
    );

    it('requesting the bill twice is a no-op; after paying it is rejected', () => {
      expect(run('BILL_REQUESTED', { type: 'REQUEST_BILL' }, GUEST)).toMatchObject({ noop: true });
      expect(next(run('PAID', { type: 'REQUEST_BILL' }, WAITER))).toBe('REJECT:INVALID_FROM_STATE');
    });

    it('guests may only request the bill', () => {
      expect(next(run('OCCUPIED', { type: 'GREET' }, GUEST))).toBe('REJECT:FORBIDDEN');
      expect(next(run('VACANT', { type: 'HOST_SEAT' }, GUEST))).toBe('REJECT:FORBIDDEN');
    });

    it('payment closes the bill task only when fully paid', () => {
      expect(next(run('BILL_REQUESTED', { type: 'PAYMENT_CAPTURED' }, SYSTEM))).toBe('REJECT:GUARD_FAILED');
      const r = run('BILL_REQUESTED', { type: 'PAYMENT_CAPTURED' }, SYSTEM, { seating: { isPaid: true } });
      expect(next(r)).toBe('PAID');
      expect(effect(r, 'CANCEL_TASKS')?.tasks).toEqual(['BILL']);
    });
  });

  describe('leave and clean (rows 11–14)', () => {
    it('camera vacancy after payment → NEEDS_CLEANING with a clean task', () => {
      const r = run('PAID', { type: 'CAMERA_VACATED' }, CAMERA, {
        seating: { isPaid: true, hasAcceptedOrder: true },
      });
      expect(next(r)).toBe('NEEDS_CLEANING');
      expect(types(r)).toEqual(expect.arrayContaining(['CLOSE_SEATING', 'CANCEL_GREET_SLA', 'CREATE_TASK']));
      expect(effect(r, 'CREATE_TASK')?.task).toBe('CLEAN');
    });

    it.each(['OCCUPIED', 'GREETED', 'ORDERED', 'SERVED', 'BILL_REQUESTED'] as const)(
      'camera vacancy on unpaid %s with an order raises LEFT_WITHOUT_PAYING and does not close',
      (from) => {
        const r = run(from, { type: 'CAMERA_VACATED' }, CAMERA, { seating: { hasAcceptedOrder: true } });
        expect(next(r)).toBe(from);
        expect(types(r)).toEqual(['RAISE_ALERT']);
        expect(effect(r, 'RAISE_ALERT')).toMatchObject({
          alert: 'LEFT_WITHOUT_PAYING',
          severity: 'CRITICAL',
        });
      },
    );

    it('camera vacancy before anything was ordered changes nothing (staff confirm departure)', () => {
      expect(run('GREETED', { type: 'CAMERA_VACATED' }, CAMERA)).toMatchObject({ ok: true, noop: true });
    });

    it.each(UNSEATED)('camera vacancy on %s is a no-op', (from) => {
      expect(run(from, { type: 'CAMERA_VACATED' }, CAMERA)).toMatchObject({ ok: true, noop: true });
    });

    it('any floor staff can mark a table left when nothing is owed', () => {
      expect(next(run('GREETED', { type: 'STAFF_MARK_LEFT' }, staff('BUSSER')))).toBe('NEEDS_CLEANING');
      expect(
        next(
          run('PAID', { type: 'STAFF_MARK_LEFT' }, WAITER, {
            seating: { hasAcceptedOrder: true, isPaid: true },
          }),
        ),
      ).toBe('NEEDS_CLEANING');
    });

    it('only a manager or cashier can close a table that still owes money', () => {
      const owes = { seating: { hasAcceptedOrder: true } };
      expect(next(run('SERVED', { type: 'STAFF_MARK_LEFT' }, WAITER, owes))).toBe('REJECT:FORBIDDEN');
      expect(next(run('SERVED', { type: 'STAFF_MARK_LEFT' }, staff('CASHIER'), owes))).toBe('NEEDS_CLEANING');
      expect(next(run('SERVED', { type: 'STAFF_MARK_LEFT' }, MANAGER, owes))).toBe('NEEDS_CLEANING');
    });

    it.each(UNSEATED)('marking %s as left is rejected', (from) => {
      expect(next(run(from, { type: 'STAFF_MARK_LEFT' }, MANAGER))).toBe('REJECT:INVALID_FROM_STATE');
    });

    it('busser confirms clean → VACANT', () => {
      const r = run('NEEDS_CLEANING', { type: 'CLEAN_CONFIRMED' }, staff('BUSSER'));
      expect(next(r)).toBe('VACANT');
      expect(types(r)).toEqual(['MARK_CLEANED', 'CANCEL_TASKS']);
      expect(run('VACANT', { type: 'CLEAN_CONFIRMED' }, staff('BUSSER'))).toMatchObject({ noop: true });
      expect(next(run('OCCUPIED', { type: 'CLEAN_CONFIRMED' }, staff('BUSSER')))).toBe(
        'REJECT:INVALID_FROM_STATE',
      );
      expect(next(run('NEEDS_CLEANING', { type: 'CLEAN_CONFIRMED' }, staff('CHEF')))).toBe(
        'REJECT:FORBIDDEN',
      );
    });
  });

  describe('holds and service (rows 15–18)', () => {
    it('host holds and releases a vacant table', () => {
      expect(next(run('VACANT', { type: 'HOLD_FOR_RESERVATION' }, staff('HOST')))).toBe('RESERVED');
      expect(next(run('RESERVED', { type: 'RELEASE_HOLD' }, staff('HOST')))).toBe('VACANT');
      expect(next(run('OCCUPIED', { type: 'HOLD_FOR_RESERVATION' }, staff('HOST')))).toBe(
        'REJECT:INVALID_FROM_STATE',
      );
      expect(next(run('VACANT', { type: 'HOLD_FOR_RESERVATION' }, WAITER))).toBe('REJECT:FORBIDDEN');
    });

    it('managers take tables out of and back into service', () => {
      expect(next(run('VACANT', { type: 'SET_OUT_OF_SERVICE' }, MANAGER))).toBe('OUT_OF_SERVICE');
      const dirty = run('NEEDS_CLEANING', { type: 'SET_OUT_OF_SERVICE' }, MANAGER);
      expect(next(dirty)).toBe('OUT_OF_SERVICE');
      expect(effect(dirty, 'CANCEL_TASKS')?.tasks).toEqual(['CLEAN']);
      expect(next(run('OCCUPIED', { type: 'SET_OUT_OF_SERVICE' }, MANAGER))).toBe(
        'REJECT:INVALID_FROM_STATE',
      );
      expect(next(run('OUT_OF_SERVICE', { type: 'RETURN_TO_SERVICE' }, MANAGER))).toBe('VACANT');
      expect(next(run('VACANT', { type: 'SET_OUT_OF_SERVICE' }, staff('HOST')))).toBe('REJECT:FORBIDDEN');
    });
  });

  describe('manager force (row 19)', () => {
    const force = (from: TableStatus, to: TableStatus, seating?: Partial<SeatingFacts> | null) =>
      run(from, { type: 'FORCE_STATE', to }, MANAGER, { seating });

    it('is managers only', () => {
      expect(next(run('VACANT', { type: 'FORCE_STATE', to: 'PAID' }, staff('HOST')))).toBe(
        'REJECT:FORBIDDEN',
      );
    });

    it('forcing to the same state is a no-op', () => {
      expect(force('ORDERED', 'ORDERED')).toMatchObject({ ok: true, noop: true });
    });

    it('opening a seated state without a seating creates one (SLA only for OCCUPIED)', () => {
      expect(types(force('VACANT', 'OCCUPIED', null))).toEqual(['CREATE_SEATING', 'START_GREET_SLA']);
      expect(types(force('VACANT', 'ORDERED', null))).toEqual(['CREATE_SEATING']);
    });

    it('moving an occupied table forward counts as greet', () => {
      expect(types(force('OCCUPIED', 'SERVED'))).toContain('CANCEL_GREET_SLA');
    });

    it('leaving the seated states closes the seating; cleaning only when targeted', () => {
      const toVacant = force('ORDERED', 'VACANT');
      expect(types(toVacant)).toContain('CLOSE_SEATING');
      expect(types(toVacant)).not.toContain('CREATE_TASK');
      expect(effect(force('ORDERED', 'NEEDS_CLEANING'), 'CREATE_TASK')?.task).toBe('CLEAN');
    });

    it('leaving NEEDS_CLEANING cancels the clean task', () => {
      expect(effect(force('NEEDS_CLEANING', 'VACANT', null), 'CANCEL_TASKS')?.tasks).toEqual(['CLEAN']);
    });
  });

  describe('invariants over every state × event', () => {
    const events: [TableMachineEvent, Actor][] = [
      [{ type: 'HOST_SEAT' }, MANAGER],
      [{ type: 'GREET' }, MANAGER],
      [{ type: 'REQUEST_BILL' }, MANAGER],
      [{ type: 'STAFF_MARK_LEFT' }, MANAGER],
      [{ type: 'CLEAN_CONFIRMED' }, MANAGER],
      [{ type: 'HOLD_FOR_RESERVATION' }, MANAGER],
      [{ type: 'RELEASE_HOLD' }, MANAGER],
      [{ type: 'SET_OUT_OF_SERVICE' }, MANAGER],
      [{ type: 'RETURN_TO_SERVICE' }, MANAGER],
      [{ type: 'CAMERA_OCCUPIED', guestCount: 2 }, CAMERA],
      [{ type: 'CAMERA_VACATED' }, CAMERA],
      [{ type: 'CAMERA_STAFF_PRESENT', seconds: 60, confidence: 1 }, CAMERA],
      [{ type: 'GUEST_COUNT_CHANGED', guestCount: 2 }, CAMERA],
      [{ type: 'ORDER_ACCEPTED', orderSource: 'QR' }, SYSTEM],
      [{ type: 'FIRST_ORDER_SERVED' }, SYSTEM],
      [{ type: 'PAYMENT_CAPTURED' }, SYSTEM],
      ...TABLE_STATUSES.map((to): [TableMachineEvent, Actor] => [{ type: 'FORCE_STATE', to }, MANAGER]),
    ];
    const cases = TABLE_STATUSES.flatMap((from) => events.map(([e, a]) => [from, e, a] as const));

    it.each(cases)('%s + %o keeps the seating consistent', (from, event, actor) => {
      const r = run(from, event, actor, {
        seating: isSeated(from) ? { allFirstOrderServed: true, isPaid: true } : null,
      });
      if (!r.ok) {
        expect(['INVALID_FROM_STATE', 'GUARD_FAILED', 'FORBIDDEN']).toContain(r.reason);
        return;
      }
      const t = types(r);
      // A seating is created exactly when entering a seated state from an unseated one.
      expect(t.includes('CREATE_SEATING')).toBe(!isSeated(from) && isSeated(r.next));
      // A seating is closed exactly when leaving the seated states.
      expect(t.includes('CLOSE_SEATING')).toBe(isSeated(from) && !isSeated(r.next));
      // The greet timer only ever starts on entering OCCUPIED.
      if (t.includes('START_GREET_SLA')) expect(r.next).toBe('OCCUPIED');
      // Camera events never move a table backwards out of service, nor into VACANT.
      if (actor.kind === 'CAMERA') expect(r.next === 'VACANT' && from !== 'VACANT').toBe(false);
      // No duplicate effects of the same kind (keeps the service simple).
      const kinds = t.filter((k) => k !== 'SET_SEATING_TS');
      expect(new Set(kinds).size).toBe(kinds.length);
    });
  });
});
