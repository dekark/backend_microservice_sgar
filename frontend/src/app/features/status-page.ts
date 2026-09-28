import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { safeReturnUrl } from '../core/guards';
@Component({
  selector: 'app-status',
  imports: [RouterLink],
  template: `<div class="standalone-state">
    <a class="brand" routerLink="/inicio"><span class="brand-symbol">a</span>ámbito</a>
    <section class="panel">
      <span class="status-symbol">◇</span>
      <h1>{{ title }}</h1>
      <p>{{ message }}</p>
      <div class="actions">
        <a class="button" [routerLink]="retry">{{
          unavailable ? 'Volver a intentar' : 'Ir al inicio'
        }}</a
        ><a class="button secondary" routerLink="/login">Iniciar sesión</a>
      </div>
    </section>
  </div>`,
})
export class StatusPage {
  private readonly route = inject(ActivatedRoute);
  readonly unavailable = this.route.snapshot.queryParamMap.get('unavailable') === '1';
  readonly missing = this.route.snapshot.data['missing'] === true;
  readonly title = this.unavailable
    ? 'El servicio no está disponible'
    : this.missing
      ? 'Esta página no existe'
      : 'No tienes acceso a este espacio';
  readonly message = this.unavailable
    ? 'No pudimos verificar tu acceso. Comprueba que los servicios estén disponibles e inténtalo otra vez.'
    : this.missing
      ? 'Comprueba la dirección o vuelve a tu espacio de trabajo.'
      : 'Tu sesión, rol, permiso o área asignada no permite abrir esta página. Contacta con un administrador si necesitas acceso.';
  readonly retry = this.unavailable
    ? safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'))
    : '/inicio';
}
