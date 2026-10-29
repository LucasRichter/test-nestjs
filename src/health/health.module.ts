import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfigModule } from '../config/app-config.module.js';
import { EventsModule } from '../events/events.module.js';
import {
  PatientEvent,
  PatientEventSchema,
} from '../events/schemas/event.schema.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [
    AppConfigModule,
    EventsModule,
    MongooseModule.forFeature([
      { name: PatientEvent.name, schema: PatientEventSchema },
    ]),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
