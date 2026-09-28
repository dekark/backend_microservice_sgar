import { AuditService } from './audit.service';
import { AuditRepository } from './audit.repository';
describe('AuditService', () => {
  it('rejects malformed input before touching the database', async () => {
    const repository = { persist: jest.fn() };
    const service = new AuditService(repository as unknown as AuditRepository);
    await expect(
      service.recordAuthEvent({ token: 'secret' }),
    ).rejects.toThrow();
    expect(repository.persist).not.toHaveBeenCalled();
  });
});
