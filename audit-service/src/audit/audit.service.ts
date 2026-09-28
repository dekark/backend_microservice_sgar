import { Injectable } from '@nestjs/common';
import { AuditRepository } from './audit.repository';
import { parseAuthEvent } from './auth-event';
import { parseApplicationEvent } from 'database';

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}
  async recordAuthEvent(value: unknown): Promise<void> {
    await this.repository.persist(parseAuthEvent(value));
  }
  async recordApplicationEvent(value: unknown): Promise<void> {
    await this.repository.persistApplication(parseApplicationEvent(value));
  }
}
