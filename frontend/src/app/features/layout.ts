import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { errorMessage } from '../core/errors';
import { access, CATALOG } from './catalog';
@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: ` <div class="app-frame">
    <aside class="sidebar" [class.mobile-open]="menu()">
      <a class="brand" routerLink="/inicio"
        ><span class="brand-symbol">a</span
        ><span>ámbito<span class="brand-caption">ESPACIO DE GESTIÓN</span></span></a
      >
      <div class="workspace">
        <span class="workspace-dot"></span>
        <div>Mi organización<small>Espacio de trabajo</small></div>
      </div>
      <span class="nav-label">PRINCIPAL</span>
      <nav aria-label="Navegación principal">
        <a routerLink="/inicio" routerLinkActive="active" (click)="menu.set(false)"
          ><span>▦</span>Resumen</a
        >
        @for (entity of allowed().entities; track entity) {
          <a
            [routerLink]="[allowed().prefix, entity]"
            routerLinkActive="active"
            (click)="menu.set(false)"
            ><span aria-hidden="true">{{ catalog[entity].mark }}</span
            >{{ catalog[entity].title }}</a
          >
        }
        <span class="nav-label">MI CUENTA</span>
        <a routerLink="/archivos" routerLinkActive="active" (click)="menu.set(false)"
          ><span>↥</span>Archivos de recursos</a
        >
        <a routerLink="/perfil" routerLinkActive="active" (click)="menu.set(false)"
          ><span>◉</span>Perfil y sesiones</a
        >
      </nav>
      <div class="sidebar-bottom">
        <span class="role-pill">{{ auth.user()?.role }}</span>
        <p>Acceso según tu rol y área asignada.</p>
      </div>
    </aside>
    @if (menu()) {
      <button class="sidebar-shade" aria-label="Cerrar menú" (click)="menu.set(false)"></button>
    }
    <div class="app-body">
      <header class="topbar">
        <button
          class="icon-button mobile-toggle"
          aria-label="Abrir menú"
          (click)="menu.set(!menu())"
        >
          ☰
        </button>
        <div class="breadcrumb">Organización <span>/</span> Panel de gestión</div>
        <div class="top-user">
          <span class="avatar-letter">{{ initials() }}</span>
          <div>
            {{ auth.user()?.name }}<small>{{ auth.user()?.email }}</small>
          </div>
          <button class="quiet-button" [disabled]="leaving()" (click)="logout()">Salir ↗</button>
        </div>
      </header>
      @if (error()) {
        <div class="alert error" role="alert">{{ error() }}</div>
      }
      <main id="main-content"><router-outlet /></main>
      <footer class="footer">Ámbito · Tu organización, en un solo lugar.</footer>
    </div>
  </div>`,
})
export class Layout {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly catalog = CATALOG;
  readonly allowed = computed(() => access(this.auth.user()));
  readonly initials = computed(() =>
    (this.auth.user()?.name ?? 'U')
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0])
      .join('')
      .toUpperCase(),
  );
  readonly menu = signal(false);
  readonly error = signal('');
  readonly leaving = signal(false);
  async logout(): Promise<void> {
    this.leaving.set(true);
    this.error.set('');
    try {
      await this.auth.logout();
      window.google?.accounts.id.disableAutoSelect();
      await this.router.navigate(['/login']);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.leaving.set(false);
    }
  }
}
