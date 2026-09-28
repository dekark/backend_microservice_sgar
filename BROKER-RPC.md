# Controladores por RabbitMQ y Kafka

Los siete servicios aceptan comandos request/reply por ambos brokers. Cada
comando ejecuta el controlador HTTP correspondiente en el mismo proceso mediante
`127.0.0.1`, conservando guards, validacion, interceptores, permisos y auditoria.
Los servicios de negocio existentes ejecutan sus operaciones habituales. Las
rutas HTTP siguen disponibles para Angular y AWS API Gateway.

| Servicio    | Cola RabbitMQ   | Patron RPC / topic Kafka |
| ----------- | --------------- | ------------------------ |
| auth        | auth_rpc        | auth.rpc.v1              |
| roles       | roles_rpc       | roles.rpc.v1             |
| permissions | permissions_rpc | permissions.rpc.v1       |
| resources   | resources_rpc   | resources.rpc.v1         |
| areas       | areas_rpc       | areas.rpc.v1             |
| users       | users_rpc       | users.rpc.v1             |
| audit       | audit_rpc       | audit.rpc.v1             |

Se reutilizan el mismo Kafka y RabbitMQ compartidos. Son nuevas colas y topics,
sin contenedores adicionales. PostgreSQL sigue siendo el de `database/.env`.
`audit_queue` conserva su consumidor de eventos y esta separado de `audit_rpc`.

## Rutas y autorizacion

[RPC-ROUTES.json](RPC-ROUTES.json) enumera los metodos y rutas de los controladores,
incluyendo las operaciones heredadas de `/admin/*`, los CRUD por area, paginacion,
busquedas, activacion, avatares y archivos. Los parametros `:id` y `:area` se
sustituyen por sus valores, codificados como segmentos URL.

Los comandos llevan el JWT de la aplicacion en `accessToken`; no aceptan una
identidad, rol, permisos ni cabeceras arbitrarias proporcionados por el cliente.
Los CRUD siguen requiriendo el rol y area definidos por sus guards. Las rutas
publicas, como login y health, mantienen su acceso publico.

Los seis servicios de negocio consultan `/auth/me` mediante `BrokerGateway.send`
a auth por RabbitMQ. `AUTH_RPC_TRANSPORT=kafka` selecciona Kafka para esa consulta.
`AUTH_SERVICE_URL` ya no participa en la comprobacion de sesiones. La consulta
tiene un plazo de cinco segundos; un fallo del broker impide validar la sesion.
No hay fallback que omita la validacion.

Google sigue autenticando en Angular: el frontend obtiene el ID token y envia
`POST /auth/google` con `{ "idToken": "..." }`. El mismo comando puede enviarse
por RPC desde un cliente de confianza; el backend verifica el token.

## Contrato

Ejemplo de consulta a resources:

```typescript
const result = await gateway.send(
  "resources",
  {
    version: 1,
    requestId: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 30000).toISOString(),
    method: "GET",
    path: "/area-user/areas/Finanzas/resources",
    query: { page: 1, limit: 20, q: "manual" },
    accessToken: jwtDeLaAplicacion,
  },
  "rabbit",
); // 'kafka' usa el mismo contrato
```

Importa `BrokerClientModule` e inyecta `BrokerGateway` desde `src/messaging`.
Usa `body` para POST/PATCH/PUT con los mismos campos que exige el controlador.
`path` es una ruta local, sin host ni query string; los filtros van en `query`.
El vencimiento debe estar en el futuro y a un maximo de cinco minutos.
El cliente lo limita ademas a `BROKER_RPC_TIMEOUT_MS`: conexion y respuesta
comparten un solo plazo. Las respuestas se validan y deben corresponder al
requestId enviado; una respuesta malformada no valida una sesion.
Si falla la conexion inicial, el cliente se descarta para que la siguiente
solicitud pueda reconectar. Esto no reenvia operaciones ni reintenta escrituras.

La respuesta contiene `requestId`, `ok`, `statusCode`, `data` y, cuando la peticion
HTTP lo proporciona, `auditRequestId`. Los errores 401/403/404 se conservan.
Una respuesta 204 tiene `data: null`. No se siguen redirecciones.

El cliente Nest utiliza `send`, no `emit`. RabbitMQ usa la cola de la tabla y el
patron RPC; Kafka utiliza ese patron como topic y su topic de respuesta `.reply`.
`BrokerGateway` configura la suscripcion de respuestas antes de conectar.

Para una prueba manual, despues de compilar auth y arrancar los servicios/brokers,
crea un archivo JSON como `{ "method": "GET", "path": "/health/live" }` y ejecuta:

```powershell
npm run rpc:call -- rabbit auth comando.json
npm run rpc:call -- kafka auth comando.json
```

