import { Injectable } from '@nestjs/common';
import type { ServerToClientEvents } from '@dinesense/shared';
import { RealtimeGateway } from './realtime.gateway';

type Payload<E extends keyof ServerToClientEvents> = Omit<
  Parameters<ServerToClientEvents[E]>[0],
  'v' | 'emittedAt'
>;

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  emit<E extends keyof ServerToClientEvents>(room: string | string[], event: E, payload: Payload<E>): void {
    // The server is undefined until the HTTP server starts (e.g. in scripts); skip quietly.
    if (!this.gateway.server) return;
    const body = { v: 1, emittedAt: new Date().toISOString(), ...payload } as Parameters<
      ServerToClientEvents[E]
    >[0];
    (this.gateway.server.to(room).emit as (e: E, b: typeof body) => boolean)(event, body);
  }
}
