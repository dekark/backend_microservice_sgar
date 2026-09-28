# Configuración de Amazon S3 en Producción / Cloud

Tu proyecto ya tiene el código completamente integrado con `@aws-sdk/client-s3` y URLs firmadas temporales para avatares, fotos de recursos y archivos adjuntos.

Actualmente funciona con el emulador local (`scripts/local-s3.cjs` o contenedor `s3` en el puerto 9000).

Para activar tu bucket real en Amazon S3 sin romper nada, sigue estos pasos:

---

## 1. Crear el Bucket en Amazon S3 (Consola AWS)

1. En la consola de AWS ve a **Amazon S3** > **Create bucket**.
2. **Bucket name**: Elige un nombre globalmente único (ejemplo: `mi-proyecto-capstone-media-2026`).
3. **AWS Region**: Selecciona tu región preferida (ejemplo: `us-east-1` o `sa-east-1`).
4. **Block Public Access**: **Mantén todo marcado (activado)**.
   * *Razón*: El backend maneja el acceso mediante URLs firmadas privadas (`getSignedUrl`), por lo que el bucket **NO** debe ser público.
5. **Bucket Versioning**: Opcional (recomendado para producción).
6. **Default encryption**: SSE-S3 (Amazon S3-managed keys) - AES256.
7. Haz clic en **Create bucket**.

---

## 2. Configurar CORS en el Bucket (Opcional pero recomendado para Angular)

Si el frontend descarga o visualiza imágenes directamente desde las URLs firmadas:
En tu bucket > pestaña **Permissions** > **Cross-origin resource sharing (CORS)** > **Edit**:

```json
[
  {
    "AllowedHeaders": [
      "*"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD"
    ],
    "AllowedOrigins": [
      "http://localhost:4200",
      "https://tudominio.com"
    ],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "Content-Type"
    ],
    "MaxAgeSeconds": 3000
  }
]
```

---

## 3. Política IAM de Acceso Mínimo

Crea un usuario IAM (o asigna un Rol IAM si ejecutas en EC2/ECS) con la siguiente política para restringir el acceso únicamente a los directorios que usa el proyecto (`media/` y `files/`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CapstoneS3Access",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::NOMBRE_DE_TU_BUCKET/media/*",
        "arn:aws:s3:::NOMBRE_DE_TU_BUCKET/files/*"
      ]
    }
  ]
}
```

---

## 4. Cómo Activar AWS S3 Real en el Proyecto

### Opción A: Ejecución en desarrollo local (fuera de Docker)
En `resources-service/.env` y `users-service/.env`, ya tienes el bloque listo con tu bucket `proyecto-capstone`.
Solo debes descomentar estas líneas:

```env
S3_MEDIA_BUCKET='proyecto-capstone'
AWS_REGION='us-east-1'
AWS_ACCESS_KEY_ID='<tu_access_key>'
AWS_SECRET_ACCESS_KEY='<tu_secret_key>'
AWS_SESSION_TOKEN='<tu_session_token>'
```
*(Nota: Asegúrate de que `S3_ENDPOINT` permanezca comentado para que el SDK conecte a AWS y no al emulador local).*

> **Nota para AWS Academy**: Cada vez que inicies un nuevo laboratorio en Vocareum, ve a **AWS Details** > **AWS CLI** > **Show** y actualiza el `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y `AWS_SESSION_TOKEN` en tus archivos `.env`.

---

### Opción B: Ejecución en Docker (`docker-compose.yml`)
En `docker-compose.yml`, en los servicios `resources` y `users`:
1. Comenta las líneas del modo local (`S3_ENDPOINT: http://s3:9000`, etc.).
2. Descomenta el bloque de AWS real configurando las variables correspondientes.