El script completa version, requestId y vencimiento si faltan. Lee la configuracion
de mensajeria de auth; las variables del proceso tienen prioridad. Imprime la
respuesta, que puede contener datos privados o tokens al invocar login. Para
escrituras conserva el `requestId` original si investigas un timeout; ejecutar
otra vez un archivo sin requestId genera una operacion nueva.

## Archivos

POST/PUT admiten `file: { filename, contentType, base64 }`, sin `body` simultaneo.
El adaptador genera el campo multipart `file` y ejecuta la validacion de tipo,
tamano y permisos del controlador. Limite RPC: 256 KiB por archivo y 512 KiB por
mensaje o respuesta. Usa las rutas HTTP/S3 existentes para archivos mayores;
reduce la paginacion si una respuesta supera el limite.

## Configuracion y migracion

```dotenv
BROKER_RPC_ENABLED=true
BROKER_RPC_TIMEOUT_MS=30000
AUTH_RPC_TRANSPORT=rabbit
```

Son los valores predeterminados; `AUTH_RPC_TRANSPORT` se usa en los seis servicios
que consultan auth. `BROKER_RPC_ENABLED=false` desactiva los consumidores RPC del
servicio, pero no elimina la dependencia de auth RPC de sus guards.

Antes de arrancar, aplica las migraciones pendientes de `database/drizzle`
mediante el procedimiento de tu base: esta version agrega
`0004_broker_commands.sql` y requiere tambien `0003_application_audit.sql`.
La aplicacion no migra Neon al iniciar. Si el historial esta gestionado por
Drizzle, el comando desde `database` es `npx drizzle-kit migrate`.

`broker_commands` reserva cada escritura por servicio y requestId antes de llamar
al controlador. Un duplicado devuelve 409 y no vuelve a ejecutarse. Se guarda
solamente la huella de la solicitud, estado, codigo y correlacion de auditoria;
no se guardan tokens, archivos ni respuestas. GET/HEAD no requieren reserva.

Esto evita ejecutar otra vez una escritura con el mismo ID; no garantiza una
respuesta exactamente una vez. Si el proceso cae o se pierde la respuesta,
la operacion puede haber terminado. Un 504 o un registro `started`/`uncertain`
requiere comprobar el recurso antes de crear otro requestId. RabbitMQ confirma
el mensaje despues de procesarlo y antes de que Nest publique la respuesta;
no existe una transaccion que una HTTP, la reserva y la respuesta del broker.
No se eliminan reservas automaticamente: su retencion determina cuanto tiempo
se conserva la proteccion contra duplicados.

El servidor HTTP arranca antes de los consumidores para permitir la ejecucion
local. Una falla al iniciar los consumidores cierra la aplicacion. Las rutas
protegidas de auth limitan peticiones por usuario, despues de verificar JWT y
sesion, para evitar que todos los clientes RPC compartan la cuota de loopback.
Login y refresh conservan sus limites por IP: los productores RPC comparten esa
cuota publica. No se aceptan IPs arbitrarias del productor.

Para AWS configura `KAFKA_BROKERS`, TLS/SASL y `RABBITMQ_URL` con los endpoints de
tus brokers, descritos en [AUDIT-EVENTS.md](AUDIT-EVENTS.md). Provisiona los topics
RPC y `.reply`, sus permisos y particiones: cada instancia concurrente de cliente
Kafka en un mismo grupo de respuestas necesita una particion de respuesta.
Los comandos/respuestas pueden transportar JWT y datos de negocio; restringe
sus productores/consumidores y retencion, y utiliza conexiones cifradas en nube.
Angular se conecta al API Gateway, sin recibir credenciales de los brokers.

## Auditoria y comprobaciones

Cada comando produce `rpc.completed`, incluso si es rechazado antes de llegar al
controlador. Los comandos ejecutados conservan ademas la auditoria HTTP y los
cambios transaccionales ya implementados. El requestId RPC y el auditRequestId
HTTP aparecen en la respuesta/reserva; los eventos no incluyen los cuerpos ni JWT.
Si falla el almacenamiento del resultado de auditoria RPC, se registra un error
local; no se garantiza captura durante una caida de la base.

Las pruebas de auth validan contrato, plazos, duplicados y ambos handlers. Las
pruebas HTTP de users invocan ambos handlers con transportes simulados y verifican
sesion, rol, area, controladores heredados y multipart. `npm run test:audit:offline`
aplica las migraciones en PGlite en memoria y prueba reservas concurrentes y
resultados inciertos, ademas de la auditoria existente.

`npm run rpc:routes` regenera el catalogo leyendo los controladores compilados de
los siete proyectos; no arranca Nest ni conecta a la base. Compila los proyectos
antes de usarlo. La entrega real entre procesos necesita una comprobacion con
Kafka/RabbitMQ disponibles; las pruebas locales no validan infraestructura AWS.

Referencias: [RPC Kafka en Nest](https://docs.nestjs.com/microservices/kafka) y
[RPC RabbitMQ en Nest](https://docs.nestjs.com/microservices/rabbitmq).
