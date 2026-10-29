import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type EventStatus = 'pending' | 'processing' | 'processed' | 'failed';

export interface EventOutcome {
  sequence: number;
  previousEventId: string | null;
  stateHash: string;
}

@Schema({ collection: 'events', versionKey: false })
export class PatientEvent {
  @Prop({ required: true })
  patientId: string;

  @Prop({ required: true })
  type: string;

  @Prop({ type: Object, required: true })
  data: Record<string, unknown>;

  @Prop({ required: true })
  ts: Date;

  @Prop({ required: true, unique: true })
  idempotencyKey: string;

  @Prop({
    type: String,
    required: true,
    enum: ['pending', 'processing', 'processed', 'failed'],
  })
  status: EventStatus;

  @Prop({ required: true })
  receivedAt: Date;

  @Prop({ required: true })
  eligibleAt: Date;

  @Prop({ required: true, default: 0 })
  attempt: number;

  @Prop({ required: true, default: false })
  effectApplied: boolean;

  @Prop({ type: String, default: null })
  lockToken: string | null;

  @Prop({ type: Date, default: null })
  lockedUntil: Date | null;

  @Prop({ type: String, default: null })
  lastError: string | null;

  @Prop({ type: Date, default: null })
  processedAt: Date | null;

  @Prop({ type: Object, default: null })
  outcome: EventOutcome | null;
}

export type PatientEventDocument = HydratedDocument<PatientEvent>;
export const PatientEventSchema = SchemaFactory.createForClass(PatientEvent);

PatientEventSchema.index({ patientId: 1, ts: 1, _id: 1 });
PatientEventSchema.index({ status: 1, eligibleAt: 1, ts: 1 });
PatientEventSchema.index(
  { patientId: 1 },
  { unique: true, partialFilterExpression: { status: 'processing' } },
);
