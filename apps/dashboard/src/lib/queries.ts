'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  Alert,
  AuditEntry,
  Bill,
  Camera,
  GuestProfile,
  OpeningWindow,
  Reservation,
  EdgeDevice,
  FloorSnapshot,
  KdsBoard,
  Menu,
  Order,
  Shift,
  StaffMember,
  Timeline,
} from './types';

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
  bills: (o: string) => ['outlet', o, 'bills'] as const,
  cameras: (o: string) => ['outlet', o, 'cameras'] as const,
  reservations: (o: string) => ['outlet', o, 'reservations'] as const,
};

export const useReservations = (outletId: string, date: string) =>
  useQuery({
    queryKey: [...qk.reservations(outletId), date],
    queryFn: () => api<Reservation[]>(`/outlets/${outletId}/reservations?date=${date}`),
  });

export const useHours = (outletId: string) =>
  useQuery({
    queryKey: ['outlet', outletId, 'hours'],
    queryFn: () => api<OpeningWindow[]>(`/outlets/${outletId}/hours`),
  });

/** Looks a guest up by phone once it is a complete number (recognition at the door / on the phone). */
export const useGuestLookup = (outletId: string, phone: string | null) =>
  useQuery({
    queryKey: ['outlet', outletId, 'guest-lookup', phone],
    queryFn: () =>
      api<{ guest: GuestProfile | null }>(
        `/outlets/${outletId}/guests/lookup?phone=${encodeURIComponent(phone!)}`,
      ),
    enabled: !!phone,
    staleTime: 30_000,
  });

/** Cameras + edge devices (managers). Polled so the health wall stays current between socket hints. */
export const useCameras = (outletId: string) =>
  useQuery({
    queryKey: qk.cameras(outletId),
    queryFn: () => api<Camera[]>(`/outlets/${outletId}/cameras`),
    refetchInterval: 30_000,
  });

export const useEdgeDevices = (outletId: string) =>
  useQuery({
    queryKey: [...qk.cameras(outletId), 'devices'],
    queryFn: () => api<EdgeDevice[]>(`/outlets/${outletId}/edge-devices`),
    refetchInterval: 30_000,
  });

export const useTableBills = (outletId: string, tableId: string) =>
  useQuery({
    queryKey: [...qk.bills(outletId), 'table', tableId],
    queryFn: () => api<Bill[]>(`/outlets/${outletId}/tables/${tableId}/bills`),
  });

export const useDayBills = (outletId: string, date: string) =>
  useQuery({
    queryKey: [...qk.bills(outletId), 'day', date],
    queryFn: () => api<Bill[]>(`/outlets/${outletId}/bills?date=${date}`),
  });

export const useAlertHistory = (outletId: string, status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED') =>
  useQuery({
    queryKey: [...qk.alerts(outletId), status],
    queryFn: () => api<Alert[]>(`/outlets/${outletId}/alerts?status=${status}`),
  });

export const useAuditPage = (outletId: string, cursor: string | null) =>
  useQuery({
    queryKey: ['outlet', outletId, 'audit', cursor],
    queryFn: () =>
      api<{ items: AuditEntry[]; nextCursor: string | null }>(
        `/outlets/${outletId}/audit-logs?limit=50${cursor ? `&cursor=${cursor}` : ''}`,
      ),
  });

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
