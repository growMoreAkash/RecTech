import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

/** Opaque random token, URL-safe. */
export const randomToken = (prefix: string, bytes = 32) =>
  `${prefix}_${randomBytes(bytes).toString('base64url')}`;

/** Tokens are high-entropy, so a fast hash is fine (and lets us look them up by hash). */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (secret: string) => argon2.hash(secret, ARGON);

export async function verifySecret(hash: string | null | undefined, secret: string): Promise<boolean> {
  if (!hash) {
    // Spend comparable time so missing users are not distinguishable by timing.
    await argon2.hash(secret, ARGON);
    return false;
  }
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}
