# Seguridad de users-service

El servicio escucha en `http://localhost:3005` y verifica las sesiones consultando
`GET /auth/me` en auth-service. Configura `AUTH_SERVICE_URL` en `.env` (valor por
defecto: `http://localhost:3000`; entre contenedores: `http://auth:3000`). Debe ser
la direccion del servicio de confianza, no una URL recibida del cliente.

`GET /users/me`, con `Authorization: Bearer <accessToken>`, devuelve el usuario,
`roleId`, `role` y `permissions`. Requiere sesion valida y rol `superadministrador`.
Otros usuarios pueden consultar su propio perfil en `/auth/me` de auth-service.
El access token es el emitido por auth-service despues del login;
no es el ID token de Google ni el refresh token.

`UsersController` aplica `AuthSessionGuard` seguido de `SuperadminGuard`: verifica
el token y la sesion en auth-service y comprueba que el rol actual sea exactamente
`superadministrador`. Todas las operaciones CRUD exigen ese rol; no necesitan
permisos RBAC adicionales. Se ignoran roles enviados por el cliente.
`DATABASE_URL` se carga automaticamente desde `database/.env`, compartido con auth-service.
Consulta [CRUD.md](../CRUD.md) para rutas, cuerpos y pruebas integradas.

`RolesPermissionsGuard` sigue disponible para uso opcional en futuras rutas;
actualmente no se aplica al CRUD. Para activarlo en una nueva ruta:

```typescript
import { RequireRoles, RequirePermissions } from '../security/access.decorators';
import { RolesPermissionsGuard } from '../security/roles-permissions.guard';

@Get('ruta-administrativa')
@UseGuards(RolesPermissionsGuard)
@RequireRoles('admin', 'gestor')
@RequirePermissions('users.read', 'users.export')
// Aqui va el metodo que implementa la operacion.
```

Los nombres son ejemplos: deben coincidir exactamente con `roles.name` y
`permissions.key` de tu base. Los roles y sus asignaciones se gestionan en roles-service.
Se acepta cualquiera de los roles listados y se exigen todos los permisos listados.
Si declaras ambos decoradores, se deben cumplir ambos. Un rol llamado `admin` no
omite las comprobaciones de permisos. Las restricciones de controlador y metodo
se acumulan; las de un metodo no eliminan las del controlador.

Todas las rutas de `UsersController`, incluida `/users/me`, heredan la restriccion
de superadministrador. Para proteger otro controlador de este proyecto, importa
`SecurityModule` en su modulo y aplica
`@UseGuards(AuthSessionGuard, SuperadminGuard)` al controlador. El guard compara
exactamente `superadministrador`, respetando el nombre solicitado. No basta con
poner un decorador de permisos sin activar los guards.

Las respuestas son `401` para una sesion invalida, `403` para rol/permisos
insuficientes o usuario/rol inactivo, y `503` si no se puede verificar la sesion
(incluye tiempo de espera y respuestas inesperadas de auth-service). El servicio
no permite el acceso si auth-service falla. La verificacion tiene un timeout de
5 segundos y consume una peticion a `/auth/me` por cada peticion protegida;
considera su limite de solicitudes al dimensionar el despliegue.

Pruebas: `npm test -- --runInBand` y `npm run test:e2e -- --runInBand`. Las rutas
administrativas de prueba existen solo en la suite HTTP, no en la API desplegada.

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
