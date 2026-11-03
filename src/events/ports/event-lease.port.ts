import mongoose from 'mongoose';
import type { PatientEventDocument } from '../schemas/event.schema.js';

export const EVENT_LEASE = Symbol('EVENT_LEASE');

export interface EventLease {
  findClaimCandidates(limit: number): Promise<mongoose.Types.ObjectId[]>;
  claim(
    id: mongoose.Types.ObjectId,
    lockToken: string,
    lockedUntil: Date,
  ): Promise<PatientEventDocument | null>;
  findExpiredLocks(now: Date): Promise<PatientEventDocument[]>;
  releaseExpired(
    event: PatientEventDocument,
    attempt: number,
    failed: boolean,
  ): Promise<void>;
  releaseOwned(
    id: mongoose.Types.ObjectId | string,
    lockToken: string,
  ): Promise<void>;
}
