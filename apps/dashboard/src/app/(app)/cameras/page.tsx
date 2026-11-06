'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Camera as CameraIcon, Copy, PencilLine, RefreshCw, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { Button } from '@dinesense/ui/button';
import { Field, Input, Select } from '@dinesense/ui/field';
import { api, apiObjectUrl } from '@/lib/api';
import { qk, useCameras, useEdgeDevices, useFloor, useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { Camera, EdgeDevice, Point } from '@/lib/types';
import { cn, formText, useNow } from '@/lib/utils';
import {
  boundsPercent,
  cameraHealth,
  type CameraHealth,
  deviceOnline,
  isValidZone,
  rectPolygon,
  zonesBody,
} from '@/lib/zones';

const DOOR_KEY = '__door';

const ZoneCanvas = dynamic(() => import('@/components/cameras/zone-canvas'), {
  ssr: false,
  loading: () => (
    <div className="aspect-video rounded-lg border border-slate-200 bg-slate-800" aria-busy="true" />
  ),
});

const HEALTH_STYLE: Record<CameraHealth, { cls: string; glyph: string }> = {
  ok: { cls: 'bg-emerald-100 text-emerald-800', glyph: '●' },
  degraded: { cls: 'bg-amber-100 text-amber-800', glyph: '◐' },
  down: { cls: 'bg-red-100 text-red-800', glyph: '✕' },
  unknown: { cls: 'bg-slate-100 text-slate-600', glyph: '○' },
};

export default function CamerasPage() {
  const t = useTranslations('cameras');
  const { outlet, can } = useSession();
  const cameras = useCameras(outlet.id);
  const [calibrating, setCalibrating] = useState<string | null>(null);

  if (!can('OWNER', 'MANAGER')) return <p className="p-4 text-sm text-slate-600">{t('managersOnly')}</p>;
  const cam = cameras.data?.find((c) => c.id === calibrating);

  return (
    <div className="space-y-8 p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t('privacy')}</p>
      </header>
      <ErrorText error={cameras.error} />
      {cam ? (
        <Calibrate camera={cam} onClose={() => setCalibrating(null)} />
      ) : (
        <>
          <section aria-labelledby="wall" className="space-y-3">
            <h2 id="wall" className="text-lg font-semibold">
              {t('wall')}
            </h2>
            {cameras.data?.length === 0 ? <p className="text-sm text-slate-500">{t('noCameras')}</p> : null}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cameras.data?.map((c) => (
                <CameraCard key={c.id} camera={c} onCalibrate={() => setCalibrating(c.id)} />
              ))}
            </ul>
          </section>
          <AddCamera />
          <Devices />
        </>
      )}
    </div>
  );
}

function HealthBadge({ camera }: { camera: Camera }) {
  const t = useTranslations('cameras.health');
  const h = cameraHealth(camera);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        HEALTH_STYLE[h].cls,
      )}
    >
      <span aria-hidden>{HEALTH_STYLE[h].glyph}</span>
      {t(h)}
    </span>
  );
}

/** Fetches the (blurred) calibration snapshot with auth; re-fetched when a new one arrives. */
function useSnapshot(outletId: string, camera: Camera): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!camera.hasSnapshot) return setUrl(null);
    let objectUrl: string | null = null;
    let cancelled = false;
    apiObjectUrl(`/outlets/${outletId}/cameras/${camera.id}/snapshot`)
      .then((u) => {
        objectUrl = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [outletId, camera.id, camera.hasSnapshot, camera.snapshotAt]);
  return url;
}

