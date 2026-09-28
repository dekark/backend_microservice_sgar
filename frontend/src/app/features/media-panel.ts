import { Component, inject, Input, OnChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';
import { errorMessage } from '../core/errors';
import { safeLink, Service } from '../core/models';
@Component({
  selector: 'app-media-panel',
  imports: [FormsModule],
  template: ` <section class="media-panel">
    <h3>{{ kind === 'resource' ? 'Imagen y contenido del recurso' : 'Avatar' }}</h3>
    <p class="muted">
      {{
        kind === 'resource'
          ? 'La portada y el archivo principal se guardan por separado.'
          : 'JPEG, PNG o WebP. Máximo 5 MiB y 16 megapíxeles.'
      }}
    </p>
    @if (error()) {
      <div class="alert error" role="alert">{{ error() }}</div>
    }
    @if (message()) {
      <div class="alert success" role="status">{{ message() }}</div>
    }
    <div class="media-grid">
      <div class="media-preview">
        @if (imageUrl()) {
          <img
            [src]="imageUrl()"
            [alt]="kind === 'resource' ? 'Portada del recurso' : 'Avatar del usuario'"
          />
        } @else {
          <span class="placeholder-image">{{ kind === 'resource' ? '◈' : '◎' }}</span
          ><small>Sin imagen</small>
        }
      </div>
      <div>
        <label class="file-label"
          >{{ kind === 'resource' ? 'Subir o reemplazar portada' : 'Subir o reemplazar avatar'
          }}<input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            [disabled]="busy()"
            (change)="upload($event, 'image')"
        /></label>
        <p class="field-hint">JPEG, PNG o WebP · hasta 5 MiB.</p>
        <div class="actions">
          <button type="button" class="secondary" [disabled]="busy()" (click)="load()">
            Actualizar imagen</button
          ><button
            type="button"
            class="danger-text"
            [disabled]="busy() || !imageUrl()"
            (click)="remove('image')"
          >
            Quitar imagen
          </button>
        </div>
      </div>
    </div>
    @if (kind === 'resource') {
      <div class="content-upload">
        <h3>Archivo principal o enlace</h3>
        <p class="muted">
          Hasta 25 MiB. El formato debe corresponder al tipo del recurso. Los recursos LINK solo
          aceptan un enlace.
        </p>
        @if (downloadUrl()) {
          <a class="download-link" [href]="downloadUrl()" target="_blank" rel="noopener noreferrer"
            >↗ Abrir contenido actual</a
          >
        }
        <label class="file-label"
          >Subir o reemplazar archivo<input
            type="file"
            [disabled]="busy() || resourceType === 'LINK'"
            (change)="upload($event, 'file')"
        /></label>
        <div class="inline-form">
          <label
            >Enlace del recurso<input
              type="url"
              [(ngModel)]="url"
              name="resourceUrl"
              placeholder="https://…" /></label
          ><button
            type="button"
            class="secondary"
            [disabled]="busy() || !url.trim()"
            (click)="saveUrl()"
          >
            Guardar enlace
          </button>
        </div>
        <button type="button" class="danger-text" [disabled]="busy()" (click)="remove('file')">
          Quitar archivo o enlace
        </button>
      </div>
    }
    @if (busy()) {
      <p role="status" class="loading-text">Procesando archivo…</p>
    }
  </section>`,
})
export class MediaPanel implements OnChanges {
  @Input() kind: 'avatar' | 'user-avatar' | 'resource' = 'avatar';
  @Input() recordId = '';
  @Input() basePath = '';
  @Input() resourceType = '';
  private readonly api = inject(ApiService);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly imageUrl = signal<string | null>(null);
  readonly downloadUrl = signal<string | null>(null);
  url = '';
  private generation = 0;
  ngOnChanges(): void {
    this.generation++;
    this.imageUrl.set(null);
    this.downloadUrl.set(null);
    this.url = '';
    void this.load();
  }
  private service(): Service {
    return this.kind === 'resource' ? 'resources' : 'users';
  }
  private path(part: 'image' | 'file'): string {
    if (this.kind === 'avatar') return '/users/me/avatar';
    const base =
      this.basePath ||
      `/${this.kind === 'resource' ? 'resources' : 'admin/users'}/${encodeURIComponent(this.recordId)}`;
    return `${base}/${this.kind === 'user-avatar' ? 'avatar' : part}`;
  }
  async load(): Promise<void> {
    const version = this.generation;
    this.error.set('');
    try {
      const read = async (part: 'image' | 'file'): Promise<Record<string, unknown> | null> => {
        try {
          return await this.api.request('GET', this.service(), this.path(part));
        } catch (e) {
          if (e instanceof HttpErrorResponse && e.status === 404) return null;
          throw e;
        }
      };
      const [image, content] = await Promise.all([
        read('image'),
        this.kind === 'resource' ? read('file') : Promise.resolve(null),
      ]);
      if (version !== this.generation) return;
      this.imageUrl.set(safeLink(image?.['url']));
      this.downloadUrl.set(safeLink(content?.['downloadUrl'] ?? content?.['url']));
      this.url = typeof content?.['url'] === 'string' ? content['url'] : '';
    } catch (e) {
      if (version === this.generation) this.error.set(errorMessage(e));
    }
  }
  async upload(event: Event, part: 'image' | 'file'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const max = (part === 'image' ? 5 : 25) * 1024 * 1024;
    if (file.size > max) {
      this.error.set(`El archivo supera ${part === 'image' ? 5 : 25} MiB.`);
      input.value = '';
      return;
    }
    if (part === 'image' && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.error.set('Selecciona una imagen JPEG, PNG o WebP.');
      input.value = '';
      return;
    }
    await this.perform(
      () => this.api.upload(this.service(), this.path(part), file),
      'Archivo actualizado.',
    );
    input.value = '';
  }
  async saveUrl(): Promise<void> {
    const url = safeLink(this.url);
    if (!url) {
      this.error.set('Escribe una URL HTTP o HTTPS sin credenciales.');
      return;
    }
    await this.perform(
      () =>
        this.api.request('PUT', 'resources', this.path('file').replace(/\/file$/, '/url'), { url }),
      'Enlace actualizado.',
    );
  }
  async remove(part: 'image' | 'file'): Promise<void> {
    if (!confirm('¿Quieres quitar este contenido? Esta acción no elimina el registro.')) return;
    await this.perform(
      () => this.api.request('DELETE', this.service(), this.path(part)),
      'Contenido eliminado.',
    );
  }
  private async perform(work: () => Promise<unknown>, message: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await work();
      this.message.set(message);
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
