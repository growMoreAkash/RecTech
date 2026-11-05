import { Injectable } from '@nestjs/common';
import type { Alert, Role, Task } from '@prisma/client';
import { messages } from '@dinesense/i18n';
import { ROLE_TASK_TYPES, rooms } from '@dinesense/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PushService } from './push.service';

const PUSHED_ALERTS = new Set<string>([
  'NO_ELIGIBLE_WAITER',
  'ESCALATION',
  'LEFT_WITHOUT_PAYING',
  'CAMERA_OFFLINE',
  'EDGE_OFFLINE',
]);

const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/**
 * Tells the right people about new work: socket events for open screens, web push for phones in pockets.
 * Assigned tasks go to the assignee; unassigned ones to checked-in, on-shift staff whose role handles that task.
 * Text comes from the i18n catalog (English until staff locale preferences exist).
 */
@Injectable()
export class NotifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  async taskCreated(task: Task): Promise<void> {
    this.emitTask('task.created', task);
    const recipients = task.assigneeId
      ? [task.assigneeId]
      : await this.onShiftFor(task.outletId, (r) => ROLE_TASK_TYPES[r].includes(task.type));
    const label = await this.tableLabel(task.tableId);
    const t = messages.en.push;
    await this.push.toUsers(recipients, {
      title: t.title,
      body: fill(t[task.type as keyof typeof t] ?? t.title, { table: label }),
      url: '/',
      tag: `task-${task.type}-${task.tableId ?? task.id}`,
    });
  }

  taskUpdated(task: Task): void {
    this.emitTask('task.updated', task);
  }

  async alertRaised(alert: Alert): Promise<void> {
    // Phones only buzz for what needs a person now; everything else is on the dashboard via sockets.
    if (alert.severity !== 'CRITICAL' && !PUSHED_ALERTS.has(alert.type)) return;
    const managers = await this.prisma.userOutletRole.findMany({
      where: { outletId: alert.outletId, role: { in: ['OWNER', 'MANAGER'] }, user: { active: true } },
      select: { userId: true },
    });
    const t = messages.en.push;
    const label = await this.tableLabel(alert.tableId);
    const entry = (messages.en.alerts as unknown as Record<string, unknown>)[alert.type];
    const kind = typeof entry === 'string' ? entry : alert.type;
    await this.push.toUsers(
      managers.map((m) => m.userId),
      { title: kind, body: fill(t.alert, { table: label }), url: '/', tag: `alert-${alert.id}` },
    );
  }

  private emitTask(event: 'task.created' | 'task.updated', task: Task) {
    const to = [rooms.role('MANAGER', task.outletId), rooms.role('HOST', task.outletId)];
    if (task.assigneeId) to.push(rooms.staff(task.assigneeId));
    else
      for (const role of Object.keys(ROLE_TASK_TYPES) as Role[])
        if (ROLE_TASK_TYPES[role].includes(task.type)) to.push(rooms.role(role, task.outletId));
    this.realtime.emit(to, event, {
      id: task.id,
      outletId: task.outletId,
      type: task.type,
      status: task.status,
      tableId: task.tableId,
      assigneeId: task.assigneeId,
    });
  }

  /** Users checked in right now (not on break, not checked out) whose shift role passes `accepts`. */
  private async onShiftFor(outletId: string, accepts: (r: Role) => boolean): Promise<string[]> {
    const now = new Date();
    const shifts = await this.prisma.shift.findMany({
      where: {
        outletId,
        checkedInAt: { not: null },
        checkedOutAt: null,
        onBreak: false,
        startsAt: { lte: new Date(now.getTime() + 3_600_000) },
        endsAt: { gt: now },
      },
      select: { userId: true, role: true },
    });
    return shifts.filter((s) => accepts(s.role)).map((s) => s.userId);
  }

  private async tableLabel(tableId: string | null): Promise<string> {
    if (!tableId) return '';
    return (
      (await this.prisma.table.findUnique({ where: { id: tableId }, select: { label: true } }))?.label ?? ''
    );
  }
}
