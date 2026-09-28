import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthSessionGuard } from '../security/auth-session.guard';
import { SuperadminGuard } from '../security/superadmin.guard';
import type { AuthenticatedRequest } from '../security/security.types';
import { RolesService } from './roles.service';
@Controller('roles')
@UseGuards(AuthSessionGuard, SuperadminGuard)
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get('by-name/:name')
  @Header('Cache-Control', 'no-store')
  byName(@Param('name') name: string, @Query() query: Record<string, unknown>) {
    return this.service.list({ ...query, name });
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: Record<string, unknown>) {
    return this.service.list(query);
  }
  @Get(':id/permissions')
  @Header('Cache-Control', 'no-store')
  permissions(@Param('id') id: string) {
    return this.service.permissions(id);
  }
  @Put(':id/permissions')
  @Header('Cache-Control', 'no-store')
  setPermissions(@Param('id') id: string, @Body() body: unknown) {
    return this.service.setPermissions(id, body);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.service.create(body, request.user.id);
  }
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.service.update(id, body);
  }

  @Patch(':id/activate')
  @Header('Cache-Control', 'no-store')
  activate(@Param('id') id: string) {
    return this.service.update(id, { isActive: true });
  }

  @Patch(':id/deactivate')
  @Header('Cache-Control', 'no-store')
  deactivate(@Param('id') id: string) {
    return this.service.update(id, { isActive: false });
  }
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}
