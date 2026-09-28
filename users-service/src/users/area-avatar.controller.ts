import { Controller, UseGuards } from '@nestjs/common';
import { AuthSessionGuard } from '../security/auth-session.guard';
import { AreaAdminGuard } from '../security/area-admin.guard';
import { ImageControllerBase } from '../media/image.controller-base';
import { ImagesService } from '../media/images.service';

@Controller('area-admin/areas/:area/users/:id/avatar')
@UseGuards(AuthSessionGuard, AreaAdminGuard)
export class AreaAvatarController extends ImageControllerBase {
  constructor(images: ImagesService) {
    super(images, 'users', 'area-admin');
  }
}
