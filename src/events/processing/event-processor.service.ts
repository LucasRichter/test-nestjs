import { Inject, Injectable, Logger } from '@nestjs/common';
import mongoose from 'mongoose';
import { structuredLog } from '../../common/structured-log.js';
import { AppConfig } from '../../config/app-config.module.js';
import { chainStateHash } from '../idempotency.js';
import { EVENT_EFFECT, type EventEffect } from '../ports/event-effect.port.js';
import type { PatientEventDocument } from '../schemas/event.schema.js';
import { EXTERNAL_SYSTEM, type ExternalSystem } from './external-system.js';

@Injectable()
export class EventProcessor {
  private readonly logger = new Logger(EventProcessor.name);

  constructor(
    @Inject(EVENT_EFFECT) private readonly events: EventEffect,
    private readonly env: AppConfig,
    @Inject(EXTERNAL_SYSTEM) private readonly external: ExternalSystem,
  ) {}

  async process(event: PatientEventDocument, lockToken: string): Promise<void> {
    try {
      await this.applyExternalEffect(event, lockToken);
      if (!(await this.events.holdsLock(event._id, lockToken))) {
        return;
      }
      const previous = await this.events.findPreviousProcessed(event);
      const outcome = {
        sequence: (previous?.outcome?.sequence ?? 0) + 1,
        previousEventId: previous ? previous._id.toString() : null,
        stateHash: chainStateHash(
          previous?.outcome?.stateHash ?? '',
          event._id.toString(),
          event.type,
        ),
      };
      const completed = await this.events.complete(
        event._id,
        lockToken,
        outcome,
      );
      if (!completed) {
        this.logger.warn(
          structuredLog({
            message: 'Dropped completion after losing the lock',
            eventId: event._id.toString(),
            patientId: event.patientId,
          }),
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
    const marked = await this.events.markEffectApplied(event._id, lockToken);
    if (!marked) {
      return;
    }
    try {
      await this.external.apply({
        id: event._id.toString(),
        patientId: event.patientId,
        type: event.type,
      });
    } catch (error) {
      await this.events.clearEffectApplied(event._id, lockToken);
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
    const current = await this.events.findOwned(id, lockToken);
    if (!current) {
      return;
    }
    const attempt = current.attempt + 1;
    if (attempt >= this.env.maxAttempts) {
      await this.events.markFailed(id, lockToken, attempt, message);
      this.logger.warn(
        structuredLog({
          message: 'Event failed after the last attempt',
          eventId: id.toString(),
          patientId: current.patientId,
          error: message,
        }),
      );
      return;
    }
    const backoff = Math.min(30_000, this.env.retryBackoffMs * 2 ** attempt);
    await this.events.scheduleRetry(
      id,
      lockToken,
      attempt,
      message,
      new Date(Date.now() + backoff),
    );
  }
}
