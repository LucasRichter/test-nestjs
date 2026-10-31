import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { sleep } from '../src/common/sleep.js';
import { configureApp } from '../src/app.setup.js';
import { AppModule } from '../src/app.module.js';
import {
  EXTERNAL_SYSTEM,
  type ExternalCall,
  type ExternalSystem,
} from '../src/events/processing/external-system.js';

class RecordingExternal implements ExternalSystem {
  readonly calls: ExternalCall[] = [];
  readonly maxActive = new Map<string, number>();
  private readonly active = new Map<string, number>();
  delayMs = 40;
  failTypes = new Set<string>();

  async apply(event: ExternalCall): Promise<void> {
    const current = (this.active.get(event.patientId) ?? 0) + 1;
    this.active.set(event.patientId, current);
    this.maxActive.set(
      event.patientId,
      Math.max(this.maxActive.get(event.patientId) ?? 0, current),
    );
    this.calls.push(event);
    try {
      if (this.failTypes.has(event.type)) {
        throw new Error('external unavailable');
      }
      await sleep(this.delayMs);
    } finally {
      this.active.set(
        event.patientId,
        (this.active.get(event.patientId) ?? 1) - 1,
      );
    }
  }

  callsFor(patientId: string): ExternalCall[] {
    return this.calls.filter((call) => call.patientId === patientId);
  }
}