function SnapshotView({ camera, labels }: { camera: Camera; labels: Map<string, string> }) {
  const t = useTranslations('cameras');
  const { outlet } = useSession();
  const url = useSnapshot(outlet.id, camera);
  return (
    <div className="relative aspect-video overflow-hidden rounded-md bg-slate-800">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: URL from an authenticated fetch
        <img
          src={url}
          alt={t('snapshotAlt', { name: camera.name })}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-sm text-slate-300">
          <span className="flex items-center gap-2">
            <CameraIcon aria-hidden className="h-4 w-4" />
            {t('noSnapshot')}
          </span>
        </div>
      )}
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        {camera.zones.map((z) => (
          <polygon
            key={z.id}
            points={z.polygon.map((p) => p.join(',')).join(' ')}
            fill="rgba(37,99,235,0.18)"
            stroke="#2563eb"
            strokeWidth={0.004}
          />
        ))}
      </svg>
      {camera.zones.map((z) => {
        const cx = z.polygon.reduce((s, p) => s + p[0], 0) / z.polygon.length;
        const cy = z.polygon.reduce((s, p) => s + p[1], 0) / z.polygon.length;
        return (
          <span
            key={z.id}
            aria-hidden
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-blue-700/80 px-1 text-xs font-bold text-white"
            style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}
          >
            {labels.get(z.tableId) ?? '?'}
          </span>
        );
      })}
    </div>
  );
}

