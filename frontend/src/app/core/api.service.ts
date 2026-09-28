import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from './config';
import { AuthService } from './auth.service';
import { Entity, Page, RecordData, Scope, Service } from './models';
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);
  private readonly auth = inject(AuthService);
  request<T>(
    method: string,
    service: Service,
    path: string,
    body?: unknown,
    query: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query))
      if (value !== '') params = params.set(key, value);
    return firstValueFrom(
      this.http.request<T>(method, this.config.url(service, path), { body, params }),
    );
  }
  collection(entity: Entity, scope: Scope): string {
    if (scope === 'admin') return `/admin/${entity}`;
    const area = this.auth.user()?.areaId;
    if (!area) throw Error('No tienes un área asignada.');
    if (
      !['users', 'resources', 'audit'].includes(entity) ||
      (scope === 'area-user' && entity !== 'resources')
    )
      throw Error('Módulo no disponible para este acceso.');
    return `/${scope}/areas/${encodeURIComponent(area)}/${entity}`;
  }
  list(
    entity: Entity,
    scope: Scope,
    query: Record<string, string | number | boolean> = {},
  ): Promise<Page> {
    return this.request('GET', entity, this.collection(entity, scope), undefined, query);
  }
  get(entity: Entity, scope: Scope, id: string): Promise<RecordData> {
    return this.request(
      'GET',
      entity,
      `${this.collection(entity, scope)}/${encodeURIComponent(id)}`,
    );
  }
  byName(
    entity: Entity,
    scope: Scope,
    name: string,
    query: Record<string, string | number | boolean> = {},
  ): Promise<Page> {
    return this.request(
      'GET',
      entity,
      `${this.collection(entity, scope)}/${entity === 'audit' ? 'by-action' : 'by-name'}/${encodeURIComponent(name)}`,
      undefined,
      query,
    );
  }
  save(entity: Entity, scope: Scope, body: unknown, id?: string): Promise<RecordData> {
    return this.request(
      id ? 'PATCH' : 'POST',
      entity,
      `${this.collection(entity, scope)}${id ? '/' + encodeURIComponent(id) : ''}`,
      body,
    );
  }
  remove(entity: Entity, scope: Scope, id: string): Promise<void> {
    return this.request(
      'DELETE',
      entity,
      `${this.collection(entity, scope)}/${encodeURIComponent(id)}`,
    );
  }
  activate(entity: Entity, scope: Scope, id: string, active: boolean): Promise<RecordData> {
    return this.request(
      'PATCH',
      entity,
      `${this.collection(entity, scope)}/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`,
    );
  }
  upload(service: Service, path: string, file: File): Promise<unknown> {
    const body = new FormData();
    body.append('file', file);
    return this.request('PUT', service, path, body);
  }
}
