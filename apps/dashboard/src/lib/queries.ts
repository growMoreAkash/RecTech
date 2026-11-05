'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Alert, FloorSnapshot, KdsBoard, Menu, Order, Shift, StaffMember, Timeline } from './types';

export const qk = {
  outlet: (o: string) => ['outlet', o] as const,
  floor: (o: string) => ['outlet', o, 'floor'] as const,
  timeline: (o: string, t: string) => ['outlet', o, 'timeline', t] as const,
  staff: (o: string) => ['outlet', o, 'staff'] as const,
  shifts: (o: string, date: string) => ['outlet', o, 'shifts', date] as const,
  alerts: (o: string) => ['outlet', o, 'alerts'] as const,
  menu: (o: string) => ['outlet', o, 'menu'] as const,
  orders: (o: string) => ['outlet', o, 'orders'] as const,
  kds: (o: string, station: string) => ['outlet', o, 'kds', station] as const,
};

export const useMenu = (outletId: string) =>
  useQuery({ queryKey: qk.menu(outletId), queryFn: () => api<Menu>(`/outlets/${outletId}/menu`) });

/** Pending QR orders waiting for a waiter (refetched on order.updated). */
export const usePendingOrders = (outletId: string, enabled: boolean) =>
  useQuery({
    queryKey: [...qk.orders(outletId), 'pending'],
    queryFn: () => api<Order[]>(`/outlets/${outletId}/orders?status=PENDING_APPROVAL`),
    enabled,
  });

export const useTableOrders = (outletId: string, tableId: string) =>
  useQuery({
    queryKey: [...qk.orders(outletId), 'table', tableId],
    queryFn: () => api<Order[]>(`/outlets/${outletId}/tables/${tableId}/orders`),
  });

export const useKds = (outletId: string, station: string) =>
  useQuery({
    queryKey: qk.kds(outletId, station),
    queryFn: () => api<KdsBoard>(`/outlets/${outletId}/kds?station=${encodeURIComponent(station)}`),
  });

export const useFloor = (outletId: string) =>
  useQuery({ queryKey: qk.floor(outletId), queryFn: () => api<FloorSnapshot>(`/outlets/${outletId}/floor`) });

export const useTimeline = (outletId: string, tableId: string | null) =>
  useQuery({
    queryKey: qk.timeline(outletId, tableId ?? ''),
    queryFn: () => api<Timeline>(`/outlets/${outletId}/tables/${tableId}/timeline`),
    enabled: !!tableId,
  });

export const useStaff = (outletId: string, enabled = true) =>
  useQuery({
    queryKey: qk.staff(outletId),
    queryFn: () => api<StaffMember[]>(`/outlets/${outletId}/staff`),
    enabled,
  });

export const useShifts = (outletId: string, date: string) =>
  useQuery({
    queryKey: qk.shifts(outletId, date),
    queryFn: () => api<{ date: string; shifts: Shift[] }>(`/outlets/${outletId}/shifts?date=${date}`),
  });

export const useAlerts = (outletId: string, enabled: boolean) =>
  useQuery({
    queryKey: qk.alerts(outletId),
    queryFn: () => api<Alert[]>(`/outlets/${outletId}/alerts`),
    enabled,
  });

/** Mutation that refreshes the outlet's queries afterwards (sockets also push, this covers missed events). */
export function useOutletMutation<TVars>(outletId: string, fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: qk.outlet(outletId) }),
  });
}
