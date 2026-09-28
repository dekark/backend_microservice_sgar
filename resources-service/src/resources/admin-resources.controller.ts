import { Controller } from '@nestjs/common';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

// Inherits CRUD handlers, validation and both guards from the protected controller.
@Controller('admin/resources')
export class AdminResourcesController extends ResourcesController {
  constructor(service: ResourcesService) {
    super(service);
  }
}
