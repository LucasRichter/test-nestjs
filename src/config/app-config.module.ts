import { Module } from '@nestjs/common';
import { APP_ENV, readEnv } from './app-env.js';

@Module({
  providers: [{ provide: APP_ENV, useFactory: () => readEnv() }],
  exports: [APP_ENV],
})
export class AppConfigModule {}
