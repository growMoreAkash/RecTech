import type { Task } from './types';

/** What finishing a task means for staff — the button the inbox shows. */
export type TaskAction = 'done' | 'greet' | 'clean' | 'fire' | 'openTable';

export function taskAction(type: Task['type']): TaskAction {
  switch (type) {
    case 'CALL_WAITER':
    case 'WATER':
    case 'CUTLERY':
    case 'CHECK_TABLE':
    case 'OFFER_DESSERT':
    case 'SERVICE_RECOVERY':
      return 'done';
    case 'FIRE_COURSE':
      return 'fire';
    case 'GREET':
      return 'greet';
    case 'CLEAN':
      return 'clean';
    // Serving, approving and billing happen on the table's orders/bill.
    case 'SERVE':
    case 'APPROVE_ORDER':
    case 'BILL':
      return 'openTable';
  }
}

/** Urgency order for the inbox: guests waiting first. */
const PRIORITY: Record<Task['type'], number> = {
  GREET: 0,
  SERVICE_RECOVERY: 1,
  APPROVE_ORDER: 2,
  SERVE: 3,
  CALL_WAITER: 4,
  FIRE_COURSE: 5,
  BILL: 6,
  CHECK_TABLE: 7,
  WATER: 8,
  CUTLERY: 9,
  OFFER_DESSERT: 10,
  CLEAN: 11,
};

export const sortTasks = (tasks: Task[]) =>
  [...tasks].sort(
    (a, b) => PRIORITY[a.type] - PRIORITY[b.type] || Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
