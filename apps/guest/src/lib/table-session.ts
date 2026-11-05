'use client';

import { RT_NAMESPACE, type ServerToClientEvents } from '@dinesense/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ApiError, deviceId, guestApi, savedToken, saveToken } from './api';
import type { Cart, GuestBills, Landing, Orders } from './types';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type Phase = 'loading' | 'waiting' | 'ordering' | 'ended' | 'error';

/**
 * Everything the table page needs: menu, this phone's session token, shared cart and orders, kept live by the socket.
 * Without an open seating the page polls (read-only menu) until the host seats the party.
 */
export function useTableSession(qr: string) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  const landing = useQuery({
    queryKey: ['landing', qr],
    queryFn: () => guestApi<Landing>(`/t/${qr}`),
    refetchInterval: (q) => (q.state.data?.open || token ? false : 15_000),
  });

  // Join (or re-join) the seating once the table is open.
  useEffect(() => {
    if (!landing.data?.open || token || ended) return;
    let cancelled = false;
    const existing = savedToken(qr);
    void (async () => {
      try {
        if (existing) {
          await guestApi('/cart', { token: existing });
          if (!cancelled) setToken(existing);
          return;
        }
      } catch {
        saveToken(qr, null); // stale token from a previous visit
      }
      try {
        const s = await guestApi<{ token: string }>(`/t/${qr}/session`, {
          method: 'POST',
          body: { deviceId: deviceId() },
        });
        saveToken(qr, s.token);
        if (!cancelled) setToken(s.token);
      } catch {
        /* still waiting to be seated; polling continues */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [landing.data?.open, token, qr, ended]);

  const onError = (e: unknown) => {
    if (e instanceof ApiError && (e.code === 'NO_OPEN_SEATING' || e.status === 401)) {
      saveToken(qr, null);
      setToken(null);
      setEnded(true);
    }
  };

  /** Notices "session ended" on any call, then lets the query see the original error. */
  async function watched<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (e) {
      onError(e);
      throw e;
    }
  }

  const cart = useQuery({
    queryKey: ['cart', token],
    queryFn: () => watched(guestApi<Cart>('/cart', { token })),
    enabled: !!token,
  });
  const orders = useQuery({
    queryKey: ['orders', token],
    queryFn: () => watched(guestApi<Orders>('/orders', { token })),
    enabled: !!token,
  });

  const bills = useQuery({
    queryKey: ['bills', token],
    queryFn: () => watched(guestApi<GuestBills>('/bills', { token })),
    enabled: !!token,
  });

  useEffect(() => {
    if (!token) return;
    const socket: Socket<ServerToClientEvents> = io(`${SOCKET_URL}${RT_NAMESPACE}`, {
      auth: { guestToken: token },
      transports: ['websocket'],
    });
    socket.on('connect', () => void qc.invalidateQueries());
    socket.on('cart.updated', () => void qc.invalidateQueries({ queryKey: ['cart', token] }));
    socket.on('order.updated', () => void qc.invalidateQueries({ queryKey: ['orders', token] }));
    socket.on('bill.updated', () => void qc.invalidateQueries({ queryKey: ['bills', token] }));
    socket.on('menu.changed', () => void qc.invalidateQueries({ queryKey: ['landing', qr] }));
    socket.on('menu.availability', (p) =>
      qc.setQueryData<Landing>(
        ['landing', qr],
        (l) =>
          l && {
            ...l,
            menu: {
              categories: l.menu.categories.map((c) => ({
                ...c,
                items: c.items.map((i) => (i.id === p.menuItemId ? { ...i, isAvailable: p.isAvailable } : i)),
              })),
            },
          },
      ),
    );
    return () => {
      socket.close();
    };
  }, [token, qc, qr]);

  const phase: Phase = ended
    ? 'ended'
    : landing.error
      ? 'error'
      : !landing.data
        ? 'loading'
        : token
          ? 'ordering'
          : 'waiting';
  return {
    phase,
    landing: landing.data,
    landingError: landing.error,
    token,
    cart: cart.data,
    orders: orders.data,
    bills: bills.data,
    onError,
  };
}
