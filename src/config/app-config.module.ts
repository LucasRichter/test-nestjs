import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readEnv, type AppEnv } from './app-env.js';

const ENV_KEYS = [
  'PORT',
  'MONGODB_URI',
  'PROCESSING_DELAY_MS',
  'REORDER_GRACE_MS',
  'WORKER_CONCURRENCY',
  'LOCK_TTL_MS',
  'MAX_ATTEMPTS',
  'POLL_INTERVAL_MS',
  'WORKER_ENABLED',
  'RETRY_BACKOFF_MS',
  'OLDEST_PENDING_DEGRADED_MS',
  'SHUTDOWN_TIMEOUT_MS',
] as const;

@Injectable()
export class AppConfig implements AppEnv {
  readonly port: number;
  readonly mongodbUri: string;
  readonly processingDelayMs: number;
  readonly reorderGraceMs: number;
  readonly workerConcurrency: number;
  readonly lockTtlMs: number;
  readonly maxAttempts: number;
  readonly pollIntervalMs: number;
  readonly workerEnabled: boolean;
  readonly retryBackoffMs: number;
  readonly oldestPendingDegradedMs: number;
  readonly shutdownTimeoutMs: number;

  constructor(config: ConfigService) {
    const raw: NodeJS.ProcessEnv = {};
    for (const key of ENV_KEYS) {
      const value = config.get<string>(key);
      if (value !== undefined) {
        raw[key] = value;
      }
    }
    const env = readEnv(raw);
    this.port = env.port;
    this.mongodbUri = env.mongodbUri;
    this.processingDelayMs = env.processingDelayMs;
    this.reorderGraceMs = env.reorderGraceMs;
    this.workerConcurrency = env.workerConcurrency;
    this.lockTtlMs = env.lockTtlMs;
    this.maxAttempts = env.maxAttempts;
    this.pollIntervalMs = env.pollIntervalMs;
    this.workerEnabled = env.workerEnabled;
    this.retryBackoffMs = env.retryBackoffMs;
    this.oldestPendingDegradedMs = env.oldestPendingDegradedMs;
    this.shutdownTimeoutMs = env.shutdownTimeoutMs;
  }
}

@Global()
@Module({
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
