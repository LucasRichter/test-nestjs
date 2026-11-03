import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config.module.js';
import {
  EVENT_HEALTH,
  type EventHealth,
} from '../events/ports/event-health.port.js';
import {
  WORKER_HEALTH,
  type WorkerHealth,
} from '../events/ports/worker-health.port.js';
import type { HealthDto } from './health.dto.js';

@Injectable()
export class HealthService {
  constructor(
    @Inject(EVENT_HEALTH) private readonly events: EventHealth,
    private readonly env: AppConfig,
    @Inject(WORKER_HEALTH) private readonly worker: WorkerHealth,
  ) {}

  async snapshot(): Promise<HealthDto> {
    const worker = this.workerStatus();
    try {
      await this.events.ping();
      const backlog = await this.events.backlog();
      const oldestPendingAgeMs = backlog.oldestPendingReceivedAt
        ? Date.now() - backlog.oldestPendingReceivedAt.getTime()
        : null;
      const lagging =
        oldestPendingAgeMs !== null &&
        oldestPendingAgeMs > this.env.oldestPendingDegradedMs;
      const degraded = worker === 'down' || lagging;
      return {
        status: degraded ? 'degraded' : 'ok',
        mongo: 'up',
        worker,
        pending: backlog.pending,
        processing: backlog.processing,
        processed: backlog.processed,
        failed: backlog.failed,
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
