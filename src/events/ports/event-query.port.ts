import type { PatientEventDocument } from '../schemas/event.schema.js';

export const EVENT_QUERY = Symbol('EVENT_QUERY');

export interface EventQuery {
  findById(id: string): Promise<PatientEventDocument | null>;
  findTimeline(patientId: string): Promise<PatientEventDocument[]>;
}
