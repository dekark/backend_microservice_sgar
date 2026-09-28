import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Session } from '../core/models';
import { errorMessage } from '../core/errors';
import { MediaPanel } from './media-panel';
@Component({
  selector: 'app-profile',
  imports: [DatePipe, MediaPanel],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">MI CUENTA</span>
        <h1>Perfil y sesiones</h1>
        <p class="muted">Tu identidad, tus permisos y los dispositivos conectados.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert error" role="alert">{{ error() }}</div>
    }
    <div class="profile-grid">
      <section class="panel">
        <h2>{{ auth.user()?.name }}</h2>
        <p class="muted">{{ auth.user()?.email }}</p>
        <dl class="details">
          <dt>Rol</dt>
          <dd>{{ auth.user()?.role }}</dd>
          <dt>Área asignada</dt>
          <dd>{{ auth.user()?.areaId ?? 'Sin área' }}</dd>
          <dt>ID de usuario</dt>
          <dd>{{ auth.user()?.id }}</dd>
        </dl>
        <h3>Claves de permisos</h3>
        <div class="chip-row">
          @for (key of auth.user()?.permissions; track key) {
            <span class="chip">{{ key }}</span>
          } @empty {
            <span class="muted">No tienes claves adicionales.</span>
          }
        </div>
      </section>
      <section class="panel"><app-media-panel kind="avatar" /></section>
    </div>
    <section class="panel session-panel">
      <div class="section-heading">
        <div>
          <h2>Sesiones activas</h2>
          <p class="muted">Revoca el acceso de los dispositivos que ya no utilices.</p>
        </div>
        <button class="secondary" [disabled]="busy()" (click)="load()">↻ Actualizar</button>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Dispositivo</th>
              <th>Última actividad</th>
              <th>Vencimiento</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            @for (session of sessions(); track session.id) {
              <tr>
                <td>
                  <strong>{{ session.current ? 'Este dispositivo' : 'Otra sesión' }}</strong
                  ><small>{{ session.userAgent || 'Dispositivo no identificado' }}</small
                  ><small>{{ session.ipAddress }}</small>
                </td>
                <td>{{ session.lastActiveAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                <td>{{ session.expiresAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                <td>
                  <button class="danger-text" [disabled]="busy()" (click)="revoke(session)">
                    {{ session.current ? 'Cerrar sesión' : 'Revocar' }}
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4">
                  {{ busy() ? 'Cargando sesiones…' : 'No hay sesiones para mostrar.' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <button class="danger-button" [disabled]="busy()" (click)="logoutAll()">
        Cerrar todas mis sesiones
      </button>
    </section>`,
})
export class Profile implements OnInit {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly sessions = signal<Session[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.sessions.set(await this.auth.sessions());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  async revoke(session: Session): Promise<void> {
    if (!confirm('¿Revocar esta sesión?')) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.revoke(session.id);
      if (session.current) {
        this.auth.clear();
        await this.router.navigate(['/login']);
      } else await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  async logoutAll(): Promise<void> {
    if (!confirm('¿Cerrar tus sesiones en todos los dispositivos?')) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.logout(true);
      await this.router.navigate(['/login']);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
