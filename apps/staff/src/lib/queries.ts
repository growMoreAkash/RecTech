'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Bill, Floor, Menu, Order, Shift, Task } from './types';

export const qk = {
  outlet: (o: string) => ['outlet', o] as const,
  floor: (o: string) => ['outlet', o, 'floor'] as const,
  tasks: (o: string) => ['outlet', o, 'tasks'] as const,
  shifts: (o: string) => ['outlet', o, 'shifts'] as const,
  menu: (o: string) => ['outlet', o, 'menu'] as const,
  orders: (o: string, t: string) => ['outlet', o, 'orders', t] as const,
  bills: (o: string, t: string) => ['outlet', o, 'bills', t] as const,
};

export const useFloor = (o: string) =>
  useQuery({ queryKey: qk.floor(o), queryFn: () => api<Floor>(`/outlets/${o}/floor`) });
export const useTasks = (o: string) =>
  useQuery({ queryKey: qk.tasks(o), queryFn: () => api<Task[]>(`/outlets/${o}/tasks`) });
export const useShifts = (o: string) =>
  useQuery({
    queryKey: qk.shifts(o),
    queryFn: () => api<{ date: string; shifts: Shift[] }>(`/outlets/${o}/shifts`),
  });
export const useMenu = (o: string) =>
  useQuery({ queryKey: qk.menu(o), queryFn: () => api<Menu>(`/outlets/${o}/menu`) });
export const useTableOrders = (o: string, t: string) =>
  useQuery({ queryKey: qk.orders(o, t), queryFn: () => api<Order[]>(`/outlets/${o}/tables/${t}/orders`) });
export const useTableBills = (o: string, t: string) =>
  useQuery({ queryKey: qk.bills(o, t), queryFn: () => api<Bill[]>(`/outlets/${o}/tables/${t}/bills`) });

export function useOutletMutation<TVars>(o: string, fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: qk.outlet(o) }) });
}
