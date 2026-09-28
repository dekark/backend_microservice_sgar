import { Controller, UseGuards } from '@nestjs/common';
import { AuthSessionGuard } from '../security/auth-session.guard';
import { AreaAdminGuard } from '../security/area-admin.guard';
import { ImageControllerBase } from '../media/image.controller-base';
import { ImagesService } from '../media/images.service';

@Controller('area-admin/areas/:area/resources/:id/image')
@UseGuards(AuthSessionGuard, AreaAdminGuard)
export class AreaResourceImageController extends ImageControllerBase {
  constructor(images: ImagesService) {
    super(images, 'resources', 'area-admin');
  }
}
