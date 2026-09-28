const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
// Seven HTTP services; never connects to brokers or PostgreSQL.
module.exports = Object.fromEntries(
  ['auth', 'roles', 'permissions', 'resources', 'areas', 'users', 'audit'].map((service, index) => {
    const file = path.join(__dirname, `../${service}-service/.env`);
    const env = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
    const port = Number(
      process.env[`FRONTEND_${service.toUpperCase()}_PORT`] || env.PORT || 3000 + index,
    );
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw Error(`Puerto de ${service} inválido.`);
    return [
      `/api/${service}/**`,
      {
        target: `http://127.0.0.1:${port}`,
        changeOrigin: true,
        pathRewrite: { [`^/api/${service}`]: '' },
      },
    ];
  }),
);
