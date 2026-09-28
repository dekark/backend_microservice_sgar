# Backend de microservicios

El [frontend Angular Ámbito](frontend/README.md) está en `frontend/` e incluye
login Google, guards por rol/área, CRUD, archivos y gestión de sesiones.
Inícialo con `npm run frontend:dev` y abre `http://localhost:4200`.
Configura el identificador público de Google siguiendo su README y arranca los
servicios Nest por separado. Angular no inicia Docker.

[Auditoria general y eventos Kafka/RabbitMQ](AUDIT-EVENTS.md) para los siete servicios.
Todos los controladores admiten [comandos por RabbitMQ y Kafka](BROKER-RPC.md),
conservando sus guards y rutas HTTP. La validacion de sesiones entre servicios
usa RabbitMQ por defecto y puede configurarse para Kafka.
Esta version requiere las migraciones `0003_application_audit` y
`0004_broker_commands` antes de arrancar.
Pruebas sin Docker: `npm run test:audit:offline`.

Login Google en Angular y validacion del ID token en el backend: [GOOGLE-AUTH.md](GOOGLE-AUTH.md).

Los CRUD incluyen [paginacion, busqueda, filtros y consulta por ID/nombre](SEARCH.md)
en roles, permisos, areas, usuarios, recursos y auditoria, conservando sus permisos.

La [subida de avatares, imagenes y archivos de recursos](IMAGES.md) usa multipart,
validacion por tipo y S3 privado. Cualquier usuario autenticado puede cambiar su
avatar y el contenido de recursos de su area, sin exigir un nombre de rol especifico.
Requiere configurar el bucket/region y aplicar la migracion
de imagenes de recursos antes de usar la version actual del CRUD.

Los CRUD globales de usuarios, roles, permisos, areas, recursos y auditoria estan documentados
en [CRUD.md](CRUD.md). Todos requieren una sesion valida de auth-service y el rol
exacto `superadministrador`.
La API administrativa dedicada esta disponible bajo `/admin/roles`,
`/admin/permissions`, `/admin/resources`, `/admin/areas`, `/admin/users` y
`/admin/audit`, cada una en el puerto de su microservicio.

El rol `administrador` usa [el CRUD por area](AREA-ADMIN.md) de recursos, usuarios y
auditoria: `/area-admin/areas/:area/resources`, `/area-admin/areas/:area/users` y
`/area-admin/areas/:area/audit`. Requiere area
asignada y un permiso activo del rol cuyo `module` sea el nombre exacto del area.

El rol `usuario normal` dispone del [CRUD de recursos de su area](AREA-USER.md) en
`/area-user/areas/:area/resources` (resources-service, puerto 3003).

## Verificar los siete proyectos NestJS

Con las dependencias instaladas en `database/` y en cada servicio:

```powershell
npm run backend:build   # Compila database y los siete servicios, en ese orden
npm run backend:test    # Pruebas unitarias, HTTP aisladas y auditoria en memoria
npm run backend:check   # Compilacion completa y todas las pruebas anteriores
```

Estos comandos se detienen al primer fallo. No arrancan Docker ni aplican
migraciones a la base configurada. Las pruebas HTTP usan dependencias simuladas;
las pruebas de auditoria usan PostgreSQL WASM en memoria. El comando de pruebas
compila tambien database y audit-service porque la suite en memoria los importa.
No sustituye las pruebas de integracion con PostgreSQL, Kafka, RabbitMQ, Google
y S3 reales; estas requieren un entorno de pruebas configurado por separado.

## Conexion compartida a PostgreSQL

Para completar los archivos privados de configuracion local, ejecuta una vez:

```powershell
npm run env:configure
```

El comando genera los `.env` de los siete servicios, completa puertos y direcciones
locales de Kafka/RabbitMQ, y conserva los secretos existentes. Las claves faltantes
se generan en los archivos privados, no en las plantillas `.env.example`.
No arranca servicios ni modifica la base. Puedes repetirlo sin rotar las claves.

