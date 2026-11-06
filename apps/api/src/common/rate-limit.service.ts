import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { AppError } from './app-error';

/** Fixed-window counters in Redis. Used on public guest endpoints (QR abuse, prank orders, button spam). */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<void> {
    const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const [[, count]] = (await this.redis
      .multi()
      .incr(k)
      .expire(k, windowSeconds + 1)
      .exec()) as [[unknown, number], unknown];
    if (count > limit) {
      throw new AppError(
        'RATE_LIMITED',
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many requests; please slow down',
        {
          retryAfterSeconds: windowSeconds,
        },
      );
    }
  }
}
