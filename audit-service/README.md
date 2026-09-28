# Audit Service

Consumidor de los eventos de autenticacion publicados por `auth-service` en RabbitMQ.
Persiste en la tabla compartida `audit_logs`. Tambien expone CRUD HTTP en `/audit`,
protegido por sesion valida, sin exigir roles o permisos adicionales. Consulta
[CRUD.md](../CRUD.md) para cuerpos, validaciones y ejemplos.

## Configuracion y arranque

Desde la raiz del proyecto:

```powershell
cd database
npm ci
npm run build
cd ../audit-service
npm ci
```

`DATABASE_URL` se carga desde `database/.env`, compartido con auth-service y los
otros servicios. Una variable explicita del proceso o Docker tiene prioridad.
Las tablas compartidas deben existir.

Integra las otras variables de `.env.example` en el `.env` del servicio:

- `PORT=3006`: evita usar el puerto 3000 de auth-service.
- `AUTH_SERVICE_URL=http://localhost:3000`: servicio que verifica las sesiones HTTP.
- `RABBITMQ_URL`: mismo broker/vhost que usa auth-service.
- `AUTH_AUDIT_QUEUE=audit_queue`: debe coincidir en ambos servicios.
- `AUDIT_REJECTED_QUEUE=audit_queue.invalid`: cola durable para recibos de rechazo.
- `AUDIT_PREFETCH_COUNT=10`: limita mensajes simultaneos sin confirmar.
- `AUDIT_RETRY_DELAY_MS=1000`: pausa antes de reencolar si la persistencia falla.

```powershell
npm run start:dev
```

El arranque espera la conexion del consumidor RabbitMQ antes de abrir el puerto HTTP.
La ruta HTTP raiz existente se conserva. No es una comprobacion continua de disponibilidad.
La implementacion no aplica migraciones remotas ni modifica credenciales. No requiere
una migracion adicional: usa `audit_logs.id` como identificador unico del evento.

## Contrato y persistencia

Se consume el patron NestJS `audit.auth.record` de la cola durable configurada.
El contrato version 1 es el publicado en `auth-service/README.md`.
Kafka sigue disponible para otros suscriptores; este servicio consume RabbitMQ para
evitar dos caminos de escritura del mismo evento.

Se validan version, origen, accion, UUID, fecha ISO, longitudes, codigos de motivo y
campos permitidos antes de tocar la base.

| Evento                                               | audit_logs                                    |
| ---------------------------------------------------- | --------------------------------------------- |
| eventId                                              | id (clave primaria para deduplicacion)        |
| userId                                               | user_id, o null si la cuenta ya fue eliminada |
| action                                               | action                                        |
| sessionId                                            | entity_id, con entity = user_sessions         |
| occurredAt                                           | created_at                                    |
| ipAddress                                            | ip_address                                    |
| source, version, userAgent, reason                   | metadata                                      |
| userId original, hash del evento, fecha de recepcion | metadata                                      |

Las cuentas existentes se bloquean con `FOR KEY SHARE` durante la insercion para
proteger la relacion frente a eliminaciones concurrentes. Si el usuario ya no existe,
su identificador original permanece en metadata sin bloquear indefinidamente la entrega.

El consumidor confirma (`ack`) solo despues del commit. Una repeticion identica del
evento no crea otro registro. Reutilizar el mismo `eventId` con contenido diferente
genera un rechazo y conserva intacto el registro anterior.

## Fallos y rechazos

- Fallo de base de datos: espera configurada y `nack(requeue=true)`. No se confirma ni
  descarta el evento. El prefetch limita el trabajo pendiente. El broker puede volver
  a entregar mensajes al reiniciar el consumidor.
- Evento invalido, envelope desconocido, JSON no valido o ID en conflicto: se publica
  un recibo persistente en la cola de rechazos; solo despues de la confirmacion del
  broker se confirma el mensaje original.
- Si falla publicar el rechazo, el original se reencola.
- El recibo contiene `source`, `reason`, un `digest` SHA-256 del mensaje y
  `rejectedAt`. No copia el payload original, que podria contener credenciales.
  Por ello no es una cola de reproduccion automatica: permite detectar/reconciliar
  errores del productor consultando su outbox por separado.
- Las entregas y los recibos pueden repetirse. La tabla de auditoria es idempotente
  por `eventId`; los recibos se pueden agrupar por `digest`.

Las colas de entrada mantienen los mismos atributos que el productor (durable, sin
argumentos nuevos). No se necesita recrear una cola existente para agregar un DLX.

RabbitMQ debe estar en una red privada, con credenciales y permisos de publicacion
asignados a los servicios apropiados: el campo `source` del evento no autentica al
productor por si solo.

## Pruebas

```powershell
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Para probar la integracion completa, inicia Docker Desktop y ejecuta desde audit-service:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/run-integration.ps1
```

La opcion ExecutionPolicy se aplica solo a ese proceso; no modifica la politica del equipo.
El script crea PostgreSQL y RabbitMQ temporales con puertos aleatorios accesibles solo
en localhost, compila la base y auth-service, ejecuta el publicador real de auth-service
contra el consumidor real de audit-service y elimina ambos contenedores al finalizar.
Las pruebas validan persistencia, duplicados concurrentes, usuario eliminado, eventos
en conflicto, rechazos sin datos sensibles, envelopes malformados y reentrega despues
de un fallo transitorio. No usan Neon ni los brokers habituales del proyecto.

Referencias: [RabbitMQ en NestJS](https://docs.nestjs.com/microservices/rabbitmq) y
[confirmaciones de RabbitMQ](https://www.rabbitmq.com/docs/confirms).
