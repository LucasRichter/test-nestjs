import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfigModule } from '../config/app-config.module.js';
import { APP_ENV, type AppEnv } from '../config/app-env.js';
import { EventsController, PatientsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { EventWorker } from './processing/event-worker.service.js';
import { EXTERNAL_SYSTEM } from './processing/external-system.js';
import { SimulatedExternalSystem } from './processing/simulated-external-system.js';
import { PatientEvent, PatientEventSchema } from './schemas/event.schema.js';

@Module({
  imports: [
    AppConfigModule,
    MongooseModule.forFeature([
      { name: PatientEvent.name, schema: PatientEventSchema },
    ]),
  ],
  controllers: [EventsController, PatientsController],
  providers: [
    EventsService,
    EventWorker,
    {
      provide: EXTERNAL_SYSTEM,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) =>
        new SimulatedExternalSystem(env.processingDelayMs),
    },
  ],
  exports: [EventsService, EventWorker, MongooseModule],
})
export class EventsModule {}
