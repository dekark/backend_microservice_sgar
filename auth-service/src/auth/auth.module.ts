import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { GoogleTokenService } from './google-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthenticatedThrottlerGuard } from './authenticated-throttler.guard';
import { ThrottlerModule } from '@nestjs/throttler';
import { KafkaModule } from '../kafka/kafka.module';
import { RabbitModule } from '../rabbit/rabbit.module';
import { AuthEventsPublisher } from './auth-events.publisher';
import { AuthJobsService } from './auth-jobs.service';
import { AuthHealthController } from './auth-health.controller';

@Module({
  imports: [
    ConfigModule,
    KafkaModule,
    RabbitModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS'),
          issuer: config.getOrThrow<string>('JWT_ISSUER'),
          audience: config.getOrThrow<string>('JWT_AUDIENCE'),
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: config.getOrThrow<string>('JWT_ISSUER'),
          audience: config.getOrThrow<string>('JWT_AUDIENCE'),
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    AuthRepository,
    GoogleTokenService,
    JwtAuthGuard,
    AuthenticatedThrottlerGuard,
    AuthEventsPublisher,
    AuthJobsService,
  ],
  controllers: [AuthController, AuthHealthController],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
