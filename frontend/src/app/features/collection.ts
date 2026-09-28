import { Component, ElementRef, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { combineLatest, Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorMessage } from '../core/errors';
import { Entity, Page, RecordData, Scope, UUID } from '../core/models';
import { CATALOG, Definition, Field, formBody, formFields, LABELS } from './catalog';
import { MediaPanel } from './media-panel';
import { RolePermissions } from './role-permissions';
@Component({
  selector: 'app-collection',
  imports: [FormsModule, MediaPanel, RolePermissions],
  templateUrl: './collection.html',
})
export class Collection implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private subscription?: Subscription;
  private revision = 0;
  entity: Entity = 'resources';
  scope: Scope = 'admin';
  definition: Definition = CATALOG.resources;
  readonly labels = LABELS;
  readonly page = signal<Page | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly formError = signal('');
  readonly selected = signal<RecordData | null>(null);
  q = '';
  mode = 'text';
  filter = '';
  filterValue = '';
  sortBy = 'createdAt';
  order = 'desc';
  limit = 20;
  currentPage = 1;
  editingId?: string;
  fields: Field[] = [];
  draft: Record<string, unknown> = {};
  @ViewChild('editor') editor!: ElementRef<HTMLDialogElement>;
  ngOnInit(): void {
    this.subscription = combineLatest([this.route.paramMap, this.route.data]).subscribe(
      ([params, data]) => {
        this.entity = params.get('entity') as Entity;
        this.scope = data['scope'] as Scope;
        this.definition = CATALOG[this.entity];
        this.q = '';
        this.mode = 'text';
        this.filter = '';
        this.filterValue = '';
        this.currentPage = 1;
        this.sortBy = 'createdAt';
        this.selected.set(null);
        this.notice.set('');
        this.editor?.nativeElement.close();
        void this.load();
      },
    );
  }
  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.revision++;
  }
  async search(): Promise<void> {
    this.currentPage = 1;
    await this.load();
  }
  async load(): Promise<void> {
    const revision = ++this.revision;
    this.loading.set(true);
    this.error.set('');
    const query: Record<string, string | number | boolean> = {
      page: this.currentPage,
      limit: this.limit,
      sortBy: this.sortBy,
      order: this.order,
    };
    if (this.filter && this.filterValue.trim()) query[this.filter] = this.filterValue.trim();
    try {
      let page: Page;
      if (this.mode === 'id' && this.q.trim()) {
        this.validateId(this.q.trim());
        const row = await this.api.get(this.entity, this.scope, this.q.trim());
        page = {
          data: [row],
          total: 1,
          page: 1,
          limit: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        };
      } else if (this.mode === 'name' && this.q.trim())
        page = await this.api.byName(this.entity, this.scope, this.q.trim(), query);
      else
        page = await this.api.list(this.entity, this.scope, {
          ...query,
          ...(this.q.trim() ? { q: this.q.trim() } : {}),
        });
      if (revision === this.revision) this.page.set(page);
    } catch (e) {
      if (revision === this.revision) {
        this.error.set(errorMessage(e));
        this.page.set(null);
      }
    } finally {
      if (revision === this.revision) this.loading.set(false);
    }
  }
  private validateId(id: string): void {
    if (['roles', 'permissions'].includes(this.entity) ? !/^[1-9]\d*$/.test(id) : !UUID.test(id))
      throw Error('El ID no tiene un formato válido para este módulo.');
  }
  async paginate(direction: number): Promise<void> {
    this.currentPage += direction;
    await this.load();
  }
  async inspect(row: RecordData): Promise<void> {
    this.error.set('');
    try {
      const revision = this.revision;
      const record = await this.api.get(this.entity, this.scope, String(row.id));
      if (revision === this.revision) this.selected.set(record);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async edit(row?: RecordData): Promise<void> {
    this.formError.set('');
    this.error.set('');
    try {
      const revision = this.revision;
      const current = row ? await this.api.get(this.entity, this.scope, String(row.id)) : undefined;
      if (revision !== this.revision) return;
      this.editingId = current ? String(current.id) : undefined;
      this.fields = formFields(this.entity, this.scope, !!current);
      this.draft = {};
      for (const f of this.fields) {
        const value = current?.[f.key];
        this.draft[f.key] =
          f.type === 'boolean'
            ? (value ?? true)
            : f.type === 'json'
              ? JSON.stringify(value ?? {}, null, 2)
              : (value ?? (f.type === 'select' ? (f.options?.[0] ?? '') : ''));
      }
      this.editor.nativeElement.showModal();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  closeEditor(): void {
    if (!this.saving()) this.editor.nativeElement.close();
  }
  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.formError.set('');
    try {
      const body = formBody(this.fields, this.draft, !!this.editingId);
      const record = await this.api.save(this.entity, this.scope, body, this.editingId);
      this.editor.nativeElement.close();
      this.selected.set(record);
      this.notice.set(this.editingId ? 'Registro actualizado.' : 'Registro creado.');
      await this.load();
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
  async remove(row: RecordData): Promise<void> {
    if (
      !confirm(
        `¿Eliminar ${row.name ?? row.action ?? 'este registro'}? Esta acción no se puede deshacer.`,
      )
    )
      return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.api.remove(this.entity, this.scope, String(row.id));
      if (this.selected()?.id === row.id) this.selected.set(null);
      this.notice.set('Registro eliminado.');
      if (this.page()?.data.length === 1 && this.currentPage > 1) this.currentPage--;
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
  async toggle(row: RecordData): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    try {
      const record = await this.api.activate(
        this.entity,
        this.scope,
        String(row.id),
        !row.isActive,
      );
      if (this.selected()?.id === row.id) this.selected.set(record);
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
  display(value: unknown, key = ''): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Activo' : 'Inactivo';
    if (key.endsWith('At') && typeof value === 'string') {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  }
  details(row: RecordData): [string, unknown][] {
    return Object.entries(row);
  }
  mediaPath(row: RecordData): string {
    return `${this.api.collection(this.entity, this.scope)}/${encodeURIComponent(String(row.id))}`;
  }
  string(value: unknown): string {
    return String(value ?? '');
  }
}
