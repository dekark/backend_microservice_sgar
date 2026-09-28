import { Controller } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

// Inherits CRUD handlers, validation and both guards from the protected controller.
@Controller('admin/roles')
export class AdminRolesController extends RolesController {
  constructor(service: RolesService) {
    super(service);
  }
}
