import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MediaPanel } from './media-panel';
import { UUID } from '../core/models';
@Component({
  selector: 'app-files',
  imports: [FormsModule, MediaPanel],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">CONTENIDO COMPARTIDO</span>
        <h1>Archivos de recursos</h1>
        <p class="muted">
          Gestiona la portada, el archivo principal o el enlace de un recurso de tu área.
        </p>
      </div>
    </div>
    <section class="panel">
      <form class="inline-form" (ngSubmit)="open()">
        <label
          >ID del recurso<input
            name="resourceId"
            [(ngModel)]="id"
            placeholder="UUID del recurso"
            required /></label
        ><button class="primary">Abrir recurso</button>
      </form>
      <p class="muted">
        El recurso debe existir. El backend comprueba que pertenezca a tu área; el
        superadministrador tiene acceso global.
      </p>
      @if (error()) {
        <div class="alert error" role="alert">{{ error() }}</div>
      }
      @if (selected()) {
        <app-media-panel kind="resource" [recordId]="selected()" />
      }
    </section>`,
})
export class Files {
  id = '';
  readonly selected = signal('');
  readonly error = signal('');
  open(): void {
    if (!UUID.test(this.id.trim())) {
      this.error.set('Introduce un UUID de recurso válido.');
      this.selected.set('');
      return;
    }
    this.error.set('');
    this.selected.set(this.id.trim());
  }
}
