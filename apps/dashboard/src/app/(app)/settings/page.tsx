'use client';

import { ASSIGNMENT_MODES, type OutletSettingsInput } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Field, Input, Select } from '@dinesense/ui/field';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
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
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  const minutes = (sec: number) => String(Math.round((sec / 60) * 10) / 10);
  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-6 p-4">
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
          <Check name="cameraGreetEnabled" label={t('camera.greet')} defaultChecked={s.cameraGreetEnabled} />
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
