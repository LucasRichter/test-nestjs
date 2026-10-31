import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';

@Exclude()
export class AcceptedEventDto {
  @Expose()
  @ApiProperty()
  id: string;

  @Expose()
  @ApiProperty({ enum: ['pending', 'processing', 'processed', 'failed'] })
  status: string;

  @Expose()
  @ApiProperty()
  duplicate: boolean;

  constructor(values: AcceptedEventDto) {
    Object.assign(this, values);
  }
}

@Exclude()
export class EventOutcomeDto {
  @Expose()
  @ApiProperty()
  sequence: number;

  @Expose()
  @ApiProperty({ nullable: true })
  previousEventId: string | null;

  @Expose()
  @ApiProperty()
  stateHash: string;

  constructor(values: EventOutcomeDto) {
    Object.assign(this, values);
  }
}

@Exclude()
export class EventViewDto {
  @Expose()
  @ApiProperty()
  id: string;

  @Expose()
  @ApiProperty()
  patientId: string;

  @Expose()
  @ApiProperty()
  type: string;

  @Expose()
  @ApiProperty({ type: 'object', additionalProperties: true })
  data: Record<string, unknown>;

  @Expose()
  @ApiProperty()
  ts: string;

  @Expose()
  @ApiProperty({ enum: ['pending', 'processing', 'processed', 'failed'] })
  status: string;

  @Expose()
  @ApiProperty({ type: EventOutcomeDto, nullable: true })
  @Type(() => EventOutcomeDto)
  outcome: EventOutcomeDto | null;

  @Expose()
  @ApiProperty()
  receivedAt: string;

  @Expose()
  @ApiProperty({ nullable: true })
  processedAt: string | null;

  constructor(values: EventViewDto) {
    Object.assign(this, values);
  }
}

@Exclude()
export class PatientTimelineDto {
  @Expose()
  @ApiProperty()
  patientId: string;

  @Expose()
  @ApiProperty({ nullable: true })
  stateHash: string | null;

  @Expose()
  @ApiProperty({ type: [EventViewDto] })
  @Type(() => EventViewDto)
  events: EventViewDto[];

  constructor(values: PatientTimelineDto) {
    Object.assign(this, values);
  }
}
