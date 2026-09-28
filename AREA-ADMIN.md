# CRUD del administrador de area

Para gestionar avatares de usuarios e imagenes de recursos de tu area,
consulta [IMAGES.md](IMAGES.md).

El rol exacto `administrador` tiene controladores separados de los del
`superadministrador`:

| Servicio          | Puerto | Ruta                                |
| ----------------- | ------ | ----------------------------------- |
| resources-service | 3003   | `/area-admin/areas/:area/resources` |
| users-service     | 3005   | `/area-admin/areas/:area/users`     |
| audit-service     | 3006   | `/area-admin/areas/:area/audit`     |

`:area` acepta el UUID o el nombre exacto del area (codificado en la URL).
Los tres controladores ofrecen POST, GET con `page`/`limit`, GET `/:id`, PATCH `/:id`
y DELETE `/:id`. Cada peticion requiere `Authorization: Bearer <accessToken>`.

Los listados tambien admiten busqueda, filtros y ordenamiento; usuarios/recursos
tienen `/by-name/:name` y auditoria `/by-action/:action`. Consulta [SEARCH.md](SEARCH.md).

## Autorizacion

`AuthSessionGuard` valida la sesion y `AreaAdminGuard` comprueba en la base:

1. El usuario y su rol estan activos, y `roles.name` es exactamente `administrador`.
2. `users.area_id` referencia el area solicitada y esta activa.
3. Existe un permiso activo unido a ese rol mediante
   `role_permissions.role_id` y `role_permissions.permission_id`.
4. `permissions.module` coincide exactamente con `areas.name` (incluidas
   mayusculas, espacios y acentos). No se compara con `permissions.name` ni con `key`.

Un permiso que cumpla esa relacion habilita las cinco operaciones del CRUD por
area. No se aceptan permisos o roles declarados por el cliente. Si varios
administradores comparten rol, cada uno sigue limitado a su propia `users.area_id`.

El servidor asigna `areaId` al crear. Si el cuerpo incluye `areaId` o `areaName`,
deben coincidir con el area autorizada. Las lecturas, conteos, actualizaciones y
borrados filtran por `area_id` en SQL. Un ID de otra area devuelve `404`, y solicitar
un area no asignada devuelve `403`. No se pueden mover registros de area.
Se revalida y bloquea la relacion de autorizacion durante cada transaccion; los
cambios de asignacion, permisos o nombre del area afectan las siguientes peticiones.

## Ejemplo

Para activar/desactivar usuarios no administrativos de tu area, usa sin cuerpo:

- `PATCH /area-admin/areas/:area/users/:id/activate`
- `PATCH /area-admin/areas/:area/users/:id/deactivate`

Devuelven el usuario actualizado con `isActive`. Estas operaciones no permiten
gestionar usuarios administrativos ni de otras areas. Recursos y auditoria no
tienen `isActive`, por lo que no incluyen estas acciones.

Para un usuario asignado al area `Finanzas`, cuyo rol `administrador` tenga
un permiso con `module: "Finanzas"`:

```http
POST http://localhost:3003/area-admin/areas/Finanzas/resources
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "name": "Presupuesto anual",
  "type": "DOCUMENT",
  "areaName": "Finanzas"
}
```

El CRUD de usuarios usa los campos documentados en [CRUD.md](CRUD.md), pero
`areaId` lo asigna el servidor y el `roleId` de una creacion debe corresponder a un
rol activo no administrativo. No permite cambiar `roleId`, ni modificar/borrar
administradores o superadministradores, incluido el propio administrador de area.
`googleSub` sigue siendo inmutable. Crear un usuario no evita verificar su identidad
en Google.

Los controladores globales `/admin/...` y sus rutas originales siguen siendo
exclusivos de `superadministrador`. Ese rol usa sus propios controladores; no
requiere area ni permiso de modulo. Areas, roles y permisos se gestionan
mediante esos controladores globales. El administrador de area puede gestionar
auditoria de su area; los registros sin area asignada solo se gestionan desde los
controladores globales. Los metadatos internos de entrega de auditoria se conservan
y no se pueden sobrescribir. Borrar una auditoria no borra el evento de Kafka ni
evita una nueva entrega de RabbitMQ. Esta implementacion no cambia asignaciones
ni datos existentes en la base y no requiere nuevas variables de entorno.

## Pruebas

Compila database, auth-service y los seis servicios. Ejecuta
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-crud.ps1`.
El script incorpora `scripts/test-area-access.cjs` y verifica el CRUD por area,
relaciones de permisos, revocacion, intentos de acceso a datos ajenos y de elevacion
de rol, usando JWT reales y PostgreSQL temporal. No utiliza Neon ni modifica la
base configurada en `database/.env`.
