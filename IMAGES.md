# Avatares, imagenes y archivos de recursos

Las rutas siguientes aceptan `multipart/form-data` con un unico campo **file**.
Usan `Authorization: Bearer <accessToken>` y admiten:

- **POST**: subir una imagen (o reemplazar la existente), respuesta `200`.
- **PUT**: reemplazar la imagen, respuesta `200`.
- **GET**: obtener metadatos y una URL firmada de lectura valida por 300 segundos.
- **DELETE**: quitar la imagen, respuesta `204` (tambien si ya estaba vacia).

| Servicio                | Ruta                                          | Acceso                                                                                                                      |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| users-service, 3005     | `/users/me/avatar`                            | Cualquier usuario con sesion valida; solo su propio avatar                                                                  |
| users-service, 3005     | `/admin/users/:id/avatar`                     | Superadministrador                                                                                                          |
| users-service, 3005     | `/users/:id/avatar`                           | Superadministrador                                                                                                          |
| users-service, 3005     | `/area-admin/areas/:area/users/:id/avatar`    | Administrador con permiso de modulo; solo usuarios de su area; no puede modificar avatares de otras cuentas administrativas |
| resources-service, 3003 | `/admin/resources/:id/image`                  | Superadministrador                                                                                                          |
| resources-service, 3003 | `/resources/:id/image`                        | Cualquier usuario autenticado de la misma area; superadministrador en cualquier area                                        |
| resources-service, 3003 | `/area-admin/areas/:area/resources/:id/image` | Administrador con permiso de modulo y area asignada                                                                         |
| resources-service, 3003 | `/area-user/areas/:area/resources/:id/image`  | Cualquier usuario autenticado de la misma area, sin exigir nombre de rol ni permiso de modulo                               |

Las rutas por area admiten ID o nombre exacto, como los CRUD existentes.
El avatar propio no requiere area asignada. Los roles y areas se comprueban de nuevo
antes de guardar los metadatos, para impedir que un cambio de asignacion durante
la subida permita modificar un registro ajeno.

Las rutas generales de imagen y archivo de recursos requieren usuario y rol activos,
y un area activa asignada que coincida con la del recurso. No exigen que el rol se
llame `usuario normal` ni `administrador`. El superadministrador conserva acceso
global. Los CRUD generales y las rutas administrativas mantienen sus guards.

## Archivo principal o URL del recurso

El recurso debe existir antes de adjuntar su contenido. En resources-service (3003):

| Metodo     | Ruta                  | Funcion                                                                                                             |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| POST / PUT | `/resources/:id/file` | Subir o reemplazar el archivo principal, multipart con campo `file`                                                 |
| GET        | `/resources/:id/file` | Consultar contenido; si hay archivo devuelve `file`, `downloadUrl` y `expiresIn: 300`; si hay enlace devuelve `url` |
| DELETE     | `/resources/:id/file` | Eliminar el archivo o enlace principal, sin borrar el recurso ni su portada                                         |
| PUT        | `/resources/:id/url`  | Guardar JSON `{ "url": "https://..." }`                                                                             |

Estas rutas estan disponibles para cualquier usuario autenticado de la misma area,
sin un nombre de rol especifico. Tambien existen bajo:

- `/area-user/areas/:area/resources/:id/file` y `/url`: el mismo acceso por area.
- `/admin/resources/:id/file` y `/url`: superadministrador.
- `/area-admin/areas/:area/resources/:id/file` y `/url`: administrador con permiso del modulo de su area.

El archivo principal admite hasta **25 MiB**, conserva sus bytes originales y se
clasifica por su contenido con `file-type`; no confia en el MIME enviado por el cliente.
Se comprueba el tipo que ya tiene el recurso en PostgreSQL:

| Tipo del recurso                          | Contenido admitido                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCUMENT                                  | PDF, Office/OpenDocument reconocidos, EPUB/MOBI y texto UTF-8 (TXT, CSV, JSON, XML, HTML, Markdown, etc.). Office antiguo usa contenedor CFB y extension DOC/XLS/PPT/MSG. |
| IMAGE                                     | Formatos de imagen reconocidos (incluye GIF, JPEG, PNG, WebP, TIFF, AVIF, etc.) y SVG textual. Se conserva el original, sin conversion.                                   |
| VIDEO                                     | Formatos reconocidos como video, por ejemplo MP4, WebM, AVI y MOV.                                                                                                        |
| FILE, SOFTWARE, LICENSE, EQUIPMENT, OTHER | Cualquier formato binario o textual, incluidos archivos comprimidos, instaladores y formatos propios. Los desconocidos se guardan como `application/octet-stream`.        |
| LINK                                      | Una URL HTTP/HTTPS; rechaza subidas de archivos.                                                                                                                          |

Los tipos distintos de LINK tambien pueden usar una URL HTTP/HTTPS. No se descarga
ni inspecciona el destino: se almacena el enlace. Se rechazan otros protocolos y
URLs con credenciales. Si un formato no se reconoce como imagen/video/documento,
puede almacenarse en una categoria generica como FILE.

Guardar una URL sustituye el archivo principal y limpia el objeto administrado
anterior. Subir un archivo sustituye la URL. Ambas operaciones conservan la portada.
Si el tipo o el acceso cambia durante una subida, se rechaza la escritura y se
intenta limpiar el objeto recien subido.

