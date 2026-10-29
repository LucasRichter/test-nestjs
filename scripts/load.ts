const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const durationMs = Number(process.env.LOAD_DURATION_MS ?? 60_000);
const target = Number(process.env.LOAD_EVENTS ?? 1000);
const patients = Number(process.env.LOAD_PATIENTS ?? 200);
const duplicateEvery = 20;

interface Health {
  status: string;
  pending: number;
  processing: number;
  processed: number;
  failed: number;
  oldestPendingAgeMs: number | null;
}

interface Accepted {
  duplicate: boolean;
}

const latencies: number[] = [];
const samples: Health[] = [];
let accepted = 0;
let duplicates = 0;
let failures = 0;
let uniquePayloads = 0;

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * ratio) - 1,
  );
  return sorted[Math.max(0, index)];
}

async function send(
  index: number,
  payload: Record<string, unknown>,
  isDuplicate: boolean,
): Promise<void> {
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    latencies.push(Date.now() - started);
    if (!response.ok) {
      failures += 1;
      return;
    }
    const body = (await response.json()) as Accepted;
    accepted += 1;
    if (body.duplicate || isDuplicate) {
      duplicates += 1;
    }
  } catch {
    failures += 1;
    latencies.push(Date.now() - started);
  }
}

async function sample(): Promise<void> {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    return;
  }
  samples.push((await response.json()) as Health);
}

const startedAt = Date.now();
const requests: Promise<void>[] = [];
const sampler = setInterval(() => {
  void sample();
}, 5_000);
let previousPayload: Record<string, unknown> | null = null;

for (let index = 0; index < target; index++) {
  const due = startedAt + (index * durationMs) / target;
  const wait = due - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const isDuplicate =
    index > 0 && index % duplicateEvery === 0 && previousPayload !== null;
  const payload = isDuplicate
    ? previousPayload
    : {
        patientId: `load-${index % patients}`,
        type: 'vitals',
        data: { index },
        ts: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)).toISOString(),
      };
  if (!isDuplicate) {
    uniquePayloads += 1;
    previousPayload = payload;
  }
  requests.push(send(index, payload!, isDuplicate));
}

await Promise.all(requests);
clearInterval(sampler);
await sample();

const drainDeadline = Date.now() + 70_000;
let drained: Health | null = null;
while (Date.now() < drainDeadline) {
  await sample();
  const latest = samples[samples.length - 1];
  if (latest && latest.pending === 0 && latest.processing === 0) {
    drained = latest;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

const peakProcessing = samples.reduce(
  (max, sample) => Math.max(max, sample.processing),
  0,
);
const pendingAfterWarmup = samples.slice(2).map((sample) => sample.pending);
const pendingStayedBounded = pendingAfterWarmup.every(
  (pending) => pending < 200,
);
const p95 = percentile(latencies, 0.95);
const processedMatches =
  drained !== null &&
  drained.processed >= uniquePayloads &&
  drained.failed === 0;

const report = {
  accepted,
  duplicates,
  failures,
  uniquePayloads,
  p95Ms: p95,
  peakProcessing,
  pendingSamples: samples.map((sample) => sample.pending),
  processingSamples: samples.map((sample) => sample.processing),
  drained: drained !== null,
  processed: drained?.processed ?? samples.at(-1)?.processed ?? 0,
  failed: drained?.failed ?? samples.at(-1)?.failed ?? 0,
};

console.log(JSON.stringify(report, null, 2));

const passed =
  failures === 0 &&
  p95 < 250 &&
  peakProcessing <= 100 &&
  peakProcessing >= 40 &&
  pendingStayedBounded &&
  drained !== null &&
  processedMatches &&
  duplicates > 0;

if (!passed) {
  console.error('Load run did not meet the steady-state checks.');
  process.exitCode = 1;
}