function CameraCard({ camera, onCalibrate }: { camera: Camera; onCalibrate: () => void }) {
  const t = useTranslations('cameras');
  const format = useFormatter();
  const { outlet } = useSession();
  const floor = useFloor(outlet.id);
  const labels = new Map(floor.data?.tables.map((tb) => [tb.id, tb.label]));
  const [editing, setEditing] = useState(false);
  const snap = useOutletMutation(outlet.id, () =>
    api(`/outlets/${outlet.id}/cameras/${camera.id}/request-snapshot`, { method: 'POST' }),
  );
  const remove = useOutletMutation(outlet.id, () =>
    api(`/outlets/${outlet.id}/cameras/${camera.id}`, { method: 'DELETE' }),
  );
  const h = camera.lastHealth;
  const when = (iso: string | null) => (iso ? format.relativeTime(new Date(iso), new Date()) : t('never'));

  return (
    <li className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{camera.name}</h3>
          <p className="text-xs text-slate-500">
            {camera.edgeDevice.name} · {camera.streamHost}
          </p>
        </div>
        <HealthBadge camera={camera} />
      </div>
      <SnapshotView camera={camera} labels={labels} />
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">{t('fps')}</dt>
          <dd className="font-medium">
            {h ? h.fps.toFixed(1) : '—'} / {camera.fps}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">{t('lastFrame')}</dt>
          <dd className="font-medium">{when(h?.lastFrameAt ?? null)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t('zones')}</dt>
          <dd className="font-medium">{camera.zones.length}</dd>
        </div>
      </dl>
      {h?.error ? <p className="text-xs text-red-700">{h.error}</p> : null}
      {!camera.enabled ? <p className="text-xs text-slate-500">{t('disabled')}</p> : null}
      <ErrorText error={snap.error ?? remove.error} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onCalibrate}>
          {t('calibrate')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => snap.mutate(undefined)}
          disabled={snap.isPending}
        >
          <RefreshCw aria-hidden className="h-3 w-3" />
          {snap.isSuccess ? t('snapshotRequested') : t('requestSnapshot')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          <PencilLine aria-hidden className="h-3 w-3" />
          {t('edit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            window.confirm(t('confirmDelete', { name: camera.name })) && remove.mutate(undefined)
          }
        >
          <Trash2 aria-hidden className="h-3 w-3" />
          {t('delete')}
        </Button>
      </div>
      {editing ? <CameraForm camera={camera} onDone={() => setEditing(false)} /> : null}
    </li>
  );
}

function CameraForm({ camera, onDone }: { camera?: Camera; onDone?: () => void }) {
  const t = useTranslations('cameras');
  const { outlet } = useSession();
  const devices = useEdgeDevices(outlet.id);
  const active = devices.data?.filter((d) => !d.revokedAt) ?? [];
  const save = useOutletMutation(outlet.id, (body: object) =>
    camera
      ? api(`/outlets/${outlet.id}/cameras/${camera.id}`, { method: 'PATCH', body })
      : api(`/outlets/${outlet.id}/cameras`, { method: 'POST', body }),
  );

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const url = formText(d, 'rtspUrl').trim();
    const body = {
      name: formText(d, 'name').trim(),
      edgeDeviceId: formText(d, 'edgeDeviceId'),
      fps: Number(formText(d, 'fps')),
      enabled: d.get('enabled') === 'on',
      ...(url ? { rtspUrl: url } : {}),
    };
    save.mutate(body, {
      onSuccess: () => {
        if (!camera) form.reset();
        onDone?.();
      },
    });
  };

  if (!camera && !active.length) return <p className="text-sm text-slate-500">{t('needDevice')}</p>;
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label={t('name')}>
        {(p) => <Input {...p} name="name" required maxLength={60} defaultValue={camera?.name} />}
      </Field>
      <Field label={t('device')}>
        {(p) => (
          <Select {...p} name="edgeDeviceId" required defaultValue={camera?.edgeDevice.id ?? active[0]?.id}>
            {active.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('url')} hint={camera ? t('urlKeep') : t('urlHint')}>
        {(p) => (
          <Input
            {...p}
            name="rtspUrl"
            required={!camera}
            autoComplete="off"
            spellCheck={false}
            placeholder="rtsp://user:password@192.168.1.20:554/stream1"
          />
        )}
      </Field>
      <Field label={t('targetFps')} hint={t('fpsHint')}>
        {(p) => (
          <Input {...p} name="fps" type="number" min={1} max={15} defaultValue={camera?.fps ?? 3} required />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={camera?.enabled ?? true} className="h-4 w-4" />
        {t('enabled')}
      </label>
      <div className="flex items-end gap-2 sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>
          {camera ? t('saveCamera') : t('addCamera')}
        </Button>
        {onDone ? (
          <Button variant="ghost" onClick={onDone}>
            {t('cancel')}
          </Button>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <ErrorText error={save.error} />
      </div>
    </form>
  );
}

function AddCamera() {
  const t = useTranslations('cameras');
  return (
    <section
      aria-labelledby="add-camera"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="add-camera" className="text-lg font-semibold">
        {t('addCamera')}
      </h2>
      <CameraForm />
    </section>
  );
}

function Devices() {
  const t = useTranslations('cameras');
  const format = useFormatter();
  const now = useNow(30_000);
  const { outlet } = useSession();
  const devices = useEdgeDevices(outlet.id);
  const [secret, setSecret] = useState<{ deviceId: string; secret: string } | null>(null);
  const register = useOutletMutation(outlet.id, (name: string) =>
    api<{ deviceId: string; secret: string }>(`/outlets/${outlet.id}/edge-devices`, {
      method: 'POST',
      body: { name },
    }),
  );
  const revoke = useOutletMutation(outlet.id, (id: string) =>
    api(`/outlets/${outlet.id}/edge-devices/${id}`, { method: 'DELETE' }),
  );

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    register.mutate(formText(new FormData(form), 'name').trim(), {
      onSuccess: (r) => {
        setSecret(r as { deviceId: string; secret: string });
        form.reset();
      },
    });
  };
  const env = secret
    ? `DS_API_URL=${typeof window === 'undefined' ? '' : window.location.origin}/api/v1\nDS_DEVICE_ID=${secret.deviceId}\nDS_DEVICE_SECRET=${secret.secret}`
    : '';

  return (
    <section aria-labelledby="devices" className="space-y-3">
      <h2 id="devices" className="text-lg font-semibold">
        {t('devices')}
      </h2>
      <p className="max-w-3xl text-sm text-slate-600">{t('devicesHint')}</p>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {devices.data?.map((d: EdgeDevice) => {
          const online = !d.revokedAt && deviceOnline(d.lastSeenAt, now);
          return (
            <li
              key={d.id}
              className={cn('flex flex-wrap items-center gap-3 p-3', d.revokedAt && 'opacity-60')}
            >
              <div className="min-w-48 flex-1">
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-slate-500">
                  {t('deviceMeta', { cameras: d._count.cameras, version: d.version ?? '—' })} ·{' '}
                  {d.lastSeenAt
                    ? t('lastSeen', { when: format.relativeTime(new Date(d.lastSeenAt), new Date(now)) })
                    : t('neverSeen')}
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  d.revokedAt
                    ? 'bg-slate-200 text-slate-600'
                    : online
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-red-100 text-red-800',
                )}
              >
                {d.revokedAt ? t('revoked') : online ? t('online') : t('offline')}
              </span>
              {!d.revokedAt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => window.confirm(t('confirmRevoke', { name: d.name })) && revoke.mutate(d.id)}
                >
                  {t('revoke')}
                </Button>
              ) : null}
            </li>
          );
        })}
        {devices.data?.length === 0 ? <li className="p-3 text-sm text-slate-500">{t('noDevices')}</li> : null}
      </ul>
      <ErrorText error={devices.error ?? register.error ?? revoke.error} />
      {secret ? (
        <div role="status" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">{t('secretOnce')}</p>
          <pre className="overflow-x-auto rounded bg-white p-2 text-xs">{env}</pre>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(env)}>
              <Copy aria-hidden className="h-3 w-3" />
              {t('copy')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
              {t('done')}
            </Button>
          </div>
        </div>
      ) : null}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label={t('deviceName')}>
          {(p) => (
            <Input {...p} name="name" required maxLength={60} placeholder={t('deviceNamePlaceholder')} />
          )}
        </Field>
        <Button type="submit" disabled={register.isPending}>
          {t('register')}
        </Button>
      </form>
    </section>
  );
}

