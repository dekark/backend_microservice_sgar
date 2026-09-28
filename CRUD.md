# CRUD de los microservicios

Para subir o reemplazar avatares, portadas, archivos principales o enlaces de recursos,
consulta [IMAGES.md](IMAGES.md). Esas rutas permiten cualquier rol autenticado para
el avatar propio y los recursos de su area.
Los campos de avatar e imagen se actualizan mediante esas rutas multipart, no
mediante el PATCH JSON general.

## Activar y desactivar

Roles, permisos, areas y usuarios tienen `isActive` y ofrecen estas acciones
(sin cuerpo, respuesta `200` con el registro y su nuevo `isActive`):

| Entidad  | Activar                                 | Desactivar                                |
| -------- | --------------------------------------- | ----------------------------------------- |
| Roles    | `PATCH /admin/roles/:id/activate`       | `PATCH /admin/roles/:id/deactivate`       |
| Permisos | `PATCH /admin/permissions/:id/activate` | `PATCH /admin/permissions/:id/deactivate` |
| Areas    | `PATCH /admin/areas/:id/activate`       | `PATCH /admin/areas/:id/deactivate`       |
| Usuarios | `PATCH /admin/users/:id/activate`       | `PATCH /admin/users/:id/deactivate`       |

Cada ruta utiliza el puerto de su microservicio y requiere sesion valida y rol
`superadministrador`. Tambien existen en las rutas originales sin `/admin`.
Repetir la accion mantiene el estado solicitado. Los registros desactivados siguen
disponibles en el CRUD para poder reactivarlos; no se borran. El PATCH general
con `{ "isActive": true }` o `{ "isActive": false }` sigue funcionando.

El administrador de area dispone de
`PATCH /area-admin/areas/:area/users/:id/activate` y
`PATCH /area-admin/areas/:area/users/:id/deactivate` solo para usuarios no
administrativos de su area. Conserva la validacion del permiso de modulo y no
puede activar/desactivar administradores ni usuarios de otras areas.

Recursos tiene `status` y auditoria no tiene `isActive`; no reciben estas rutas.
Las sesiones (`user_sessions.is_active`) conservan su ciclo de autenticacion:
login crea una sesion activa y logout/revocacion la desactiva. Estas acciones CRUD
no reactivan sesiones revocadas. Desactivar el usuario o su rol impide sus siguientes
peticiones autenticadas; desactivar el area o su permiso bloquea el acceso por area.

Para el rol `usuario normal`, consulta el [CRUD de recursos de su area](AREA-USER.md).

Esta guia describe los CRUD globales del superadministrador. Para los controladores
del rol `administrador` limitados al area asignada, consulta [AREA-ADMIN.md](AREA-ADMIN.md).

## API administrativa

Listados paginados, filtros, ordenamiento y consultas por nombre/accion:
[SEARCH.md](SEARCH.md). Se aplican a las rutas globales, administrativas y por area.

Cada microservicio tiene un controlador administrativo dedicado:

| Servicio            | Ruta administrativa  |
| ------------------- | -------------------- |
| roles-service       | `/admin/roles`       |
| permissions-service | `/admin/permissions` |
| resources-service   | `/admin/resources`   |
| areas-service       | `/admin/areas`       |
| users-service       | `/admin/users`       |
| audit-service       | `/admin/audit`       |

Estas rutas ofrecen POST, GET, GET `/:id`, PATCH `/:id` y DELETE `/:id`.
Tambien incluyen GET `/admin/users/me` y GET/PUT
`/admin/roles/:id/permissions`. Usan los mismos cuerpos, paginacion, servicios y
validaciones que se describen abajo. Cada ruta utiliza el puerto de su microservicio.
Los controladores administrativos heredan los handlers y ambos guards del CRUD
existente; las rutas anteriores mantienen la misma proteccion.

El nombre autorizado ahora es exactamente `superadministrador`. La escritura
anterior `superadministardor` ya no concede acceso. Los roles existentes en la base
no se renombran automaticamente. Las tablas internas de sesiones, refresh tokens
y entrega de eventos siguen gestionadas por auth-service.

## Autorizacion

Todas las rutas de esta guia exigen `Authorization: Bearer <accessToken>` emitido
por auth-service y el rol exacto `superadministrador` (nombre solicitado, sensible
a mayusculas y sin espacios adicionales). Solo ese rol puede realizar las
operaciones, incluyendo asignar roles/permisos y editar/borrar auditoria.
No se exigen permisos RBAC adicionales ni ser propietario del registro.

