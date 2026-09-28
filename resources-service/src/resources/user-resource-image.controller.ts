import { Controller, UseGuards } from '@nestjs/common';
import { AuthSessionGuard } from '../security/auth-session.guard';
import { ImageControllerBase } from '../media/image.controller-base';
import { ImagesService } from '../media/images.service';

@Controller([
  'resources/:id/image',
  'area-user/areas/:area/resources/:id/image',
])
@UseGuards(AuthSessionGuard)
export class UserResourceImageController extends ImageControllerBase {
  constructor(images: ImagesService) {
    super(images, 'resources', 'member');
  }
}
