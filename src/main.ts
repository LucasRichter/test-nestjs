import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { configureApp } from './app.setup.js';
import { AppModule } from './app.module.js';
import { readEnv } from './config/app-env.js';

async function bootstrap() {
  const env = readEnv();
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Clinical event ingest')
      .setDescription(
        'Accepts patient events over HTTP, processes them in per-patient order, and stores the outcome.',
      )
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  await app.listen(env.port);
}
await bootstrap();
