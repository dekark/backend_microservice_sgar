# Google en el frontend, autenticacion propia en el backend

Angular muestra el boton de Google Identity Services y recibe un ID token en
`CredentialResponse.credential`. Lo envia como JSON a `POST /auth/google`:

```json
{ "idToken": "<credential recibido de Google>" }
```

El backend valida la firma, el emisor, la audiencia y el vencimiento mediante
`google-auth-library`. Tambien exige un correo verificado y usa `sub` para
identificar la cuenta. Este uso de la libreria sirve para verificar el token;
el inicio de sesion con Google se realiza en el navegador.

Tras validarlo, auth-service comprueba el usuario y su rol activo, crea la sesion
y devuelve `accessToken`, `refreshToken`, `sessionId` y el perfil. Los eventos
se guardan en el outbox para entregarlos a Kafka y RabbitMQ.

## Configuracion

En Angular configura el Client ID publico de tu aplicacion web de Google.
Registra el origen del frontend en los origenes JavaScript autorizados de Google.
En `auth-service/.env` configura:

```dotenv
AUTH_GOOGLE_ENABLED=true
GOOGLE_CLIENT_ID=<mismo Client ID publico configurado en Angular>
FRONTEND_ORIGIN=http://localhost:4200
```

Reemplaza el marcador por tu identificador real antes de habilitar el login.
El backend necesita el Client ID para comprobar la audiencia `aud` del token.
Este flujo no necesita Client Secret; no agregues secretos de Google al frontend.
No requiere rutas de inicio o callback de OAuth en el backend.

`JWT_SECRET` sigue siendo privado del backend. La conexion a la base se lee de
`database/.env`. Para registrar cuentas nuevas, configura `AUTH_DEFAULT_ROLE_ID`
con un rol activo existente; si esta ausente solo acceden cuentas ya registradas
por su `google_sub`. Los roles y permisos los determina la base de datos.

Para Docker local configura el mismo Client ID y `AUTH_GOOGLE_ENABLED=true`
en `.env.auth-local`. En AWS configura las variables equivalentes en el servicio
que ejecuta Nest y usa el origen HTTPS real de Angular en `FRONTEND_ORIGIN`.

## Envio desde Angular

Dentro del callback de Google Identity Services, usa tu `HttpClient` de Angular:

```typescript
// response es el CredentialResponse entregado por Google Identity Services.
this.http.post(`${authApiUrl}/auth/google`, {
  idToken: response.credential,
}).subscribe({
  next: (session) => {
    // Entrega la sesion al servicio de autenticacion de tu frontend.
  },
  error: () => {
    // Muestra el error de inicio de sesion en la interfaz.
  },
});
```

`authApiUrl` apunta a `http://localhost:3000` en desarrollo, o a la URL publica
del API Gateway en AWS, incluyendo el prefijo del stage si corresponde.
El cuerpo debe contener el ID token, no un codigo de autorizacion ni un access
token para consumir APIs de Google. El envio es JSON desde el callback JavaScript;
no se configura Google para enviar un formulario directamente a este endpoint.

Para las siguientes peticiones a los microservicios envia el JWT propio recibido:

```http
Authorization: Bearer <accessToken devuelto por auth-service>
```

## Endpoints

| Metodo | Ruta | Uso |
| --- | --- | --- |
| POST | `/auth/google` | Valida `{ idToken }` y crea la sesion |
| POST | `/auth/refresh` | Rota `{ refreshToken }` y entrega tokens propios nuevos |
| GET | `/auth/me` | Perfil y permisos actuales |
| GET | `/auth/sessions` | Sesiones activas del usuario |
| POST | `/auth/logout` | Revoca la sesion actual |
| POST | `/auth/logout-all` | Revoca todas las sesiones del usuario |
| DELETE | `/auth/sessions/:sessionId` | Revoca una sesion propia |

Excepto login y refresh, estas rutas requieren el Bearer propio de la aplicacion.

## Comprobacion

Desde la raiz:

```powershell
npm --prefix auth-service test -- --runInBand
npm --prefix auth-service run test:e2e -- --runInBand
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-auth.ps1
```

El ultimo comando necesita Docker y crea una base PostgreSQL temporal local,
que elimina al terminar. Las pruebas simulan la validacion de Google y comprueban
sesiones, refresh, permisos y eventos persistidos; no prueban un login real en Google.

Referencia: [validacion del ID token en el servidor, documentacion de Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
