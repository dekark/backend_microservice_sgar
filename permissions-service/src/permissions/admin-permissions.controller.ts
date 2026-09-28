import { Controller } from '@nestjs/common';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

// Inherits CRUD handlers, validation and both guards from the protected controller.
@Controller('admin/permissions')
export class AdminPermissionsController extends PermissionsController {
  constructor(service: PermissionsService) {
    super(service);
  }
}
