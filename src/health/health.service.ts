import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { APP_ENV, type AppEnv } from '../config/app-env.js';
import { EventWorker } from '../events/processing/event-worker.service.js';
import {
  PatientEvent,
  type PatientEventDocument,
} from '../events/schemas/event.schema.js';
import type { HealthDto } from './health.dto.js';

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly connection: mongoose.Connection,
    @InjectModel(PatientEvent.name)
    private readonly events: mongoose.Model<PatientEventDocument>,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly worker: EventWorker,
  ) {}

  async snapshot(): Promise<HealthDto> {
    const worker = this.workerStatus();
    try {
      const db = this.connection.db;
      if (!db) {
        throw new Error('Mongo connection is not open');
      }
      await db.admin().ping();
      const [pending, processing, processed, failed, oldest] =
        await Promise.all([
          this.events.countDocuments({ status: 'pending' }),
          this.events.countDocuments({ status: 'processing' }),
          this.events.countDocuments({ status: 'processed' }),
          this.events.countDocuments({ status: 'failed' }),
          this.events.findOne({ status: 'pending' }).sort({ receivedAt: 1 }),
        ]);
      const oldestPendingAgeMs = oldest
        ? Date.now() - oldest.receivedAt.getTime()
        : null;
      const lagging =
        oldestPendingAgeMs !== null &&
        oldestPendingAgeMs > this.env.oldestPendingDegradedMs;
      const degraded = worker === 'down' || lagging;
      return {
        status: degraded ? 'degraded' : 'ok',
        mongo: 'up',
        worker,
        pending,
        processing,
        processed,
        failed,
        oldestPendingAgeMs,
      };
    } catch {
      return {
        status: 'down',
        mongo: 'down',
        worker,
        pending: 0,
        processing: 0,
        processed: 0,
        failed: 0,
        oldestPendingAgeMs: null,
      };
    }
  }

  private workerStatus(): HealthDto['worker'] {
    if (!this.env.workerEnabled) {
      return 'disabled';
    }
    return this.worker.isAlive() ? 'up' : 'down';
  }
}

export function assertStoreAvailable(health: HealthDto): HealthDto {
  if (health.mongo === 'down') {
    throw new ServiceUnavailableException(health);
  }
  return health;
}
