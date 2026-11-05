'use client';

import { RT_NAMESPACE, type ServerToClientEvents } from '@dinesense/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refresh } from './api';
import { qk } from './queries';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Keeps the staff app live; every event simply refetches the affected data (REST is the source of truth). */
export function useLive(outletId: string): boolean {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const socket: Socket<ServerToClientEvents> = io(`${SOCKET_URL}${RT_NAMESPACE}`, {
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
    });
    const all = () => void qc.invalidateQueries({ queryKey: qk.outlet(outletId) });
    socket.on('connect', () => {
      setConnected(true);
      all();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.io.on('reconnect_attempt', () => void refresh());
    for (const e of [
      'task.created',
      'task.updated',
      'order.updated',
      'bill.updated',
      'shift.updated',
      'floor.changed',
      'menu.changed',
      'menu.availability',
    ] as const) {
      socket.on(e, all);
    }
    socket.on('table.updated', () => {
      void qc.invalidateQueries({ queryKey: qk.floor(outletId) });
      void qc.invalidateQueries({ queryKey: qk.tasks(outletId) });
    });
    return () => {
      socket.close();
    };
  }, [outletId, qc]);
  return connected;
}
