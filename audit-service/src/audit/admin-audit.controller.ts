import { Controller } from '@nestjs/common';
import { AuditHttpController } from './audit-http.controller';
import { AuditCrudService } from './audit-crud.service';

// Inherits CRUD handlers, validation and both guards from the protected controller.
@Controller('admin/audit')
export class AdminAuditController extends AuditHttpController {
  constructor(service: AuditCrudService) {
    super(service);
  }
}
