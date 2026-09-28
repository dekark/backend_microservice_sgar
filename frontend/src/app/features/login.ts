import { AfterViewInit, Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ConfigService } from '../core/config';
import { GoogleService } from '../core/google.service';
import { errorMessage } from '../core/errors';
import { safeReturnUrl } from '../core/guards';
@Component({
  selector: 'app-login',
  template: ` <div class="login-page">
    <section class="login-story">
      <a class="brand light" href="/"><span class="brand-symbol">a</span>ámbito</a>
      <div class="story-content">
        <span class="eyebrow">CADA EQUIPO, SU ESPACIO</span>
        <h1>Todo conectado.<br />Todo en su lugar.</h1>
        <p>
          Un espacio para gestionar tus recursos, organizar tu equipo y seguir la actividad de tu
          organización.
        </p>
        <div class="orbit-art" aria-hidden="true">
          <div class="orbit o1"></div>
          <div class="orbit o2"></div>
          <div class="orbit-center">a</div>
          <span class="orbit-label l1">◈ Recursos</span
          ><span class="orbit-label l2">◎ Personas</span
          ><span class="orbit-label l3">◇ Acceso</span>
        </div>
      </div>
      <span class="story-footer">Personas · Recursos · Organización</span>
    </section>
    <section class="login-form">
      <div class="login-card">
        <span class="eyebrow">BIENVENIDO A ÁMBITO</span>
        <h2>Tu próximo paso<br />empieza aquí.</h2>
        <p class="muted">Inicia sesión con la cuenta de Google registrada en tu organización.</p>
        @if (!clientId) {
          <div class="alert info">
            El inicio de sesión con Google aún no está configurado. Configura el Client ID público
            del frontend y del backend.
          </div>
        }
        <div #googleButton class="google-button" [class.busy]="busy()"></div>
        @if (busy()) {
          <p class="loading-text" role="status">Verificando tu cuenta…</p>
        }
        @if (error()) {
          <div class="alert error" role="alert">{{ error() }}</div>
          <button class="secondary" (click)="initialize()" [disabled]="busy()">
            Volver a intentar
          </button>
        }
        <div class="login-divider"></div>
        <p class="login-note">
          <span>◇</span> Tu rol y tu área determinan las herramientas a las que puedes acceder.
        </p>
      </div>
      <span class="login-copyright">Ámbito · Gestión de organizaciones</span>
    </section>
  </div>`,
})
export class Login implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly google = inject(GoogleService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly clientId = inject(ConfigService).settings.googleClientId;
  readonly busy = signal(false);
  readonly error = signal('');
  @ViewChild('googleButton') button!: ElementRef<HTMLElement>;
  ngAfterViewInit(): void {
    void this.initialize();
  }
  async initialize(): Promise<void> {
    if (!this.clientId) return;
    this.error.set('');
    try {
      await this.google.button(this.button.nativeElement, this.clientId, (token) => {
        void this.login(token);
      });
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async login(token: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(token);
      await this.router.navigateByUrl(
        safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')),
      );
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
