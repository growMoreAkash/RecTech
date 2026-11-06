import type { Prisma, Task } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Someone from the staff was at (or did something for) this table: a tap on its state, a waiter order, an approval,
 * a served item, a ticked-off task, or the camera seeing staff standing there. Ends the idle episode: the
 * check-table nudge is done and the idle alert resolved. Returns the tasks it closed (callers emit them).
 */
export async function touchSeating(tx: Tx, seatingId: string, at = new Date()): Promise<Task[]> {
  await tx.seating.updateMany({
    where: {
      id: seatingId,
      status: 'OPEN',
      OR: [{ lastStaffTouchAt: null }, { lastStaffTouchAt: { lt: at } }],
    },
    data: { lastStaffTouchAt: at },
  });
  const open = await tx.task.findMany({
    where: { seatingId, type: 'CHECK_TABLE', status: { in: ['OPEN', 'ACCEPTED'] } },
    select: { id: true },
  });
  if (open.length) {
    await tx.task.updateMany({
      where: { id: { in: open.map((t) => t.id) } },
      data: { status: 'DONE', doneAt: at },
    });
  }
  await tx.alert.updateMany({
    where: { seatingId, type: 'IDLE_TABLE', status: { not: 'RESOLVED' } },
    data: { status: 'RESOLVED', resolvedAt: at },
  });
  return open.length ? tx.task.findMany({ where: { id: { in: open.map((t) => t.id) } } }) : [];
}
