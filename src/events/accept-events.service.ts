import { Inject, Injectable } from '@nestjs/common';
import { isDuplicateKey } from '../common/mongo-errors.js';
import { AppConfig } from '../config/app-config.module.js';
import type { CreateEventDto } from './dto/create-event.dto.js';
import { AcceptedEventDto } from './dto/event-response.dto.js';
import { toAccepted } from './event.presenter.js';
import { buildIdempotencyKey, normalizeTimestamp } from './idempotency.js';
import { EVENT_INTAKE, type EventIntake } from './ports/event-intake.port.js';

@Injectable()
export class AcceptEventsService {
  constructor(
    @Inject(EVENT_INTAKE) private readonly events: EventIntake,
    private readonly env: AppConfig,
  ) {}

  async accept(dto: CreateEventDto): Promise<AcceptedEventDto> {
    const ts = new Date(normalizeTimestamp(dto.ts));
    const now = new Date();
    const document = {
      patientId: dto.patientId,
      type: dto.type,
      data: dto.data,
      ts,
      idempotencyKey: buildIdempotencyKey(dto),
      status: 'pending' as const,
      receivedAt: now,
      eligibleAt: new Date(now.getTime() + this.env.reorderGraceMs),
      attempt: 0,
      effectApplied: false,
      lockToken: null,
      lockedUntil: null,
      lastError: null,
      processedAt: null,
      outcome: null,
    };

    try {
      const createdId = await this.events.insertPending(document);
      return toAccepted({ id: createdId, status: 'pending', duplicate: false });
    } catch (error) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
      const existing = await this.events.findByIdempotencyKey(
        document.idempotencyKey,
      );
      if (!existing) {
        throw error;
      }
      return toAccepted({
        id: existing._id.toString(),
        status: existing.status,
        duplicate: true,
      });
    }
  }
}
