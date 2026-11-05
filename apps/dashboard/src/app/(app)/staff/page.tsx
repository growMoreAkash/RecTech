'use client';

import { localDate, localDayRange, ROLES, type Role } from '@dinesense/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { Button } from '@dinesense/ui/button';
import { Field, Input, Select } from '@dinesense/ui/field';
import { api } from '@/lib/api';
import { useFloor, useOutletMutation, useShifts, useStaff } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { Shift, StaffMember } from '@/lib/types';
import { cn, formText } from '@/lib/utils';

export default function StaffPage() {
  const t = useTranslations();
  const [tab, setTab] = useState<'shifts' | 'team'>('shifts');
  return (
    <div className="space-y-4 p-4">
      <div role="tablist" aria-label={t('nav.staff')} className="flex gap-1">
        {(['shifts', 'team'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium',
              tab === k ? 'bg-orange-50 text-brand' : 'hover:bg-slate-100',
            )}
          >
            {t(`staff.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === 'shifts' ? <Shifts /> : <Team />}</div>
    </div>
  );
}

function shiftStatus(s: Shift): 'scheduled' | 'onShift' | 'onBreak' | 'done' {
  if (s.checkedOutAt) return 'done';
  if (!s.checkedInAt) return 'scheduled';
  return s.onBreak ? 'onBreak' : 'onShift';
}

const STATUS_CLASS = {
  scheduled: 'bg-slate-100 text-slate-700',
  onShift: 'bg-emerald-100 text-emerald-800',
  onBreak: 'bg-amber-100 text-amber-800',
  done: 'bg-slate-200 text-slate-500',
};

function Shifts() {
  const t = useTranslations();
  const format = useFormatter();
  const { outlet, can, me } = useSession();
  const [date, setDate] = useState(() => localDate(new Date(), outlet.timezone));
  const shifts = useShifts(outlet.id, date);
  const floor = useFloor(outlet.id);
  const sectionName = new Map(floor.data?.sections.map((s) => [s.id, s.name]));
  const manager = can('OWNER', 'MANAGER');
  const act = useOutletMutation(
    outlet.id,
    ({ id, path, body }: { id: string; path: string; body?: object }) =>
      api(`/outlets/${outlet.id}/shifts/${id}/${path}`, { method: 'POST', body }),
  );
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('shifts.date')}>
          {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
      </div>
      <ErrorText error={shifts.error ?? act.error} />
      {shifts.data?.shifts.length === 0 ? (
        <p className="text-sm text-slate-500">{t('shifts.empty')}</p>
      ) : null}
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {shifts.data?.shifts.map((s) => {
          const st = shiftStatus(s);
          const mine = s.userId === me.id;
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-48 flex-1">
                <p className="font-medium">{s.user.name}</p>
                <p className="text-xs text-slate-500">
                  {t(`roles.${s.role}`)} · {time(s.startsAt)}–{time(s.endsAt)} ·{' '}
                  {s.sectionIds.length
                    ? s.sectionIds.map((id) => sectionName.get(id) ?? '?').join(', ')
                    : t('shifts.allSections')}
                  {s.maxTables ? ` · ${t('shifts.maxTables')} ${s.maxTables}` : ''}
                </p>
              </div>
              {s.checkInSeq ? (
                <span className="text-xs text-slate-500">{t('shifts.order', { n: s.checkInSeq })}</span>
              ) : null}
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_CLASS[st])}>
                {t(`shifts.${st}`)}
              </span>
              {manager || mine ? (
                <div className="flex gap-2">
                  {st === 'scheduled' ? (
                    <Button size="sm" onClick={() => act.mutate({ id: s.id, path: 'check-in' })}>
                      {t('shifts.checkIn')}
                    </Button>
                  ) : null}
                  {st === 'onShift' || st === 'onBreak' ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          act.mutate({ id: s.id, path: 'break', body: { onBreak: st === 'onShift' } })
                        }
                      >
                        {st === 'onShift' ? t('shifts.startBreak') : t('shifts.endBreak')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => act.mutate({ id: s.id, path: 'check-out' })}
                      >
                        {t('shifts.checkOut')}
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {manager ? <AddShift date={date} /> : null}
    </div>
  );
}

function AddShift({ date }: { date: string }) {
  const t = useTranslations();
  const { outlet } = useSession();
  const staff = useStaff(outlet.id);
  const floor = useFloor(outlet.id);
  const [userId, setUserId] = useState('');
  const person = staff.data?.find((s) => s.id === userId);
  const create = useOutletMutation(outlet.id, (body: object) =>
    api(`/outlets/${outlet.id}/shifts`, { method: 'POST', body }),
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    // Times are entered in outlet-local time on the selected day.
    const { start: dayStart } = localDayRange(date, outlet.timezone);
    const at = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return new Date(dayStart.getTime() + ((h ?? 0) * 60 + (m ?? 0)) * 60_000);
    };
    const startsAt = at(formText(d, 'start'));
    let endsAt = at(formText(d, 'end'));
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000); // overnight
    const maxTables = Number(formText(d, 'maxTables'));
    create.mutate(
      {
        userId,
        role: formText(d, 'role'),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        sectionIds: d.getAll('sectionIds').filter((v): v is string => typeof v === 'string'),
        ...(maxTables ? { maxTables } : {}),
      },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      aria-labelledby="add-shift-h"
    >
      <h2 id="add-shift-h" className="font-semibold">
        {t('shifts.addShift')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t('shifts.person')}>
          {(p) => (
            <Select {...p} required value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="" disabled>
                —
              </option>
              {staff.data
                ?.filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t('staff.role')}>
          {(p) => (
            <Select {...p} name="role" required key={userId}>
              {(person?.roles ?? []).map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('shifts.start')}>
          {(p) => <Input {...p} name="start" type="time" defaultValue="11:00" required />}
        </Field>
        <Field label={t('shifts.end')}>
          {(p) => <Input {...p} name="end" type="time" defaultValue="23:00" required />}
        </Field>
        <Field label={t('shifts.maxTables')}>
          {(p) => <Input {...p} name="maxTables" type="number" min={1} max={50} placeholder="4" />}
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">{t('shifts.sections')}</legend>
        <div className="mt-1 flex flex-wrap gap-4">
          {floor.data?.sections.map((s) => (
            <label key={s.id} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="sectionIds" value={s.id} />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorText error={create.error} />
      <Button type="submit" disabled={create.isPending || !userId}>
        {t('shifts.addShift')}
      </Button>
    </form>
  );
}

function Team() {
  const t = useTranslations();
  const { outlet, can } = useSession();
  const staff = useStaff(outlet.id);
  const manager = can('OWNER', 'MANAGER');
  const toggle = useOutletMutation(outlet.id, (s: StaffMember) =>
    api(`/outlets/${outlet.id}/staff/${s.id}`, { method: 'PATCH', body: { active: !s.active } }),
  );

  return (
    <div className="space-y-4">
      <ErrorText error={staff.error ?? toggle.error} />
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {staff.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex-1">
              <p className={cn('font-medium', !s.active && 'text-slate-400 line-through')}>{s.name}</p>
              <p className="text-xs text-slate-500">
                {s.roles.map((r) => t(`roles.${r}`)).join(', ')}
                {s.email ? ` · ${s.email}` : ''}
              </p>
            </div>
            <span className="text-xs">{s.active ? t('staff.active') : t('staff.inactive')}</span>
            {manager ? (
              <Button size="sm" variant="secondary" onClick={() => toggle.mutate(s)}>
                {s.active ? t('staff.deactivate') : t('staff.activate')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {manager ? <AddStaff /> : null}
    </div>
  );
}

function AddStaff() {
  const t = useTranslations();
  const { outlet, can } = useSession();
  const [done, setDone] = useState(false);
  const create = useOutletMutation(outlet.id, (body: object) =>
    api(`/outlets/${outlet.id}/staff`, { method: 'POST', body }),
  );
  // Managers may add floor staff; only owners add owners/managers (the API enforces this too).
  const grantable: readonly Role[] = can('OWNER')
    ? ROLES
    : ROLES.filter((r) => r !== 'OWNER' && r !== 'MANAGER');

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = Object.fromEntries(
      [...new FormData(form).entries()].filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
    );
    setDone(false);
    create.mutate(d, {
      onSuccess: () => {
        form.reset();
        setDone(true);
      },
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      aria-labelledby="add-staff-h"
    >
      <h2 id="add-staff-h" className="font-semibold">
        {t('staff.addStaff')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t('staff.name')}>{(p) => <Input {...p} name="name" required maxLength={80} />}</Field>
        <Field label={t('staff.role')}>
          {(p) => (
            <Select {...p} name="role" required defaultValue="WAITER">
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staff.pin')}>
          {(p) => <Input {...p} name="pin" required inputMode="numeric" pattern="\d{4,6}" />}
        </Field>
        <Field label={`${t('staff.email')} (${t('common.optional')})`}>
          {(p) => <Input {...p} name="email" type="email" />}
        </Field>
        <Field label={`${t('staff.password')} (${t('common.optional')})`} hint={t('staff.passwordHint')}>
          {(p) => <Input {...p} name="password" type="password" minLength={8} autoComplete="new-password" />}
        </Field>
      </div>
      <ErrorText error={create.error} />
      {done ? (
        <p role="status" className="text-sm text-emerald-700">
          {t('staff.created')}
        </p>
      ) : null}
      <Button type="submit" disabled={create.isPending}>
        {t('staff.addStaff')}
      </Button>
    </form>
  );
}
