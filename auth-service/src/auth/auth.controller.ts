import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthenticatedThrottlerGuard } from './authenticated-throttler.guard';
import type { AuthenticatedRequest, RequestMetadata } from './auth.types';

function metadata(request: Request): RequestMetadata {
  // Express trusts no forwarded addresses unless explicitly configured at bootstrap.
  return {
    ipAddress: request.ip?.slice(0, 100) ?? null,
    userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
  };
}
function tokenField(body: unknown, field: string, max: number): string {
  if (!body || typeof body !== 'object' || !(field in body)) {
    throw new BadRequestException(`${field} es obligatorio`);
  }
  const value: unknown = (body as Record<string, unknown>)[field];
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new BadRequestException(
      `${field} debe ser un string no vacio de hasta ${max} caracteres`,
    );
  }
  return value;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('google')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  login(@Body() body: unknown, @Req() request: Request) {
    return this.auth.loginWithGoogle(
      tokenField(body, 'idToken', 16384),
      metadata(request),
    );
  }

  @Post('refresh')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  refresh(@Body() body: unknown, @Req() request: Request) {
    return this.auth.refresh(
      tokenField(body, 'refreshToken', 256),
      metadata(request),
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, AuthenticatedThrottlerGuard)
  @Header('Cache-Control', 'no-store')
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.profile(request);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard, AuthenticatedThrottlerGuard)
  @Header('Cache-Control', 'no-store')
  sessions(@Req() request: AuthenticatedRequest) {
    return this.auth.sessions(request);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard, AuthenticatedThrottlerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: AuthenticatedRequest) {
    await this.auth.logout(request, metadata(request));
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard, AuthenticatedThrottlerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@Req() request: AuthenticatedRequest) {
    await this.auth.logoutAll(request, metadata(request));
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard, AuthenticatedThrottlerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    await this.auth.revokeSession(request, sessionId, metadata(request));
  }
}