function Calibrate({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const t = useTranslations('cameras');
  const format = useFormatter();
  const { outlet } = useSession();
  const qc = useQueryClient();
  const floor = useFloor(outlet.id);
  const imageUrl = useSnapshot(outlet.id, camera);
  const tables = useMemo(
    () =>
      [...(floor.data?.tables ?? [])].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }),
      ),
    [floor.data],
  );
  // The entrance zone is edited like a table zone, under a reserved key.
  const rows = [{ id: DOOR_KEY, label: t('doorZone') }, ...tables];
  const labels = Object.fromEntries(rows.map((tb) => [tb.id, tb.label]));
  const initial = () =>
    ({
      ...Object.fromEntries(camera.zones.map((z) => [z.tableId, z.polygon])),
      ...(camera.door ? { [DOOR_KEY]: camera.door } : {}),
    }) as Record<string, Point[]>;
  const [zones, setZones] = useState<Record<string, Point[]>>(initial);
  const [dirty, setDirty] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [rectFor, setRectFor] = useState<string | null>(null);

  const save = useOutletMutation(outlet.id, () =>
    api(`/outlets/${outlet.id}/cameras/${camera.id}/zones`, {
      method: 'PUT',
      body: { ...zonesBody(zones, new Set(tables.map((tb) => tb.id))), door: zones[DOOR_KEY] ?? null },
    }),
  );
  const snap = useOutletMutation(outlet.id, () =>
    api(`/outlets/${outlet.id}/cameras/${camera.id}/request-snapshot`, { method: 'POST' }),
  );

  const setZone = (tableId: string, poly: Point[] | null) => {
    setZones((z) => {
      const next = { ...z };
      if (poly && isValidZone(poly)) next[tableId] = poly;
      else delete next[tableId];
      return next;
    });
    setDirty(true);
  };

  const applyRect = (e: FormEvent<HTMLFormElement>, tableId: string) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const n = (k: string) => Number(formText(d, k));
    setZone(tableId, rectPolygon(n('left'), n('top'), n('right'), n('bottom')));
    setRectFor(null);
  };

  return (
    <section aria-labelledby="calibrate" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="calibrate" className="text-lg font-semibold">
            {t('calibrateTitle', { name: camera.name })}
          </h2>
          <p className="text-xs text-slate-500">
            {camera.snapshotAt
              ? t('snapshotTaken', { when: format.relativeTime(new Date(camera.snapshotAt), new Date()) })
              : t('noSnapshot')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => snap.mutate(undefined)} disabled={snap.isPending}>
            <RefreshCw aria-hidden className="h-4 w-4" />
            {snap.isSuccess ? t('snapshotRequested') : t('requestSnapshot')}
          </Button>
          <Button
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  setDirty(false);
                  void qc.invalidateQueries({ queryKey: qk.cameras(outlet.id) });
                },
              })
            }
            disabled={!dirty || save.isPending}
          >
            {t('saveZones')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => (!dirty || window.confirm(t('confirmDiscard'))) && onClose()}
          >
            {t('back')}
          </Button>
        </div>
      </div>
      <ErrorText error={save.error ?? snap.error} />
      {save.isSuccess && !dirty ? (
        <p role="status" className="text-sm text-emerald-700">
          {t('zonesSaved')}
        </p>
      ) : null}
      <p className="text-sm text-slate-600" id="zone-help">
        {drawing && active ? t('drawHelp', { table: labels[active] ?? '?' }) : t('calibrateHelp')}
      </p>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="lg:sticky lg:top-4">
          <ZoneCanvas
            imageUrl={imageUrl}
            zones={zones}
            labels={labels}
            activeTable={active}
            drawing={drawing}
            onDraw={(tableId, poly) => {
              setZone(tableId, poly);
              setDrawing(false);
            }}
            onChange={(tableId, poly) => setZone(tableId, poly)}
          />
        </div>
        <ul
          aria-label={t('tableZones')}
          className="max-h-[75vh] divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 bg-white"
        >
          {rows.map((tb) => {
            const poly = zones[tb.id];
            const b = poly ? boundsPercent(poly) : null;
            const isActive = active === tb.id;
            return (
              <li key={tb.id} className={cn('space-y-2 p-3', isActive && 'bg-orange-50')}>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-left font-medium underline-offset-2 hover:underline"
                    aria-pressed={isActive}
                    onClick={() => {
                      setActive(isActive ? null : tb.id);
                      setDrawing(false);
                    }}
                  >
                    {tb.label}
                  </button>
                  <span className="text-xs text-slate-500">
                    {b ? t('zoneBounds', { ...b, points: poly!.length }) : t('noZone')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={isActive && drawing ? 'primary' : 'secondary'}
                    aria-describedby="zone-help"
                    onClick={() => {
                      setActive(tb.id);
                      setDrawing(!(isActive && drawing));
                    }}
                  >
                    {isActive && drawing ? t('cancelDrawing') : poly ? t('redraw') : t('draw')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={rectFor === tb.id}
                    onClick={() => setRectFor(rectFor === tb.id ? null : tb.id)}
                  >
                    {t('rectangle')}
                  </Button>
                  {poly ? (
                    <Button size="sm" variant="ghost" onClick={() => setZone(tb.id, null)}>
                      {t('removeZone')}
                    </Button>
                  ) : null}
                </div>
                {rectFor === tb.id ? (
                  <form onSubmit={(e) => applyRect(e, tb.id)} className="grid grid-cols-2 gap-2">
                    {(['left', 'top', 'right', 'bottom'] as const).map((k) => (
                      <Field key={k} label={t(`edge.${k}`)}>
                        {(p) => (
                          <Input
                            {...p}
                            name={k}
                            type="number"
                            min={0}
                            max={100}
                            required
                            defaultValue={b ? b[k] : k === 'left' || k === 'top' ? 25 : 75}
                          />
                        )}
                      </Field>
                    ))}
                    <Button size="sm" type="submit" className="col-span-2">
                      {t('applyRectangle')}
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
