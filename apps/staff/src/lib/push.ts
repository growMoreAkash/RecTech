'use client';

import { api } from './api';

export type PushState = 'unsupported' | 'disabled' | 'denied' | 'off' | 'on';

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const { enabled } = await api<{ enabled: boolean }>('/push/public-key');
  if (!enabled) return 'disabled';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

/** Registers the service worker, asks permission, and hands the subscription to the API. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const { enabled, publicKey } = await api<{ enabled: boolean; publicKey: string | null }>(
    '/push/public-key',
  );
  if (!enabled || !publicKey) return 'disabled';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/me/push-subscriptions', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } });
  return 'on';
}

/** Re-attach the existing browser subscription to whoever is signed in on this shared terminal. */
export async function syncPush(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/me/push-subscriptions', {
    method: 'POST',
    body: { endpoint: json.endpoint, keys: json.keys },
  }).catch(() => undefined);
}
