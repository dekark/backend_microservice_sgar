import { Controller, UseGuards } from '@nestjs/common';
import { AuthSessionGuard } from '../security/auth-session.guard';
import { SuperadminGuard } from '../security/superadmin.guard';
import { AreaAdminGuard } from '../security/area-admin.guard';
import { ResourceFileControllerBase } from '../media/resource-file.controller-base';
import { ResourceFilesService } from '../media/resource-files.service';

@Controller(['resources/:id', 'area-user/areas/:area/resources/:id'])
@UseGuards(AuthSessionGuard)
export class ResourceFilesController extends ResourceFileControllerBase {
  constructor(files: ResourceFilesService) {
    super(files, 'member');
  }
}
@Controller('admin/resources/:id')
@UseGuards(AuthSessionGuard, SuperadminGuard)
export class AdminResourceFilesController extends ResourceFileControllerBase {
  constructor(files: ResourceFilesService) {
    super(files, 'superadmin');
  }
}
@Controller('area-admin/areas/:area/resources/:id')
@UseGuards(AuthSessionGuard, AreaAdminGuard)
export class AreaResourceFilesController extends ResourceFileControllerBase {
  constructor(files: ResourceFilesService) {
    super(files, 'area-admin');
  }
}
