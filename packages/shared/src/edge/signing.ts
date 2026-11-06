import { createHash, createHmac } from 'node:crypto';

/**
 * Edge request signature (shared spec with services/vision):
 *   signature = hex( HMAC-SHA256( secret, `${timestamp}.${METHOD}.${path}.${hex(sha256(body))}` ) )
 * `path` is the URL path incl. query (e.g. /api/v1/edge/events); body is the exact bytes sent ("" for GET).
 * Method + path in the signed string stop a captured signature being replayed against another endpoint.
 */
export function edgeSignature(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: Buffer | string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret)
    .update(`${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`)
    .digest('hex');
}

/** Known-answer vector, asserted by both the TypeScript and Python test suites. */
export const EDGE_SIGNING_VECTOR = {
  secret: 'es_test_secret_0123456789abcdef',
  timestamp: '1762300800',
  method: 'POST',
  path: '/api/v1/edge/events',
  body: '{"deviceId":"edg_1","sentAt":"2025-11-05T00:00:00Z","events":[]}',
  // Independently computed with openssl (see signing.spec.ts); never derive it from edgeSignature itself.
  signature: '4ae67dc7fa434a000286de03b27a8f23985e3aed7fc0650f91e793cf2196005b',
} as const;
