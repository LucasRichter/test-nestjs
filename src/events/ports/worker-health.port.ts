export const WORKER_HEALTH = Symbol('WORKER_HEALTH');

export interface WorkerHealth {
  isAlive(): boolean;
}
