import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { ENV, type Env } from '../config/env';

/**
 * Edge secrets and camera URL encryption.
 * - Device secret = HMAC(EDGE_SECRET_KEY, deviceId): nothing secret stored per device; shown once at registration.
 * - RTSP URLs (they contain camera passwords) are AES-256-GCM encrypted at rest: base64(iv | tag | ciphertext).
 */
@Injectable()
export class EdgeCrypto {
  private readonly edgeKey: string;
  private readonly cameraKey: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.edgeKey = env.EDGE_SECRET_KEY ?? `edge:${env.JWT_ACCESS_SECRET}`;
    this.cameraKey = env.CAMERA_SECRET_KEY
      ? Buffer.from(env.CAMERA_SECRET_KEY, 'base64')
      : createHash('sha256').update(`camera:${env.JWT_ACCESS_SECRET}`).digest();
  }

  deviceSecret(deviceId: string): string {
    return `es_${createHmac('sha256', this.edgeKey).update(deviceId).digest('base64url')}`;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.cameraKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
  }

  decrypt(blob: string): string {
    const raw = Buffer.from(blob, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.cameraKey, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

/** rtsp://user:secret@10.0.0.5:554/stream → rtsp://10.0.0.5:554 (safe to show managers). */
export function maskStreamUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '—';
  }
}
