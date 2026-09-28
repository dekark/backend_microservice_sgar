import { Component, inject, Input, OnChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Page, RecordData } from '../core/models';
import { errorMessage } from '../core/errors';
@Component({
  selector: 'app-role-permissions',
  imports: [FormsModule],
  template: `<section class="permissions-editor">
    <h3>Permisos del rol</h3>
    <p class="muted">
      Los permisos seleccionados se asignarán a este rol. Las selecciones se conservan al cambiar de
      página.
    </p>
    @if (error()) {
      <div class="alert error" role="alert">{{ error() }}</div>
      @if (!ready()) {
        <button class="secondary" [disabled]="busy()" (click)="initialize()">
          Reintentar carga
        </button>
      }
    }
    @if (message()) {
      <div class="alert success" role="status">{{ message() }}</div>
    }
    <form class="inline-form" (ngSubmit)="search()">
      <label
        >Buscar permisos<input
          name="permissionSearch"
          [(ngModel)]="q"
          maxlength="200"
          placeholder="Nombre, clave o módulo" /></label
      ><button class="secondary" [disabled]="busy()">Buscar</button>
    </form>
    @for (item of page()?.data; track item.id) {
      <label class="permission-option"
        ><input
          type="checkbox"
          [checked]="selected().has(+item.id)"
          [disabled]="busy() || !ready()"
          (change)="toggle(+item.id)"
        /><span
          >{{ item.name
          }}<small
            >{{ item['key'] }} · {{ item['module']
            }}{{ item.isActive === false ? ' · Inactivo' : '' }}</small
          ></span
        ></label
      >
    }
    <div class="pagination">
      <button
        class="secondary"
        [disabled]="busy() || !page()?.hasPreviousPage"
        (click)="loadPage(-1)"
      >
        Anterior</button
      ><span>Página {{ page()?.page ?? 1 }} · {{ selected().size }} seleccionados</span
      ><button class="secondary" [disabled]="busy() || !page()?.hasNextPage" (click)="loadPage(1)">
        Siguiente
      </button>
    </div>
    <button class="primary" [disabled]="busy() || !ready()" (click)="save()">
      Guardar permisos del rol
    </button>
  </section>`,
})
export class RolePermissions implements OnChanges {
  @Input() roleId = '';
  private readonly api = inject(ApiService);
  readonly selected = signal(new Set<number>());
  readonly page = signal<Page | null>(null);
  readonly busy = signal(false);
  readonly ready = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  q = '';
  private generation = 0;
  ngOnChanges(): void {
    this.generation++;
    this.ready.set(false);
    this.selected.set(new Set());
    this.page.set(null);
    void this.initialize();
  }
  async initialize(): Promise<void> {
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      const [assigned, page] = await Promise.all([
        this.api.request<RecordData[]>(
          'GET',
          'roles',
          `/admin/roles/${encodeURIComponent(this.roleId)}/permissions`,
        ),
        this.api.list('permissions', 'admin', { limit: 20, page: 1 }),
      ]);
      if (generation !== this.generation) return;
      this.selected.set(new Set(assigned.map((p) => +p.id)));
      this.page.set(page);
      this.ready.set(true);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  toggle(id: number): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async search(): Promise<void> {
    await this.fetchPage(1);
  }
  async loadPage(direction: number): Promise<void> {
    await this.fetchPage((this.page()?.page ?? 1) + direction);
  }
  private async fetchPage(page: number): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.page.set(
        await this.api.list('permissions', 'admin', {
          page,
          limit: 20,
          ...(this.q.trim() ? { q: this.q.trim() } : {}),
        }),
      );
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  async save(): Promise<void> {
    if (!this.ready() || this.busy() || !confirm('¿Aplicar esta selección de permisos al rol?'))
      return;
    if (this.selected().size > 1000) {
      this.error.set('El backend permite hasta 1000 permisos por rol.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await this.api.request(
        'PUT',
        'roles',
        `/admin/roles/${encodeURIComponent(this.roleId)}/permissions`,
        { permissionIds: [...this.selected()] },
      );
      this.message.set('Permisos actualizados.');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
