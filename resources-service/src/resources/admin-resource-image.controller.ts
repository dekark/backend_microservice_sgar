import { Controller, UseGuards } from '@nestjs/common';
import { AuthSessionGuard } from '../security/auth-session.guard';
import { SuperadminGuard } from '../security/superadmin.guard';
import { ImageControllerBase } from '../media/image.controller-base';
import { ImagesService } from '../media/images.service';

@Controller('admin/resources/:id/image')
@UseGuards(AuthSessionGuard, SuperadminGuard)
export class AdminResourceImageController extends ImageControllerBase {
  constructor(images: ImagesService) {
    super(images, 'resources', 'superadmin');
  }
}
