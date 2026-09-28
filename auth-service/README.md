# Auth Service

Angular realiza el login con Google y envia el ID token al backend para validarlo
y crear una sesion propia. Configuracion: [GOOGLE-AUTH.md](../GOOGLE-AUTH.md).

## Arranque local automatico

Desde esta carpeta ejecuta `npm run local` (o `npm run auth:local` desde la raiz).
Esto levanta Kafka, RabbitMQ, auditoria y autenticacion. Los contenedores leen
la misma conexion de `database/.env` que los demas proyectos Nest. El arranque
comprueba disponibilidad; no ejecuta migraciones, crea roles ni escribe eventos de prueba.
Consulta el [README del proyecto](../README.md) para puertos, comandos y Google Client ID.
La configuracion se guarda en `.env.auth-local` de la raiz y no reemplaza tu `.env`.
La URL de PostgreSQL permanece en `database/.env`, montado en modo de solo lectura.
Para registrar usuarios nuevos, `AUTH_DEFAULT_ROLE_ID` debe ser un rol activo existente.
Sin Client ID el servidor arranca pero el login Google queda deshabilitado (HTTP 503).

Autenticacion de Google para el backend NestJS: login, registro controlado, JWT,
refresh tokens rotatorios, sesiones revocables y publicacion de eventos.

## Preparacion

Desde la raiz puedes ejecutar `npm run env:configure` para completar los archivos
privados de entorno. Genera las claves que falten y conserva las existentes.
El Client ID de Google y el ID del rol de registro requieren valores reales;
si no estan disponibles, Google y el registro automatico permanecen deshabilitados.

Desde la raiz:

```powershell
cd database
npm ci
npm run build
cd ../auth-service
npm ci
```

La conexion se lee directamente de `DATABASE_URL` en `database/.env`; no hace falta
copiarla al `.env` de auth-service. Auth usa el driver TCP `pg` para transacciones
y bloqueos. Las variables explicitas del proceso o Docker tienen prioridad.

Integra las otras variables de `.env.example` en tu `.env` existente. Configura:

- `GOOGLE_CLIENT_ID`: mismo Client ID que Angular/Google Identity Services.
- `JWT_SECRET`: secreto aleatorio de al menos 32 bytes.
- `AUTH_DEFAULT_ROLE_ID`: ID de un rol activo existente con permisos minimos. Si esta vacio,
  se rechaza el registro automatico y solamente entran usuarios ya registrados por `google_sub`.
- `FRONTEND_ORIGIN`: origen exacto de Angular, por defecto `http://localhost:4200`.
- Configuracion Kafka/RabbitMQ y del worker: ver `.env.example`.

Antes de arrancar, aplica la migracion preparada `database/drizzle/0001_auth_sessions_outbox.sql`
con el procedimiento de migraciones de tu base. Si tu historial ya esta gestionado por
Drizzle, desde `database` puedes ejecutar `npx drizzle-kit migrate`. No ejecutes el SQL
manualmente y luego el migrador sobre la misma migracion. Si creaste tablas mediante
`drizzle-kit push`, primero reconcilia ese historial con las migraciones existentes.

**Esta tarea no aplica migraciones a Neon.** Las pruebas de persistencia usan una base local
desechable. La migracion agrega una tabla y columnas/indices; las sesiones anteriores
quedan vencidas y los refresh tokens sin relacion a una sesion ya no se aceptan.
Los JWT anteriores sin `sid` requieren iniciar sesion otra vez.

```powershell
npm run start:dev
```

## API

Todos los endpoints usan JSON y el prefijo `/auth`. Los protegidos requieren
`Authorization: Bearer <accessToken>`.

| Metodo | Ruta                      | Funcion                                               | Autenticacion         |
| ------ | ------------------------- | ----------------------------------------------------- | --------------------- |
| POST   | /auth/google              | Login/registro con ID token de Google                 | ID token en body      |
| POST   | /auth/refresh             | Renueva ambos tokens y conserva la sesion             | Refresh token en body |
| GET    | /auth/me                  | Perfil y permisos activos actuales                    | Bearer                |
| GET    | /auth/sessions            | Sesiones activas del usuario, con indicador `current` | Bearer                |
| POST   | /auth/logout              | Revoca la sesion actual                               | Bearer                |
| POST   | /auth/logout-all          | Revoca todas las sesiones del usuario                 | Bearer                |
| DELETE | /auth/sessions/:sessionId | Revoca un dispositivo propio                          | Bearer                |

