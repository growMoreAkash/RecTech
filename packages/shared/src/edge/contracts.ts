import { z } from 'zod';

/**
 * Edge → API contracts (docs/PLAN.md §6.1). The Python vision service mirrors these; `pnpm --filter
 * @dinesense/shared gen:edge-schema` writes the JSON Schema it validates against in its tests.
 */

const id = z.string().min(1).max(64);
/** UUIDv7 recommended (time-ordered); any unique string up to 64 chars is accepted. */
const eventId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const isoTime = z.string().datetime({ offset: true });

const base = { eventId, occurredAt: isoTime };
const tableEvent = { ...base, cameraId: id, tableId: id, confidence: z.number().min(0).max(1) };

export const edgeEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...tableEvent,
      type: z.literal('table.occupied'),
      payload: z
        .object({ guestCount: z.number().int().min(0).max(60), dwellSeconds: z.number().min(0) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...tableEvent,
      type: z.literal('table.vacated'),
      payload: z.object({ emptySeconds: z.number().min(0) }).strict(),
    })
    .strict(),
  z
    .object({
      ...tableEvent,
      type: z.literal('table.guest_count_changed'),
      payload: z
        .object({ guestCount: z.number().int().min(0).max(60), previous: z.number().int().min(0).max(60) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...tableEvent,
      type: z.literal('table.staff_present'),
      payload: z.object({ seconds: z.number().min(0), trackId: z.number().int() }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('camera.health'),
      cameraId: id,
      payload: z
        .object({
          status: z.enum(['ok', 'degraded', 'down']),
          fps: z.number().min(0).max(120),
          latencyMs: z.number().min(0),
          lastFrameAt: isoTime.nullable(),
          reconnects: z.number().int().min(0),
          error: z.string().max(300).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('device.heartbeat'),
      payload: z
        .object({
          version: z.string().max(40),
          uptimeS: z.number().min(0),
          queueDepth: z.number().int().min(0),
        })
        .strict(),
    })
    .strict(),
]);
export type EdgeEvent = z.infer<typeof edgeEventSchema>;
export type EdgeEventType = EdgeEvent['type'];

export const edgeBatchSchema = z
  .object({
    deviceId: id,
    sentAt: isoTime,
    events: z.array(z.unknown()).min(1).max(200),
  })
  .strict();
export type EdgeBatch = z.infer<typeof edgeBatchSchema>;

/**
 * The device deletes accepted, duplicate and rejected events from its outbox; `retry` ones (transient server
 * problems) stay queued and are sent again.
 */
export interface EdgeBatchResult {
  accepted: string[];
  duplicates: string[];
  rejected: { eventId: string; reason: string }[];
  retry: string[];
}

/** Normalised polygon point in [0, 1] of the snapshot. */
const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export const zonePolygonSchema = z.array(point).min(3).max(32);

export const cameraInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    edgeDeviceId: id,
    /** rtsp://user:pass@host:554/stream — stored encrypted, never returned to browsers. */
    rtspUrl: z
      .string()
      .trim()
      .regex(/^(rtsp|rtsps|http|https|file):\/\/\S+$/i, 'Use an rtsp:// URL')
      .max(500),
    fps: z.number().int().min(1).max(15).default(3),
    enabled: z.boolean().default(true),
  })
  .strict();
export type CameraInput = z.infer<typeof cameraInputSchema>;
export const cameraPatchSchema = cameraInputSchema.partial().strict();

export const zonesInputSchema = z
  .object({ zones: z.array(z.object({ tableId: id, polygon: zonePolygonSchema }).strict()).max(40) })
  .strict()
  .refine((z2) => new Set(z2.zones.map((x) => x.tableId)).size === z2.zones.length, {
    message: 'One zone per table per camera',
  });
export type ZonesInput = z.infer<typeof zonesInputSchema>;

export const edgeDeviceInputSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();

/** Signed-request headers (see signing.ts). The device secret itself is never sent. */
export const EDGE_HEADERS = {
  device: 'x-ds-device',
  timestamp: 'x-ds-timestamp',
  signature: 'x-ds-signature',
} as const;
/** Requests outside this window are rejected (replay protection). */
export const EDGE_CLOCK_SKEW_SECONDS = 300;
/** Buffered events older than this are dropped by the API (stale observations must not move tables). */
export const EDGE_MAX_EVENT_AGE_SECONDS = 15 * 60;
