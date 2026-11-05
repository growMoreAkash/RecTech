import type { Task } from './types';

/** What finishing a task means for staff — the button the inbox shows. */
export type TaskAction = 'done' | 'greet' | 'clean' | 'openTable';

export function taskAction(type: Task['type']): TaskAction {
  switch (type) {
    case 'CALL_WAITER':
    case 'WATER':
    case 'CUTLERY':
      return 'done';
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
  APPROVE_ORDER: 1,
  SERVE: 2,
  CALL_WAITER: 3,
  BILL: 4,
  WATER: 5,
  CUTLERY: 6,
  CLEAN: 7,
};

export const sortTasks = (tasks: Task[]) =>
  [...tasks].sort(
    (a, b) => PRIORITY[a.type] - PRIORITY[b.type] || Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
