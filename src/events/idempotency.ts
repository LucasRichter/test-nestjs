import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

export function normalizeTimestamp(ts: string): string {
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('ts must be a valid ISO-8601 timestamp');
  }
  return parsed.toISOString();
}

export function buildIdempotencyKey(input: {
  patientId: string;
  type: string;
  data: unknown;
  ts: string;
}): string {
  const payload = canonicalize({
    patientId: input.patientId,
    type: input.type,
    data: input.data,
    ts: normalizeTimestamp(input.ts),
  });
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function chainStateHash(
  previous: string,
  eventId: string,
  type: string,
): string {
  return createHash('sha256')
    .update(`${previous}|${eventId}|${type}`)
    .digest('hex');
}
