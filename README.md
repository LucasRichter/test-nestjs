# Clinical event ingest

NestJS service that accepts patient events over HTTP, processes them in the background, and stores the outcome in a single MongoDB collection. The sender gets an answer immediately. Processing simulates a slow external system and takes about five seconds.

```bash
docker compose up --build
```

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/health`

```bash
curl -X POST http://localhost:3000/events \
  -H "content-type: application/json" \
  -d "{\"patientId\":\"p1\",\"type\":\"vitals\",\"data\":{\"heartRate\":80},\"ts\":\"2026-01-01T00:00:00.000Z\"}"
```

The response is `202` with `{ id, status, duplicate }`. Processing continues after that response.

MongoDB is a one-node replica set so a multi-document transaction can accept a late event and roll back that patient's later outcomes together. From the host, open a shell with `docker compose exec mongo mongosh`. The replica set advertises the hostname `mongo`, which resolves inside Compose.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/events` | Validate, persist, return `202`. Invalid body is `400`. Store down is `503`. |
| `GET` | `/events/:id` | One event and its outcome. |
| `GET` | `/patients/:patientId` | That patient's events in `ts` order, plus the current `stateHash`. |
| `GET` | `/health` | Mongo, worker, and backlog. `degraded` when the oldest pending event is too old. `503` when Mongo is down. |

`data` is a JSON object. `ts` is ISO-8601. There is no authentication and no clinical rule. Swagger is only there so the endpoints can be called by hand.

## Data model

One collection, `events`. The document is both the queue item and the result. A patient's state is the chain of `processed` events ordered by `ts`.

What the sender sends:

- `patientId` — who the event belongs to. The worker runs one event at a time for this id.
- `type` — kind of event.
- `data` — JSON object body.
- `ts` — when it happened on the sender's clock. Application order uses this, not arrival order.

What the service adds:

- `idempotencyKey` — SHA-256 of the canonical payload. A retry finds this document instead of inserting another.
- `status` — `pending`, `processing`, `processed`, or `failed`.
- `outcome.sequence`, `outcome.previousEventId`, `outcome.stateHash` — position in that patient's chain. This is an observable fold, not a clinical calculation.

Support fields: `receivedAt` and `eligibleAt` (the two-second reorder window), `lockToken` and `lockedUntil` (who owns the event), `effectApplied` (the external effect was already counted), `attempt` and `lastError`.

Indexes: unique `idempotencyKey`; `{ patientId, ts }` for order; `{ status, eligibleAt, ts }` for the worker; a partial unique index on `patientId` where `status` is `processing`.

## Why it is shaped this way

Section 3 of the assignment describes the room the service lives in. The choices below follow from that.

**The sender will not wait.** `POST /events` writes the event and returns `202`. The five-second call is not on the request path. A response near five seconds would mean processing leaked into the request.

**An accepted event must not disappear.** The `202` is sent only after the insert is acknowledged. A failed write is `5xx`, and the sender retries. The queue is the collection itself, so a restart does not drop work that was only in memory.

**The same event must not be counted twice.** The payload has no event id. The idempotency key is the hash of `patientId`, `type`, `data`, and `ts`, with object keys sorted and `ts` normalized to one ISO form. An identical retry returns the same id and `duplicate: true`, still as `202`.

This does not close the problem. Two genuinely identical clinical facts become one document. A retry that changes `ts` becomes a second event and is counted again. Without an id from the sender, those two cases cannot be told apart.

**Today's volume is 1000 events per minute, for hours, and it will grow.** That is about 17 arrivals per second. Each holds a slot for 5 seconds, so a steady run needs about 84 in flight. The worker defaults to 100 slots (`WORKER_CONCURRENCY`). The wait is I/O, not CPU, so one Node process can hold those timers. Patients are processed in parallel with each other. One patient is serial, because that patient's result depends on order. If a whole minute of traffic is for one patient, it becomes a queue of more than an hour. Growth is more slots, or another process with `WORKER_ENABLED` using the same database lock. This delivery runs one process.

