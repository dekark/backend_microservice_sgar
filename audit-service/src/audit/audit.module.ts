import { Module } from '@nestjs/common';
import { AreaAuditController } from './area-audit.controller';
import { AreaAuditService } from './area-audit.service';
import { AdminAuditController } from './admin-audit.controller';
import { ConfigModule } from '@nestjs/config';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { RejectedEventsPublisher } from './rejected-events.publisher';
import { RabbitModule } from '../rabbit/rabbit.module';
import { SecurityModule } from '../security/security.module';
import { CrudModule } from '../crud/crud.module';
import { AuditCrudService } from './audit-crud.service';
import { AuditHttpController } from './audit-http.controller';

@Module({
  imports: [ConfigModule, RabbitModule, SecurityModule, CrudModule],
  providers: [
    AreaAuditService,
    AuditService,
    AuditRepository,
    RejectedEventsPublisher,
    AuditCrudService,
  ],
  controllers: [
    AuditController,
    AuditHttpController,
    AdminAuditController,
    AreaAuditController,
  ],
})
export class AuditModule {}
