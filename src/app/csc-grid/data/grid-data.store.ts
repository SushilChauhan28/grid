import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DummyJsonAdapter } from './dummyjson.adapter';
import { GridDataAdapter } from './grid-data.adapter';
import { MockarooAdapter } from './mockaroo.adapter';
import { ChildRecord, EnterpriseRecord, FilterClause, GridQuery, SortClause } from './grid-query.model';

export type PagingMode = 'paged' | 'infinite';
export type ChildState = { status: 'loading' | 'ready' | 'error'; rows: ChildRecord[]; message?: string };

/**
 * Owns everything asynchronous for the All Features section: which adapter is
 * live, the current query, the loaded window, and the loading/error state.
 *
 * Requests are sequenced by a monotonically increasing token rather than
 * cancelled — a late response from a superseded query is discarded instead of
 * overwriting fresher rows.
 */
@Injectable({ providedIn: 'root' })
export class GridDataStore {
  private mockaroo = inject(MockarooAdapter);
  private dummy = inject(DummyJsonAdapter);

  readonly adapters: GridDataAdapter[] = [this.mockaroo, this.dummy];

  adapterId = signal<string>(this.mockaroo.id);
  adapter = computed(() => this.adapters.find(a => a.id === this.adapterId()) ?? this.mockaroo);

  mode = signal<PagingMode>('paged');
  search = signal('');
  filters = signal<FilterClause[]>([]);
  sort = signal<SortClause[]>([]);
  page = signal(0);
  pageSize = signal(50);

  rows = signal<EnterpriseRecord[]>([]);
  total = signal(0);
  elapsedMs = signal(0);
  /** True only for the very first fetch, when there is nothing to show yet. */
  initialLoading = signal(true);
  loading = signal(false);
  loadingMore = signal(false);
  error = signal<string | null>(null);

  private children = signal<Record<string, ChildState>>({});
  private distinct = new Map<string, string[]>();
  private token = 0;

  query = computed<GridQuery>(() => ({
    search: this.search(),
    filters: this.filters(),
    sort: this.sort(),
    page: this.page(),
    pageSize: this.pageSize(),
  }));

  pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  hasMore = computed(() => this.rows().length < this.total());
  isFiltered = computed(() => this.filters().length > 0 || this.search().trim().length > 0);

  /** Fetches the current query. `append` accumulates for infinite scroll. */
  async load(append = false): Promise<void> {
    const my = ++this.token;
    this.error.set(null);
    if (append) this.loadingMore.set(true); else this.loading.set(true);

    try {
      const res = await firstValueFrom(this.adapter().fetch(this.query()));
      if (my !== this.token) return;
      this.rows.set(append ? [...this.rows(), ...res.rows] : res.rows);
      this.total.set(res.total);
      this.elapsedMs.set(res.elapsedMs);
    } catch (e: unknown) {
      if (my !== this.token) return;
      this.error.set(e instanceof Error ? e.message : 'The request could not be completed.');
      if (!append) this.rows.set([]);
    } finally {
      if (my === this.token) {
        this.loading.set(false);
        this.loadingMore.set(false);
        this.initialLoading.set(false);
      }
    }
  }

  /** Any query change other than "next page in infinite mode" restarts the window. */
  reload(): void { this.page.set(0); void this.load(false); }

  loadMore(): void {
    if (this.mode() !== 'infinite' || this.loading() || this.loadingMore() || !this.hasMore()) return;
    this.page.update(p => p + 1);
    void this.load(true);
  }

  setMode(m: PagingMode): void {
    if (this.mode() === m) return;
    this.mode.set(m);
    this.reload();
  }

  setAdapter(id: string): void {
    if (this.adapterId() === id) return;
    this.adapterId.set(id);
    this.distinct.clear();
    this.children.set({});
    this.initialLoading.set(true);
    this.reload();
  }

  simulateFailure(): void {
    this.mockaroo.failNextRequest = true;
    this.reload();
  }

