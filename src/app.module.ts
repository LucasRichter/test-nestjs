import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoExceptionFilter } from './common/mongo-exception.filter.js';
import { AppConfig, AppConfigModule } from './config/app-config.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
    }),
    AppConfigModule,
    MongooseModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (env: AppConfig) => ({
        uri: env.mongodbUri,
        serverSelectionTimeoutMS: 30_000,
      }),
    }),
    EventsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: MongoExceptionFilter }],
})
export class AppModule {}
