import mongoose from 'mongoose';
import type {
  EventOutcome,
  PatientEventDocument,
} from '../schemas/event.schema.js';

export const EVENT_EFFECT = Symbol('EVENT_EFFECT');

export interface EventEffect {
  markEffectApplied(
    id: mongoose.Types.ObjectId,
    lockToken: string,
  ): Promise<boolean>;
  clearEffectApplied(
    id: mongoose.Types.ObjectId,
    lockToken: string,
  ): Promise<void>;
  holdsLock(id: mongoose.Types.ObjectId, lockToken: string): Promise<boolean>;
  findPreviousProcessed(
    event: PatientEventDocument,
  ): Promise<PatientEventDocument | null>;
  complete(
    id: mongoose.Types.ObjectId,
    lockToken: string,
    outcome: EventOutcome,
  ): Promise<boolean>;
  findOwned(
    id: mongoose.Types.ObjectId,
    lockToken: string,
  ): Promise<PatientEventDocument | null>;
  markFailed(
    id: mongoose.Types.ObjectId,
    lockToken: string,
    attempt: number,
    lastError: string,
  ): Promise<void>;
  scheduleRetry(
    id: mongoose.Types.ObjectId,
    lockToken: string,
    attempt: number,
    lastError: string,
    eligibleAt: Date,
  ): Promise<void>;
}
