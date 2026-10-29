import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { isDuplicateKey, isMongoUnavailable } from '../common/mongo-errors.js';
import { APP_ENV, type AppEnv } from '../config/app-env.js';
import type { CreateEventDto } from './dto/create-event.dto.js';
import { toEventView, type EventView } from './event.presenter.js';
import { buildIdempotencyKey, normalizeTimestamp } from './idempotency.js';
import {
  PatientEvent,
  type PatientEventDocument,
} from './schemas/event.schema.js';

export interface AcceptedEvent {
  id: string;
  status: string;
  duplicate: boolean;
}

@Injectable()
export class EventsService implements OnModuleInit {
  constructor(
    @InjectModel(PatientEvent.name)
    private readonly events: mongoose.Model<PatientEventDocument>,
    @InjectConnection() private readonly connection: mongoose.Connection,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.events.createIndexes();
  }

  async accept(dto: CreateEventDto): Promise<AcceptedEvent> {
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

    const session = await this.connection.startSession();
    try {
      let createdId = '';
      await session.withTransaction(async () => {
        const [created] = await this.events.create([document], { session });
        createdId = created._id.toString();
        await this.invalidateSuffix(created, session);
      });
      return { id: createdId, status: 'pending', duplicate: false };
    } catch (error) {
      if (isDuplicateKey(error)) {
        const existing = await this.events.findOne({
          idempotencyKey: document.idempotencyKey,
        });
        if (!existing) {
          throw error;
        }
        return {
          id: existing._id.toString(),
          status: existing.status,
          duplicate: true,
        };
      }
      if (isMongoUnavailable(error)) {
        throw new ServiceUnavailableException('Event store is unavailable');
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async getById(id: string): Promise<EventView> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Event not found');
    }
    const event = await this.events.findById(id);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return toEventView(event);
  }

  async timeline(patientId: string): Promise<{
    patientId: string;
    stateHash: string | null;
    events: EventView[];
  }> {
    const events = await this.events
      .find({ patientId })
      .sort({ ts: 1, _id: 1 });
    const latestProcessed = [...events]
      .reverse()
      .find((event) => event.status === 'processed');
    return {
      patientId,
      stateHash: latestProcessed?.outcome?.stateHash ?? null,
      events: events.map((event) => toEventView(event)),
    };
  }

  private async invalidateSuffix(
    created: PatientEventDocument,
    session: mongoose.ClientSession,
  ): Promise<void> {
    await this.events.updateMany(
      {
        patientId: created.patientId,
        _id: { $ne: created._id },
        ts: { $gt: created.ts },
        status: { $in: ['processed', 'processing'] },
      },
      {
        $set: {
          status: 'pending',
          outcome: null,
          lockToken: null,
          lockedUntil: null,
          processedAt: null,
        },
      },
      { session },
    );
  }
}