`GOOGLE_CLIENT_ID` requiere el identificador real de tu aplicacion de Google: si
falta, queda sin declarar y `AUTH_GOOGLE_ENABLED=false`. `AUTH_DEFAULT_ROLE_ID`
tampoco se inventa: si no defines un rol activo existente, el registro automatico
queda deshabilitado y solo pueden entrar usuarios ya registrados. Estas variables
opcionales se omiten cuando faltan, en lugar de escribir asignaciones vacias.

Auth, usuarios, roles, permisos, areas, recursos y auditoria leen la conexion desde
`database/.env`. No necesitas repetir `DATABASE_URL` en cada servicio. Sus `.env`
siguen disponibles para puertos, Google, JWT y mensajeria.

La prioridad es: variables del proceso (incluidas Docker y pruebas), `database/.env`
y finalmente el `.env` del servicio. Las rutas de los archivos son absolutas y se
resuelven desde el modulo, tanto al ejecutar TypeScript como el codigo compilado.
El perfil `auth:local` monta el mismo `database/.env` en los contenedores de auth
y auditoria en modo de solo lectura. No define otra conexion PostgreSQL.
Reinicia un servicio tras cambiar los archivos `.env`.

## Puertos HTTP de los servicios Nest

Cada servicio lee `PORT` de las variables de entorno o de su propio archivo `.env`.
Si no defines `PORT`, usa el valor predeterminado de esta tabla:

| Proyecto            | Puerto | URL local             |
| ------------------- | ------ | --------------------- |
| auth-service        | 3000   | http://localhost:3000 |
| roles-service       | 3001   | http://localhost:3001 |
| permissions-service | 3002   | http://localhost:3002 |
| resources-service   | 3003   | http://localhost:3003 |
| areas-service       | 3004   | http://localhost:3004 |
| users-service       | 3005   | http://localhost:3005 |
| audit-service       | 3006   | http://localhost:3006 |

Para ejecutar uno directamente, abre una terminal en su carpeta y ejecuta
`npm run start:dev`. Para personalizar el puerto, configura `PORT` en el `.env`
de ese proyecto; su `.env.example` contiene el valor correspondiente. El puerto
debe ser un entero entre 1 y 65535. Las variables de la terminal tienen prioridad
sobre `.env`; evita definir un mismo `PORT` global para todos los servicios.

El comando Docker `npm run auth:local` inicia auth y auditoria con su infraestructura.
Los otros cinco servicios se ejecutan por separado. Si auth o auditoria ya estan
corriendo en Docker, no inicies otra instancia en el mismo puerto.

## Arranque local de autenticacion con un comando

Hay un unico `docker-compose.yml` y un unico proyecto `backend-auth-local`.
Para ejecutar Nest directamente en tu equipo y levantar **solo un Kafka y un
RabbitMQ compartidos** cuando quieras usar Docker:

```powershell
npm run env:configure
npm run brokers:local
```

El comando de configuracion alinea las conexiones locales de los siete servicios
con esos brokers, conserva los endpoints de nube y no toca `database/.env`.
No hay contenedor de PostgreSQL. Auth y auditoria solo se agregan al activar el
perfil `auth` mediante `npm run auth:local`, reutilizando los mismos brokers.
Los contenedores auxiliares `kafka-init` y `kafka-storage-init` ya no se necesitan.

Si quedaron contenedores de la configuracion antigua (`backend-kafka` y
`backend-rabbitmq`), revisalos al volver a utilizar Docker; este cambio de archivos
no los elimina ni modifica sus volumenes.

Requisitos: Node.js 20.12+ y Docker Desktop con contenedores Linux.

Desde esta carpeta:

```powershell
npm run auth:local
```

Tambien puedes ejecutar `npm run local` desde `auth-service`.

El comando genera `.env.auth-local` con secretos aleatorios, conserva sus valores en los
siguientes arranques, construye la aplicacion y levanta:

- Un Kafka compartido, con listeners para Docker y el host. Los topics
  `auth.events.v1` y `application.events.v1` se crean al publicar por primera vez.
