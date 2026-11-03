import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfig } from '../config/app-config.module.js';
import { AcceptEventsService } from './accept-events.service.js';
import { EventsController, PatientsController } from './events.controller.js';
import { EventQueryService } from './event-query.service.js';
import { EventsRepository } from './events.repository.js';
import { EVENT_EFFECT } from './ports/event-effect.port.js';
import { EVENT_HEALTH } from './ports/event-health.port.js';
import { EVENT_INTAKE } from './ports/event-intake.port.js';
import { EVENT_LEASE } from './ports/event-lease.port.js';
import { EVENT_QUERY } from './ports/event-query.port.js';
import { WORKER_HEALTH } from './ports/worker-health.port.js';
import { EventProcessor } from './processing/event-processor.service.js';
import { EventWorker } from './processing/event-worker.service.js';
import { EXTERNAL_SYSTEM } from './processing/external-system.js';
import { SimulatedExternalSystem } from './processing/simulated-external-system.js';
import { PatientEvent, PatientEventSchema } from './schemas/event.schema.js';

const eventStore = { useExisting: EventsRepository };

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PatientEvent.name, schema: PatientEventSchema },
    ]),
  ],
  controllers: [EventsController, PatientsController],
  providers: [
    EventsRepository,
    { provide: EVENT_INTAKE, ...eventStore },
    { provide: EVENT_QUERY, ...eventStore },
    { provide: EVENT_LEASE, ...eventStore },
    { provide: EVENT_EFFECT, ...eventStore },
    { provide: EVENT_HEALTH, ...eventStore },
    AcceptEventsService,
    EventQueryService,
    EventProcessor,
    EventWorker,
    { provide: WORKER_HEALTH, useExisting: EventWorker },
    {
      provide: EXTERNAL_SYSTEM,
      inject: [AppConfig],
      useFactory: (env: AppConfig) =>
        new SimulatedExternalSystem(env.processingDelayMs),
    },
  ],
  exports: [EVENT_HEALTH, WORKER_HEALTH],
})
export class EventsModule {}
