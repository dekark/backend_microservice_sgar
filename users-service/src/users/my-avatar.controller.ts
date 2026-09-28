import { Controller, UseGuards } from '@nestjs/common';
import { AuthSessionGuard } from '../security/auth-session.guard';
import { ImageControllerBase } from '../media/image.controller-base';
import { ImagesService } from '../media/images.service';

@Controller('users/me/avatar')
@UseGuards(AuthSessionGuard)
export class MyAvatarController extends ImageControllerBase {
  constructor(images: ImagesService) {
    super(images, 'users', 'self');
  }
}
