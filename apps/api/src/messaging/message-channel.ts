/** Where guest messages go (PLAN §11 `NotificationChannel`). WhatsApp now; SMS/FCM would be more channels. */
export interface OutboundMessage {
  to: string; // E.164
  template: string;
  locale: string;
  /** Ordered values for the template placeholders. */
  params: string[];
  /** Rendered text (console channel, logs). */
  text: string;
}

export interface MessageChannel {
  readonly name: 'whatsapp' | 'console';
  send(m: OutboundMessage): Promise<{ providerMessageId: string | null }>;
}

export const MESSAGE_CHANNEL = Symbol('MESSAGE_CHANNEL');

export class ChannelError extends Error {
  constructor(
    message: string,
    /** False for errors retrying cannot fix (invalid number, template rejected). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