  // ── Filters ───────────────────────────────────────────────────────────────
  setFilter(field: string, values: string[]): void {
    const rest = this.filters().filter(f => f.field !== field);
    this.filters.set(values.length ? [...rest, { field, op: 'in', values }] : rest);
    this.reload();
  }
  clearFilter(field: string): void {
    this.filters.set(this.filters().filter(f => f.field !== field));
    this.reload();
  }
  clearAllFilters(): void {
    this.filters.set([]);
    this.search.set('');
    this.reload();
  }
  filterFor(field: string): string[] | null {
    return this.filters().find(f => f.field === field)?.values ?? null;
  }

  // ── Sorting ───────────────────────────────────────────────────────────────
  /** Cycles asc → desc → off. `additive` keeps existing clauses for multi-sort. */
  toggleSort(field: string, additive: boolean): SortClause[] {
    const cur = this.sort();
    const at = cur.findIndex(s => s.field === field);
    let next: SortClause[];
    if (at < 0) {
      next = additive ? [...cur, { field, dir: 'asc' }] : [{ field, dir: 'asc' }];
    } else if (cur[at].dir === 'asc') {
      next = cur.map((s, i) => i === at ? { ...s, dir: 'desc' as const } : s);
      if (!additive) next = [next[at]];
    } else {
      next = cur.filter((_, i) => i !== at);
      if (!additive) next = [];
    }
    this.sort.set(next);
    this.reload();
    return next;
  }
  sortFor(field: string): { dir: 'asc' | 'desc'; level: number; of: number } | null {
    const i = this.sort().findIndex(s => s.field === field);
    return i < 0 ? null : { dir: this.sort()[i].dir, level: i + 1, of: this.sort().length };
  }

  // ── Distinct values (filter popup) ────────────────────────────────────────
  async distinctValues(field: string): Promise<string[]> {
    const hit = this.distinct.get(field);
    if (hit) return hit;
    const vals = await firstValueFrom(this.adapter().distinctValues(field));
    this.distinct.set(field, vals);
    return vals;
  }

  // ── Lazy child records ────────────────────────────────────────────────────
  childrenFor(rowId: string): ChildState | undefined { return this.children()[rowId]; }

  async loadChildren(rowId: string): Promise<void> {
    if (this.children()[rowId]?.status === 'ready') return;
    this.children.update(m => ({ ...m, [rowId]: { status: 'loading', rows: [] } }));
    try {
      const rows = await firstValueFrom(this.adapter().fetchChildren(rowId));
      this.children.update(m => ({ ...m, [rowId]: { status: 'ready', rows } }));
    } catch {
      this.children.update(m => ({ ...m, [rowId]: { status: 'error', rows: [], message: 'Could not load child records.' } }));
    }
  }

  // ── Local write-through (inline edit / delete keep the window consistent) ──
  patchRow(id: string, field: string, value: string): void {
    this.rows.update(rs => rs.map(r => r.id === id ? { ...r, [field]: value } as EnterpriseRecord : r));
  }
  removeRows(ids: string[]): void {
    const set = new Set(ids);
    this.rows.update(rs => rs.filter(r => !set.has(r.id)));
    this.total.update(t => Math.max(0, t - ids.length));
  }
  prependRow(row: EnterpriseRecord): void {
    this.rows.update(rs => [row, ...rs]);
    this.total.update(t => t + 1);
  }

  async exportRows(limit: number): Promise<EnterpriseRecord[]> {
    return firstValueFrom(this.adapter().fetchAll(this.query(), limit));
  }

  /** The whole dataset, ignoring the current query. Feeds the client-mode
   *  sections, which run their own filter/sort/page over rows they hold. */
  async fetchDataset(limit: number): Promise<EnterpriseRecord[]> {
    const q: GridQuery = { search: '', filters: [], sort: [], page: 0, pageSize: limit };
    return firstValueFrom(this.adapter().fetchAll(q, limit));
  }

  /** Ids of every row matching the current query, not just the loaded page. */
  async matchingIds(limit: number): Promise<string[]> {
    const rows = await firstValueFrom(this.adapter().fetchAll(this.query(), limit));
    return rows.map(r => r.id);
  }
}
