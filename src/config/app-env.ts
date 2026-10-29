export interface AppEnv {
  port: number;
  mongodbUri: string;
  processingDelayMs: number;
  reorderGraceMs: number;
  workerConcurrency: number;
  lockTtlMs: number;
  maxAttempts: number;
  pollIntervalMs: number;
  workerEnabled: boolean;
  retryBackoffMs: number;
  oldestPendingDegradedMs: number;
  shutdownTimeoutMs: number;
}

export const APP_ENV = Symbol('APP_ENV');

function numberFrom(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative number`);
  }
  return value;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const mongodbUri = env.MONGODB_URI;
  if (!mongodbUri) {
    throw new Error('MONGODB_URI is required');
  }

  return {
    port: numberFrom(env, 'PORT', 3000),
    mongodbUri,
    processingDelayMs: numberFrom(env, 'PROCESSING_DELAY_MS', 5000),
    reorderGraceMs: numberFrom(env, 'REORDER_GRACE_MS', 2000),
    workerConcurrency: Math.max(1, numberFrom(env, 'WORKER_CONCURRENCY', 100)),
    lockTtlMs: numberFrom(env, 'LOCK_TTL_MS', 30_000),
    maxAttempts: Math.max(1, numberFrom(env, 'MAX_ATTEMPTS', 5)),
    pollIntervalMs: numberFrom(env, 'POLL_INTERVAL_MS', 200),
    workerEnabled: (env.WORKER_ENABLED ?? 'true') !== 'false',
    retryBackoffMs: numberFrom(env, 'RETRY_BACKOFF_MS', 1000),
    oldestPendingDegradedMs: numberFrom(
      env,
      'OLDEST_PENDING_DEGRADED_MS',
      30_000,
    ),
    shutdownTimeoutMs: numberFrom(env, 'SHUTDOWN_TIMEOUT_MS', 10_000),
  };
}
