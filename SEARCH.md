# CRUD, paginacion y busqueda

Los seis modulos de negocio (roles, permisos, areas, usuarios, recursos y auditoria)
ofrecen las mismas operaciones basicas. Cada ruta usa el puerto de su servicio.

| Metodo | Ruta relativa a la coleccion | Operacion                                                                    |
| ------ | ---------------------------- | ---------------------------------------------------------------------------- |
| POST   | `/`                          | Crear un registro                                                            |
| GET    | `/?page=1&limit=20`          | Listar con paginacion, busqueda y filtros                                    |
| GET    | `/:id`                       | Ver un registro por ID; `404` si no existe o no pertenece al area autorizada |
| GET    | `/by-name/:name`             | Buscar coincidencias exactas de nombre sin distinguir mayusculas             |
| PATCH  | `/:id`                       | Editar los campos enviados                                                   |
| DELETE | `/:id`                       | Eliminar el registro                                                         |

Auditoria no tiene `name`: usa **`/audit/by-action/:action`** en lugar de `by-name`.
Las consultas por nombre/accion devuelven una lista paginada, porque los nombres de
usuarios y recursos y las acciones de auditoria pueden repetirse. Sin coincidencias,
responden `200` con `data: []` y `total: 0`. Codifica el nombre con `encodeURIComponent`.

## Colecciones y permisos

| Servicio            | Puerto | Coleccion global |
| ------------------- | ------ | ---------------- |
| roles-service       | 3001   | `/roles`         |
| permissions-service | 3002   | `/permissions`   |
| resources-service   | 3003   | `/resources`     |
| areas-service       | 3004   | `/areas`         |
| users-service       | 3005   | `/users`         |
| audit-service       | 3006   | `/audit`         |

Los CRUD globales y sus alias `/admin/...` requieren autenticacion y rol
`superadministrador`. Las consultas nuevas tambien estan disponibles en:

- `/area-admin/areas/:area/resources`, `/users` y `/audit`: administrador con
  area asignada y permiso cuyo modulo coincide con el nombre del area.
- `/area-user/areas/:area/resources`: rol `usuario normal` con area asignada.

Las rutas de archivos/imagenes y avatar mantienen sus reglas descritas en
[IMAGES.md](IMAGES.md). Autenticacion, sesiones y tokens siguen gestionados por
auth-service; no se exponen mediante estos CRUD.

Las consultas por area siempre agregan el filtro de area autorizado en SQL,
tanto al listado como al conteo. Un filtro `areaId` de otra area devuelve `403`;
buscar por nombre o ID nunca amplia el acceso.

## Parametros comunes

| Parametro     | Uso                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `page`        | Pagina desde 1, predeterminado 1, maximo 10000                                                                                           |
| `limit`       | Registros por pagina, predeterminado 20, maximo 100                                                                                      |
| `q`           | Texto parcial de hasta 200 caracteres, sin distinguir mayusculas                                                                         |
| `sortBy`      | Campo de orden: cualquiera de los filtros de la tabla siguiente, `createdAt` o `updatedAt` (excepto auditoria, que no tiene `updatedAt`) |
| `order`       | `asc` o `desc`, predeterminado `desc`                                                                                                    |
| `createdFrom` | Fecha minima de creacion, inclusiva, ISO UTC: `2026-01-01T00:00:00Z`                                                                     |
| `createdTo`   | Fecha maxima de creacion, inclusiva, ISO UTC: `2026-12-31T23:59:59.999Z`                                                                 |

Por defecto se ordena por `createdAt desc`. El ID desempata el orden; los valores
nulos quedan al final. Se aceptan milisegundos en las fechas, siempre con sufijo `Z`.
Los parametros desconocidos, repetidos, vacios o invalidos devuelven `400`.

`q` trata `%`, `_` y `!` literalmente. No permite insertar comodines SQL.
La busqueda ignora mayusculas, pero no elimina acentos. Los filtros se combinan
con AND; `q` busca con OR dentro de sus campos.

| Modulo      | Filtros exactos                                                                         | Campos recorridos por `q`                   |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| roles       | `id`, `name`, `isActive`                                                                | Nombre, descripcion                         |
| permissions | `id`, `name`, `key`, `module`, `isActive`                                               | Nombre, clave, modulo, descripcion          |
| areas       | `id`, `name`, `isActive`                                                                | Nombre, descripcion                         |
| users       | `id`, `name`, `email`, `roleId`, `areaId`, `isActive`                                   | Nombre, correo                              |
| resources   | `id`, `name`, `areaId`, `type`, `status`, `createdById`, `mimeType`, `originalFileName` | Nombre, descripcion, nombre de archivo, URL |
| audit       | `id`, `action`, `entity`, `entityId`, `areaId`, `userId`                                | Accion, entidad, ID de entidad              |

Los filtros de texto son exactos sin distinguir mayusculas. `type` y `status`
deben usar los valores del esquema en mayusculas. `isActive` acepta `true` o `false`.
`id` es entero positivo en roles/permisos y UUID en las demas colecciones.
`roleId` es entero positivo; los demas IDs de relaciones son UUID.
`areaId=null` permite buscar usuarios/auditoria sin area, y `userId=null` auditoria
sin usuario (solo en el CRUD global).

## Ejemplos

Todas las peticiones usan `Authorization: Bearer <accessToken>`.

```http
GET http://localhost:3003/resources?page=1&limit=10&q=manual&type=DOCUMENT&status=ACTIVE&sortBy=name&order=asc
GET http://localhost:3005/admin/users?isActive=true&roleId=2&page=2&limit=20
GET http://localhost:3002/permissions?module=Finanzas&q=leer
GET http://localhost:3001/roles/by-name/administrador
GET http://localhost:3004/areas/by-name/Finanzas
GET http://localhost:3003/resources/RESOURCE_UUID
GET http://localhost:3003/area-user/areas/Finanzas/resources/by-name/Manual%20interno
GET http://localhost:3006/area-admin/areas/Finanzas/audit/by-action/auth.login
GET http://localhost:3006/admin/audit?action=auth.login&createdFrom=2026-01-01T00:00:00Z
```

Respuesta paginada:

```json
{
  "data": [{ "id": "...", "name": "Manual interno" }],
  "page": 1,
  "limit": 10,
  "total": 23,
  "totalPages": 3,
  "hasNextPage": true,
  "hasPreviousPage": false
}
```

`total` cuenta solo las coincidencias autorizadas que cumplen todos los filtros.
Una pagina posterior a la ultima devuelve `data: []` y conserva ese total.
Los cuerpos de creacion y edicion se documentan en [CRUD.md](CRUD.md),
[AREA-ADMIN.md](AREA-ADMIN.md) y [AREA-USER.md](AREA-USER.md).

## Validacion

`scripts/test-crud.ps1` incluye `scripts/test-search.cjs`: usa PostgreSQL temporal
y sesiones/JWT reales para comprobar filtros, paginas, nombres repetidos,
validacion de parametros, orden de rutas y aislamiento de areas. No utiliza Neon.
El cambio no necesita nuevas columnas ni migraciones.
