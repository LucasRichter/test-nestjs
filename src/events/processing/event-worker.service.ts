import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { sleep } from '../../common/sleep.js';
import { isDuplicateKey } from '../../common/mongo-errors.js';
import { APP_ENV, type AppEnv } from '../../config/app-env.js';
import { chainStateHash } from '../idempotency.js';
import {
  PatientEvent,
  type PatientEventDocument,
} from '../schemas/event.schema.js';
import { EXTERNAL_SYSTEM, type ExternalSystem } from './external-system.js';

@Injectable()
export class EventWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventWorker.name);
  private readonly inflight = new Set<Promise<void>>();
  private readonly ownedLocks = new Map<string, string>();
  private running = false;
  private loop: Promise<void> | null = null;
  private lastTickAt: Date | null = null;

  constructor(
    @InjectModel(PatientEvent.name)
    private readonly events: mongoose.Model<PatientEventDocument>,
    @InjectConnection() private readonly connection: mongoose.Connection,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(EXTERNAL_SYSTEM) private readonly external: ExternalSystem,
  ) {}

  onModuleInit(): void {
    if (!this.env.workerEnabled) {
      return;
    }
    this.running = true;
    this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await Promise.race([
      Promise.allSettled(
        [...this.inflight, this.loop].filter((job) => job !== null),
      ),
      sleep(this.env.shutdownTimeoutMs),
    ]);
    await this.releaseOwnedLocks();
  }

  isAlive(): boolean {
    if (!this.env.workerEnabled || !this.running) {
      return false;
    }
    if (!this.lastTickAt) {
      return true;
    }
    const staleAfter = Math.max(5_000, this.env.pollIntervalMs * 5);
    return Date.now() - this.lastTickAt.getTime() < staleAfter;
  }

  private async run(): Promise<void> {
    while (this.running) {
      this.lastTickAt = new Date();
      try {
        await this.releaseExpiredLocks();
        await this.fillSlots();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'worker tick failed';
        this.logger.error(message);
      }
      await sleep(this.env.pollIntervalMs);
    }
  }

  private async fillSlots(): Promise<void> {
    const slots = this.env.workerConcurrency - this.inflight.size;
    if (slots <= 0) {
      return;
    }
    const candidates = await this.findCandidates(slots);
    for (const id of candidates) {
      if (!this.running || this.inflight.size >= this.env.workerConcurrency) {
        return;
      }
      const claimed = await this.claim(id);
      if (!claimed?.lockToken) {
        continue;
      }
      const lockToken = claimed.lockToken;
      const eventId = claimed._id.toString();
      this.ownedLocks.set(eventId, lockToken);
      const job = this.process(claimed, lockToken).catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'processing failed';
        this.logger.error(`Processing ${eventId} failed: ${message}`);
      });
      this.inflight.add(job);
      void job.finally(() => {
        this.inflight.delete(job);
        this.ownedLocks.delete(eventId);
      });
    }
  }

  private async findCandidates(
    limit: number,
  ): Promise<mongoose.Types.ObjectId[]> {
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

  private async claim(
    id: mongoose.Types.ObjectId,
  ): Promise<PatientEventDocument | null> {
    const lockToken = new mongoose.Types.ObjectId().toString();
    const lockedUntil = new Date(Date.now() + this.env.lockTtlMs);
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

  private async process(
    event: PatientEventDocument,
    lockToken: string,
  ): Promise<void> {
    try {
      await this.applyExternalEffect(event, lockToken);
      if (!(await this.holdsLock(event._id, lockToken))) {
        return;
      }
      const previous = await this.events
        .findOne({
          patientId: event.patientId,
          status: 'processed',
          $or: [
            { ts: { $lt: event.ts } },
            { ts: event.ts, _id: { $lt: event._id } },
          ],
        })
        .sort({ ts: -1, _id: -1 });
      const outcome = {
        sequence: (previous?.outcome?.sequence ?? 0) + 1,
        previousEventId: previous ? previous._id.toString() : null,
        stateHash: chainStateHash(
          previous?.outcome?.stateHash ?? '',
          event._id.toString(),
          event.type,
        ),
      };
      const completed = await this.events.updateOne(
        { _id: event._id, status: 'processing', lockToken },
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
      if (completed.matchedCount === 0) {
        this.logger.warn(
          `Dropped completion for ${event._id.toString()} after losing the lock`,
        );
      }
    } catch (error) {
      await this.failOrRetry(event._id, lockToken, error);
    }
  }

  private async applyExternalEffect(
    event: PatientEventDocument,
    lockToken: string,
  ): Promise<void> {
    if (event.effectApplied) {
      return;
    }
    const marked = await this.events.updateOne(
      {
        _id: event._id,
        status: 'processing',
        lockToken,
        effectApplied: { $ne: true },
      },
      { $set: { effectApplied: true } },
    );
    if (marked.modifiedCount === 0) {
      return;
    }
    try {
      await this.external.apply({
        id: event._id.toString(),
        patientId: event.patientId,
        type: event.type,
      });
    } catch (error) {
      await this.events.updateOne(
        { _id: event._id, status: 'processing', lockToken },
        { $set: { effectApplied: false } },
      );
      throw error;
    }
  }

  private async failOrRetry(
    id: mongoose.Types.ObjectId,
    lockToken: string,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error ? error.message : 'processing failed';
    const current = await this.events.findOne({
      _id: id,
      status: 'processing',
      lockToken,
    });
    if (!current) {
      return;
    }
    const attempt = current.attempt + 1;
    if (attempt >= this.env.maxAttempts) {
      await this.events.updateOne(
        { _id: id, status: 'processing', lockToken },
        {
          $set: {
            status: 'failed',
            attempt,
            lastError: message,
            lockToken: null,
            lockedUntil: null,
          },
        },
      );
      this.logger.warn(
        `Event ${id.toString()} failed for ${current.patientId}: ${message}`,
      );
      return;
    }
    const backoff = Math.min(30_000, this.env.retryBackoffMs * 2 ** attempt);
    await this.events.updateOne(
      { _id: id, status: 'processing', lockToken },
      {
        $set: {
          status: 'pending',
          attempt,
          lastError: message,
          lockToken: null,
          lockedUntil: null,
          eligibleAt: new Date(Date.now() + backoff),
        },
      },
    );
  }

  private async releaseExpiredLocks(): Promise<void> {
    const expired = await this.events.find({
      status: 'processing',
      lockedUntil: { $lt: new Date() },
    });
    for (const event of expired) {
      const attempt = event.attempt + 1;
      const failed = attempt >= this.env.maxAttempts;
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
  }

  private async releaseOwnedLocks(): Promise<void> {
    for (const [id, lockToken] of this.ownedLocks) {
      await this.events.updateOne(
        { _id: id, status: 'processing', lockToken },
        { $set: { status: 'pending', lockToken: null, lockedUntil: null } },
      );
    }
    this.ownedLocks.clear();
  }

  private async holdsLock(
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
}
