# Recursos del usuario de area

Las fotos se suben y reemplazan mediante
`/area-user/areas/:area/resources/:id/image`; el archivo principal usa `/file`
y el enlace `/url`. Estas rutas admiten cualquier rol autenticado de la misma area,
sin exigir `usuario normal`; consulta [IMAGES.md](IMAGES.md).

El rol exacto `usuario normal` puede gestionar recursos de su area asignada mediante
`http://localhost:3003/area-user/areas/:area/resources`.
`:area` acepta el UUID o el nombre exacto del area, codificado en la URL.

El listado admite filtros, busqueda y ordenamiento, y `/by-name/:name` permite
consultar por nombre dentro de tu area. Detalles en [SEARCH.md](SEARCH.md).

| Metodo | Ruta                                               | Operacion |
| ------ | -------------------------------------------------- | --------- |
| POST   | `/area-user/areas/:area/resources`                 | Crear     |
| GET    | `/area-user/areas/:area/resources?page=1&limit=20` | Listar    |
| GET    | `/area-user/areas/:area/resources/:id`             | Consultar |
| PATCH  | `/area-user/areas/:area/resources/:id`             | Modificar |
| DELETE | `/area-user/areas/:area/resources/:id`             | Eliminar  |

Todas requieren `Authorization: Bearer <accessToken>`. `AuthSessionGuard` valida
la sesion; `AreaUserGuard` comprueba en la base que usuario, rol y area esten activos,
que el rol se llame `usuario normal` y que `users.area_id` corresponda al area solicitada.
No se exige un permiso por modulo para estas rutas. La constante `AREA_USER_ROLE`
en `database/src/area-crud.ts` define el nombre del rol para el guard y la base.

El acceso comprende todos los recursos del area, aunque los haya creado otro
usuario. El servidor asigna `areaId` y `createdById` al crear. No permite mover
recursos a otra area ni cambiar su creador. Todas las consultas, conteos y
escrituras filtran por `area_id`, y la autorizacion se vuelve a comprobar dentro
de cada transaccion. Los cambios de rol, estado o asignacion de area afectan la
siguiente peticion con el mismo token.

Un recurso de otra area devuelve `404`. Un area no asignada, rol incorrecto o
usuario/rol/area inactivo devuelve `403`; una sesion invalida devuelve `401`.
Un cuerpo o paginacion invalida devuelve `400`.

Ejemplo (el usuario debe estar asignado al area `Finanzas`):

```http
POST http://localhost:3003/area-user/areas/Finanzas/resources
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "name": "Informe mensual",
  "type": "DOCUMENT",
  "url": "https://example.com/informe.pdf"
}
```

Los campos de recursos y limites de paginacion son los de [CRUD.md](CRUD.md).
`areaId` es opcional en estas rutas; si se envia debe coincidir con la asignacion.
Tambien se acepta `areaName` si coincide exactamente. Se gestionan metadatos de
recursos; estas operaciones no suben ni borran objetos en S3.

Este controlador no concede acceso a usuarios, auditoria, roles, permisos ni areas.
Los administradores y superadministradores conservan sus controladores actuales.
No se crean roles, usuarios o asignaciones automaticamente en la base compartida.

## Verificacion

Tras compilar database y los microservicios, ejecuta
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-crud.ps1`.
Incluye `scripts/test-area-user.cjs`: CRUD de recursos propios y de companeros,
aislamiento entre areas, cambios de rol y asignacion, revocacion de sesiones y
rechazo de acceso administrativo. Usa PostgreSQL temporal local, no Neon.
