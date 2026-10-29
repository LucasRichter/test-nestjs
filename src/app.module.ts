import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_ENV, type AppEnv } from './config/app-env.js';
import { AppConfigModule } from './config/app-config.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    AppConfigModule,
    MongooseModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => ({
        uri: env.mongodbUri,
        serverSelectionTimeoutMS: 30_000,
      }),
    }),
    EventsModule,
    HealthModule,
  ],
})
export class AppModule {}
