import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { MyAvatarController } from './my-avatar.controller';
import { AdminAvatarController } from './admin-avatar.controller';
import { AreaAvatarController } from './area-avatar.controller';
import { AreaUsersController } from './area-users.controller';
import { AreaUsersService } from './area-users.service';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { SecurityModule } from '../security/security.module';
import { CrudModule } from '../crud/crud.module';
@Module({
  imports: [SecurityModule, CrudModule, MediaModule],
  providers: [UsersService, AreaUsersService],
  controllers: [
    MyAvatarController,
    UsersController,
    AdminUsersController,
    AreaUsersController,
    AdminAvatarController,
    AreaAvatarController,
  ],
})
export class UsersModule {}
