import { HttpErrorResponse } from '@angular/common/http';
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return 'No se pudo conectar con el servicio. Comprueba que el backend esté disponible.';
    if (error.status === 403) return 'Tu rol, permiso o área no permite realizar esta operación.';
    if (error.status === 401) return 'Tu sesión ha vencido. Vuelve a iniciar sesión.';
    if (error.status === 429)
      return 'Has realizado demasiadas peticiones. Espera un momento y vuelve a intentarlo.';
    if (error.status >= 500)
      return 'El servicio no está disponible en este momento. Inténtalo de nuevo.';
    const message: unknown = error.error?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && message.every((m) => typeof m === 'string'))
      return message.join(' · ');
    return `No se pudo completar la operación (${error.status}).`;
  }
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}
