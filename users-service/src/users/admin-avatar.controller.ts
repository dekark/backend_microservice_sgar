import { Controller, UseGuards } from '@nestjs/common';
import { AuthSessionGuard } from '../security/auth-session.guard';
import { SuperadminGuard } from '../security/superadmin.guard';
import { ImageControllerBase } from '../media/image.controller-base';
import { ImagesService } from '../media/images.service';

@Controller(['users/:id/avatar', 'admin/users/:id/avatar'])
@UseGuards(AuthSessionGuard, SuperadminGuard)
export class AdminAvatarController extends ImageControllerBase {
  constructor(images: ImagesService) {
    super(images, 'users', 'superadmin');
  }
}
