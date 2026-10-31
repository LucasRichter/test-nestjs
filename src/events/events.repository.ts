import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { isDuplicateKey } from '../common/mongo-errors.js';
import {
  PatientEvent,
  type EventOutcome,
  type PatientEventDocument,
} from './schemas/event.schema.js';

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

export interface BacklogSnapshot {
  pending: number;
  processing: number;
  processed: number;
  failed: number;
  oldestPendingReceivedAt: Date | null;
}

@Injectable()
export class EventsRepository implements OnModuleInit {
  constructor(
    @InjectModel(PatientEvent.name)
    private readonly events: mongoose.Model<PatientEventDocument>,
    @InjectConnection() private readonly connection: mongoose.Connection,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.events.createIndexes();
  }

  async ping(): Promise<void> {
    const db = this.connection.db;
    if (!db) {
      throw new Error('Mongo connection is not open');
    }
    await db.admin().ping();
  }

  async backlog(): Promise<BacklogSnapshot> {
    const [row] = await this.events.aggregate<{
      counts: { _id: string; count: number }[];
      oldest: { receivedAt: Date }[];
    }>([
      {
        $facet: {
          counts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          oldest: [
            { $match: { status: 'pending' } },
            { $sort: { receivedAt: 1 } },
            { $limit: 1 },
            { $project: { _id: 0, receivedAt: 1 } },
          ],
        },
      },
    ]);

    const counts = { pending: 0, processing: 0, processed: 0, failed: 0 };
    for (const item of row?.counts ?? []) {
      if (
        item._id === 'pending' ||
        item._id === 'processing' ||
        item._id === 'processed' ||
        item._id === 'failed'
      ) {
        counts[item._id] = item.count;
      }
    }

    const receivedAt = row?.oldest[0]?.receivedAt;
    return {
      ...counts,
      oldestPendingReceivedAt: receivedAt ? new Date(receivedAt) : null,
    };
  }

  async insertPending(document: PendingEventInsert): Promise<string> {
    const session = await this.connection.startSession();
    try {
      let createdId = '';
      await session.withTransaction(async () => {
        const [created] = await this.events.create([document], { session });
        createdId = created._id.toString();
        await this.events.updateMany(
          {
            patientId: created.patientId,
            _id: { $ne: created._id },
            ts: { $gt: created.ts },
            status: { $in: ['processed', 'processing'] },
          },
          {
            $set: {
              status: 'pending',
              outcome: null,
              lockToken: null,
              lockedUntil: null,
              processedAt: null,
            },
          },
          { session },
        );
      });
      return createdId;
    } finally {
      await session.endSession();
    }
  }

  findByIdempotencyKey(key: string): Promise<PatientEventDocument | null> {
    return this.events.findOne({ idempotencyKey: key }).exec();
  }

  findById(id: string): Promise<PatientEventDocument | null> {
    return this.events.findById(id).exec();
  }

  findTimeline(patientId: string): Promise<PatientEventDocument[]> {
    return this.events.find({ patientId }).sort({ ts: 1, _id: 1 }).exec();
  }

  async findClaimCandidates(limit: number): Promise<mongoose.Types.ObjectId[]> {
    const rows = await this.events.aggregate<{
      eventId: mongoose.Types.ObjectId;
      eligibleAt: Date;
    }>([
      { $match: { status: 'pending' } },
      { $sort: { ts: 1, _id: 1 } },
      {
        $group: {
          _id: '$patientId',
          eventId: { $first: '$_id' },
          eligibleAt: { $first: '$eligibleAt' },
        },
      },
      { $match: { eligibleAt: { $lte: new Date() } } },
      { $limit: limit },
    ]);
    return rows.map((row) => row.eventId);
  }

