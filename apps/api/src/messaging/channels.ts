import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { ChannelError, MESSAGE_CHANNEL, type MessageChannel, type OutboundMessage } from './message-channel';

/** Dev / no credentials: records and logs the message, sends nothing. */
@Injectable()
export class ConsoleChannel implements MessageChannel {
  readonly name = 'console' as const;
  private readonly logger = new Logger('WhatsApp(console)');

  send(m: OutboundMessage): Promise<{ providerMessageId: string | null }> {
    this.logger.log(
      `→ ${m.to.slice(0, -4).replace(/\d/g, '•')}${m.to.slice(-4)} [${m.template}/${m.locale}] ${m.text}`,
    );
    return Promise.resolve({ providerMessageId: `console_${randomUUID()}` });
  }
}

/**
 * Meta WhatsApp Cloud API: template messages (business-initiated messages must use approved templates).
 * POST {api}/{phone-number-id}/messages with the template name, language and body parameters.
 */
@Injectable()
export class WhatsAppChannel implements MessageChannel {
  readonly name = 'whatsapp' as const;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(m: OutboundMessage): Promise<{ providerMessageId: string | null }> {
    let res: Response;
    try {
      res = await fetch(`${this.env.WHATSAPP_API_URL}/${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.env.WHATSAPP_ACCESS_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: m.to.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: m.template,
            language: { code: m.locale },
            components: [{ type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) }],
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new ChannelError(`network: ${String(e)}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      // 4xx other than rate limits won't succeed on retry (bad number, unapproved template, …).
      throw new ChannelError(
        body.error?.message ?? `HTTP ${res.status}`,
        res.status >= 500 || res.status === 429,
      );
    }
    return { providerMessageId: body.messages?.[0]?.id ?? null };
  }
}

export const channelFactory = {
  provide: MESSAGE_CHANNEL,
  inject: [ENV, ConsoleChannel, WhatsAppChannel],
  useFactory: (env: Env, console: ConsoleChannel, whatsapp: WhatsAppChannel): MessageChannel =>
    env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? whatsapp : console,
};