function applyEnv(uri: string, overrides: Record<string, string> = {}): void {
  const values: Record<string, string> = {
    MONGODB_URI: uri,
    PROCESSING_DELAY_MS: '30',
    REORDER_GRACE_MS: '400',
    WORKER_CONCURRENCY: '10',
    LOCK_TTL_MS: '30000',
    MAX_ATTEMPTS: '5',
    POLL_INTERVAL_MS: '25',
    WORKER_ENABLED: 'true',
    RETRY_BACKOFF_MS: '20',
    OLDEST_PENDING_DEGRADED_MS: '60000',
    SHUTDOWN_TIMEOUT_MS: '500',
    PORT: '0',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

async function createApp(
  uri: string,
  external?: ExternalSystem,
  overrides: Record<string, string> = {},
) {
  applyEnv(uri, overrides);
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (external) {
    builder = builder.overrideProvider(EXTERNAL_SYSTEM).useValue(external);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 8_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return;
    }
    await sleep(25);
  }
  throw new Error('timed out waiting for condition');
}

describe('ingest service', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let external: RecordingExternal;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    external = new RecordingExternal();
    app = await createApp(replSet.getUri('ingest'), external);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await replSet.stop();
  });

  async function post(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/events').send(body);
  }

  it('rejects an invalid payload without storing it', async () => {
    const response = await post({
      patientId: 'p-invalid',
      type: 'vitals',
      data: [],
      ts: 'not-a-date',
    });
    expect(response.status).toBe(400);
    const timeline = await request(app.getHttpServer()).get(
      '/patients/p-invalid',
    );
    expect(timeline.body.events).toEqual([]);
  });

  it('accepts a retry of the same payload once', async () => {
    const body = {
      patientId: 'p-dup',
      type: 'vitals',
      data: { heartRate: 80, note: 'same' },
      ts: '2026-01-01T00:00:00Z',
    };
    const [first, second] = await Promise.all([
      post(body),
      post({
        ...body,
        data: { note: 'same', heartRate: 80 },
        ts: '2026-01-01T00:00:00.000Z',
      }),
    ]);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.id).toBe(second.body.id);
    expect([first.body.duplicate, second.body.duplicate].sort()).toEqual([
      false,
      true,
    ]);

    const timeline = await request(app.getHttpServer()).get('/patients/p-dup');
    expect(timeline.body.events).toHaveLength(1);
  });

  it('returns 202 before the external call finishes', async () => {
    const slow = await createApp(replSet.getUri('ingest_slow'), undefined, {
      PROCESSING_DELAY_MS: '1500',
      REORDER_GRACE_MS: '0',
      SHUTDOWN_TIMEOUT_MS: '100',
    });
    const started = Date.now();
    const response = await request(slow.getHttpServer())
      .post('/events')
      .send({
        patientId: 'p-fast',
        type: 'vitals',
        data: { n: 1 },
        ts: '2026-02-01T00:00:00.000Z',
      });
    const elapsed = Date.now() - started;
    expect(response.status).toBe(202);
    expect(elapsed).toBeLessThan(500);
    await slow.close();
  });

  it('applies one patient in event-time order when the later event arrives first', async () => {
    const patientId = 'p-order';
    await post({
      patientId,
      type: 'vitals',
      data: { n: 2 },
      ts: '2026-03-01T00:00:02.000Z',
    });
    await post({
      patientId,
      type: 'vitals',
      data: { n: 1 },
      ts: '2026-03-01T00:00:01.000Z',
    });

    await waitFor(async () => {
      const timeline = await request(app.getHttpServer()).get(
        `/patients/${patientId}`,
      );
      return timeline.body.events.every(
        (event: { status: string }) => event.status === 'processed',
      );
    });

    const timeline = await request(app.getHttpServer()).get(
      `/patients/${patientId}`,
    );
    expect(
      timeline.body.events.map(
        (event: { data: { n: number } }) => event.data.n,
      ),
    ).toEqual([1, 2]);
    expect(timeline.body.events[0].outcome.sequence).toBe(1);
    expect(timeline.body.events[1].outcome.sequence).toBe(2);
    expect(timeline.body.events[1].outcome.previousEventId).toBe(
      timeline.body.events[0].id,
    );
    expect(external.callsFor(patientId).map((call) => call.id)).toEqual([
      timeline.body.events[0].id,
      timeline.body.events[1].id,
    ]);
  });

  it('rewrites the suffix of a late event without applying the external effect twice', async () => {
    const patientId = 'p-late';
    const created = await post({
      patientId,
      type: 'vitals',
      data: { n: 2 },
      ts: '2026-04-01T00:00:02.000Z',
    });
    await waitFor(async () => {
      const event = await request(app.getHttpServer()).get(
        `/events/${created.body.id}`,
      );
      return event.body.status === 'processed';
    });

    const late = await post({
      patientId,
      type: 'vitals',
      data: { n: 1 },
      ts: '2026-04-01T00:00:01.000Z',
    });
    await waitFor(async () => {
      const timeline = await request(app.getHttpServer()).get(
        `/patients/${patientId}`,
      );
      return timeline.body.events.every(
        (event: { status: string }) => event.status === 'processed',
      );
    });

    const timeline = await request(app.getHttpServer()).get(
      `/patients/${patientId}`,
    );
    expect(
      timeline.body.events.map((event: { id: string }) => event.id),
    ).toEqual([late.body.id, created.body.id]);
    expect(timeline.body.events[1].outcome.sequence).toBe(2);
    expect(timeline.body.events[1].outcome.previousEventId).toBe(late.body.id);
    expect(
      external.calls.filter((call) => call.id === created.body.id),
    ).toHaveLength(1);
    expect(timeline.body.stateHash).toBe(
      timeline.body.events[1].outcome.stateHash,
    );
  });

  it('does not process two events of the same patient at the same time', async () => {
    external.delayMs = 80;
    const patients = ['p-serial-a', 'p-serial-b'];
    for (const patientId of patients) {
      for (let index = 0; index < 4; index++) {
        await post({
          patientId,
          type: 'vitals',
          data: { n: index },
          ts: new Date(Date.UTC(2026, 5, 1, 0, 0, index)).toISOString(),
        });
      }
    }

    await waitFor(async () => {
      const timelines = await Promise.all(
        patients.map((patientId) =>
          request(app.getHttpServer()).get(`/patients/${patientId}`),
        ),
      );
      return timelines.every((timeline) =>
        timeline.body.events.every(
          (event: { status: string }) => event.status === 'processed',
        ),
      );
    }, 12_000);

    expect(external.maxActive.get('p-serial-a')).toBe(1);
    expect(external.maxActive.get('p-serial-b')).toBe(1);
    external.delayMs = 40;
  });

  it('picks the event up after the lock expires without a second external effect', async () => {
    const leased = new RecordingExternal();
    leased.delayMs = 400;
    const leaseApp = await createApp(replSet.getUri('ingest_lease'), leased, {
      LOCK_TTL_MS: '120',
      REORDER_GRACE_MS: '0',
      POLL_INTERVAL_MS: '20',
      MAX_ATTEMPTS: '5',
    });
    const response = await request(leaseApp.getHttpServer())
      .post('/events')
      .send({
        patientId: 'p-lease',
        type: 'vitals',
        data: { n: 1 },
        ts: '2026-06-01T00:00:00.000Z',
      });

    await waitFor(async () => {
      const event = await request(leaseApp.getHttpServer()).get(
        `/events/${response.body.id}`,
      );
      return event.body.status === 'processed';
    });

    const event = await request(leaseApp.getHttpServer()).get(
      `/events/${response.body.id}`,
    );
    expect(event.body.status).toBe('processed');
    expect(event.body.effectApplied).toBeUndefined();
    expect(leased.calls).toHaveLength(1);
    await leaseApp.close();
  });

  it('stops the patient on a visible failure instead of skipping ahead', async () => {
    external.failTypes.add('boom');
    const patientId = 'p-failed';
    const failed = await post({
      patientId,
      type: 'boom',
      data: { n: 1 },
      ts: '2026-07-01T00:00:01.000Z',
    });
    const later = await post({
      patientId,
      type: 'vitals',
      data: { n: 2 },
      ts: '2026-07-01T00:00:02.000Z',
    });

    await waitFor(async () => {
      const event = await request(app.getHttpServer()).get(
        `/events/${failed.body.id}`,
      );
      return event.body.status === 'failed';
    });
    await sleep(300);

    const blocked = await request(app.getHttpServer()).get(
      `/events/${later.body.id}`,
    );
    const failedEvent = await request(app.getHttpServer()).get(
      `/events/${failed.body.id}`,
    );
    expect(blocked.body.status).toBe('pending');
    expect(failedEvent.body.status).toBe('failed');
    expect(failedEvent.body.lastError).toBeUndefined();
    expect(failedEvent.body.attempt).toBeUndefined();
    external.failTypes.delete('boom');
  });
});
