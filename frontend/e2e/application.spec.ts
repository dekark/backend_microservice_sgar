import { expect, Page, test } from '@playwright/test';
const areaId = '22222222-2222-4222-8222-222222222222';
const resourceId = '33333333-3333-4333-8333-333333333333';
const userId = '11111111-1111-4111-8111-111111111111';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHh8AAAAASUVORK5CYII=',
  'base64',
);
async function backend(page: Page, role = 'superadministrador', denyArea = false) {
  const calls: { method: string; path: string; body: any }[] = [];
  let avatar = false;
  const records: Record<string, any[]> = {
    resources: [
      {
        id: resourceId,
        name: 'Manual de bienvenida',
        type: 'DOCUMENT',
        status: 'ACTIVE',
        areaId,
        createdAt: '2026-09-20T10:00:00Z',
      },
    ],
    users: [
      {
        id: userId,
        name: 'Ana Torres',
        email: 'ana@example.com',
        roleId: 1,
        areaId,
        isActive: true,
      },
    ],
    areas: [
      { id: areaId, name: 'Operaciones', description: 'Equipo de operaciones', isActive: true },
    ],
    roles: [{ id: 1, name: role, isActive: true }],
    permissions: [
      {
        id: 1,
        name: 'Gestionar operaciones',
        key: 'operations.manage',
        module: 'Operaciones',
        isActive: true,
      },
    ],
    audit: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        action: 'resource.created',
        entity: 'resources',
        entityId: resourceId,
        createdAt: '2026-09-20T10:00:00Z',
      },
    ],
  };
  const tokens = {
    accessToken: 'fixture-access',
    refreshToken: 'fixture-refresh',
    sessionId: 'session',
    expiresIn: 900,
  };
  await page.route('**/*', (route) =>
    route.request().url().startsWith('http://localhost:4200/') ? route.continue() : route.abort(),
  );
  await page.route('**/app-config.json', (route) =>
    route.fulfill({
      json: {
        googleClientId: 'fixture.apps.googleusercontent.com',
        api: Object.fromEntries(['auth', ...Object.keys(records)].map((s) => [s, '/api/' + s])),
      },
    }),
  );
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.google={accounts:{id:{initialize(c){this.cb=c.callback},renderButton(el){const b=document.createElement('button');b.className='secondary';b.textContent='Continuar con Google';b.onclick=()=>this.cb({credential:'google-id-token-fixture'});el.appendChild(b)},disableAutoSelect(){}}}};`,
    }),
  );
  await page.route('https://files.example.com/avatar.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: png }),
  );
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const [, , service, ...parts] = url.pathname.split('/');
    const path = '/' + parts.join('/');
    const method = req.method();
    let body: any = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData();
    }
    calls.push({ method, path: url.pathname, body });
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (service === 'auth') {
      if (path === '/auth/google') {
        expect(body).toEqual({ idToken: 'google-id-token-fixture' });
        return reply(tokens);
      }
      if (path === '/auth/refresh') return reply(tokens);
      if (path === '/auth/me')
        return reply({
          id: userId,
          name: 'Ana Torres',
          email: 'ana@example.com',
          roleId: 1,
          role,
          areaId,
          permissions: ['operations.manage'],
        });
      if (path === '/auth/sessions')
        return reply([
          {
            id: 'session',
            current: true,
            userAgent: 'Microsoft Edge',
            ipAddress: '127.0.0.1',
            createdAt: '2026-09-01T10:00:00Z',
            expiresAt: '2026-10-01T10:00:00Z',
            lastActiveAt: '2026-09-24T10:00:00Z',
          },
        ]);
      return route.fulfill({ status: 204 });
    }
    expect(req.headers()['authorization']).toBe('Bearer fixture-access');
    if (denyArea && path.startsWith('/area-admin/')) return reply({ message: 'Forbidden' }, 403);
    if (path.endsWith('/avatar')) {
      if (method === 'PUT') {
        avatar = true;
        return reply({});
      }
      if (method === 'DELETE') {
        avatar = false;
        return route.fulfill({ status: 204 });
      }
      return avatar
        ? reply({ url: 'https://files.example.com/avatar.png', expiresIn: 300 })
        : reply({ message: 'No image' }, 404);
    }
    if (/\/(image|file|url)$/.test(path))
      return method === 'GET'
        ? reply({ message: 'No content' }, 404)
        : method === 'DELETE'
          ? route.fulfill({ status: 204 })
          : reply({ uploaded: true });
    if (service === 'roles' && path.endsWith('/permissions'))
      return reply(method === 'GET' ? records['permissions'] : []);
    const data = records[service];
    if (!data) return reply({}, 404);
    const base = path.indexOf('/' + service);
    const suffix = path
      .slice(base + service.length + 1)
      .split('/')
      .filter(Boolean);
    if (suffix[0] === 'by-name' || suffix[0] === 'by-action') {
      const filtered = data.filter((r) => (r.name || r.action) === decodeURIComponent(suffix[1]));
      return reply({
        data: filtered,
        total: filtered.length,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    }
    if (suffix.length) {
      const record = data.find((r) => String(r.id) === suffix[0]);
      if (!record) return reply({ message: 'Not found' }, 404);
      if (method === 'DELETE') {
        data.splice(data.indexOf(record), 1);
        return route.fulfill({ status: 204 });
      }
      if (method === 'PATCH')
        Object.assign(record, suffix[1] ? { isActive: suffix[1] === 'activate' } : body);
      return reply(record);
    }
    if (method === 'POST') {
      const created = {
        id: '44444444-4444-4444-8444-444444444444',
        ...body,
        createdAt: new Date().toISOString(),
      };
      data.push(created);
      return reply(created, 201);
    }
    const q = url.searchParams.get('q')?.toLowerCase();
    const filtered = q ? data.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : data;
    return reply({
      data: filtered.slice(0, +(url.searchParams.get('limit') || 20)),
      total: filtered.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });
  return calls;
}
async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('heading', { name: /Hola, Ana/ })).toBeVisible();
}
test('Google login, protected CRUD, resource upload and deletion', async ({ page }) => {
  const calls = await backend(page);
  await login(page);
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('navigation').getByRole('link', { name: 'Recursos', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Manual de bienvenida', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Crear recurso' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Guía de soporte');
  await dialog.getByLabel('ID del área').fill(areaId);
  await dialog.getByRole('button', { name: 'Guardar registro' }).click();
  await expect(page.getByRole('cell', { name: 'Guía de soporte', exact: true })).toBeVisible();
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'Guía de soporte', exact: true }) });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  await dialog.getByLabel('Nombre').fill('Guía actualizada');
  await dialog.getByRole('button', { name: 'Guardar registro' }).click();
  await expect(page.getByRole('cell', { name: 'Guía actualizada', exact: true })).toBeVisible();
  await page
    .getByLabel('Subir o reemplazar archivo', { exact: true })
    .setInputFiles({
      name: 'guia.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Contenido de prueba'),
    });
  await expect(page.getByRole('status').filter({ hasText: 'Archivo actualizado.' })).toBeVisible();
  expect(
    calls.some(
      (c) =>
        c.method === 'PUT' && c.path.endsWith('/file') && String(c.body).includes('name="file"'),
    ),
  ).toBe(true);
  page.once('dialog', (d) => d.accept());
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'Guía actualizada', exact: true }) })
    .getByRole('button', { name: 'Eliminar', exact: true })
    .click();
  await expect(page.getByRole('cell', { name: 'Guía actualizada', exact: true })).toHaveCount(0);
});
test('normal users only see their area resources and cannot open global roles', async ({
  page,
}) => {
  const calls = await backend(page, 'usuario normal');
  await login(page);
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Roles', exact: false }),
  ).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Recursos', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Manual de bienvenida', exact: true })).toBeVisible();
  expect(calls.some((c) => c.path === `/api/resources/area-user/areas/${areaId}/resources`)).toBe(
    true,
  );
  await page.goto('/gestion/roles');
  await expect(
    page.getByRole('heading', { name: 'No tienes acceso a este espacio' }),
  ).toBeVisible();
});
test('area administrator must pass the backend module-permission check', async ({ page }) => {
  const calls = await backend(page, 'administrador', true);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Hola, Ana', exact: false })).toBeVisible();
  // Dashboard totals may request scoped APIs; measure only the guarded navigation.
  await page.waitForLoadState('networkidle');
  calls.length = 0;
  await page.goto('/mi-area/users');
  await expect(
    page.getByRole('heading', { name: 'No tienes acceso a este espacio' }),
  ).toBeVisible();
  expect(calls.some((c) => c.path.startsWith('/api/users/area-admin/'))).toBe(false);
});
test('profile avatar and sessions work in a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await backend(page);
  await login(page);
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await page.getByRole('link', { name: 'Perfil y sesiones' }).click();
  await expect(page.getByRole('heading', { name: 'Perfil y sesiones' })).toBeVisible();
  await page
    .getByLabel('Subir o reemplazar avatar')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('Avatar del usuario')).toBeVisible();
  expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/users/users/me/avatar')).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/profile-mobile.png', fullPage: true });
});
test('anonymous navigation is redirected to Google login without exposing data', async ({
  page,
}) => {
  const calls = await backend(page);
  await page.goto('/gestion/users');
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
  expect(calls.filter((c) => !c.path.startsWith('/api/auth/'))).toHaveLength(0);
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
});
test('management modules support role permissions, activation, user creation and audit search', async ({
  page,
}) => {
  const calls = await backend(page);
  await login(page);
  const nav = page.getByRole('navigation');
  await nav.getByRole('link', { name: 'Permisos', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'Gestionar operaciones', exact: true }),
  ).toBeVisible();
  await nav.getByRole('link', { name: 'Roles', exact: true }).click();
  await page.getByRole('button', { name: 'Ver', exact: true }).click();
  const permission = page.getByRole('checkbox', { name: /Gestionar operaciones/ });
  await expect(permission).toBeChecked();
  await permission.uncheck();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Guardar permisos del rol' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Permisos actualizados.' }),
  ).toBeVisible();
  expect(
    calls.find((c) => c.method === 'PUT' && c.path === '/api/roles/admin/roles/1/permissions')
      ?.body,
  ).toEqual({ permissionIds: [] });
  await nav.getByRole('link', { name: 'Áreas', exact: true }).click();
  await page.getByRole('button', { name: 'Desactivar', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Inactivo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Activo', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Usuarios', exact: true }).click();
  await page.getByRole('button', { name: /Crear usuario/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Usuario de prueba');
  await dialog.getByLabel('Correo electrónico').fill('prueba@example.com');
  await dialog.getByLabel('Identificador de Google').fill('test-only-sub');
  await dialog.getByLabel('ID del rol').fill('3');
  await dialog.getByRole('button', { name: 'Guardar registro' }).click();
  await expect(page.getByRole('cell', { name: 'Usuario de prueba', exact: true })).toBeVisible();
  expect(
    calls.find((c) => c.method === 'POST' && c.path === '/api/users/admin/users')?.body.roleId,
  ).toBe(3);
  await nav.getByRole('link', { name: 'Auditoría', exact: true }).click();
  await page.getByLabel('Tipo de búsqueda').selectOption('name');
  await page.getByRole('textbox', { name: 'Buscar', exact: true }).fill('resource.created');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect
    .poll(() => calls.some((c) => c.path === '/api/audit/admin/audit/by-action/resource.created'))
    .toBe(true);
  await expect(page.getByRole('cell', { name: 'resource.created', exact: true })).toBeVisible();
});
