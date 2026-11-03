export const EVENT_HEALTH = Symbol('EVENT_HEALTH');

export interface BacklogSnapshot {
  pending: number;
  processing: number;
  processed: number;
  failed: number;
  oldestPendingReceivedAt: Date | null;
}

export interface EventHealth {
  ping(): Promise<void>;
  backlog(): Promise<BacklogSnapshot>;
}
