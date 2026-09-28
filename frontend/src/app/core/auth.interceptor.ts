import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { ConfigService } from './config';
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const config = inject(ConfigService);
  if (!config.owns(request.url)) return next(request);
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.accessToken();
  const generation = auth.sessionVersion;
  const authorized = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;
  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (
        generation !== auth.sessionVersion ||
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        !token
      )
        return throwError(() => error);
      // Parallel 401 responses share one refresh. A late response uses the already rotated token.
      const refreshed =
        auth.accessToken() && auth.accessToken() !== token
          ? Promise.resolve(auth.accessToken()!)
          : auth.renew();
      return from(refreshed).pipe(
        switchMap((value) =>
          generation === auth.sessionVersion
            ? next(request.clone({ setHeaders: { Authorization: `Bearer ${value}` } }))
            : throwError(() => Error('La sesión cambió.')),
        ),
        catchError((failure: unknown) => {
          if (
            failure instanceof HttpErrorResponse &&
            [401, 403].includes(failure.status) &&
            (generation === auth.sessionVersion || !auth.accessToken())
          ) {
            if (generation === auth.sessionVersion && failure.status === 401) auth.clear();
            if (auth.accessToken()) return throwError(() => failure);
            void router.navigate(['/login']);
          }
          return throwError(() => failure);
        }),
      );
    }),
  );
};
