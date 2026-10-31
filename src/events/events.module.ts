import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfig } from '../config/app-config.module.js';
import { EventsController, PatientsController } from './events.controller.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';
import { EventProcessor } from './processing/event-processor.service.js';
import { EventWorker } from './processing/event-worker.service.js';
import { EXTERNAL_SYSTEM } from './processing/external-system.js';
import { SimulatedExternalSystem } from './processing/simulated-external-system.js';
import { PatientEvent, PatientEventSchema } from './schemas/event.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PatientEvent.name, schema: PatientEventSchema },
    ]),
  ],
  controllers: [EventsController, PatientsController],
  providers: [
    EventsRepository,
    EventsService,
    EventProcessor,
    EventWorker,
    {
      provide: EXTERNAL_SYSTEM,
      inject: [AppConfig],
      useFactory: (env: AppConfig) =>
        new SimulatedExternalSystem(env.processingDelayMs),
    },
  ],
  exports: [EventsRepository, EventsService, EventWorker],
})
export class EventsModule {}
