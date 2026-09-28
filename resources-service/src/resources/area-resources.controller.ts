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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthSessionGuard } from '../security/auth-session.guard';
import { AreaAdminGuard } from '../security/area-admin.guard';
import type { AuthenticatedRequest } from '../security/security.types';
import { AreaResourcesService } from './area-resources.service';

@Controller('area-admin/areas/:area/resources')
@UseGuards(AuthSessionGuard, AreaAdminGuard)
export class AreaResourcesController {
  constructor(private readonly service: AreaResourcesService) {}

  @Get('by-name/:name')
  @Header('Cache-Control', 'no-store')
  byName(
    @Req() request: AuthenticatedRequest,
    @Param('area') area: string,
    @Param('name') name: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.list(request.user.id, area, { ...query, name });
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('area') area: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.list(request.user.id, area, query);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('area') area: string,
    @Param('id') id: string,
  ) {
    return this.service.get(request.user.id, area, id);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('area') area: string,
    @Body() body: unknown,
  ) {
    return this.service.create(request.user.id, area, body);
  }
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('area') area: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(request.user.id, area, id, body);
  }
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('area') area: string,
    @Param('id') id: string,
  ) {
    await this.service.remove(request.user.id, area, id);
  }
}
