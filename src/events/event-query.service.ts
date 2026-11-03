import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import mongoose from 'mongoose';
import { EventViewDto, PatientTimelineDto } from './dto/event-response.dto.js';
import { toEventView, toTimeline } from './event.presenter.js';
import { EVENT_QUERY, type EventQuery } from './ports/event-query.port.js';

@Injectable()
export class EventQueryService {
  constructor(@Inject(EVENT_QUERY) private readonly events: EventQuery) {}

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
