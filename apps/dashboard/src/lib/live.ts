'use client';

import { RT_NAMESPACE, type ServerToClientEvents } from '@dinesense/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refresh } from './api';
import { qk } from './queries';
import type { FloorSnapshot } from './types';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Keeps the outlet's cached data live. `table.updated` patches the floor snapshot in place (no refetch);
 * other events invalidate the relevant queries. On (re)connect everything refetches — sockets are only a hint.
 */
export function useLiveOutlet(outletId: string): boolean {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents> = io(`${SOCKET_URL}${RT_NAMESPACE}`, {
      // Re-read on every (re)connect so a refreshed token is used.
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      setConnected(true);
      void qc.invalidateQueries({ queryKey: qk.outlet(outletId) });
    });
    socket.on('disconnect', () => setConnected(false));
    // The server drops sockets with an expired token; refresh, then let socket.io reconnect.
    socket.io.on('reconnect_attempt', () => void refresh());
    (socket as unknown as Socket).on('auth_error', () => void refresh().then(() => socket.connect()));

    socket.on('table.updated', (p) => {
      if (p.outletId !== outletId) return;
      qc.setQueryData<FloorSnapshot>(
        qk.floor(outletId),
        (snap) =>
          snap && {
            ...snap,
            tables: snap.tables.map((t) =>
              t.id === p.tableId && p.version >= t.live.version
                ? {
                    ...t,
                    live: {
                      tableId: p.tableId,
                      outletId: p.outletId,
                      status: p.status,
                      version: p.version,
                      statusChangedAt: p.statusChangedAt,
                      seating: p.seating,
                    },
                  }
                : t,
            ),
          },
      );
      void qc.invalidateQueries({ queryKey: qk.timeline(outletId, p.tableId) });
    });
    socket.on('floor.changed', () => void qc.invalidateQueries({ queryKey: qk.floor(outletId) }));
    socket.on(
      'shift.updated',
      () => void qc.invalidateQueries({ queryKey: [...qk.outlet(outletId), 'shifts'] }),
    );
    socket.on('alert.created', () => void qc.invalidateQueries({ queryKey: qk.alerts(outletId) }));
    socket.on('alert.updated', () => void qc.invalidateQueries({ queryKey: qk.alerts(outletId) }));
    socket.on('order.updated', () => void qc.invalidateQueries({ queryKey: qk.orders(outletId) }));
    socket.on('bill.updated', () => void qc.invalidateQueries({ queryKey: qk.bills(outletId) }));
    socket.on('kds.changed', (p) => void qc.invalidateQueries({ queryKey: qk.kds(outletId, p.stationCode) }));
    socket.on('menu.changed', () => void qc.invalidateQueries({ queryKey: qk.menu(outletId) }));
    socket.on('menu.availability', () => void qc.invalidateQueries({ queryKey: qk.menu(outletId) }));

    return () => {
      socket.close();
    };
  }, [outletId, qc]);

  return connected;
}
