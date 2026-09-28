import { Entity, Scope, User } from '../core/models';
export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'textarea' | 'select' | 'boolean' | 'json';
  required?: boolean;
  options?: string[];
  max?: number;
  nullable?: boolean;
  immutable?: boolean;
  hint?: string;
}
export interface Definition {
  title: string;
  singular: string;
  subtitle: string;
  mark: string;
  columns: string[];
  fields: Field[];
  filters: string[];
  active?: boolean;
}
const name = (max = 150): Field => ({ key: 'name', label: 'Nombre', required: true, max });
const description: Field = {
  key: 'description',
  label: 'Descripción',
  type: 'textarea',
  max: 10000,
  nullable: true,
};
const active: Field = { key: 'isActive', label: 'Registro activo', type: 'boolean' };
const area: Field = {
  key: 'areaId',
  label: 'ID del área',
  nullable: true,
  hint: 'UUID del área registrada en el sistema.',
};
export const CATALOG: Record<Entity, Definition> = {
  resources: {
    title: 'Recursos',
    singular: 'recurso',
    mark: '◈',
    subtitle: 'Documentos, archivos y herramientas de tu organización.',
    columns: ['name', 'type', 'status', 'areaId', 'createdAt'],
    filters: ['type', 'status', 'areaId', 'createdById', 'mimeType'],
    fields: [
      name(200),
      description,
      { ...area, required: true, nullable: false },
      {
        key: 'type',
        label: 'Tipo de recurso',
        type: 'select',
        required: true,
        options: [
          'DOCUMENT',
          'FILE',
          'LINK',
          'IMAGE',
          'VIDEO',
          'SOFTWARE',
          'LICENSE',
          'EQUIPMENT',
          'OTHER',
        ],
      },
      {
        key: 'status',
        label: 'Estado',
        type: 'select',
        options: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
      },
      {
        key: 'url',
        label: 'Enlace',
        nullable: true,
        max: 4096,
        hint: 'URL HTTP o HTTPS. También puedes adjuntar un archivo después de crear el recurso.',
      },
    ],
  },
  users: {
    title: 'Usuarios',
    singular: 'usuario',
    mark: '◎',
    subtitle: 'Personas, roles y áreas de trabajo.',
    columns: ['name', 'email', 'roleId', 'isActive', 'areaId'],
    filters: ['email', 'roleId', 'areaId', 'isActive'],
    active: true,
    fields: [
      name(),
      { key: 'email', label: 'Correo electrónico', type: 'email', required: true, max: 255 },
      {
        key: 'googleSub',
        label: 'Identificador de Google (sub)',
        required: true,
        immutable: true,
        max: 255,
        hint: 'Identificador real de Google; no es la dirección de correo.',
      },
      {
        key: 'roleId',
        label: 'ID del rol',
        type: 'number',
        required: true,
        hint: 'En el acceso por área debe ser un rol no administrativo.',
      },
      area,
      active,
    ],
  },
  areas: {
    title: 'Áreas',
    singular: 'área',
    mark: '▧',
    subtitle: 'Organiza los equipos y sus espacios de trabajo.',
    columns: ['name', 'description', 'isActive', 'createdAt'],
    filters: ['name', 'isActive'],
    active: true,
    fields: [name(), description, active],
  },
  roles: {
    title: 'Roles',
    singular: 'rol',
    mark: '◇',
    subtitle: 'Define los roles y sus permisos asociados.',
    columns: ['name', 'description', 'isActive', 'createdAt'],
    filters: ['name', 'isActive'],
    active: true,
    fields: [name(100), description, active],
  },
  permissions: {
    title: 'Permisos',
    singular: 'permiso',
    mark: '⌘',
    subtitle: 'Controla las capacidades disponibles en cada módulo.',
    columns: ['name', 'key', 'module', 'isActive'],
    filters: ['key', 'module', 'isActive'],
    active: true,
    fields: [
      name(),
      { key: 'key', label: 'Clave del permiso', required: true, max: 150 },
      {
        key: 'module',
        label: 'Módulo',
        required: true,
        max: 100,
        hint: 'Para el administrador de área debe coincidir exactamente con el nombre del área.',
      },
      description,
      active,
    ],
  },
  audit: {
    title: 'Auditoría',
    singular: 'registro de auditoría',
    mark: '↗',
    subtitle: 'Consulta la actividad y el historial de la aplicación.',
    columns: ['action', 'entity', 'entityId', 'userId', 'createdAt'],
    filters: ['action', 'entity', 'entityId', 'userId', 'areaId'],
    fields: [
      { key: 'action', label: 'Acción', required: true, max: 150 },
      { key: 'entity', label: 'Entidad', required: true, max: 100 },
      { key: 'entityId', label: 'ID de la entidad', nullable: true, max: 255 },
      area,
      { key: 'metadata', label: 'Metadatos (JSON)', type: 'json' },
    ],
  },
};
export const LABELS: Record<string, string> = {
  id: 'ID',
  name: 'Nombre',
  description: 'Descripción',
  key: 'Clave',
  module: 'Módulo',
  email: 'Correo',
  roleId: 'Rol',
  areaId: 'Área',
  isActive: 'Estado',
  type: 'Tipo',
  status: 'Estado',
  action: 'Acción',
  entity: 'Entidad',
  entityId: 'ID de entidad',
  userId: 'Usuario',
  createdById: 'Creado por',
  createdAt: 'Creación',
  updatedAt: 'Actualización',
  mimeType: 'Formato',
  url: 'Enlace',
  originalFileName: 'Archivo',
  metadata: 'Metadatos',
};
export function access(user: User | null): { scope: Scope; entities: Entity[]; prefix: string } {
  if (user?.role === 'superadministrador')
    return {
      scope: 'admin',
      entities: ['resources', 'users', 'areas', 'roles', 'permissions', 'audit'],
      prefix: '/gestion',
    };
  if (user?.role === 'administrador' && user.areaId)
    return { scope: 'area-admin', entities: ['resources', 'users', 'audit'], prefix: '/mi-area' };
  if (user?.role === 'usuario normal' && user.areaId)
    return { scope: 'area-user', entities: ['resources'], prefix: '/mis-recursos' };
  return { scope: 'area-user', entities: [], prefix: '/mis-recursos' };
}
export function formFields(entity: Entity, scope: Scope, editing: boolean): Field[] {
  return CATALOG[entity].fields.filter(
    (f) =>
      !(editing && f.immutable) &&
      !(
        scope !== 'admin' &&
        (f.key === 'areaId' || (entity === 'users' && editing && f.key === 'roleId'))
      ),
  );
}
export function formBody(
  fields: Field[],
  draft: Record<string, unknown>,
  editing: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = draft[f.key];
    if (f.type === 'boolean') {
      body[f.key] = raw === true;
      continue;
    }
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === '' || value === null || value === undefined) {
      if (f.required) throw Error(`${f.label} es obligatorio.`);
      if (editing && f.nullable) body[f.key] = null;
      continue;
    }
    if (f.type === 'number') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 2147483647)
        throw Error(`${f.label} debe ser un entero positivo.`);
      body[f.key] = n;
    } else if (f.type === 'json') {
      try {
        body[f.key] = JSON.parse(String(value));
      } catch {
        throw Error('Los metadatos deben ser JSON válido.');
      }
    } else {
      if (f.max && String(value).length > f.max)
        throw Error(`${f.label} supera ${f.max} caracteres.`);
      body[f.key] = value;
    }
  }
  return body;
}
