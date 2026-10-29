import type { EventOutcome } from './schemas/event.schema.js';
import type { PatientEventDocument } from './schemas/event.schema.js';

export interface EventView {
  id: string;
  patientId: string;
  type: string;
  data: Record<string, unknown>;
  ts: string;
  status: string;
  attempt: number;
  effectApplied: boolean;
  lastError: string | null;
  outcome: EventOutcome | null;
  receivedAt: string;
  processedAt: string | null;
}

export function toEventView(event: PatientEventDocument): EventView {
  return {
    id: event._id.toString(),
    patientId: event.patientId,
    type: event.type,
    data: event.data,
    ts: event.ts.toISOString(),
    status: event.status,
    attempt: event.attempt,
    effectApplied: event.effectApplied,
    lastError: event.lastError,
    outcome: event.outcome,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt ? event.processedAt.toISOString() : null,
  };
}
