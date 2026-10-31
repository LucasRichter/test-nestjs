import {
  AcceptedEventDto,
  EventOutcomeDto,
  EventViewDto,
  PatientTimelineDto,
} from './dto/event-response.dto.js';
import type { PatientEventDocument } from './schemas/event.schema.js';

export function toEventView(event: PatientEventDocument): EventViewDto {
  return new EventViewDto({
    id: event._id.toString(),
    patientId: event.patientId,
    type: event.type,
    data: event.data,
    ts: event.ts.toISOString(),
    status: event.status,
    outcome: event.outcome
      ? new EventOutcomeDto({
          sequence: event.outcome.sequence,
          previousEventId: event.outcome.previousEventId,
          stateHash: event.outcome.stateHash,
        })
      : null,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt ? event.processedAt.toISOString() : null,
  });
}

export function toAccepted(values: AcceptedEventDto): AcceptedEventDto {
  return new AcceptedEventDto(values);
}

export function toTimeline(values: PatientTimelineDto): PatientTimelineDto {
  return new PatientTimelineDto(values);
}
