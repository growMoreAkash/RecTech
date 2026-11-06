'use client';

import { ALLERGENS, COURSES, localized, VEG_TYPES } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Field, Input, Select } from '@dinesense/ui/field';
import { Money } from '@dinesense/ui/money';
import { Sheet } from '@dinesense/ui/sheet';
import { VegMark } from '@dinesense/ui/veg-mark';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { paiseToRupees, rupeesToPaise } from '@/lib/money-input';
import { useMenu, useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { Course, Menu, MenuItem, ModifierGroup } from '@/lib/types';
import { cn, formText } from '@/lib/utils';

const GST_SLABS = [0, 500, 1200, 1800];

export default function MenuPage() {
  const t = useTranslations('menuAdmin');
  const locale = useLocale();
  const { outlet, can } = useSession();
  const menu = useMenu(outlet.id);
  const manager = can('OWNER', 'MANAGER');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MenuItem | 'new' | null>(null);
  const [tab, setTab] = useState<'items' | 'options'>('items');

  const availability = useOutletMutation(
    outlet.id,
    ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      api(`/outlets/${outlet.id}/menu/items/${id}/availability`, { method: 'PATCH', body: { isAvailable } }),
  );
  const addCategory = useOutletMutation(outlet.id, (name: string) =>
    api(`/outlets/${outlet.id}/menu/categories`, { method: 'POST', body: { name: { en: name } } }),
  );

  const setCourse = useOutletMutation(outlet.id, ({ id, course }: { id: string; course: Course }) =>
    api(`/outlets/${outlet.id}/menu/categories/${id}`, { method: 'PATCH', body: { course } }),
  );

  if (!menu.data)
    return (
      <div className="p-4" aria-busy="true">
        <ErrorText error={menu.error} />
      </div>
    );
  const data = menu.data;
  const current = categoryId ?? data.categories[0]?.id ?? null;
  const items = data.items.filter((i) => i.categoryId === current);
  const station = new Map(data.stations.map((s) => [s.id, localized(s.name, locale)]));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{t('title')}</h1>
        {manager ? (
          <div role="tablist" className="flex gap-1">
            {(['items', 'options'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  'rounded-md px-3 py-2 text-sm',
                  tab === k ? 'bg-orange-50 text-brand' : 'hover:bg-slate-100',
                )}
              >
                {t(`tabs.${k}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <ErrorText error={availability.error} />

      {tab === 'options' && manager ? (
        <ModifierGroups groups={data.modifierGroups} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <nav aria-label={t('categories')} className="space-y-1">
            {data.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-current={c.id === current ? 'true' : undefined}
                onClick={() => setCategoryId(c.id)}
                className={cn(
                  'block w-full rounded-md px-3 py-2 text-left text-sm',
                  c.id === current ? 'bg-orange-50 font-medium text-brand' : 'hover:bg-slate-100',
                )}
              >
                {localized(c.name, locale)}{' '}
                <span className="text-slate-400">
                  ({data.items.filter((i) => i.categoryId === c.id).length})
                </span>
              </button>
            ))}
            {manager ? (
              <form
                className="flex gap-1 pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const name = formText(new FormData(form), 'name').trim();
                  if (name) addCategory.mutate(name, { onSuccess: () => form.reset() });
                }}
              >
                <Input
                  name="name"
                  placeholder={t('newCategory')}
                  aria-label={t('newCategory')}
                  maxLength={120}
                />
                <Button type="submit" variant="secondary" size="sm">
                  {t('add')}
                </Button>
              </form>
            ) : null}
          </nav>
          <section className="space-y-2">
            {manager ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => setEditing('new')} disabled={!current}>
                  {t('addItem')}
                </Button>
                {current ? (
                  <label className="flex items-center gap-2 text-sm">
                    {t('course.label')}
                    <Select
                      value={data.categories.find((c) => c.id === current)?.course ?? 'OTHER'}
                      onChange={(e) => setCourse.mutate({ id: current, course: e.target.value as Course })}
                      disabled={setCourse.isPending}
                      className="w-36"
                    >
                      {COURSES.map((c) => (
                        <option key={c} value={c}>
                          {t(`course.${c}`)}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : null}
              </div>
            ) : null}
            <ErrorText error={setCourse.error} />
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                  <VegMark vegType={i.vegType} />
                  <div className="min-w-40 flex-1">
                    <p className="font-medium">{localized(i.name, 'en')}</p>
                    <p className="text-xs text-slate-500">
                      {i.name.hi ? `${i.name.hi} · ` : ''}
                      {station.get(i.stationId)} · GST {i.taxRateBps / 100}%
                      {i.modifierGroups.length
                        ? ` · ${i.modifierGroups.map((g) => localized(g.name, locale)).join(', ')}`
                        : ''}
                    </p>
                  </div>
                  <Money paise={i.pricePaise} className="font-medium" />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={i.isAvailable}
                      onChange={(e) => availability.mutate({ id: i.id, isAvailable: e.target.checked })}
                      className="size-5 accent-emerald-600"
                    />
                    {i.isAvailable ? t('available') : t('soldOut')}
                  </label>
                  {manager ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(i)}>
                      {t('edit')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? t('addItem') : t('editItem')}
      >
        {editing !== null ? (
          <ItemForm
            key={editing === 'new' ? 'new' : editing.id}
            item={editing === 'new' ? null : editing}
            categoryId={current}
            menu={data}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function ItemForm({
  item,
  categoryId,
  menu,
  onDone,
}: {
  item: MenuItem | null;
  categoryId: string | null;
  menu: Menu;
  onDone: () => void;
}) {
  const t = useTranslations('menuAdmin');
  const tv = useTranslations('vegType');
  const ta = useTranslations('guest.allergens');
  const locale = useLocale();
  const { outlet } = useSession();
  const [priceError, setPriceError] = useState(false);
  const save = useOutletMutation(outlet.id, (body: object) =>
    item
      ? api(`/outlets/${outlet.id}/menu/items/${item.id}`, { method: 'PATCH', body })
      : api(`/outlets/${outlet.id}/menu/items`, { method: 'POST', body }),
  );
  const archive = useOutletMutation(outlet.id, () =>
    api(`/outlets/${outlet.id}/menu/items/${item!.id}`, { method: 'DELETE' }),
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const pricePaise = rupeesToPaise(formText(d, 'price'));
    setPriceError(pricePaise === null);
    if (pricePaise === null) return;
    const hi = formText(d, 'nameHi').trim();
    const desc = formText(d, 'description').trim();
    save.mutate(
      {
        categoryId: formText(d, 'categoryId'),
        stationId: formText(d, 'stationId'),
        name: { en: formText(d, 'nameEn').trim(), ...(hi ? { hi } : {}) },
        description: desc ? { en: desc } : null,
        vegType: formText(d, 'vegType'),
        pricePaise,
        taxRateBps: Number(formText(d, 'taxRateBps')),
        spiceLevel: Number(formText(d, 'spiceLevel')),
        allergens: d.getAll('allergens').filter((v): v is string => typeof v === 'string'),
        modifierGroupIds: d.getAll('modifierGroupIds').filter((v): v is string => typeof v === 'string'),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label={t('nameEn')}>
        {(p) => <Input {...p} name="nameEn" required maxLength={120} defaultValue={item?.name.en} />}
      </Field>
      <Field label={t('nameHi')}>
        {(p) => <Input {...p} name="nameHi" maxLength={120} defaultValue={item?.name.hi} lang="hi" />}
      </Field>
      <Field label={t('description')}>
        {(p) => (
          <Input {...p} name="description" maxLength={500} defaultValue={item?.description?.en ?? ''} />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('price')} error={priceError ? t('priceInvalid') : undefined}>
          {(p) => (
            <Input
              {...p}
              name="price"
              inputMode="decimal"
              required
              defaultValue={item ? paiseToRupees(item.pricePaise) : ''}
              placeholder="340.00"
            />
          )}
        </Field>
        <Field label={t('gst')}>
          {(p) => (
            <Select {...p} name="taxRateBps" defaultValue={item?.taxRateBps ?? 500}>
              {GST_SLABS.map((b) => (
                <option key={b} value={b}>
                  {b / 100}%
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('diet')}>
          {(p) => (
            <Select {...p} name="vegType" defaultValue={item?.vegType ?? 'VEG'}>
              {VEG_TYPES.map((v) => (
                <option key={v} value={v}>
                  {tv(v)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('spice')}>
          {(p) => (
            <Select {...p} name="spiceLevel" defaultValue={item?.spiceLevel ?? 0}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? t('notSpicy') : '🌶'.repeat(n)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('category')}>
          {(p) => (
            <Select {...p} name="categoryId" defaultValue={item?.categoryId ?? categoryId ?? ''}>
              {menu.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {localized(c.name, locale)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('station')}>
          {(p) => (
            <Select {...p} name="stationId" defaultValue={item?.stationId ?? menu.stations[0]?.id}>
              {menu.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {localized(s.name, locale)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">{t('allergens')}</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {ALLERGENS.map((a) => (
            <label key={a} className="inline-flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                name="allergens"
                value={a}
                defaultChecked={item?.allergens.includes(a)}
              />
              {ta(a)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">{t('optionGroups')}</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {menu.modifierGroups.map((g) => (
            <label key={g.id} className="inline-flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                name="modifierGroupIds"
                value={g.id}
                defaultChecked={item?.modifierGroups.some((x) => x.id === g.id)}
              />
              {localized(g.name, locale)}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorText error={save.error ?? archive.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {t('save')}
        </Button>
        {item ? (
          <Button variant="danger" onClick={() => archive.mutate(undefined, { onSuccess: onDone })}>
            {t('remove')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Option groups (portion, spice, add-ons): name, min/max picks, options with price changes. */
function ModifierGroups({ groups }: { groups: ModifierGroup[] }) {
  const t = useTranslations('menuAdmin');
  const [editing, setEditing] = useState<ModifierGroup | 'new' | null>(null);
  return (
    <div className="space-y-3">
      <Button variant="secondary" onClick={() => setEditing('new')}>
        {t('addGroup')}
      </Button>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {groups.map((g) => (
          <li key={g.id} className="flex items-center gap-3 p-3">
            <div className="flex-1">
              <p className="font-medium">{g.name.en}</p>
              <p className="text-xs text-slate-500">
                {t('picks', { min: g.minSelect, max: g.maxSelect })} ·{' '}
                {g.modifiers.map((m) => m.name.en).join(', ')}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(g)}>
              {t('edit')}
            </Button>
          </li>
        ))}
      </ul>
      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? t('addGroup') : t('editGroup')}
      >
        {editing !== null ? (
          <GroupForm
            key={editing === 'new' ? 'new' : editing.id}
            group={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function GroupForm({ group, onDone }: { group: ModifierGroup | null; onDone: () => void }) {
  const t = useTranslations('menuAdmin');
  const { outlet } = useSession();
  const [rows, setRows] = useState(() =>
    group
      ? group.modifiers.map((m) => ({ id: m.id, en: m.name.en, price: paiseToRupees(m.priceDeltaPaise) }))
      : [{ id: undefined as string | undefined, en: '', price: '0' }],
  );
  const save = useOutletMutation(outlet.id, (body: object) =>
    group
      ? api(`/outlets/${outlet.id}/menu/modifier-groups/${group.id}`, { method: 'PUT', body })
      : api(`/outlets/${outlet.id}/menu/modifier-groups`, { method: 'POST', body }),
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const priceOf = (s: string) => {
      const neg = s.trim().startsWith('-');
      const p = rupeesToPaise(s.replace('-', ''));
      return p === null ? 0 : neg ? -p : p;
    };
    save.mutate(
      {
        name: { en: formText(d, 'name').trim() },
        minSelect: Number(formText(d, 'minSelect')),
        maxSelect: Number(formText(d, 'maxSelect')),
        modifiers: rows
          .filter((r) => r.en.trim())
          .map((r) => ({
            ...(r.id ? { id: r.id } : {}),
            name: { en: r.en.trim() },
            priceDeltaPaise: priceOf(r.price),
          })),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label={t('groupName')}>
        {(p) => <Input {...p} name="name" required defaultValue={group?.name.en} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('minPicks')}>
          {(p) => (
            <Input
              {...p}
              name="minSelect"
              type="number"
              min={0}
              max={10}
              defaultValue={group?.minSelect ?? 0}
            />
          )}
        </Field>
        <Field label={t('maxPicks')}>
          {(p) => (
            <Input
              {...p}
              name="maxSelect"
              type="number"
              min={1}
              max={10}
              defaultValue={group?.maxSelect ?? 1}
            />
          )}
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">{t('options')}</legend>
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="flex gap-2">
            <Input
              aria-label={t('optionName')}
              value={r.en}
              onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, en: e.target.value } : y)))}
            />
            <Input
              aria-label={t('priceChange')}
              className="w-28"
              value={r.price}
              onChange={(e) =>
                setRows((x) => x.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)))
              }
            />
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRows((x) => [...x, { id: undefined, en: '', price: '0' }])}
        >
          {t('addOption')}
        </Button>
      </fieldset>
      <ErrorText error={save.error} />
      <Button type="submit" disabled={save.isPending}>
        {t('save')}
      </Button>
    </form>
  );
}
