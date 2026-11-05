import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { SlaScheduler } from '../table-state/sla-scheduler';
import { SlaEngine } from './sla-engine.service';

const QUEUE = 'sla';

/**
 * Greet-SLA timers on BullMQ. A delayed `evaluate` job is set for each deadline the engine reports (greet due,
 * acknowledgement due, escalation due); job ids are deterministic so re-scheduling is idempotent. A repeatable
 * `reconcile` sweep re-evaluates every open un-greeted seating, so a flushed Redis or a restart loses nothing.
 */
@Injectable()
export class BullmqSlaScheduler implements SlaScheduler, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SlaScheduler');
  private readonly connection: IORedis;
  private readonly queue: Queue;
  private worker?: Worker;

  constructor(
    private readonly engine: SlaEngine,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    // BullMQ requires maxRetriesPerRequest: null on its connections.
    this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix: env.BULLMQ_PREFIX });
  }

  async onModuleInit(): Promise<void> {
    if (!this.env.SLA_WORKER_ENABLED) return;
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        if (job.name === 'reconcile') return this.reconcile();
        const seatingId = (job.data as { seatingId: string }).seatingId;
        await this.run(seatingId);
      },
      { connection: this.connection.duplicate(), prefix: this.env.BULLMQ_PREFIX, concurrency: 8 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`job ${job?.id} failed: ${err.message}`));
    if (this.env.SLA_RECONCILE_SECONDS > 0) {
      await this.queue.upsertJobScheduler(
        'sla-reconcile',
        { every: this.env.SLA_RECONCILE_SECONDS * 1000 },
        { name: 'reconcile' },
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit().catch(() => undefined);
  }

  async startGreetSla(input: { seatingId: string; seatedAt: Date; outletId: string }): Promise<void> {
    const settings = await this.prisma.outletSettings.findUnique({
      where: { outletId: input.outletId },
      select: { greetSlaSeconds: true },
    });
    await this.wakeAt(
      input.seatingId,
      new Date(input.seatedAt.getTime() + (settings?.greetSlaSeconds ?? 300) * 1000),
    );
  }

  /** Nothing to remove: pending wake-ups find the seating greeted and stop (cheaper than tracking job ids). */
  cancelGreetSla(): Promise<void> {
    return Promise.resolve();
  }

  /** Evaluate now and schedule the next wake-up the engine asks for. */
  async run(seatingId: string, now = new Date()): Promise<void> {
    try {
      const r = await this.engine.evaluate(seatingId, now);
      if (r.nextWakeAt) await this.wakeAt(seatingId, r.nextWakeAt);
    } catch (e) {
      this.engine.logError(seatingId, e);
    }
  }

  async reconcile(): Promise<number> {
    const ids = await this.engine.openUngreeted();
    for (const id of ids) await this.run(id);
    return ids.length;
  }

  private async wakeAt(seatingId: string, at: Date): Promise<void> {
    await this.queue.add(
      'evaluate',
      { seatingId },
      {
        // One job per seating per deadline (BullMQ forbids ':' in custom ids).
        jobId: `sla_${seatingId}_${at.getTime()}`,
        delay: Math.max(0, at.getTime() - Date.now()),
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
  }
}
