import { Controller } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Inherits CRUD handlers, validation and both guards from the protected controller.
@Controller('admin/users')
export class AdminUsersController extends UsersController {
  constructor(service: UsersService) {
    super(service);
  }
}
