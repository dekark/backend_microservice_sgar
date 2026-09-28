import { brokerRpcOptions } from './messaging/broker-rpc.module';
import { ApplicationAuditService } from './observability/application-audit.module';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const audit = app.get(ApplicationAuditService);
  app.use(audit.use.bind(audit));
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_ORIGIN'),
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  for (const options of brokerRpcOptions(config))
    app.connectMicroservice(options);
  app.enableShutdownHooks();
  try {
    await app.listen(config.getOrThrow<number>('PORT'));
    await app.startAllMicroservices();
  } catch (error) {
    await app.close();
    throw error;
  }
}
void bootstrap();
