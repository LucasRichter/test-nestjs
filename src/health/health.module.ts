import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [EventsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
