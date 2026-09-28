# Auditoria y eventos de los siete servicios

Auth, roles, permissions, areas, users, resources y audit registran su actividad
HTTP y publican eventos generales a Kafka y RabbitMQ. Las rutas del frontend
siguen siendo HTTP; los brokers transportan eventos de forma asincrona.

## Cobertura

| Actividad | Registro |
| --- | --- |
| Peticiones HTTP, listas, filtros y consultas | `http.accepted` y `http.completed`, metodo, plantilla de ruta, estado y duracion |
| Accesos denegados, errores de validacion, rutas inexistentes | Resultado HTTP 401/403/400/404/500 segun corresponda |
| Conexion interrumpida | `http.aborted` |
| Crear, editar, borrar, activar o desactivar | `data.created`, `data.updated`, `data.deleted`, entidad, ID y nombres de campos modificados |
| Asignar permisos a roles, usuarios y areas | Cambios de `role_permissions`, `users` y demas tablas implicadas |
| Avatar, imagen, archivo o URL de recurso | Peticion HTTP y cambios de referencias en `users`/`resources` |
| Autenticacion y sesiones | Eventos especificos `auth.*` existentes, mas peticiones HTTP y cambios de tablas |
| CRUD manual de auditoria | Eventos de sus propias modificaciones, incluyendo eliminaciones |

Los triggers cubren INSERT, UPDATE y DELETE en `roles`, `permissions`,
`role_permissions`, `areas`, `users`, `resources`, `audit_logs`, `user_sessions`
y `refresh_tokens`. Tambien cubren cambios en cascada. Los eventos se insertan
en `application_outbox` dentro de la transaccion original: un rollback revierte
tanto el cambio como sus eventos. Un UPDATE sin cambios no genera evento.

Cada peticion recibe un `X-Request-Id` generado por el servidor. El contexto se
propaga a las conexiones PostgreSQL; el actor se toma del usuario validado por
los guards. Los cambios fuera de una peticion tienen source `database` y pueden
carecer de actor. El worker de audit-service entrega esos eventos.

Los permisos actuales de controladores y CRUD se conservan. Las auditorias de
cambios incluyen el area de la entidad cuando existe; los eventos HTTP incluyen
el area del actor autenticado.

## Entrega y almacenamiento

Cada evento general tiene dos entregas independientes:

- Kafka: topic `application.events.v1`, configurable con `APPLICATION_KAFKA_TOPIC`.
- RabbitMQ: cola `audit_queue`, configurable con `AUTH_AUDIT_QUEUE`, patron
  `audit.application.record`. Audit-service consume esta cola y escribe `audit_logs`.

Los eventos especificos de auth mantienen `auth.events.v1` y `audit.auth.record`.
Kafka queda disponible para suscriptores adicionales; auditoria consume RabbitMQ,
por lo que no necesita consumir tambien Kafka para escribir el mismo registro.

Los workers reclaman entregas con `FOR UPDATE SKIP LOCKED`, una concesion temporal
y reintentos con espera creciente hasta 300 segundos. Una entrega fallida a Kafka
no impide confirmar RabbitMQ. Las entregas pendientes permanecen en PostgreSQL.
Se admite entrega repetida; los recibos de `audit_event_receipts` impiden duplicar
eventos generales incluso si el registro de auditoria fue editado o eliminado.
Un ID repetido con contenido distinto se rechaza.

El consumidor confirma RabbitMQ despues del commit. Los eventos invalidos van a
la cola de rechazos existente mediante un recibo sin copiar el contenido original.
Los inserts internos de auditoria no generan nuevos eventos, evitando ciclos.

## Privacidad y limites

Los eventos generales no guardan cuerpos HTTP, cabeceras, parametros de busqueda,
valores libres de parametros de ruta,
tokens, contrasenas, archivos ni URLs firmadas. En cambios de tablas se guardan
solo los nombres de los campos modificados, sin los valores anteriores o nuevos.
Se conservan IDs del actor, area, entidad y peticion para relacionar los eventos.
En consultas individuales se registra el ID UUID o numerico del parametro de
ruta `id`, `sessionId` o `roleId`; otros valores de ruta se omiten.

