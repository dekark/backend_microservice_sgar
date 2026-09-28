import {
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { GoogleIdentity } from './auth.types';

@Injectable()
export class GoogleTokenService {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (this.config.get<boolean>('AUTH_GOOGLE_ENABLED') === false) {
      if (idToken.startsWith('dev-token:')) {
        const email = idToken.replace('dev-token:', '').trim();
        const prefix = email.split('@')[0];
        return {
          sub: `google-sub-${prefix}`,
          email,
          name: prefix.charAt(0).toUpperCase() + prefix.slice(1),
        };
      }
      throw new ServiceUnavailableException(
        'Login de Google deshabilitado: configura GOOGLE_CLIENT_ID',
      );
    }
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        throw new Error('Identidad incompleta o correo no verificado');
      }
      return {
        sub: payload.sub,
        email: payload.email,
        name: (payload.name || payload.email).slice(0, 150),
      };
    } catch {
      throw new UnauthorizedException('Token de Google invalido o vencido');
    }
  }
}
