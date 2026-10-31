import { Injectable, NotFoundException } from '@nestjs/common';
import mongoose from 'mongoose';
import { isDuplicateKey } from '../common/mongo-errors.js';
import { AppConfig } from '../config/app-config.module.js';
import type { CreateEventDto } from './dto/create-event.dto.js';
import {
  AcceptedEventDto,
  EventViewDto,
  PatientTimelineDto,
} from './dto/event-response.dto.js';
import { toAccepted, toEventView, toTimeline } from './event.presenter.js';
import { buildIdempotencyKey, normalizeTimestamp } from './idempotency.js';
import { EventsRepository } from './events.repository.js';

@Injectable()
export class EventsService {
  constructor(
    private readonly events: EventsRepository,
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

  async getById(id: string): Promise<EventViewDto> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Event not found');
    }
    const event = await this.events.findById(id);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return toEventView(event);
  }

  async timeline(patientId: string): Promise<PatientTimelineDto> {
    const events = await this.events.findTimeline(patientId);
    const latestProcessed = [...events]
      .reverse()
      .find((event) => event.status === 'processed');
    return toTimeline({
      patientId,
      stateHash: latestProcessed?.outcome?.stateHash ?? null,
      events: events.map((event) => toEventView(event)),
    });
  }
}
