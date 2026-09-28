import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ApiService } from '../core/api.service';
import { Entity } from '../core/models';
import { errorMessage } from '../core/errors';
import { access, CATALOG } from './catalog';
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  template: ` <div class="page-heading">
      <div>
        <span class="eyebrow">TU ESPACIO DE TRABAJO</span>
        <h1>Hola, {{ firstName }} <span class="wave">✦</span></h1>
        <p class="muted">Aquí tienes una vista general de tu organización.</p>
      </div>
      <span class="date-chip">{{ today }}</span>
    </div>
    <section class="welcome-banner">
      <div>
        <span class="eyebrow">TODO LO QUE NECESITAS</span>
        <h2>Un buen equipo empieza<br />por un espacio organizado.</h2>
        <p>Gestiona lo importante, con el acceso que corresponde a tu rol.</p>
        <a class="button light-button" routerLink="/perfil">Ver mi perfil <span>↗</span></a>
      </div>
      <div class="banner-shapes" aria-hidden="true">
        <div>◈</div>
        <span>◎</span><i>◇</i>
      </div>
    </section>
    <div class="section-heading">
      <h2>Tus módulos</h2>
      <button class="quiet-button" [disabled]="loading()" (click)="load()">↻ Actualizar</button>
    </div>
    <div class="metric-grid">
      @for (entity of allowed.entities; track entity) {
        <a class="metric-card" [routerLink]="[allowed.prefix, entity]"
          ><div class="metric-top">
            <span class="module-icon">{{ catalog[entity].mark }}</span
            ><span class="metric-arrow">↗</span>
          </div>
          <span class="metric-number">{{ counts()[entity] ?? '—' }}</span>
          <h3>{{ catalog[entity].title }}</h3>
          <p>{{ failures()[entity] || 'Registros disponibles para tu acceso' }}</p></a
        >
      }
    </div>
    @if (!allowed.entities.length) {
      <div class="empty-state">
        <span>◇</span>
        <h2>No tienes módulos de gestión asignados</h2>
        <p>
          Puedes administrar tu perfil y los archivos de recursos de tu área. Contacta con un
          administrador para revisar tu asignación.
        </p>
      </div>
    }
    <div class="dashboard-bottom">
      <section class="panel">
        <span class="eyebrow">TU ACCESO</span>
        <h2>{{ auth.user()?.role }}</h2>
        <p class="muted">
          {{
            auth.user()?.areaId
              ? 'Tienes un área de trabajo asignada.'
              : 'No tienes un área asignada.'
          }}
        </p>
        <div class="chip-row">
          @for (permission of auth.user()?.permissions; track permission) {
            <span class="chip">{{ permission }}</span>
          } @empty {
            <span class="muted">Sin claves de permisos adicionales.</span>
          }
        </div>
      </section>
      <section class="panel accent-panel">
        <span class="eyebrow">MANTÉN TU CUENTA AL DÍA</span>
        <h2>Tu perfil también<br />es parte del equipo.</h2>
        <a routerLink="/perfil">Cambiar avatar y revisar sesiones →</a>
      </section>
    </div>`,
})
export class Dashboard implements OnInit {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  readonly catalog = CATALOG;
  readonly allowed = access(this.auth.user());
  readonly firstName = this.auth.user()?.name.split(' ')[0] ?? '';
  readonly today = new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  readonly counts = signal<Partial<Record<Entity, number>>>({});
  readonly failures = signal<Partial<Record<Entity, string>>>({});
  readonly loading = signal(false);
  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.failures.set({});
    await Promise.all(
      this.allowed.entities.map(async (entity) => {
        try {
          const page = await this.api.list(entity, this.allowed.scope, { limit: 1, page: 1 });
          this.counts.update((c) => ({ ...c, [entity]: page.total }));
        } catch (e) {
          this.failures.update((f) => ({ ...f, [entity]: errorMessage(e) }));
          this.counts.update((c) => ({ ...c, [entity]: undefined }));
        }
      }),
    );
    this.loading.set(false);
  }
}