La comprobacion consulta `/auth/me` mediante RPC a auth en cada peticion: valida JWT, sesion vigente,
usuario activo y rol activo. Una sesion revocada deja de tener acceso. Los datos de
rol o permisos enviados por el cliente no se usan para autenticar.

Cada controlador aplica `@UseGuards(AuthSessionGuard, SuperadminGuard)`.
Los seis `SecurityModule` exportan ambos guards para proteger nuevos controladores.
El cambio de rol se aplica en la siguiente peticion, incluso con el mismo token.
Las operaciones de autenticacion, perfil `/auth/me` y gestion de la propia sesion
conservan sus reglas actuales. Las rutas tecnicas `/` y `/health/*` conservan su
acceso publico. El consumidor RabbitMQ de auditoria conserva su autenticacion al
broker. Los [comandos RPC](BROKER-RPC.md) de los CRUD ejecutan los mismos guards
que la API HTTP; los eventos internos de auditoria usan el consumidor separado.

El primer administrador debe tener asignado previamente en la base un rol activo
cuyo `name` sea `superadministrador`. Este cambio no crea ni eleva usuarios en la
base compartida. No asignes ese rol como `AUTH_DEFAULT_ROLE_ID` de los registros
publicos: concederia acceso administrativo a cualquier usuario nuevo.

| Servicio            | Puerto | Ruta base      | ID              |
| ------------------- | ------ | -------------- | --------------- |
| roles-service       | 3001   | `/roles`       | Entero positivo |
| permissions-service | 3002   | `/permissions` | Entero positivo |
| resources-service   | 3003   | `/resources`   | UUID            |
| areas-service       | 3004   | `/areas`       | UUID            |
| users-service       | 3005   | `/users`       | UUID            |
| audit-service       | 3006   | `/audit`       | UUID            |

Cada ruta base tiene:

| Metodo | Ruta                       | Resultado                              |
| ------ | -------------------------- | -------------------------------------- |
| POST   | `/entidad`                 | Crea y devuelve el registro (`201`)    |
| GET    | `/entidad?page=1&limit=20` | Datos, total y navegacion de paginas (`200`) |
| GET    | `/entidad/:id`             | Consulta un registro (`200`)           |
| GET    | `/entidad/by-name/:name`   | Coincidencias exactas paginadas (`200`); auditoria usa `/by-action/:action` |
| PATCH  | `/entidad/:id`             | Actualiza los campos enviados (`200`)  |
| DELETE | `/entidad/:id`             | Borra el registro (`204`, sin cuerpo)  |

La paginacion admite `limit` de 1 a 100 y `page` de 1 a 10000. Las listas se ordenan
por fecha de creacion e ID descendentes por defecto; admite `sortBy`, `order`, `q`
y filtros especificos por modulo, descritos en [SEARCH.md](SEARCH.md).
La respuesta incluye `totalPages`, `hasNextPage` y `hasPreviousPage`.
`total` se calcula en una segunda consulta
y puede variar si hay escrituras concurrentes.

## Configuracion

1. Compila el paquete compartido: `npm --prefix database run build`.
2. En cada servicio instala dependencias con `npm ci`.
3. Los siete servicios leen `DATABASE_URL` desde **`database/.env`**. No necesitas
   copiar la conexion al `.env` de cada servicio. Configura alli solamente sus
   variables particulares, como `PORT`, `RABBITMQ_URL`, `KAFKA_BROKERS` y
   `AUTH_RPC_TRANSPORT` (por defecto `rabbit`).
4. Las tablas de las migraciones existentes en `database/drizzle` deben estar
   creadas. Los CRUD no aplican migraciones ni conectan a Neon automaticamente.
5. Ejecuta `npm run start:dev` desde la carpeta de cada servicio. Los consumidores
   RPC de los siete servicios necesitan sus conexiones Kafka y RabbitMQ.

Si usas `npm run auth:local`, auth y auditoria se ejecutan en Docker y montan
`database/.env` en modo de solo lectura. Los otros servicios leen ese mismo archivo
desde tu computadora: todos usan la misma base y los mismos brokers. Auditoria
valida sesiones por RPC a auth. No ejecutes dos instancias en el mismo puerto.

## Cuerpos para crear registros

Roles:

```json
{ "name": "operador", "description": "Operaciones", "isActive": true }
```

Permisos:

```json
{ "key": "users.read", "name": "Consultar usuarios", "module": "users" }
```

Areas:

```json
{ "name": "Informatica", "description": "Area de tecnologia" }
```

Usuarios (`roleId` debe existir; `areaId` es opcional y acepta null):

```json
{
  "googleSub": "identificador-real-del-usuario-en-google",
  "email": "persona@example.com",
  "name": "Persona",
  "roleId": 1
}
```

