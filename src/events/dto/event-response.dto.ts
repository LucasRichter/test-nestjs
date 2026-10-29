import { ApiProperty } from '@nestjs/swagger';

export class AcceptedEventDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['pending', 'processing', 'processed', 'failed'] })
  status: string;

  @ApiProperty()
  duplicate: boolean;
}

export class EventOutcomeDto {
  @ApiProperty()
  sequence: number;

  @ApiProperty({ nullable: true })
  previousEventId: string | null;

  @ApiProperty()
  stateHash: string;
}

export class EventViewDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  patientId: string;

  @ApiProperty()
  type: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  data: Record<string, unknown>;

  @ApiProperty()
  ts: string;

  @ApiProperty({ enum: ['pending', 'processing', 'processed', 'failed'] })
  status: string;

  @ApiProperty()
  attempt: number;

  @ApiProperty()
  effectApplied: boolean;

  @ApiProperty({ nullable: true })
  lastError: string | null;

  @ApiProperty({ type: EventOutcomeDto, nullable: true })
  outcome: EventOutcomeDto | null;

  @ApiProperty()
  receivedAt: string;

  @ApiProperty({ nullable: true })
  processedAt: string | null;
}

export class PatientTimelineDto {
  @ApiProperty()
  patientId: string;

  @ApiProperty({ nullable: true })
  stateHash: string | null;

  @ApiProperty({ type: [EventViewDto] })
  events: EventViewDto[];
}
