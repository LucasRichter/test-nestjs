import { buildIdempotencyKey } from './idempotency.js';

describe('idempotency key', () => {
  const base = {
    patientId: 'patient-1',
    type: 'vitals',
    data: { heartRate: 80, note: 'ok' },
    ts: '2026-01-01T00:00:00.000Z',
  };

  it('treats key order and equivalent timestamps as the same event', () => {
    const reordered = buildIdempotencyKey({
      ...base,
      data: { note: 'ok', heartRate: 80 },
      ts: '2026-01-01T00:00:00Z',
    });

    expect(reordered).toBe(buildIdempotencyKey(base));
  });

  it('changes when the clinical payload changes', () => {
    const other = buildIdempotencyKey({
      ...base,
      data: { heartRate: 81, note: 'ok' },
    });

    expect(other).not.toBe(buildIdempotencyKey(base));
  });
});