Login: Angular envia la propiedad `credential` obtenida de Google Identity Services:

```json
{ "idToken": "<ID token de Google>" }
```

Respuesta de login y refresh (HTTP 200):

```json
{
  "accessToken": "<JWT propio>",
  "refreshToken": "<UUID.secreto aleatorio>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "refreshExpiresAt": "2026-10-23T00:00:00.000Z",
  "sessionId": "<UUID de sesion>",
  "user": {
    "id": "<UUID de usuario>",
    "email": "usuario@example.com",
    "name": "Usuario",
    "roleId": 1,
    "role": "reader",
    "areaId": null
  }
}
```

Refresh:

```json
{ "refreshToken": "<ultimo refreshToken recibido>" }
```

Logout, logout-all y revocacion responden 204. Errores: 400 para entrada invalida, 401 para
tokens/sesiones no validos, 403 para cuenta/rol inactivos o registro deshabilitado, 404 si
la sesion a revocar no pertenece al usuario, 409 para identidad en conflicto y 429 al
exceder el limite de solicitudes.

## Sesiones y cliente Angular

- Un login crea una sesion con vencimiento absoluto de 30 dias por defecto. La renovacion
  no extiende ese plazo. El access token dura 15 minutos por defecto.
- El JWT incluye `sub`, `sid`, `token_use`, `iat`, `exp`, `iss` y `aud`. Cada acceso
  protegido consulta el estado de sesion, usuario y rol. Logout invalida tambien los JWT
  emitidos de esa sesion, aunque su `exp` aun no haya vencido.
- Solo se almacena el hash SHA-256 del refresh token. Su secreto tiene 256 bits aleatorios.
- Cada refresh token solo puede usarse una vez. La reutilizacion de un token anterior
  revoca toda su sesion, incluyendo el token nuevo. Las renovaciones se serializan con un
  bloqueo de usuario en PostgreSQL para evitar dos respuestas validas a un mismo token.
- Angular debe coordinar una sola renovacion en curso y reemplazar ambos tokens al recibir
  la respuesta. No reintentes automaticamente el mismo refresh tras perder una respuesta:
  puede haberse consumido; en ese caso se necesita un nuevo login con Google.
- Los tokens se devuelven en JSON, no se implementan cookies. Mantenlos en memoria; no se
  recomienda guardarlos en localStorage/sessionStorage. Para persistencia entre recargas,
  una futura integracion BFF/cookie HttpOnly necesita proteccion CSRF y su propio contrato.
- `GET /auth/me` devuelve los permisos vigentes, pero cada microservicio debe aplicar la
  autorizacion en sus endpoints. Ocultar botones en Angular no autoriza operaciones.
- La autenticacion sigue siendo Google: no hay contrasenas locales ni endpoints de
  recuperacion de contrasena; esas funciones corresponden a la cuenta Google.

## Kafka, RabbitMQ y auditoria

Las operaciones exitosas guardan su estado y sus eventos en una misma transaccion:
un fallo al insertar el evento revierte la operacion. Los rechazos de login/refresh
intentan guardar un evento sin incluir la credencial; si la base esta caida se registra
el fallo de persistencia y se mantiene el rechazo original.

El worker procesa `auth_outbox` cada 5 segundos:

- **Kafka**: topic configurable `AUTH_KAFKA_TOPIC`, por defecto `auth.events.v1`.
  Clave: ID del usuario, o ID del evento para rechazos anonimos. Valor: el evento.
- **RabbitMQ**: cola durable `AUTH_AUDIT_QUEUE`, por defecto `audit_queue`.
  Patron NestJS `audit.auth.record`, mensaje persistente con `messageId = eventId`.
  Es un trabajo para el consumidor de auditoria; no una respuesta RPC.

