import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpBackend, HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ConfigService } from './config';
import { parseUser, Session, Tokens, User } from './models';

const STORAGE_KEY = 'ambito.refresh';
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly config = inject(ConfigService);
  readonly user = signal<User | null>(null);
  readonly accessToken = signal<string | null>(null);
  readonly signedIn = computed(() => !!this.user());
  private refreshToken: string | null = this.readStored();
  private refreshing: Promise<string> | null = null;
  private checking: Promise<User> | null = null;
  private generation = 0;
  get sessionVersion(): number {
    return this.generation;
  }
  private readStored(): string | null {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
  private store(value: string | null): void {
    try {
      if (value) sessionStorage.setItem(STORAGE_KEY, value);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Memory-only session if storage is unavailable. */
    }
  }
  clear(): void {
    this.generation++;
    this.user.set(null);
    this.accessToken.set(null);
    this.refreshToken = null;
    this.store(null);
    this.checking = null;
    this.refreshing = null;
  }
  private accept(tokens: Tokens, generation: number): string {
    if (generation !== this.generation) throw Error('La sesión cambió.');
    if (
      !tokens ||
      typeof tokens.accessToken !== 'string' ||
      !tokens.accessToken ||
      typeof tokens.refreshToken !== 'string' ||
      !tokens.refreshToken
    )
      throw Error('Respuesta de autenticación inválida.');
    this.accessToken.set(tokens.accessToken);
    this.refreshToken = tokens.refreshToken;
    this.store(tokens.refreshToken);
    return tokens.accessToken;
  }
  async login(idToken: string): Promise<User> {
    this.clear();
    const generation = this.generation;
    const tokens = await firstValueFrom(
      this.http
        .post<Tokens>(this.config.url('auth', '/auth/google'), { idToken })
        .pipe(timeout(20000)),
    );
    this.accept(tokens, generation);
    return this.ensureSession();
  }
  renew(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    if (!this.refreshToken) return Promise.reject(new HttpErrorResponse({ status: 401 }));
    const generation = this.generation;
    const work = firstValueFrom(
      this.http
        .post<Tokens>(this.config.url('auth', '/auth/refresh'), { refreshToken: this.refreshToken })
        .pipe(timeout(15000)),
    )
      .then((tokens) => this.accept(tokens, generation))
      .catch((error: unknown) => {
        if (
          generation === this.generation &&
          error instanceof HttpErrorResponse &&
          [401, 403].includes(error.status)
        )
          this.clear();
        throw error;
      });
    this.refreshing = work;
    void work
      .finally(() => {
        if (this.refreshing === work) this.refreshing = null;
      })
      .catch(() => {});
    return work;
  }
  ensureSession(): Promise<User> {
    if (this.checking) return this.checking;
    const generation = this.generation;
    const work = (async () => {
      let token = this.accessToken() ?? (await this.renew());
      let input: unknown;
      try {
        input = await this.profile(token);
      } catch (error) {
        if (!(error instanceof HttpErrorResponse) || error.status !== 401) throw error;
        token = await this.renew();
        input = await this.profile(token);
      }
      const user = parseUser(input);
      if (generation !== this.generation) throw Error('La sesión cambió.');
      this.user.set(user);
      return user;
    })().catch((error: unknown) => {
      if (
        generation === this.generation &&
        error instanceof HttpErrorResponse &&
        [401, 403].includes(error.status)
      )
        this.clear();
      throw error;
    });
    this.checking = work;
    void work
      .finally(() => {
        if (this.checking === work) this.checking = null;
      })
      .catch(() => {});
    return work;
  }
  private profile(token: string): Promise<unknown> {
    return firstValueFrom(
      this.http
        .get(this.config.url('auth', '/auth/me'), {
          headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
        })
        .pipe(timeout(15000)),
    );
  }
  async authenticated<T>(method: string, path: string, body?: unknown): Promise<T> {
    const generation = this.generation;
    const send = (token: string) =>
      firstValueFrom(
        this.http
          .request<T>(method, this.config.url('auth', path), {
            body,
            headers: { Authorization: `Bearer ${token}` },
          })
          .pipe(timeout(15000)),
      );
    const token = this.accessToken() ?? (await this.renew());
    try {
      return await send(token);
    } catch (error) {
      if (
        generation !== this.generation ||
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401
      )
        throw error;
      const renewed = await this.renew();
      if (generation !== this.generation) throw Error('La sesión cambió.');
      return send(renewed);
    }
  }
  sessions(): Promise<Session[]> {
    return this.authenticated('GET', '/auth/sessions');
  }
  revoke(id: string): Promise<void> {
    return this.authenticated('DELETE', `/auth/sessions/${encodeURIComponent(id)}`);
  }
  async logout(all = false): Promise<void> {
    const generation = this.generation;
    await this.authenticated('POST', all ? '/auth/logout-all' : '/auth/logout');
    if (generation === this.generation) this.clear();
  }
}
