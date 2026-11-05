'use client';

import {
  type Actor,
  type MachineContext,
  STAFF_EVENTS,
  TABLE_STATUSES,
  type TableMachineEvent,
  type TableStatus,
  transition,
} from '@dinesense/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { elapsedSince, formatDuration } from '@/lib/floor-style';
import { useOutletMutation, useTimeline } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { FloorSnapshot, FloorTable } from '@/lib/types';
import { formText, useNow } from '@/lib/utils';

/** Events offered as buttons, in display order (HOST_SEAT has its own form; FORCE_STATE its own control). */
type ActionEvent = Exclude<TableMachineEvent['type'], 'HOST_SEAT' | 'FORCE_STATE'>;
const ACTION_EVENTS = STAFF_EVENTS.filter((e): e is ActionEvent => e !== 'HOST_SEAT' && e !== 'FORCE_STATE');

/** Asks the shared state machine which actions this user may take now — the same rules the API enforces. */
function allowed(table: FloorTable, actor: Actor, event: TableMachineEvent): boolean {
  const s = table.live.seating;
  const ctx: MachineContext = {
    settings: {
      cameraGreetEnabled: false,
      staffPresentSeconds: 10,
      staffPresentMinConfidence: 0.7,
      qrOrderSatisfiesGreet: false,
    },
    seating: s
      ? { hasAcceptedOrder: !!s.firstOrderAt, allFirstOrderServed: false, isPaid: !!s.paidAt }
      : null,
    actor,
  };
  const r = transition(table.live.status, event, ctx);
  return r.ok && !r.noop;
}

export function TableDrawer({
  table,
  floor,
  onClose,
}: {
  table: FloorTable | null;
  floor: FloorSnapshot;
  onClose: () => void;
}) {
  const t = useTranslations();
  return (
    <Sheet
      open={!!table}
      onOpenChange={(o) => !o && onClose()}
      title={table ? table.label : ''}
      description={table ? floor.sections.find((s) => s.id === table.sectionId)?.name : undefined}
    >
      {table ? <DrawerBody key={table.id} table={table} floor={floor} /> : <span>{t('common.loading')}</span>}
    </Sheet>
  );
}

