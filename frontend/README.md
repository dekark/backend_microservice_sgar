# ?mbito ? Frontend Angular

Aplicaci?n Angular standalone en una carpeta independiente del backend. Incluye inicio de sesi?n con Google, panel de gesti?n, CRUD de las seis entidades, permisos por rol/?rea, archivos y sesiones.

## Arrancar en local

Desde la ra?z del repositorio:

```powershell
cd frontend
npm ci
npm start
```

Abre **http://localhost:4200**. Las dependencias ya est?n instaladas en este workspace; aqu? puedes ejecutar directamente `npm start`.

Se utiliza Angular 21 y TypeScript 5.9, compatibles con Node 20.20 instalado en este equipo. Para otra m?quina, consulta las [versiones de Node compatibles con Angular](https://angular.dev/reference/versions).

El comando inicia solamente Angular. Los servicios Nest y sus dependencias deben estar ejecut?ndose por separado, con las migraciones descritas en el [README del backend](../README.md). No inicia Docker, Kafka ni RabbitMQ, y no crea otra base de datos.

El [proxy de desarrollo de Angular](https://angular.dev/tools/cli/serve#proxying-to-a-backend-server) evita CORS en local:

| Prefijo del navegador | Servicio de destino | Puerto predeterminado |
| --------------------- | ------------------- | --------------------- |
| /api/auth             | auth-service        | 3000                  |
| /api/roles            | roles-service       | 3001                  |
| /api/permissions      | permissions-service | 3002                  |
| /api/resources        | resources-service   | 3003                  |
| /api/areas            | areas-service       | 3004                  |
| /api/users            | users-service       | 3005                  |
| /api/audit            | audit-service       | 3006                  |

`proxy.conf.cjs` toma el PORT del `.env` de cada servicio y quita el prefijo antes de reenviar. Por ejemplo, `/api/auth/auth/google` llega a `http://127.0.0.1:3000/auth/google`. Reinicia Angular si cambias los puertos. Opcionalmente puedes sobreescribir uno con `FRONTEND_AUTH_PORT`, `FRONTEND_USERS_PORT`, etc.

## Configurar Google

`npm start` y `npm run build` generan `public/app-config.json` mediante `scripts/configure.cjs`. Tambi?n puedes ejecutar `npm run configure`.

1. Configura un cliente OAuth de tipo **aplicaci?n web** en Google y autoriza el origen `http://localhost:4200` (y el dominio HTTPS cuando publiques).
2. Coloca su identificador p?blico en `GOOGLE_CLIENT_ID` de `auth-service/.env`, con Google habilitado en el backend. El generador copiar? exclusivamente ese identificador si el frontend a?n no tiene uno.
3. Alternativamente, edita `googleClientId` en `frontend/public/app-config.json`; debe coincidir con el que valida auth-service. Reinicia Angular.

El identificador de Google todav?a debe configurarse con el de tu aplicaci?n: no se puede generar uno v?lido localmente. Si falta, la pantalla de acceso lo indica. Nunca coloques un client secret, JWT_SECRET, conexi?n PostgreSQL, credenciales AWS ni contrase?as de brokers en el frontend. El script serializa una lista expl?cita de campos p?blicos.

El bot?n oficial utiliza [Google Identity Services](https://developers.google.com/identity/gsi/web/reference/js-reference) en el navegador y env?a la credencial recibida como `{ idToken }` a `POST /auth/google`. El backend verifica el token y emite la sesi?n propia; Angular no firma JWT ni conf?a en un rol guardado por el navegador.

## Pantallas y acceso

| Usuario                                          | Gesti?n disponible                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| superadministrador                               | Recursos, usuarios, ?reas, roles, permisos y auditor?a mediante /admin                |
| administrador con ?rea y permiso correspondiente | Recursos, usuarios y auditor?a de su ?rea mediante /area-admin                        |
| usuario normal con ?rea                          | Recursos de su ?rea mediante /area-user                                               |
| Cualquier usuario autenticado                    | Perfil, avatar propio, sesiones y archivos de los recursos autorizados por el backend |

Las rutas protegidas tienen guards de sesi?n, rol, permisos y ?rea. El ?rea siempre procede de `GET /auth/me`; no se elige libremente en la URL del frontend. Para los administradores, el guard consulta el endpoint de recursos de su ?rea antes de permitir la ruta: as? el backend comprueba la relaci?n rol-permiso y la coincidencia entre `permission.module` y el nombre del ?rea. La respuesta de `/auth/me` solo contiene claves de permisos, por lo que no se inventa esa relaci?n en Angular.

El guard de permisos permite exigir claves concretas mediante `data.permissions`. Los CRUD actuales mantienen los requisitos reales del backend, sin a?adir claves inexistentes.

Los [guards de Angular](https://angular.dev/guide/routing/route-guards) controlan la navegaci?n. La autorizaci?n efectiva siempre se valida otra vez en NestJS: ocultar una pantalla no concede ni revoca permisos en el servidor.

Cada CRUD incluye:

- Lista paginada, b?squeda de texto, filtros admitidos por cada tabla y ordenaci?n.
- Consulta por ID y por nombre exacto; auditor?a utiliza acci?n.
- Crear, consultar detalle, editar y eliminar con confirmaci?n.
- Activar/desactivar solo ?reas, usuarios, roles y permisos; los recursos usan su campo status.
- Editor de asignaci?n de permisos a roles para superadministrador.
- Im?genes y archivos en el detalle de recursos, y avatar en el detalle del usuario cuando el controlador lo permite.

Los formularios respetan los campos editables de cada controlador. Los identificadores de relaciones se introducen como IDs reales: roleId num?rico y areaId UUID. El administrador de ?rea no puede cambiar el ?rea ni editar el rol de un usuario desde su formulario. googleSub solo se pide al crear manualmente usuarios; el acceso normal con Google lo obtiene el backend.

Los archivos se env?an como multipart en el campo `file`. El backend valida el contenido seg?n el tipo del recurso y gestiona S3. Hay reemplazo/eliminaci?n de imagen y archivo, y edici?n de URL HTTP/HTTPS. Los l?mites predeterminados de la interfaz son 5 MiB para avatar/imagen y 25 MiB para archivo. Los recursos LINK utilizan URL.

## Sesiones y peticiones

El interceptor adjunta Bearer ?nicamente a las bases de API configuradas. Nunca lo env?a a Google, enlaces de descarga ni dominios ajenos. Las respuestas 401 renuevan la sesi?n con una ?nica petici?n compartida, incluso cuando fallan varias llamadas simult?neamente; despu?s se reintentan una vez. Los errores de permisos y de disponibilidad se muestran en la interfaz.

El access token vive en memoria y el refresh token en sessionStorage de la pesta?a. La recarga renueva la sesi?n y vuelve a consultar el perfil al servidor. sessionStorage es accesible a JavaScript: este dise?o no equivale a una cookie HttpOnly. El contrato actual del backend devuelve los tokens en JSON; pasar a cookies HttpOnly requiere un cambio coordinado del backend.

El usuario puede consultar sesiones, revocar una, cerrar la actual o cerrar todas. Una respuesta de renovaci?n que llegue despu?s de cerrar la sesi?n no vuelve a autenticar al usuario.

El navegador se comunica por HTTP con NestJS o API Gateway. Kafka, RabbitMQ, Neon y S3 siguen siendo responsabilidad del backend; las operaciones HTTP pasan por sus guards y por la integraci?n de auditor?a existente.

## AWS

`npm run build` genera `dist/frontend/browser`, preparado para hosting est?tico. No se despliega autom?ticamente.

- Configura las siete bases `api` de `app-config.json` para las integraciones de API Gateway. Ejemplo: base auth `https://api.tudominio.com/auth-service` produce `https://api.tudominio.com/auth-service/auth/google`; el gateway debe reenviar `/auth/google` al servicio correspondiente.
- Si frontend y API tienen distinto origen, configura CORS en el gateway para el dominio del frontend, Authorization, Content-Type y los m?todos usados. El proxy de desarrollo no forma parte del build.
- Sirve la aplicaci?n por HTTPS, establece la navegaci?n SPA hacia `index.html` para rutas del frontend y evita cachear `app-config.json`. No conviertas errores de rutas de API o assets en respuestas HTML.
- Autoriza el dominio p?blico en Google. Mant?n los secretos y las conexiones de los servicios exclusivamente en el backend.
- El archivo p?blico permite cambiar las URLs sin recompilar. `npm run configure` conserva los valores que ya tenga.

## Validaci?n

```powershell
npm test
npm run test:e2e
npm run build
```

Las pruebas unitarias verifican renovaci?n, concurrencia, destinos del Bearer, guards y restricciones de formularios. Las pruebas Playwright cubren login, CRUD, permisos de ?rea, archivos, avatar, sesiones y pantalla m?vil usando respuestas simuladas: no modifican Neon ni requieren Docker. No sustituyen una prueba con Google, S3 y los servicios reales configurados.

Playwright usa Microsoft Edge instalado en Windows. En otro equipo, instala el navegador de Playwright con `npx playwright install chromium` y selecciona `PLAYWRIGHT_CHANNEL=chromium`. Las capturas y trazas se guardan en `test-results`.

## Archivos principales

- `src/app/core`: configuraci?n, sesi?n, interceptor, cliente de API y guards.
- `src/app/features`: pantallas y componentes de CRUD, medios, permisos y perfil.
- `src/app/app.routes.ts`: rutas y requisitos de acceso.
- `src/styles.scss`: dise?o responsive.
- `config/app-config.example.json`: plantilla p?blica sin secretos.
- `e2e/application.spec.ts`: recorridos de navegador con backend simulado.
