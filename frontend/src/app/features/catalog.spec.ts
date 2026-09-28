import { formBody, formFields, access } from './catalog';
import { User } from '../core/models';
describe('CRUD payloads and module visibility', () => {
  it('never exposes role changes or area moves in the area user editor', () => {
    const fields = formFields('users', 'area-admin', true);
    const names = fields.map((f) => f.key);
    expect(names).not.toContain('googleSub');
    expect(names).not.toContain('areaId');
    expect(names).not.toContain('roleId');
    expect(
      formBody(
        fields,
        {
          name: 'Ana',
          email: 'ana@example.com',
          roleId: 1,
          areaId: 'other',
          googleSub: 'spoof',
          isActive: true,
        },
        true,
      ),
    ).toEqual({ name: 'Ana', email: 'ana@example.com', isActive: true });
  });
  it('sends integer role IDs and validates metadata JSON', () => {
    expect(
      formBody([{ key: 'roleId', label: 'Rol', type: 'number' }], { roleId: '7' }, false),
    ).toEqual({ roleId: 7 });
    expect(() =>
      formBody(
        [{ key: 'metadata', label: 'Metadatos', type: 'json' }],
        { metadata: '{broken}' },
        true,
      ),
    ).toThrow();
  });
  it('only normal users with an assigned area get their resources CRUD', () => {
    expect(access({ role: 'usuario normal', areaId: 'area' } as User).entities).toEqual([
      'resources',
    ]);
    expect(access({ role: 'usuario normal', areaId: null } as User).entities).toEqual([]);
  });
  it('never creates activation fields for resources or audit', () => {
    for (const entity of ['resources', 'audit'] as const)
      expect(formFields(entity, 'admin', false).map((f) => f.key)).not.toContain('isActive');
  });
});
