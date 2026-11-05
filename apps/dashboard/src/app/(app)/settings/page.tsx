'use client';

import { ASSIGNMENT_MODES, type OutletSettingsInput } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Field, Input, Select } from '@dinesense/ui/field';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { useHours, useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { OpeningWindow } from '@/lib/types';
import { formText } from '@/lib/utils';

type Settings = OutletSettingsInput;

/** Outlet settings: the greet ladder, assignment mode, ordering rules, billing and camera thresholds. */
export default function SettingsPage() {
  const t = useTranslations('settings');
  const { outlet, can } = useSession();
  const settings = useQuery({
    queryKey: ['outlet', outlet.id, 'settings'],
    queryFn: () => api<Settings>(`/outlets/${outlet.id}/settings`),
  });
  const [saved, setSaved] = useState(false);
  const save = useOutletMutation(outlet.id, (body: Partial<Settings>) =>
    api(`/outlets/${outlet.id}/settings`, { method: 'PATCH', body }),
  );
  const manager = can('OWNER', 'MANAGER');

  if (!settings.data)
    return (
      <div className="p-4" aria-busy="true">
        <ErrorText error={settings.error} />
      </div>
    );
  const s = settings.data;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const min = (k: string) => Math.round(Number(formText(d, k)) * 60);
    const num = (k: string) => Number(formText(d, k));
    const on = (k: string) => d.get(k) === 'on';
    setSaved(false);
    save.mutate(
      {
        greetSlaSeconds: min('greetSla'),
        reassignAfterSeconds: min('reassignAfter'),
        escalateAfterSeconds: min('escalateAfter'),
        assignmentMode: formText(d, 'assignmentMode') as Settings['assignmentMode'],
        defaultMaxTables: num('defaultMaxTables'),
        qrOrderNeedsApproval: on('qrOrderNeedsApproval'),
        qrOrderSatisfiesGreet: on('qrOrderSatisfiesGreet'),
        serviceChargeBps: Math.round(num('serviceCharge') * 100),
        pricesIncludeTax: on('pricesIncludeTax'),
        occupancyConfirmSeconds: num('occupancyConfirmSeconds'),
        vacancyConfirmSeconds: num('vacancyConfirmSeconds'),
        staffPresentSeconds: num('staffPresentSeconds'),
        staffPresentMinConfidence: num('staffPresentMinConfidence'),
        cameraGreetEnabled: on('cameraGreetEnabled'),
        onlinePaymentsEnabled: on('onlinePaymentsEnabled'),
        bookingEnabled: on('bookingEnabled'),
        bookingSlotMinutes: num('bookingSlotMinutes') as Settings['bookingSlotMinutes'],
        bookingMaxPartySize: num('bookingMaxPartySize'),
        bookingLeadMinutes: num('bookingLeadMinutes'),
        bookingHorizonDays: num('bookingHorizonDays'),
        bookingLastSeatingMinutes: num('bookingLastSeatingMinutes'),
        bookingMaxCoversPerSlot: num('bookingMaxCoversPerSlot'),
        turnSmallMinutes: num('turnSmallMinutes'),
        turnMediumMinutes: num('turnMediumMinutes'),
        turnLargeMinutes: num('turnLargeMinutes'),
        reservationHoldMinutes: num('reservationHoldMinutes'),
        noShowGraceMinutes: num('noShowGraceMinutes'),
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  const minutes = (sec: number) => String(Math.round((sec / 60) * 10) / 10);
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <form onSubmit={onSubmit} className="space-y-6">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <fieldset disabled={!manager} className="space-y-6">
          <Section title={t('greet.title')} hint={t('greet.hint')}>
            <Field label={t('greet.sla')}>
              {(p) => (
                <Input
                  {...p}
                  name="greetSla"
                  type="number"
                  min={0.5}
                  max={60}
                  step={0.5}
                  defaultValue={minutes(s.greetSlaSeconds)}
                  required
                />
              )}
            </Field>
            <Field label={t('greet.reassign')}>
              {(p) => (
                <Input
                  {...p}
                  name="reassignAfter"
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  defaultValue={minutes(s.reassignAfterSeconds)}
                  required
                />
              )}
            </Field>
            <Field label={t('greet.escalate')}>
              {(p) => (
                <Input
                  {...p}
                  name="escalateAfter"
                  type="number"
                  min={1}
                  max={120}
                  step={0.5}
                  defaultValue={minutes(s.escalateAfterSeconds)}
                  required
                />
              )}
            </Field>
            <Field label={t('greet.mode')} hint={t(`greet.modes.${s.assignmentMode}Hint`)}>
              {(p) => (
                <Select {...p} name="assignmentMode" defaultValue={s.assignmentMode}>
                  {ASSIGNMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`greet.modes.${m}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('greet.maxTables')}>
              {(p) => (
                <Input
                  {...p}
                  name="defaultMaxTables"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={s.defaultMaxTables}
                  required
                />
              )}
            </Field>
          </Section>
          <Section title={t('ordering.title')}>
            <Check
              name="qrOrderNeedsApproval"
              label={t('ordering.approval')}
              defaultChecked={s.qrOrderNeedsApproval}
            />
            <Check
              name="qrOrderSatisfiesGreet"
              label={t('ordering.qrGreets')}
              defaultChecked={s.qrOrderSatisfiesGreet}
            />
          </Section>
          <Section title={t('billing.title')}>
            <Field label={t('billing.serviceCharge')}>
              {(p) => (
                <Input
                  {...p}
                  name="serviceCharge"
                  type="number"
                  min={0}
                  max={25}
                  step={0.5}
                  defaultValue={s.serviceChargeBps / 100}
                  required
                />
              )}
            </Field>
            <Check
              name="pricesIncludeTax"
              label={t('billing.includeTax')}
              defaultChecked={s.pricesIncludeTax}
            />
          </Section>
          <Section title={t('payments.title')} hint={t('payments.hint')}>
            <Check
              name="onlinePaymentsEnabled"
              label={t('payments.online')}
              defaultChecked={s.onlinePaymentsEnabled}
            />
          </Section>
          <Section title={t('booking.title')} hint={t('booking.hint')}>
            <Check name="bookingEnabled" label={t('booking.enabled')} defaultChecked={s.bookingEnabled} />
            <Field label={t('booking.slot')}>
              {(p) => (
                <Select {...p} name="bookingSlotMinutes" defaultValue={String(s.bookingSlotMinutes)}>
                  {[15, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {t('booking.minutes', { count: m })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <NumberField
              name="bookingMaxPartySize"
              label={t('booking.maxParty')}
              value={s.bookingMaxPartySize}
              min={1}
              max={60}
            />
            <NumberField
              name="bookingLeadMinutes"
              label={t('booking.lead')}
              value={s.bookingLeadMinutes}
              min={0}
              max={10080}
            />
            <NumberField
              name="bookingHorizonDays"
              label={t('booking.horizon')}
              value={s.bookingHorizonDays}
              min={1}
              max={180}
            />
            <NumberField
              name="bookingLastSeatingMinutes"
              label={t('booking.lastSeating')}
              value={s.bookingLastSeatingMinutes}
              min={0}
              max={240}
            />
            <NumberField
              name="bookingMaxCoversPerSlot"
              label={t('booking.maxCovers')}
              value={s.bookingMaxCoversPerSlot}
              min={0}
              max={1000}
            />
            <NumberField
              name="turnSmallMinutes"
              label={t('booking.turnSmall')}
              value={s.turnSmallMinutes}
              min={15}
              max={360}
            />
            <NumberField
              name="turnMediumMinutes"
              label={t('booking.turnMedium')}
              value={s.turnMediumMinutes}
              min={15}
              max={360}
            />
            <NumberField
              name="turnLargeMinutes"
              label={t('booking.turnLarge')}
              value={s.turnLargeMinutes}
              min={15}
              max={480}
            />
            <NumberField
              name="reservationHoldMinutes"
              label={t('booking.hold')}
              value={s.reservationHoldMinutes}
              min={0}
              max={180}
            />
            <NumberField
              name="noShowGraceMinutes"
              label={t('booking.grace')}
              value={s.noShowGraceMinutes}
              min={5}
              max={120}
            />
          </Section>
          <Section title={t('camera.title')} hint={t('camera.hint')}>
            <Field label={t('camera.occupancy')}>
              {(p) => (
                <Input
                  {...p}
                  name="occupancyConfirmSeconds"
                  type="number"
                  min={5}
                  max={600}
                  defaultValue={s.occupancyConfirmSeconds}
                  required
                />
              )}
            </Field>
            <Field label={t('camera.vacancy')}>
              {(p) => (
                <Input
                  {...p}
                  name="vacancyConfirmSeconds"
                  type="number"
                  min={10}
                  max={1800}
                  defaultValue={s.vacancyConfirmSeconds}
                  required
                />
              )}
            </Field>
            <Field label={t('camera.staffSeconds')}>
              {(p) => (
                <Input
                  {...p}
                  name="staffPresentSeconds"
                  type="number"
                  min={2}
                  max={120}
                  defaultValue={s.staffPresentSeconds}
                  required
                />
              )}
            </Field>
            <Field label={t('camera.confidence')}>
              {(p) => (
                <Input
                  {...p}
                  name="staffPresentMinConfidence"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  defaultValue={s.staffPresentMinConfidence}
                  required
                />
              )}
            </Field>
            <Check
              name="cameraGreetEnabled"
              label={t('camera.greet')}
              defaultChecked={s.cameraGreetEnabled}
            />
          </Section>
        </fieldset>
        <ErrorText error={save.error} />
        {saved ? (
          <p role="status" className="text-sm text-emerald-700">
            {t('saved')}
          </p>
        ) : null}
        {manager ? (
          <Button type="submit" disabled={save.isPending}>
            {t('save')}
          </Button>
        ) : (
          <p className="text-sm text-slate-500">{t('managersOnly')}</p>
        )}
      </form>
      <BookingPageAndHours manager={manager} />
      {can('OWNER') ? <Privacy /> : null}
    </div>
  );
}

const GUEST_URL = process.env.NEXT_PUBLIC_GUEST_URL ?? 'http://localhost:3001';
const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** Booking link to share (website, Google profile, Instagram bio) and the opening hours that drive slots. */
function BookingPageAndHours({ manager }: { manager: boolean }) {
  const t = useTranslations('settings.hours');
  const { outlet } = useSession();
  const hours = useHours(outlet.id);
  const [draft, setDraft] = useState<OpeningWindow[] | null>(null);
  const save = useOutletMutation(outlet.id, (windows: OpeningWindow[]) =>
    api(`/outlets/${outlet.id}/hours`, { method: 'PUT', body: { windows } }),
  );
  const rows = draft ?? hours.data ?? [];
  const link = `${GUEST_URL}/b/${outlet.slug}`;
  const update = (i: number, patch: Partial<OpeningWindow>) =>
    setDraft(rows.map((w, k) => (k === i ? { ...w, ...patch } : w)));

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="hours-h">
      <h2 id="hours-h" className="font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-slate-600">
        {t('link')}{' '}
        <a href={link} target="_blank" rel="noopener" className="break-all text-brand underline">
          {link}
        </a>
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1 font-medium">{t('day')}</th>
            <th className="py-1 font-medium">{t('opens')}</th>
            <th className="py-1 font-medium">{t('closes')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows
            .map((w, i) => ({ w, i }))
            .sort(
              (a, b) =>
                DAYS.indexOf(a.w.dayOfWeek as 0) - DAYS.indexOf(b.w.dayOfWeek as 0) ||
                a.w.opens.localeCompare(b.w.opens),
            )
            .map(({ w, i }) => (
              <tr key={i}>
                <td className="py-1">
                  <Select
                    aria-label={t('day')}
                    value={w.dayOfWeek}
                    disabled={!manager}
                    onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })}
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {t(`days.${d}`)}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-1">
                  <Input
                    aria-label={t('opens')}
                    type="time"
                    value={w.opens}
                    disabled={!manager}
                    onChange={(e) => update(i, { opens: e.target.value })}
                  />
                </td>
                <td className="py-1">
                  <Input
                    aria-label={t('closes')}
                    type="time"
                    value={w.closes === '24:00' ? '23:59' : w.closes}
                    disabled={!manager}
                    onChange={(e) => update(i, { closes: e.target.value })}
                  />
                </td>
                <td className="py-1 text-right">
                  {manager ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft(rows.filter((_, k) => k !== i))}
                    >
                      {t('remove')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {!rows.length ? <p className="text-sm text-amber-700">{t('none')}</p> : null}
      {manager ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDraft([...rows, { dayOfWeek: 1, opens: '12:00', closes: '23:00' }])}
          >
            {t('add')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDraft(DAYS.map((d) => ({ dayOfWeek: d, opens: '12:00', closes: '23:00' })))}
          >
            {t('everyDay')}
          </Button>
          <Button
            size="sm"
            disabled={!draft || save.isPending}
            onClick={() => draft && save.mutate(draft, { onSuccess: () => setDraft(null) })}
          >
            {t('save')}
          </Button>
        </div>
      ) : null}
      <ErrorText error={save.error} />
    </section>
  );
}

function Privacy() {
  const t = useTranslations('settings.privacy');
  const { outlet } = useSession();
  const data = useQuery({
    queryKey: ['outlet', outlet.id, 'privacy'],
    queryFn: () => api<{ guestRetentionDays: number }>(`/outlets/${outlet.id}/privacy`),
  });
  const save = useOutletMutation(outlet.id, (guestRetentionDays: number) =>
    api(`/outlets/${outlet.id}/privacy`, { method: 'PATCH', body: { guestRetentionDays } }),
  );
  if (!data.data) return null;
  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(Number(formText(new FormData(e.currentTarget), 'days')));
      }}
    >
      <h2 className="font-semibold">{t('title')}</h2>
      <p className="text-sm text-slate-500">{t('hint')}</p>
      <Field label={t('days')}>
        {(p) => (
          <Input
            {...p}
            name="days"
            type="number"
            min={0}
            max={3650}
            defaultValue={data.data.guestRetentionDays}
            required
          />
        )}
      </Field>
      <Button size="sm" type="submit" disabled={save.isPending}>
        {t('save')}
      </Button>
      {save.isSuccess ? <span className="ml-2 text-sm text-emerald-700">{t('saved')}</span> : null}
      <ErrorText error={save.error} />
    </form>
  );
}

function NumberField({
  name,
  label,
  value,
  min,
  max,
}: {
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
}) {
  return (
    <Field label={label}>
      {(p) => <Input {...p} name={name} type="number" min={min} max={max} defaultValue={value} required />}
    </Field>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint ? <p className="text-sm text-slate-500">{hint}</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm sm:col-span-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}
