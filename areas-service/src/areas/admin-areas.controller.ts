import { Controller } from '@nestjs/common';
import { AreasController } from './areas.controller';
import { AreasService } from './areas.service';

// Inherits CRUD handlers, validation and both guards from the protected controller.
@Controller('admin/areas')
export class AdminAreasController extends AreasController {
  constructor(service: AreasService) {
    super(service);
  }
}
