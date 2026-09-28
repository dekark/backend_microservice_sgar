// Only the PUBLIC Google client ID is read. Backend secrets never become assets.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'public/app-config.json');
const settings = JSON.parse(
  fs.readFileSync(
    fs.existsSync(target) ? target : path.join(root, 'config/app-config.example.json'),
    'utf8',
  ),
);
const backendEnv = path.join(root, '../auth-service/.env');
if (!settings.googleClientId && fs.existsSync(backendEnv))
  settings.googleClientId = parseEnv(fs.readFileSync(backendEnv, 'utf8')).GOOGLE_CLIENT_ID || '';
const api = {};
for (const name of ['auth', 'roles', 'permissions', 'resources', 'areas', 'users', 'audit'])
  api[name] = settings.api?.[name] || `/api/${name}`;
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(
  target,
  JSON.stringify({ googleClientId: settings.googleClientId || '', api }, null, 2) + '\n',
);
console.log('Configuración pública del frontend preparada.');
if (!settings.googleClientId)
  console.log('Pendiente: configura el Client ID público de Google en public/app-config.json.');
