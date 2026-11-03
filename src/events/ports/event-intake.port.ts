import type { PatientEventDocument } from '../schemas/event.schema.js';

export const EVENT_INTAKE = Symbol('EVENT_INTAKE');

export interface PendingEventInsert {
  patientId: string;
  type: string;
  data: Record<string, unknown>;
  ts: Date;
  idempotencyKey: string;
  status: 'pending';
  receivedAt: Date;
  eligibleAt: Date;
  attempt: number;
  effectApplied: boolean;
  lockToken: null;
  lockedUntil: null;
  lastError: null;
  processedAt: null;
  outcome: null;
}

export interface EventIntake {
  insertPending(document: PendingEventInsert): Promise<string>;
  findByIdempotencyKey(key: string): Promise<PatientEventDocument | null>;
}