Los archivos se guardan bajo `files/resources/:id/UUID` en el mismo bucket.
Las URLs firmadas fuerzan descarga (`attachment`, `application/octet-stream`),
tambien para HTML, SVG y ejecutables. La deteccion clasifica el formato; no comprueba
que un video sea reproducible ni ejecuta o transforma el archivo.

```bash
curl -X PUT http://localhost:3003/resources/RESOURCE_ID/file \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -F "file=@manual.pdf"

curl -X PUT http://localhost:3003/resources/RESOURCE_ID/url \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/manual.pdf"}'
```

Se usan los campos existentes `s3Bucket`, `s3Key`, `originalFileName`, `mimeType`,
`fileSize` y `url`; este cambio no agrega otra migracion.

## Formatos de avatar/portada y almacenamiento

Se aceptan JPEG, PNG y WebP de hasta **5 MiB** y **16 megapixeles**, sin animacion.
Se decodifica la imagen real y se comprueba que su formato coincida con el MIME.
No se admiten SVG ni archivos que solo cambien su extension. Sharp corrige la
orientacion, limita avatares a 512 x 512 y fotos de recursos a 1600 x 1600,
conserva proporciones y genera WebP sin los metadatos del original.

El backend elige el bucket y genera una clave UUID bajo `media/users/:id/` o
`media/resources/:id/`. No acepta bucket, clave ni ruta en el formulario.
No publica ACL publicas; el bucket debe tener Block Public Access habilitado.
Las URLs firmadas permiten leer a quien posea el enlace hasta su expiracion;
no se deben guardar como URL permanente. Solicita otra con GET cuando sea necesario.

Al reemplazar, se guarda la nueva referencia en PostgreSQL y se intenta borrar
el objeto anterior si pertenece al prefijo administrado de ese registro. Si falla
la escritura en base, se limpia la nueva subida cuando se confirma que no esta
referenciada. Los fallos de limpieza se registran; pueden dejar objetos huerfanos
que requieren reconciliacion. Borrar un usuario/recurso mediante el CRUD general
no elimina sus objetos de S3: quita su imagen primero con DELETE en estas rutas.
Los objetos heredados fuera del prefijo administrado no se borran automaticamente.

El avatar usa los campos existentes `avatarS3Bucket`, `avatarS3Key`,
`avatarMimeType` y `avatarFileSize`. La foto del recurso usa campos nuevos
`imageS3Bucket`, `imageS3Key`, `imageMimeType` y `imageFileSize`.
Esto permite poner foto a un documento, equipo o producto representado como recurso
sin sobrescribir su `url`, tipo o archivo principal (`s3Bucket`/`s3Key`). No se ha
creado una entidad separada de productos ni una galeria de multiples fotos.

## Configuracion

1. Aplica la migracion `database/drizzle/0002_resource_images.sql` mediante el
   flujo de migraciones del proyecto. Se incluyo su snapshot y registro Drizzle.
   No se aplica automaticamente a la base compartida. Usa `drizzle-kit migrate`
   desde `database` cuando corresponda aplicar las migraciones pendientes.
2. En los `.env` de users-service y resources-service configura `AWS_REGION` y
   `S3_MEDIA_BUCKET` con la region y el bucket reales. No se inventaron valores
   ni se agregaron credenciales al repositorio.
3. Usa el perfil AWS local (`AWS_PROFILE`) o la cadena de credenciales del SDK.
   En AWS, asigna un rol IAM al servicio con `s3:PutObject`, `s3:GetObject` y
   `s3:DeleteObject` sobre los prefijos `media/` y `files/resources/` del bucket. Los objetos se
   escriben con cifrado SSE-S3 (`AES256`).
4. `S3_ENDPOINT` es opcional para almacenamiento compatible local; en AWS omitelo.
5. Instala dependencias (`npm ci`) y compila database y ambos servicios. Se agrego
   `sharp` a users-service y resources-service, y `file-type` a resources-service. Reinicia los servicios.

Sin bucket o region las operaciones que requieren S3 devuelven `503` con un
mensaje de configuracion. La API no crea buckets ni asigna permisos AWS.
El frontend envia el archivo al backend, por lo que no necesita credenciales AWS
ni un PUT directo al bucket. Ajusta los limites del proxy/gateway para multipart
de hasta 25 MiB mas las cabeceras del formulario para archivos (5 MiB para imagenes).
El limite efectivo sera el menor entre el servicio y el proxy/gateway desplegado.

## Ejemplos

```bash
curl -X PUT http://localhost:3005/users/me/avatar \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -F "file=@avatar.png;type=image/png"

curl -X POST http://localhost:3003/area-user/areas/AREA_ID/resources/RESOURCE_ID/image \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -F "file=@producto.jpg;type=image/jpeg"
```

Para mostrar la imagen, haz GET a la misma ruta y utiliza `url` en el elemento
`img` del frontend. POST/PUT devuelve `{ bucket, key, mimeType, fileSize }`;
GET agrega `{ url, expiresIn: 300 }`.

## Pruebas

`scripts/test-crud.ps1` aplica las migraciones en PostgreSQL temporal y prueba
subida, reemplazo, lectura, borrado, limites, formatos invalidos, permisos y
cambios de area durante la subida. Usa sharp real y AWS SDK con una simulacion
HTTP local de S3; no prueba IAM ni sube archivos al S3 real. No usa Neon.
