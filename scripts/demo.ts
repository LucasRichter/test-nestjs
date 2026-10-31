const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';

interface Accepted {
  id: string;
  status: string;
  duplicate: boolean;
}

interface Timeline {
  patientId: string;
  stateHash: string | null;
  events: Array<{
    id: string;
    status: string;
    ts: string;
    data: { step?: string };
    outcome: {
      sequence: number;
      previousEventId: string | null;
      stateHash: string;
    } | null;
  }>;
}

async function post(body: Record<string, unknown>): Promise<Accepted> {
  const response = await fetch(`${baseUrl}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `POST /events failed with ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as Accepted;
}

async function timeline(patientId: string): Promise<Timeline> {
  const response = await fetch(`${baseUrl}/patients/${patientId}`);
  if (!response.ok) {
    throw new Error(`GET patient failed with ${response.status}`);
  }
  return (await response.json()) as Timeline;
}

async function waitUntilProcessed(patientId: string): Promise<Timeline> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const view = await timeline(patientId);
    if (
      view.events.length > 0 &&
      view.events.every((event) => event.status === 'processed')
    ) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('timeline was not fully processed in time');
}

const patientId = `demo-${Date.now()}`;
const later = await post({
  patientId,
  type: 'vitals',
  data: { step: 'later' },
  ts: '2026-08-01T00:00:02.000Z',
});
const retry = await post({
  patientId,
  type: 'vitals',
  data: { step: 'later' },
  ts: '2026-08-01T00:00:02.000Z',
});
await waitUntilProcessed(patientId);
const earlier = await post({
  patientId,
  type: 'vitals',
  data: { step: 'earlier' },
  ts: '2026-08-01T00:00:01.000Z',
});
const done = await waitUntilProcessed(patientId);

console.log(
  JSON.stringify(
    {
      patientId,
      firstId: later.id,
      retry: { id: retry.id, duplicate: retry.duplicate },
      earlierId: earlier.id,
      stateHash: done.stateHash,
      events: done.events.map((event) => ({
        id: event.id,
        step: event.data.step,
        status: event.status,
        sequence: event.outcome?.sequence ?? null,
        previousEventId: event.outcome?.previousEventId ?? null,
      })),
    },
    null,
    2,
  ),
);