Cada destino tiene su propio estado de entrega, lease y reintentos con espera creciente
(hasta una hora). Si un worker cae, otro puede recuperar la entrega tras 2 minutos.
No se pierde el evento porque uno de los brokers este caido. La entrega es **al menos
una vez** y no garantiza orden total: un consumidor debe deduplicar por `eventId`.
La confirmacion del broker no significa que el consumidor ya proceso el evento.

Acciones:

- `auth.user.registered`, `auth.login.succeeded`, `auth.login.failed`.
- `auth.token.refreshed`, `auth.refresh.failed`, `auth.refresh.reuse_detected`.
- `auth.logout`, `auth.logout_all`, `auth.session.revoked`.

Contrato versionado:

```json
{
  "eventId": "<UUID>",
  "version": 1,
  "source": "auth-service",
  "action": "auth.login.succeeded",
  "occurredAt": "2026-09-23T12:00:00.000Z",
  "userId": "<UUID o null>",
  "sessionId": "<UUID o null>",
  "ipAddress": "127.0.0.1",
  "userAgent": "navegador",
  "reason": "opcional: codigo interno"
}
```

No se publican tokens, hashes, secretos ni el perfil Google. En RabbitMQ NestJS envuelve
el evento como `{ pattern: 'audit.auth.record', data: evento }`.
El consumidor de [audit-service](../audit-service/README.md) escribe en `audit_logs`
de forma idempotente por `eventId` y confirma el mensaje despues del commit.
Los eventos invalidos generan recibos sanitizados en una cola de rechazos.
Kafka expone el mismo evento para otros
suscriptores; no se debe duplicar el registro de auditoria por consumir ambos destinos.

Cada hora el worker elimina, en lotes, sesiones cuyo vencimiento supera la retencion
configurada y sus refresh tokens asociados, asi como entregas ya publicadas antiguas.
Nunca elimina eventos pendientes ni tokens rotados de una sesion aun vigente.
`AUTH_RETENTION_DAYS` vale 30 por defecto.
`AUTH_BACKGROUND_JOBS_ENABLED=false` detiene publicacion y limpieza; los eventos se
siguen acumulando en la base para cuando se reactive.

## Despliegue

El limite local es 10 solicitudes/minuto para Google, 30 para refresh y 120 para el resto,
por IP y ruta. Es memoria por instancia; varias replicas necesitan un limite compartido
en el gateway/WAF o un storage de throttling distribuido. Express no confia por defecto
en `X-Forwarded-For`; configura solo los proxies conocidos al desplegar detras de uno.

Usar HTTPS fuera de localhost. Estos JWT usan HS256. Un authorizer JWT nativo de API
Gateway no puede asumir que son tokens emitidos por Google: requiere un diseno de claves
asimetrico/JWKS o un Lambda authorizer compatible. Para revocacion inmediata, los servicios
o el authorizer deben consultar el estado de sesion (por ejemplo mediante `/auth/me`) sin
cache que conserve una autorizacion revocada; comprobar solo firma/expiracion no basta.

## Pruebas

```powershell
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Las pruebas unitarias y HTTP simulan Google y el repositorio. Las pruebas de integracion
ejecutan el repositorio real y las migraciones sobre PostgreSQL. Para ellas crea un
contenedor **desechable**:

```powershell
docker run --detach --rm --name auth-postgres-tests --env POSTGRES_PASSWORD=auth-local-test-only --env POSTGRES_DB=auth_test --publish 127.0.0.1:55432:5432 postgres:17-alpine
$env:AUTH_TEST_DATABASE_URL = 'postgresql://postgres:auth-local-test-only@127.0.0.1:55432/auth_test'
npm run test:integration
docker stop auth-postgres-tests
```

La suite de integracion vacia las tablas de esa base entre casos. Rechaza destinos que
no sean localhost/127.0.0.1, una base llamada `auth_test` y la credencial local de ejemplo.
No usa `DATABASE_URL` ni carga tu `.env`. Valida concurrencia, rollback, revocacion,
pertenencia de sesiones, expiracion y reintentos del outbox. Google y los brokers se simulan.

Referencias: [Google ID tokens](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[rotacion de refresh tokens](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html),
[transacciones Drizzle](https://orm.drizzle.team/docs/transactions) y
[mensajes RabbitMQ en NestJS](https://docs.nestjs.com/microservices/rabbitmq).
