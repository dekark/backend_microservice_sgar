import { inject, Injectable } from '@angular/core';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { Service } from './models';
export const SERVICES: Service[] = [
  'auth',
  'roles',
  'permissions',
  'resources',
  'areas',
  'users',
  'audit',
];
export interface AppSettings {
  googleClientId: string;
  api: Record<Service, string>;
}
export const DEFAULT_SETTINGS: AppSettings = {
  googleClientId: '',
  api: Object.fromEntries(SERVICES.map((s) => [s, `/api/${s}`])) as Record<Service, string>,
};
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = new HttpClient(inject(HttpBackend));
  settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  async load(): Promise<void> {
    const input = await firstValueFrom(
      this.http.get<AppSettings>('app-config.json').pipe(timeout(10000)),
    );
    if (!input || typeof input.googleClientId !== 'string')
      throw Error('Configuración del frontend inválida.');
    const api = {} as Record<Service, string>;
    for (const s of SERVICES) {
      const raw = input.api?.[s];
      if (typeof raw !== 'string' || !raw.trim()) throw Error(`Falta la URL de ${s}.`);
      const url = new URL(raw, document.baseURI);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw Error(`URL de ${s} inválida.`);
      api[s] = url.href.replace(/\/$/, '');
    }
    this.settings = { api, googleClientId: input.googleClientId.trim() };
  }
  url(service: Service, path: string): string {
    return `${this.settings.api[service]}${path}`;
  }
  owns(url: string): boolean {
    const target = new URL(url, document.baseURI);
    return SERVICES.some((service) => {
      const base = new URL(this.settings.api[service], document.baseURI);
      const prefix = base.pathname.replace(/\/$/, '');
      return (
        target.origin === base.origin &&
        (target.pathname === prefix || target.pathname.startsWith(prefix + '/'))
      );
    });
  }
}
