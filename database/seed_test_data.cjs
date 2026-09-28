const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { neon } = require('@neondatabase/serverless');

async function seed() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set in .env');
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log('--- Iniciando inserción de datos de prueba para SGAR ---');

  // 1. ROLES (Garantizar 5 roles)
  const rolesToInsert = [
    { name: 'Administrador de Área', description: 'Gestión administrativa y recursos a nivel departamental' },
    { name: 'Operador', description: 'Operaciones diarias y administración de inventario asignado' },
    { name: 'Auditor', description: 'Revisión y fiscalización de logs y cambios del sistema' },
    { name: 'Usuario Regular', description: 'Consulta general de catálogo de recursos y solicitudes' },
  ];

  for (const r of rolesToInsert) {
    await sql`
      INSERT INTO roles (name, description, is_active)
      VALUES (${r.name}, ${r.description}, true)
      ON CONFLICT (name) DO NOTHING;
    `;
  }

  const allRoles = await sql`SELECT id, name FROM roles ORDER BY id ASC;`;
  console.log(`Roles actuales (${allRoles.length}):`, allRoles.map(r => `${r.id}: ${r.name}`));

  // 2. AREAS (5 áreas departamentales)
  const areasToInsert = [
    { name: 'Tecnología e Información (TI)', description: 'Gestión de infraestructura, redes, servidores y soporte' },
    { name: 'Recursos Humanos', description: 'Gestión de personal, talento humano y bienestar' },
    { name: 'Finanzas y Contabilidad', description: 'Presupuestos, auditoría contable y compras' },
    { name: 'Operaciones y Logística', description: 'Supervisión operativa, cadena de suministro e inventarios' },
    { name: 'Auditoría y Control Interno', description: 'Cumplimiento normativo, seguridad de la información y compliance' },
  ];

  for (const a of areasToInsert) {
    await sql`
      INSERT INTO areas (name, description, is_active)
      VALUES (${a.name}, ${a.description}, true)
      ON CONFLICT (name) DO NOTHING;
    `;
  }

  const allAreas = await sql`SELECT id, name FROM areas ORDER BY name ASC;`;
  console.log(`Áreas actuales (${allAreas.length}):`, allAreas.map(a => a.name));

  // Mapa de roles y áreas para vincular
  const roleMap = {};
  allRoles.forEach(r => { roleMap[r.name] = r.id; });

  const areaMap = {};
  allAreas.forEach(a => { areaMap[a.name] = a.id; });

  // 3. USUARIOS (5 usuarios: 2 especificados por el usuario + 3 de prueba)
  // Obtenemos el usuario existente para asignar como creador o vinculador si es necesario
  const existingUsers = await sql`SELECT id, email FROM users;`;
  const primaryAdminId = existingUsers.length > 0 ? existingUsers[0].id : null;

  const usersToInsert = [
    {
      email: 'ren.campos@duocuc.cl',
      name: 'Renato Campos Duoc',
      roleId: roleMap['Administrador de Área'] || allRoles[0].id,
      areaId: areaMap['Tecnología e Información (TI)'] || null,
    },
    {
      email: 'xxx.exorde.infernal@gmail.com',
      name: 'Exorde Infernal',
      roleId: roleMap['Operador'] || allRoles[0].id,
      areaId: areaMap['Finanzas y Contabilidad'] || null,
    },
    {
      email: 'test.operador@sgar.local',
      name: 'Carlos Mendoza (Operador Prueba)',
      roleId: roleMap['Operador'] || allRoles[0].id,
      areaId: areaMap['Operaciones y Logística'] || null,
    },
    {
      email: 'test.auditor@sgar.local',
      name: 'Beatriz Salazar (Auditora Prueba)',
      roleId: roleMap['Auditor'] || allRoles[0].id,
      areaId: areaMap['Auditoría y Control Interno'] || null,
    },
    {
      email: 'test.usuario@sgar.local',
      name: 'Matías Silva (Usuario Regular Prueba)',
      roleId: roleMap['Usuario Regular'] || allRoles[0].id,
      areaId: areaMap['Recursos Humanos'] || null,
    },
  ];

  for (const u of usersToInsert) {
    const pendingSub = `pending_${crypto.randomUUID()}`;
    await sql`
      INSERT INTO users (google_sub, email, name, auth_provider, role_id, area_id, is_active)
      VALUES (${pendingSub}, ${u.email}, ${u.name}, 'GOOGLE', ${u.roleId}, ${u.areaId}, true)
      ON CONFLICT (email) DO NOTHING;
    `;
  }

  const allUsers = await sql`SELECT id, email, name, role_id FROM users;`;
  console.log(`Usuarios actuales (${allUsers.length}):`, allUsers.map(u => `${u.name} (${u.email})`));

  // 4. RECURSOS (5 recursos de diferentes tipos y áreas)
  const creatorId = primaryAdminId || allUsers[0].id;
  const tiAreaId = areaMap['Tecnología e Información (TI)'] || allAreas[0].id;
  const rrhhAreaId = areaMap['Recursos Humanos'] || allAreas[0].id;
  const finanzasAreaId = areaMap['Finanzas y Contabilidad'] || allAreas[0].id;
  const operacionesAreaId = areaMap['Operaciones y Logística'] || allAreas[0].id;
  const auditoriaAreaId = areaMap['Auditoría y Control Interno'] || allAreas[0].id;

  const resourcesToInsert = [
    {
      name: 'Servidor Dell PowerEdge R750',
      description: 'Servidor blade principal para virtualización de servicios y bases de datos locales.',
      type: 'EQUIPMENT',
      status: 'ACTIVE',
      url: null,
      areaId: tiAreaId,
      createdById: creatorId,
    },
    {
      name: 'Licencia Anual JetBrains All Products Pack',
      description: 'Suscripción corporativa para IDEs de desarrollo backend y frontend.',
      type: 'LICENSE',
      status: 'ACTIVE',
      url: 'https://account.jetbrains.com',
      areaId: tiAreaId,
      createdById: creatorId,
    },
    {
      name: 'Manual de Políticas y Procedimientos RRHH 2026',
      description: 'Directrices corporativas de inducción, beneficios y código de conducta.',
      type: 'DOCUMENT',
      status: 'ACTIVE',
      url: 'https://corporativo.sgar.local/docs/politicas-2026.pdf',
      areaId: rrhhAreaId,
      createdById: creatorId,
    },
    {
      name: 'Software ERP Corporativo SAP Business One',
      description: 'Acceso a la plataforma contable y de facturación corporativa.',
      type: 'SOFTWARE',
      status: 'ACTIVE',
      url: 'https://erp.sgar.local/login',
      areaId: finanzasAreaId,
      createdById: creatorId,
    },
    {
      name: 'Matriz de Riesgos y Control Interno',
      description: 'Documento regulatorio con la matriz de evaluación y auditoría SGAR.',
      type: 'DOCUMENT',
      status: 'ACTIVE',
      url: 'https://corporativo.sgar.local/auditoria/matriz-control.pdf',
      areaId: auditoriaAreaId,
      createdById: creatorId,
    },
  ];

  for (const res of resourcesToInsert) {
    await sql`
      INSERT INTO resources (name, description, type, status, url, area_id, created_by_id)
      VALUES (${res.name}, ${res.description}, ${res.type}, ${res.status}, ${res.url}, ${res.areaId}, ${res.createdById})
      ON CONFLICT DO NOTHING;
    `;
  }

  const allResources = await sql`SELECT id, name, type, status FROM resources;`;
  console.log(`Recursos actuales (${allResources.length}):`, allResources.map(r => `${r.name} [${r.type}]`));

  // 5. PERMISOS (5 permisos para el catálogo de permisos)
  const permissionsToInsert = [
    { key: 'users.manage', name: 'Gestión Completa de Usuarios', module: 'users', description: 'Crear, editar, activar y desactivar usuarios' },
    { key: 'roles.manage', name: 'Gestión de Roles y Permisos', module: 'roles', description: 'Crear y modificar roles de acceso' },
    { key: 'areas.manage', name: 'Gestión Departamental', module: 'areas', description: 'Crear y administrar áreas corporativas' },
    { key: 'resources.read', name: 'Consulta de Recursos', module: 'resources', description: 'Visualizar inventario y catálogo de recursos' },
    { key: 'resources.manage', name: 'Administración de Recursos', module: 'resources', description: 'Registrar, actualizar o dar de baja recursos' },
  ];

  for (const p of permissionsToInsert) {
    await sql`
      INSERT INTO permissions (key, name, module, description, is_active)
      VALUES (${p.key}, ${p.name}, ${p.module}, ${p.description}, true)
      ON CONFLICT (key) DO NOTHING;
    `;
  }

  const allPermissions = await sql`SELECT id, key, name FROM permissions;`;
  console.log(`Permisos actuales (${allPermissions.length}):`, allPermissions.map(p => `${p.key}: ${p.name}`));

  console.log('--- Datos de prueba insertados con éxito ---');
}

seed().catch((err) => {
  console.error('Error al insertar datos de prueba:', err);
  process.exit(1);
});