**Order is per patient, by `ts`.** A short reorder window (`REORDER_GRACE_MS`, default 2 seconds) keeps a patient idle until its oldest pending event is eligible. Events that arrive slightly out of order during that window line up without a rewrite. An event that arrives after a later one was already applied is inserted in the same transaction that sets those later outcomes back to `pending`. The chain is rebuilt in `ts` order. `effectApplied` is left in place, so the external call is not made again. The cost is extra code, a replica set (transactions need one), and that patient's line stalling for five seconds per replayed event that still needs the external call. Events that already recorded the effect skip the wait.

The smaller design stops at the grace window: a very late event stays stored and visible, and nothing already applied is rewritten. Mongo then does not need to be a replica set. This delivery keeps the rewrite because the patient's result depends on sequence. If that path had become hard to read, the smaller design would have been the right cut.

**The process can die in the middle of the call.** A claim stores `lockToken` and `lockedUntil`. Completion writes only if that token still matches. A dead worker's lock expires and the event returns to `pending`. On shutdown the process stops claiming, waits for in-flight work, then releases whatever it still holds. The external effect is recorded on the document before the slow call. A crash during the call does not count the effect twice. A crash in the tiny window before that write can repeat the call. A real external system would have to honor the same key. End-to-end exactly-once is not a promise this service can keep.

**A failed event stays visible and blocks that patient.** After `MAX_ATTEMPTS` (default 5) the status is `failed` and `lastError` is readable. A later `ts` is not applied over the hole. Other patients continue. There is no manual replay endpoint.

**The service keeps accepting when the backlog grows.** Rejecting a clinical event is a form of loss if the sender does not retry. `GET /health` reports `pending`, the age of the oldest pending event, and turns `degraded` past `OLDEST_PENDING_DEGRADED_MS` (default 30 seconds). The alternative, not implemented, is `503` once lag is too high, so the sender retries later instead of filling the disk.

## Throughput check

`npm test` uses a short delay. It proves the invariants. It does not prove throughput.

`npm run load` talks to the Docker API with the real 5 second delay and 100 slots:

- 60 seconds at 1000 events per minute
- 200 distinct patients, so the slots can actually run in parallel
- a small share of identical retries

It passes when the POST p95 stays under 250ms, in-flight work peaks between 40 and 100, pending stays bounded, and the backlog drains with one processed document per distinct payload. This is one minute at today's rate, not a multi-hour soak.

```bash
docker compose down -v
docker compose up --build -d
npm run load
npm run demo
```

`docker compose down -v` drops the volume so the load check is counting only this run.

`npm run demo` posts a later event, retries it, waits until it is processed, then posts an earlier event and prints the rebuilt timeline.

## Tests

NestJS 12's generated project uses Vitest, so the suite uses Vitest rather than Jest. `npm test` runs the unit checks and the MongoDB end-to-end checks (in-memory replica set).

Covered:

- canonical retries collapse to one document, including parallel inserts
- invalid bodies are `400` and are not stored
- `202` returns before the external delay
- a later `ts` that arrives first is applied after the earlier one
- a late event rewrites the suffix without a second external effect
- two events of one patient are not processed together
- an expired lock is picked up again without a second external effect
- a failed event remains visible and holds the rest of that patient

## What I would do with more time

- Run more than one API process and measure claim conflicts.
- Use a real replica set and `w: majority`.
- Return `503` when the oldest pending event is past a hard lag limit.
- Ask senders for a stable event id. The body hash is only a stand-in.
- Add an explicit replay for `failed` events.
- Cap the size of `data`. Today anything that is not a JSON object is rejected, and that is all.

## Layout

`src/events` accepts and reads events. `src/events/processing` is the worker and the simulated external call. `src/health` is the backlog probe. Configuration is environment variables, listed in `.env.example` and set by Compose.