Crear un usuario no inicia una sesion ni verifica su identidad con Google. El login
sigue realizandose en auth-service con un ID token valido. `googleSub` es obligatorio
al crear y no se puede cambiar mediante PATCH. La respuesta no incluye `googleSub`,
credenciales, refresh tokens ni sesiones. `email` se normaliza a minusculas.

Recursos (`areaId` debe existir):

```json
{
  "areaId": "UUID_DEL_AREA",
  "name": "Manual",
  "type": "DOCUMENT",
  "status": "ACTIVE",
  "url": "https://example.com/manual.pdf"
}
```

Tipos: `DOCUMENT`, `FILE`, `LINK`, `IMAGE`, `VIDEO`, `SOFTWARE`, `LICENSE`,
`EQUIPMENT`, `OTHER`. Estados: `ACTIVE`, `INACTIVE`, `ARCHIVED`. `createdById` se
obtiene de la sesion, no del cuerpo. Tambien se aceptan `description`, `s3Bucket`,
`s3Key`, `originalFileName`, `mimeType` y `fileSize` (entero seguro no negativo).
Son metadatos: este CRUD no sube ni elimina objetos de S3. `url` acepta HTTP(S).

Auditoria:

```json
{
  "action": "manual.note",
  "entity": "resources",
  "entityId": "UUID_DEL_RECURSO",
  "metadata": { "note": "Revision manual" }
}
```

`action` y `entity` son obligatorios; `entityId`, `areaId` y `metadata` son opcionales.
`userId` se obtiene de la sesion y `createdAt` lo genera la base. PATCH permite
modificar `action`, `entity`, `entityId`, `areaId` y `metadata`. Los metadatos son un
objeto JSON de hasta 64 KiB y se combinan con los existentes; los campos internos
del consumidor (`eventHash`, `source`, `version`, `eventId`, `originalUserId`,
`sessionId`, `userAgent`, `receivedAt`) se conservan y no son editables.

El consumidor RabbitMQ sigue registrando automaticamente los eventos de auth.
Borrar una fila de auditoria no borra el evento en Kafka ni sus entregas pendientes:
una nueva entrega de ese evento puede volver a crearla.

## Operaciones adicionales

- `GET /users/me`: devuelve el perfil de la sesion, incluyendo rol y permisos.
- `GET /roles/:id/permissions`: devuelve los permisos asignados al rol.
- `PUT /roles/:id/permissions` con `{ "permissionIds": [1, 2] }`: reemplaza la
  asignacion completa en una transaccion. `[]` elimina todas las asignaciones.
  IDs repetidos se deduplican; si una referencia no existe, no se cambia la asignacion.

En roles, permisos, areas y usuarios, PATCH permite `isActive` booleano. Las
descripciones y relaciones opcionales aceptan `null` donde lo permite el esquema.
Se rechazan campos desconocidos, fechas/IDs generados por el servidor, cuerpos
vacios y valores de tipo incorrecto. PATCH no reemplaza todo el registro.

Los borrados son fisicos y respetan las relaciones existentes. Por ejemplo, no se
puede borrar un rol con usuarios o un area con recursos. Borrar un usuario elimina
sus sesiones y refresh tokens, pero falla si aun tiene recursos vinculados como
creador. Para conservar registros puedes desactivarlos con `isActive: false` o
archivar un recurso con `status: "ARCHIVED"`.

## Respuestas y pruebas

- `400`: cuerpo, ID o paginacion invalida.
- `401`: token ausente/invalido o sesion revocada/vencida.
- `403`: usuario o rol inactivo, o rol distinto de `superadministrador`.
- `404`: registro no encontrado.
- `409`: valor unico duplicado o conflicto de relaciones.
- `503`: auth-service o base de datos no disponible.

Compila database, auth-service y los seis servicios antes de la prueba integrada.
En Windows, desde la raiz:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-crud.ps1
```

La prueba crea un PostgreSQL temporal en Docker, aplica las migraciones solo ahi y
arranca las APIs en puertos aleatorios. Usa JWT firmados con una clave temporal y
sesiones reales en esa base. El usuario de prueba tiene el rol `superadministrador`
sin permisos RBAC adicionales. Se comprueba que un usuario autenticado con otro rol
no pueda usar ningun CRUD, ni asignar permisos, ni falsificar su rol desde la peticion.
Tambien verifica el CRUD por area mediante `scripts/test-area-access.cjs`.
Al terminar cierra las APIs y elimina el contenedor temporal. No utiliza Neon,
secretos locales de produccion ni la base del entorno `auth:local`.
