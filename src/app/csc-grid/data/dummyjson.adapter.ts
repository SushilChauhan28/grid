import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { GridDataAdapter } from './grid-data.adapter';
import { ChildRecord, EnterpriseRecord, GridQuery, Page, STATUS_COLORS } from './grid-query.model';

interface DummyProduct {
  id: number; title: string; description: string; category: string; price: number;
  stock: number; brand?: string; sku?: string; rating: number;
  availabilityStatus?: string; meta?: { createdAt?: string; updatedAt?: string };
  dimensions?: { width: number; height: number; depth: number };
}
interface DummyResponse { products: DummyProduct[]; total: number; skip: number; limit: number; }

const BASE = 'https://dummyjson.com/products';
const STATES = ['DE', 'TX', 'OR', 'KY', 'PA', 'FL', 'GA', 'MA', 'MO', 'NV'];
const CITIES = ['Wilmington', 'Austin', 'Mulino', 'Louisville', 'Pittsburgh', 'Largo', 'Norcross', 'Marlboro', 'St. Louis', 'Reno'];
const STATUSES = ['Active', 'In Good Standing', 'Pending', 'Under Review'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

const iso = (s?: string) => {
  const d = s ? new Date(s) : null;
  if (!d || Number.isNaN(d.getTime())) return '01/01/2024';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
};

/**
 * Live DummyJSON feed. Proves the HTTP contract end to end — real network,
 * real latency, real failure modes — against an API that genuinely supports
 * server-side paging, sorting and search.
 *
 * DummyJSON exposes ~194 products, so this source is for correctness, not
 * scale; switch to the Mockaroo adapter to exercise 10,000 rows.
 */
@Injectable({ providedIn: 'root' })
export class DummyJsonAdapter extends GridDataAdapter {
  readonly id = 'dummyjson';
  readonly label = 'DummyJSON — live API';
  readonly description = 'Real network calls to dummyjson.com. ~194 records; proves the server contract, not scale.';

  private http = inject(HttpClient);

  private toRecord(p: DummyProduct, i: number): EnterpriseRecord {
    const status = STATUSES[p.id % STATUSES.length];
    return {
      id: 'DJ' + String(p.id).padStart(6, '0'),
      doc: String(p.sku ?? 1000000 + p.id),
      entity: p.title,
      address: `${100 + p.id * 3} ${p.category.replace(/-/g, ' ')} Way, Suite ${100 + i}`,
      city: CITIES[p.id % CITIES.length],
      state: STATES[p.id % STATES.length],
      zip: String(10000 + (p.id * 137) % 89999) + '-0000',
      country: 'United States (USA)',
      date: iso(p.meta?.createdAt),
      agent: p.brand ?? 'Corporation Service Company',
      jurisdiction: p.category.replace(/(^|-)(\w)/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase()),
      status,
      statusColor: STATUS_COLORS[status] ?? '#6b7280',
      updated: iso(p.meta?.updatedAt),
      priority: PRIORITIES[Math.min(3, Math.floor((5 - p.rating)))] ?? 'Medium',
      owner: (p.brand ?? 'CSC Operations').split(' ').slice(0, 2).join(' '),
      ownerEmail: 'operations@cscglobal.com',
      revenue: Math.round(p.price * p.stock * 100),
      childCount: Math.min(12, p.stock % 13),
    };
  }

  fetch(query: GridQuery): Observable<Page<EnterpriseRecord>> {
    const started = performance.now();
    const skip = query.page * query.pageSize;
    const search = query.search.trim();
    // DummyJSON exposes sortBy/order on the list endpoint only, not on /search.
    const sort = !search && query.sort.length
      ? `&sortBy=${encodeURIComponent(this.apiField(query.sort[0].field))}&order=${query.sort[0].dir}`
      : '';
    const url = search
      ? `${BASE}/search?q=${encodeURIComponent(search)}&limit=${query.pageSize}&skip=${skip}`
      : `${BASE}?limit=${query.pageSize}&skip=${skip}${sort}`;

    return this.http.get<DummyResponse>(url).pipe(
      map(res => ({
        rows: res.products.map((p, i) => this.toRecord(p, skip + i)),
        total: res.total,
        page: query.page,
        pageSize: query.pageSize,
        elapsedMs: Math.round(performance.now() - started),
      })),
    );
  }

  /** Maps grid fields onto the columns DummyJSON can actually sort by. */
  private apiField(field: string): string {
    return ({ entity: 'title', doc: 'sku', jurisdiction: 'category', revenue: 'price', date: 'meta.createdAt' } as Record<string, string>)[field] ?? 'title';
  }

  fetchAll(query: GridQuery, limit: number): Observable<EnterpriseRecord[]> {
    return this.fetch({ ...query, page: 0, pageSize: Math.min(limit, 200) }).pipe(map(p => p.rows));
  }

  distinctValues(field: string): Observable<string[]> {
    const local: Record<string, string[]> = {
      state: [...STATES].sort(), city: [...CITIES].sort(),
      status: [...STATUSES], priority: [...PRIORITIES], country: ['United States (USA)'],
    };
    if (local[field]) return of(local[field]);
    return this.http.get<DummyResponse>(`${BASE}?limit=0&select=${this.apiField(field)}`).pipe(
      map(res => [...new Set(res.products.map((p, i) => String((this.toRecord(p, i) as any)[field] ?? '')))].sort()),
    );
  }

  fetchChildren(rowId: string): Observable<ChildRecord[]> {
    const id = Number(rowId.replace(/\D/g, ''));
    return this.http.get<DummyProduct>(`${BASE}/${id}`).pipe(
      map(p => {
        const n = Math.min(12, p.stock % 13);
        return Array.from({ length: n }, (_, i) => ({
          id: `${rowId}-C${i + 1}`,
          filing: ['Annual Report', 'Amendment', 'Registered Agent Change', 'Franchise Tax'][i % 4],
          filedOn: iso(p.meta?.createdAt),
          state: STATES[p.id % STATES.length],
          amount: '$' + Math.round(p.price * (i + 1)).toLocaleString('en-US'),
        }));
      }),
    );
  }
}
