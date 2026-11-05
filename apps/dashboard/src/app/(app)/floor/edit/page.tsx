'use client';

import { TABLE_SHAPES } from '@dinesense/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { type FormEvent, useEffect, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { type DraftTable, newTable, removeTable, toDraft, toggleJoin, toPlan } from '@/lib/editor';
import { qk, useFloor, useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { formText } from '@/lib/utils';
import type { FloorSnapshot, Section, TableShape } from '@/lib/types';

const EditorCanvas = dynamic(() => import('@/components/editor/editor-canvas'), {
  ssr: false,
  loading: () => <div className="h-[36rem] rounded-lg border border-slate-200 bg-white" aria-busy="true" />,
});

export default function FloorEditorPage() {
  const t = useTranslations();
  const { outlet, can } = useSession();
  const qc = useQueryClient();
  const floor = useFloor(outlet.id);
  const [draft, setDraft] = useState<DraftTable[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  // Load the plan once; live table-state updates must not clobber unsaved edits.
  useEffect(() => {
    if (floor.data && !dirty) setDraft(floor.data.tables.map(toDraft));
  }, [floor.data, dirty]);

  if (!can('OWNER', 'MANAGER')) return <p className="p-4 text-slate-600">{t('editor.managersOnly')}</p>;
  if (!floor.data || !draft) return <div className="p-4" aria-busy="true" />;

  const sections = floor.data.sections;
  const current = draft.find((d) => d.key === selected) ?? null;
  const edit = (next: DraftTable[]) => {
    setDraft(next);
    setDirty(true);
  };
  const patch = (key: string, p: Partial<DraftTable>) =>
    edit(draft.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const tables = draft; // narrowed for the closure below
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const snap = await api<FloorSnapshot>(`/outlets/${outlet.id}/floor-plan`, {
        method: 'PUT',
        body: toPlan(tables),
      });
      qc.setQueryData(qk.floor(outlet.id), snap);
      setDraft(snap.tables.map(toDraft));
      setDirty(false);
      setSelected(null);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  const busyLabels =
    error instanceof ApiError && error.code === 'CONFLICT'
      ? ((error.details as { tables?: { label: string }[] } | undefined)?.tables
          ?.map((x) => x.label)
          .join(', ') ?? '')
      : '';

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{t('editor.title')}</h1>
        {dirty ? <span className="text-sm text-amber-700">{t('editor.unsaved')}</span> : null}
        <Button
          variant="secondary"
          disabled={!sections.length}
          onClick={() => {
            const next = newTable(draft, current?.sectionId ?? sections[0]!.id, { x: 100, y: 100 });
            edit([...draft, next]);
            setSelected(next.key);
          }}
        >
          {t('editor.addTable')}
        </Button>
        <Button
          variant="ghost"
          disabled={!dirty || saving}
          onClick={() => {
            setDirty(false);
            setDraft(floor.data.tables.map(toDraft));
            setSelected(null);
          }}
        >
          {t('editor.discard')}
        </Button>
        <Button disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? t('editor.saving') : t('editor.save')}
        </Button>
      </div>
      {busyLabels ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {t('editor.busyTables', { labels: busyLabels })}
        </p>
      ) : (
        <ErrorText error={error} />
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <EditorCanvas
          tables={draft}
          sections={sections}
          selectedKey={selected}
          onSelect={setSelected}
          onChange={patch}
        />
        <aside className="space-y-6">
          {current ? (
            <Inspector
              table={current}
              tables={draft}
              sections={sections}
              onPatch={(p) => patch(current.key, p)}
              onToggleJoin={(other) => edit(toggleJoin(draft, current.key, other))}
              onRemove={() => {
                edit(removeTable(draft, current.key));
                setSelected(null);
              }}
            />
          ) : (
            <p className="text-sm text-slate-500">{t('editor.selectHint')}</p>
          )}
          <SectionsPanel sections={sections} />
        </aside>
      </div>
    </div>
  );
}

function Inspector({
  table,
  tables,
  sections,
  onPatch,
  onToggleJoin,
  onRemove,
}: {
  table: DraftTable;
  tables: DraftTable[];
  sections: Section[];
  onPatch: (p: Partial<DraftTable>) => void;
  onToggleJoin: (key: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations();
  const num = (v: string, min: number) => Math.max(min, Math.trunc(Number(v) || min));
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" aria-label={table.label}>
      <Field label={t('editor.label')}>
        {(p) => (
          <Input
            {...p}
            value={table.label}
            maxLength={12}
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('editor.capacity')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              max={40}
              value={table.capacity}
              onChange={(e) => onPatch({ capacity: num(e.target.value, 1) })}
            />
          )}
        </Field>
        <Field label={t('editor.minCapacity')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              max={table.capacity}
              value={table.minCapacity}
              onChange={(e) => onPatch({ minCapacity: num(e.target.value, 1) })}
            />
          )}
        </Field>
      </div>
      <Field label={t('editor.shape')}>
        {(p) => (
          <Select
            {...p}
            value={table.shape}
            onChange={(e) => onPatch({ shape: e.target.value as TableShape })}
          >
            {TABLE_SHAPES.map((s) => (
              <option key={s} value={s}>
                {t(`shapes.${s}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('editor.section')}>
        {(p) => (
          <Select {...p} value={table.sectionId} onChange={(e) => onPatch({ sectionId: e.target.value })}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('editor.rotation')}>
        {(p) => (
          <Input
            {...p}
            type="number"
            min={-360}
            max={360}
            step={15}
            value={table.rotation}
            onChange={(e) => onPatch({ rotation: Number(e.target.value) || 0 })}
          />
        )}
      </Field>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">{t('editor.joinable')}</legend>
        <div className="mt-1 flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
          {tables
            .filter((o) => o.key !== table.key)
            .map((o) => (
              <label key={o.key} className="inline-flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={table.joinableWith.includes(o.key)}
                  onChange={() => onToggleJoin(o.key)}
                />
                {o.label}
              </label>
            ))}
        </div>
      </fieldset>
      <Button variant="danger" size="sm" onClick={onRemove}>
        {t('editor.removeTable')}
      </Button>
    </section>
  );
}

function SectionsPanel({ sections }: { sections: Section[] }) {
  const t = useTranslations();
  const { outlet } = useSession();
  const create = useOutletMutation(outlet.id, (body: { name: string; color: string }) =>
    api(`/outlets/${outlet.id}/sections`, { method: 'POST', body }),
  );
  const update = useOutletMutation(
    outlet.id,
    ({ id, ...body }: { id: string; name?: string; color?: string }) =>
      api(`/outlets/${outlet.id}/sections/${id}`, { method: 'PATCH', body }),
  );
  const remove = useOutletMutation(outlet.id, (id: string) =>
    api(`/outlets/${outlet.id}/sections/${id}`, { method: 'DELETE' }),
  );

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    create.mutate(
      { name: formText(data, 'name'), color: formText(data, 'color') },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <section
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
      aria-labelledby="sections-h"
    >
      <h2 id="sections-h" className="text-sm font-semibold">
        {t('editor.sections')}
      </h2>
      <ul className="space-y-1">
        {sections.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`${s.name} colour`}
              defaultValue={s.color ?? '#64748b'}
              onBlur={(e) => e.target.value !== s.color && update.mutate({ id: s.id, color: e.target.value })}
              className="size-8 rounded"
            />
            <Input
              defaultValue={s.name}
              aria-label={t('editor.sectionName')}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== s.name &&
                update.mutate({ id: s.id, name: e.target.value.trim() })
              }
            />
            <Button variant="ghost" size="sm" onClick={() => remove.mutate(s.id)}>
              {t('common.delete')}
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={onAdd} className="flex gap-2">
        <input
          type="color"
          name="color"
          defaultValue="#0ea5e9"
          aria-label="colour"
          className="size-10 rounded"
        />
        <Input
          name="name"
          required
          maxLength={40}
          placeholder={t('editor.sectionName')}
          aria-label={t('editor.sectionName')}
        />
        <Button type="submit" variant="secondary" disabled={create.isPending}>
          {t('common.add')}
        </Button>
      </form>
      <ErrorText error={create.error ?? update.error ?? remove.error} />
    </section>
  );
}