function DrawerBody({ table, floor }: { table: FloorTable; floor: FloorSnapshot }) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow();
  const { outlet, me, roles, can } = useSession();
  const actor: Actor = { kind: 'STAFF', userId: me.id, roles };
  const timeline = useTimeline(outlet.id, table.id);
  const seating = table.live.seating;

  const send = useOutletMutation(outlet.id, (body: { event: string; to?: TableStatus }) =>
    api(`/outlets/${outlet.id}/tables/${table.id}/transitions`, {
      method: 'POST',
      body: { ...body, expectedVersion: table.live.version },
    }),
  );

  const canSeat = allowed(table, actor, { type: 'HOST_SEAT' });
  const actions = ACTION_EVENTS.filter((e) => allowed(table, actor, { type: e } as TableMachineEvent));

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-500">{t('drawer.status')}</dt>
        <dd>
          <StatusBadge status={table.live.status} />
        </dd>
        <dt className="text-slate-500">{t('drawer.capacity')}</dt>
        <dd>{t('floor.seats', { count: table.capacity })}</dd>
        {seating ? (
          <>
            <dt className="text-slate-500">{t('drawer.party')}</dt>
            <dd>{seating.partySize ? t('floor.guests', { count: seating.partySize }) : '—'}</dd>
            <dt className="text-slate-500">{t('drawer.seatedAt')}</dt>
            <dd>
              {format.dateTime(new Date(seating.seatedAt), { hour: '2-digit', minute: '2-digit' })} ·{' '}
              {formatDuration(elapsedSince(seating.seatedAt, now))}
            </dd>
            <dt className="text-slate-500">{t('drawer.waiter')}</dt>
            <dd>{seating.servingWaiter?.name ?? t('drawer.noWaiter')}</dd>
            {seating.notes ? (
              <>
                <dt className="text-slate-500">{t('drawer.notes')}</dt>
                <dd>{seating.notes}</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>

      {canSeat ? <SeatForm table={table} floor={floor} /> : null}

      {actions.length ? (
        <section aria-labelledby="actions-h" className="space-y-2">
          <h3 id="actions-h" className="text-sm font-semibold">
            {t('drawer.actions')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {actions.map((e) => (
              <Button
                key={e}
                variant={e === 'GREET' || e === 'CLEAN_CONFIRMED' ? 'primary' : 'secondary'}
                disabled={send.isPending}
                onClick={() => send.mutate({ event: e })}
              >
                {t(`actions.${e}`)}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      <ErrorText error={send.error} />

      {can('OWNER', 'MANAGER') ? (
        <ForceState
          table={table}
          onForce={(to) => send.mutate({ event: 'FORCE_STATE', to })}
          busy={send.isPending}
        />
      ) : null}

      <section aria-labelledby="timeline-h" className="space-y-2">
        <h3 id="timeline-h" className="text-sm font-semibold">
          {t('drawer.timeline')}
        </h3>
        {timeline.data?.events.length ? (
          <ol className="space-y-1.5 text-sm">
            {timeline.data.events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center gap-2">
                <time className="w-20 shrink-0 tabular-nums text-slate-500" dateTime={ev.occurredAt}>
                  {format.dateTime(new Date(ev.occurredAt), { hour: '2-digit', minute: '2-digit' })}
                </time>
                <span>{t.has(`events.${ev.type}`) ? t(`events.${ev.type}` as 'events.GREET') : ev.type}</span>
                {ev.toStatus ? <StatusBadge status={ev.toStatus} /> : null}
                <span className="text-xs text-slate-500">
                  {ev.actorName
                    ? t('drawer.by', { name: ev.actorName })
                    : ev.source === 'CAMERA'
                      ? t('drawer.camera')
                      : ev.source === 'SYSTEM'
                        ? t('drawer.system')
                        : ''}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">{t('drawer.noEvents')}</p>
        )}
      </section>
    </div>
  );
}

function SeatForm({ table, floor }: { table: FloorTable; floor: FloorSnapshot }) {
  const t = useTranslations('seat');
  const { outlet } = useSession();
  const [party, setParty] = useState(Math.min(2, table.capacity));
  const [join, setJoin] = useState<string[]>([]);
  const free = new Set<TableStatus>(['VACANT', 'RESERVED', 'NEEDS_CLEANING']);
  const joinable = floor.tables.filter((x) => table.joinableWith.includes(x.id) && free.has(x.live.status));
  const capacity =
    table.capacity + floor.tables.filter((x) => join.includes(x.id)).reduce((s, x) => s + x.capacity, 0);

  const seat = useOutletMutation(outlet.id, (body: object) =>
    api(`/outlets/${outlet.id}/tables/${table.id}/seat`, { method: 'POST', body }),
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const notes = formText(new FormData(e.currentTarget), 'notes').trim();
    seat.mutate({
      partySize: party,
      ...(notes ? { notes } : {}),
      ...(join.length ? { joinTableIds: join } : {}),
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-slate-200 p-3"
      aria-labelledby="seat-h"
    >
      <h3 id="seat-h" className="text-sm font-semibold">
        {t('title')}
      </h3>
      <Field label={t('partySize')} hint={party > capacity ? t('tooBig', { capacity }) : undefined}>
        {(p) => (
          <Input
            {...p}
            type="number"
            min={1}
            max={60}
            value={party}
            onChange={(e) => setParty(Number(e.target.value))}
            required
          />
        )}
      </Field>
      <Field label={t('notes')}>
        {(p) => <Input {...p} name="notes" maxLength={280} placeholder={t('notesPlaceholder')} />}
      </Field>
      {joinable.length ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-slate-700">{t('joinTables')}</legend>
          {joinable.map((x) => (
            <label key={x.id} className="mr-4 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={join.includes(x.id)}
                onChange={(e) =>
                  setJoin((j) => (e.target.checked ? [...j, x.id] : j.filter((id) => id !== x.id)))
                }
              />
              {x.label} ({x.capacity})
            </label>
          ))}
        </fieldset>
      ) : null}
      <ErrorText error={seat.error} />
      <Button type="submit" disabled={seat.isPending} className="w-full">
        {t('submit')}
      </Button>
    </form>
  );
}

function ForceState({
  table,
  onForce,
  busy,
}: {
  table: FloorTable;
  onForce: (to: TableStatus) => void;
  busy: boolean;
}) {
  const t = useTranslations();
  const [to, setTo] = useState<TableStatus>(table.live.status);
  return (
    <details className="rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold">{t('drawer.force')}</summary>
      <p className="mt-2 text-xs text-slate-500">{t('drawer.forceHint')}</p>
      <div className="mt-2 flex gap-2">
        <Select
          value={to}
          onChange={(e) => setTo(e.target.value as TableStatus)}
          aria-label={t('drawer.force')}
        >
          {TABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`tableStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Button variant="danger" disabled={busy || to === table.live.status} onClick={() => onForce(to)}>
          {t('drawer.forceApply')}
        </Button>
      </div>
    </details>
  );
}