- RabbitMQ, con consola de administracion.
- `auth-service` y `audit-service`.

El proyecto Compose se llama `backend-auth-local` y esta definido en
`docker-compose.yml`, con el perfil opcional `auth`. La base de datos es la indicada en `database/.env`,
igual que para los servicios Nest ejecutados directamente. Ese archivo se monta en
modo de solo lectura y queda excluido de la imagen Docker.

La base debe tener las tablas de las migraciones de `database/drizzle`. El comando
no aplica migraciones ni crea roles en la base compartida. Las operaciones normales
de las APIs y sus workers utilizan esa base. Al terminar, el comando consulta
`/health/ready` para comprobar PostgreSQL, Kafka y RabbitMQ; no genera eventos de prueba.

Al actualizar desde el perfil anterior, `up --remove-orphans` retira los contenedores
antiguos de PostgreSQL y migracion. El volumen con sus datos anteriores se conserva.

| Servicio         | Direccion local predeterminada     |
| ---------------- | ---------------------------------- |
| Auth API         | http://localhost:3000              |
| Estado completo  | http://localhost:3000/health/ready |
| Proceso vivo     | http://localhost:3000/health/live  |
| Audit HTTP       | http://localhost:3006              |
| RabbitMQ consola | http://localhost:15673             |
| RabbitMQ AMQP    | localhost:5673                     |
| Kafka            | localhost:19092                    |

En RabbitMQ el usuario es `auth_local`; su contrasena esta en `.env.auth-local`.
La conexion PostgreSQL se mantiene exclusivamente en `database/.env`.
Todos los puertos publicados se limitan a localhost. Si un puerto esta ocupado, cambia
su variable en `.env.auth-local` y vuelve a ejecutar el comando.

## Habilitar login real con Google

El servidor puede arrancar sin una aplicacion de Google configurada. En ese caso
`POST /auth/google` responde 503 y el estado indica `googleLoginEnabled: false`.
No hay usuarios simulados ni una forma alternativa de saltarse la verificacion.

1. Configura tu cliente OAuth Web de Google con el origen Angular, por ejemplo
   `http://localhost:4200`.
2. Pon su identificador publico en `.env.auth-local`:
   `GOOGLE_CLIENT_ID='tu-id.apps.googleusercontent.com'`.
3. Ejecuta otra vez `npm run auth:local`. Se habilita Google automaticamente.
4. Angular debe enviar la propiedad `credential` de Google Identity Services a
   `POST /auth/google`, como `{ "idToken": "..." }`.

Para registrar nuevos usuarios con Google, configura `AUTH_DEFAULT_ROLE_ID` en
`.env.auth-local` con un rol activo existente de la base compartida. Si lo dejas
vacio, el login solo acepta usuarios ya registrados por su `google_sub`.

El secreto OAuth de Google no es necesario para este flujo de ID tokens. La
contrasena de RabbitMQ debe coincidir con la usada al inicializar su volumen.

## Comandos

```powershell
npm run brokers:local      # Solo Kafka y RabbitMQ compartidos; Nest corre en tu equipo
npm run auth:local          # Crear/actualizar y arrancar; usar database/.env
npm run auth:local:status   # Ver contenedores y estado
npm run auth:local:logs     # Seguir los logs de auth y auditoria
npm run auth:local:check    # Comprobar disponibilidad sin escribir registros de prueba
npm run auth:local:stop     # Parar el entorno conservando los datos
```

La primera ejecucion necesita descargar imagenes y dependencias. Las siguientes usan
la cache de Docker. El arranque espera las comprobaciones de salud de los brokers y
verifica que auth-service pueda consultar el esquema de la base compartida.

Para trabajar directamente con Nest fuera de Docker o configurar Neon, consulta
[auth-service](auth-service/README.md) y [audit-service](audit-service/README.md).
Este comando prepara el entorno de ejecucion local; no es un despliegue AWS.
# backend_microservice_sgar
