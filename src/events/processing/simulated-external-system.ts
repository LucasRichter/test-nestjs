import { Injectable } from '@nestjs/common';
import { sleep } from '../../common/sleep.js';
import type { ExternalCall, ExternalSystem } from './external-system.js';

@Injectable()
export class SimulatedExternalSystem implements ExternalSystem {
  constructor(private readonly delayMs: number) {}

  async apply(_event: ExternalCall): Promise<void> {
    await sleep(this.delayMs);
  }
}
