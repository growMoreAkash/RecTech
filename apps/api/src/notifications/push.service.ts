import { Inject, Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  title: string;
  body: string;
  /** Path to open when tapped (staff app). */
  url: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag: string;
}

export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<unknown>;
export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Web Push via VAPID (free, no third-party account). Expired subscriptions are pruned automatically. */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(PUSH_SENDER) private readonly send: PushSender,
  ) {
    this.enabled = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  }

  get publicKey(): string | null {
    return this.env.VAPID_PUBLIC_KEY ?? null;
  }

  async toUsers(userIds: string[], msg: PushMessage): Promise<number> {
    if (!this.enabled || !userIds.length) return 0;
    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId: { in: [...new Set(userIds)] } },
    });
    const payload = JSON.stringify(msg);
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await this.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.prisma.pushSubscription.deleteMany({ where: { id: s.id } });
          } else {
            this.logger.warn(`push to ${s.id} failed: ${String(e)}`);
          }
        }
      }),
    );
    return sent;
  }
}

/** Default sender: the `web-push` library with our VAPID details. */
export const pushSenderProvider = {
  provide: PUSH_SENDER,
  inject: [ENV],
  useFactory: (env: Env): PushSender => {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return () => Promise.resolve();
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    return (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 300, urgency: 'high' });
  },
};