El evento HTTP de admision se guarda antes de ejecutar la peticion; si no puede
persistirse, se responde 503. Por eso es obligatorio aplicar la migracion antes
de arrancar esta version. El resultado HTTP se guarda al terminar la respuesta.
Si el proceso cae o PostgreSQL falla justo entonces, puede quedar solo el evento
de admision; se informa en el logger. Los cambios de datos confirmados siguen
teniendo su evento transaccional. El cierre normal espera los registros pendientes.

Esto registra actividad HTTP y cambios persistidos. No sustituye los logs de
infraestructura ni registra acciones internas del navegador, operaciones S3
externas a la aplicacion, DDL o TRUNCATE. Los eventos no son un historial completo
de valores para reconstruir registros. Para modificar el esquema, actualiza
tambien el contrato de campos de `database/src/application-event.ts`.

No se borran automaticamente los eventos generales publicados ni los recibos.
Define su retencion segun las necesidades de almacenamiento y auditoria; no
elimines entregas pendientes. El CRUD de auditoria sigue permitiendo las
modificaciones autorizadas por los guards existentes.

## Activacion

Los siete servicios tambien aceptan [comandos RPC por ambos brokers](BROKER-RPC.md).
Estos comandos ejecutan sus controladores y generan `rpc.completed`, ademas de
los eventos HTTP y de datos correspondientes. Requieren la migracion adicional
`0004_broker_commands.sql` para reservar escrituras y evitar su repeticion.

La migracion preparada es `database/drizzle/0003_application_audit.sql`, registrada
en el journal y snapshot de Drizzle. No se aplica automaticamente al iniciar.
Aplica las migraciones mediante el procedimiento que ya utilice tu base. Si el
historial esta gestionado por Drizzle:

```powershell
cd database
npx drizzle-kit migrate
```

Este comando modifica la base indicada por `database/.env`: revisa el destino
antes de ejecutarlo. No mezcles ejecucion manual del SQL con el migrador sobre
la misma migracion. `drizzle-kit push` no instala estos triggers personalizados.

Valores por defecto para todos los servicios, tambien documentados en sus ejemplos:

```dotenv
APPLICATION_EVENTS_ENABLED=true
APPLICATION_OUTBOX_INTERVAL_MS=1000
APPLICATION_KAFKA_TOPIC=application.events.v1
AUTH_AUDIT_QUEUE=audit_queue
```

`APPLICATION_EVENTS_ENABLED=false` pausa la entrega a brokers, conservando captura
HTTP y eventos transaccionales. No es una opcion para omitir la migracion.

Para AWS, `KAFKA_BROKERS` acepta endpoints separados por coma y `KAFKA_SSL=true`
habilita TLS. SASL opcional usa `KAFKA_SASL_MECHANISM` (`plain`, `scram-sha-256` o
`scram-sha-512`), `KAFKA_SASL_USERNAME` y `KAFKA_SASL_PASSWORD`. La autenticacion
MSK IAM requiere un proveedor adicional y no esta incluida. RabbitMQ usa
`RABBITMQ_URL` con `amqps://` y las credenciales del broker. Configura topic, cola,
permisos y conectividad de los servicios AWS antes del despliegue.

## Verificacion sin Docker

Desde la raiz, con dependencias instaladas en database y audit-service:

```powershell
npm run test:audit:offline
```

Compila el paquete compartido y audit-service y ejecuta las migraciones en una
base PostgreSQL en memoria con PGlite. Comprueba transacciones, validacion,
reintentos, concesiones, deduplicacion, borrado del actor/area y aislamiento de
contextos. No lee `.env`, no abre conexiones a Neon y no ejecuta Docker.
Las pruebas unitarias y HTTP de auth-service y audit-service usan brokers
simulados. La entrega real a Kafka/RabbitMQ necesita una prueba posterior contra
los brokers elegidos; estas pruebas no verifican la infraestructura AWS.

Referencia del motor de pruebas: [PGlite en memoria](https://pglite.dev/docs/).