  async claim(
    id: mongoose.Types.ObjectId,
    lockToken: string,
    lockedUntil: Date,
  ): Promise<PatientEventDocument | null> {
    const session = await this.connection.startSession();
    try {
      let claimed: PatientEventDocument | null = null;
      await session.withTransaction(async () => {
        claimed = null;
        const event = await this.events.findById(id).session(session);
        if (
          !event ||
          event.status !== 'pending' ||
          event.eligibleAt > new Date()
        ) {
          return;
        }
        const earlier = {
          patientId: event.patientId,
          $or: [
            { ts: { $lt: event.ts } },
            { ts: event.ts, _id: { $lt: event._id } },
          ],
        };
        const blocked =
          (await this.events
            .exists({ ...earlier, status: 'failed' })
            .session(session)) ||
          (await this.events
            .exists({ ...earlier, status: 'pending' })
            .session(session)) ||
          (await this.events
            .exists({ patientId: event.patientId, status: 'processing' })
            .session(session));
        if (blocked) {
          return;
        }
        claimed = await this.events.findOneAndUpdate(
          { _id: event._id, status: 'pending' },
          { $set: { status: 'processing', lockToken, lockedUntil } },
          { returnDocument: 'after', session },
        );
      });
      return claimed;
    } catch (error) {
      if (isDuplicateKey(error)) {
        return null;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async markEffectApplied(
    id: mongoose.Types.ObjectId,
    lockToken: string,
  ): Promise<boolean> {
    const marked = await this.events.updateOne(
      {
        _id: id,
        status: 'processing',
        lockToken,
        effectApplied: { $ne: true },
      },
      { $set: { effectApplied: true } },
    );
    return marked.modifiedCount === 1;
  }

  async clearEffectApplied(
    id: mongoose.Types.ObjectId,
    lockToken: string,
  ): Promise<void> {
    await this.events.updateOne(
      { _id: id, status: 'processing', lockToken },
      { $set: { effectApplied: false } },
    );
  }

  async holdsLock(
    id: mongoose.Types.ObjectId,
    lockToken: string,
  ): Promise<boolean> {
    const found = await this.events.exists({
      _id: id,
      status: 'processing',
      lockToken,
    });
    return found !== null;
  }

  findPreviousProcessed(
    event: PatientEventDocument,
  ): Promise<PatientEventDocument | null> {
    return this.events
      .findOne({
        patientId: event.patientId,
        status: 'processed',
        $or: [
          { ts: { $lt: event.ts } },
          { ts: event.ts, _id: { $lt: event._id } },
        ],
      })
      .sort({ ts: -1, _id: -1 })
      .exec();
  }

  async complete(
    id: mongoose.Types.ObjectId,
    lockToken: string,
    outcome: EventOutcome,
  ): Promise<boolean> {
    const completed = await this.events.updateOne(
      { _id: id, status: 'processing', lockToken },
      {
        $set: {
          status: 'processed',
          outcome,
          processedAt: new Date(),
          lockToken: null,
          lockedUntil: null,
          lastError: null,
        },
      },
    );
    return completed.matchedCount === 1;
  }

  findOwned(
    id: mongoose.Types.ObjectId,
    lockToken: string,
  ): Promise<PatientEventDocument | null> {
    return this.events
      .findOne({ _id: id, status: 'processing', lockToken })
      .exec();
  }

  async markFailed(
    id: mongoose.Types.ObjectId,
    lockToken: string,
    attempt: number,
    lastError: string,
  ): Promise<void> {
    await this.events.updateOne(
      { _id: id, status: 'processing', lockToken },
      {
        $set: {
          status: 'failed',
          attempt,
          lastError,
          lockToken: null,
          lockedUntil: null,
        },
      },
    );
  }

  async scheduleRetry(
    id: mongoose.Types.ObjectId,
    lockToken: string,
    attempt: number,
    lastError: string,
    eligibleAt: Date,
  ): Promise<void> {
    await this.events.updateOne(
      { _id: id, status: 'processing', lockToken },
      {
        $set: {
          status: 'pending',
          attempt,
          lastError,
          lockToken: null,
          lockedUntil: null,
          eligibleAt,
        },
      },
    );
  }

  findExpiredLocks(now: Date): Promise<PatientEventDocument[]> {
    return this.events
      .find({ status: 'processing', lockedUntil: { $lt: now } })
      .exec();
  }

  async releaseExpired(
    event: PatientEventDocument,
    attempt: number,
    failed: boolean,
  ): Promise<void> {
    await this.events.updateOne(
      { _id: event._id, status: 'processing', lockToken: event.lockToken },
      {
        $set: failed
          ? {
              status: 'failed',
              attempt,
              lastError: 'Lock expired before processing finished',
              lockToken: null,
              lockedUntil: null,
            }
          : {
              status: 'pending',
              attempt,
              lastError: 'Lock expired before processing finished',
              lockToken: null,
              lockedUntil: null,
              eligibleAt: new Date(),
            },
      },
    );
  }

  async releaseOwned(
    id: mongoose.Types.ObjectId | string,
    lockToken: string,
  ): Promise<void> {
    await this.events.updateOne(
      { _id: id, status: 'processing', lockToken },
      { $set: { status: 'pending', lockToken: null, lockedUntil: null } },
    );
  }
}
