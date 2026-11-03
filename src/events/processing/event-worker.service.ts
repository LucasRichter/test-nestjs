import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import mongoose from 'mongoose';
import { sleep } from '../../common/sleep.js';
import { structuredLog } from '../../common/structured-log.js';
import { AppConfig } from '../../config/app-config.module.js';
import { EVENT_LEASE, type EventLease } from '../ports/event-lease.port.js';
import type { WorkerHealth } from '../ports/worker-health.port.js';
import { EventProcessor } from './event-processor.service.js';

@Injectable()
export class EventWorker
  implements OnModuleInit, OnModuleDestroy, WorkerHealth
{
  private readonly logger = new Logger(EventWorker.name);
  private readonly inflight = new Set<Promise<void>>();
  private readonly ownedLocks = new Map<string, string>();
  private running = false;
  private loop: Promise<void> | null = null;
  private lastTickAt: Date | null = null;

  constructor(
    @Inject(EVENT_LEASE) private readonly events: EventLease,
    private readonly processor: EventProcessor,
    private readonly env: AppConfig,
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
        this.logger.error(
          structuredLog({ message: 'Worker tick failed', error: message }),
        );
      }
      await sleep(this.env.pollIntervalMs);
    }
  }

  private async fillSlots(): Promise<void> {
    const slots = this.env.workerConcurrency - this.inflight.size;
    if (slots <= 0) {
      return;
    }
    const candidates = await this.events.findClaimCandidates(slots);
    for (const id of candidates) {
      if (!this.running || this.inflight.size >= this.env.workerConcurrency) {
        return;
      }
      const lockToken = new mongoose.Types.ObjectId().toString();
      const lockedUntil = new Date(Date.now() + this.env.lockTtlMs);
      const claimed = await this.events.claim(id, lockToken, lockedUntil);
      if (!claimed?.lockToken) {
        continue;
      }
      const eventId = claimed._id.toString();
      const patientId = claimed.patientId;
      this.ownedLocks.set(eventId, claimed.lockToken);
      const job = this.processor
        .process(claimed, claimed.lockToken)
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'processing failed';
          this.logger.error(
            structuredLog({
              message: 'Processing failed',
              eventId,
              patientId,
              error: message,
            }),
          );
        });
      this.inflight.add(job);
      void job.finally(() => {
        this.inflight.delete(job);
        this.ownedLocks.delete(eventId);
      });
    }
  }

  private async releaseExpiredLocks(): Promise<void> {
    const expired = await this.events.findExpiredLocks(new Date());
    for (const event of expired) {
      const attempt = event.attempt + 1;
      const failed = attempt >= this.env.maxAttempts;
      await this.events.releaseExpired(event, attempt, failed);
    }
  }

  private async releaseOwnedLocks(): Promise<void> {
    for (const [id, lockToken] of this.ownedLocks) {
      await this.events.releaseOwned(id, lockToken);
    }
    this.ownedLocks.clear();
  }
}
