import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Must run after JwtAuthGuard: user is the verified database principal.
@Injectable()
export class AuthenticatedThrottlerGuard extends ThrottlerGuard {
  protected getTracker(request: Record<string, unknown>): Promise<string> {
    const user = request.user;
    if (
      user &&
      typeof user === 'object' &&
      'id' in user &&
      typeof user.id === 'string'
    ) {
      return Promise.resolve(`user:${user.id}`);
    }
    return super.getTracker(request);
  }
}
