import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, of, shareReplay, switchMap, throwError } from 'rxjs';
import { GridDataAdapter } from './grid-data.adapter';
import {
  ALL_FEATURE_COLUMNS, ChildRecord, EnterpriseRecord, GridQuery, Page, STATUS_COLORS,
} from './grid-query.model';

const COLUMN_TYPES = new Map(ALL_FEATURE_COLUMNS.map(c => [c.field, c.type ?? 'string']));
const SEARCHABLE = ['doc', 'entity', 'address', 'city', 'state', 'zip', 'country', 'status', 'priority', 'owner'];

/** Parses 'MM/DD/YYYY' and 'MM/DD/YYYY hh:mm AM' to epoch ms. Returning NaN for
 *  anything else keeps unparseable values from silently sorting as 1970. */
function toEpoch(v: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})\s+(AM|PM))?$/.exec(v ?? '');
  if (!m) return NaN;
  let h = m[4] ? Number(m[4]) % 12 : 0;
  if (m[6] === 'PM') h += 12;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5] ?? 0)).getTime();
}

function compare(a: unknown, b: unknown, type: string): number {
  if (type === 'number') {
    const na = Number(a), nb = Number(b);
    return (Number.isNaN(na) ? 0 : na) - (Number.isNaN(nb) ? 0 : nb);
  }
  if (type === 'date' || type === 'datetime') {
    const da = toEpoch(String(a)), db = toEpoch(String(b));
    if (Number.isNaN(da) && Number.isNaN(db)) return 0;
    if (Number.isNaN(da)) return 1;
    if (Number.isNaN(db)) return -1;
    return da - db;
  }
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Serves the 10,000-record Mockaroo-schema fixture from `public/data/`, applying
 * search, filter, multi-sort and paging in memory before responding — i.e. it
 * behaves like a paging API, so the grid can be built against a server contract
 * without a backend. Latency is simulated so loading and skeleton states are
 * actually exercised rather than flashing past.
 */
@Injectable({ providedIn: 'root' })
export class MockarooAdapter extends GridDataAdapter {
  readonly id = 'mockaroo-10k';
  readonly label = 'Mockaroo — 10,000 records';
  readonly description = 'Local fixture served through a simulated paging API with 120–320 ms latency.';

  private http = inject(HttpClient);
  /** Injected failure for exercising the error state; toggled from the UI. */
  failNextRequest = false;

  private all$ = this.http.get<EnterpriseRecord[]>('data/entities-10k.json').pipe(
    map(rows => rows.map(r => ({ ...r, statusColor: STATUS_COLORS[r.status] ?? '#6b7280' }))),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  private latency(): number { return 120 + Math.round(Math.random() * 200); }

  private applyQuery(rows: EnterpriseRecord[], q: GridQuery): EnterpriseRecord[] {
    let out = rows;

    const needle = q.search.trim().toLowerCase();
    if (needle) {
      out = out.filter(r => SEARCHABLE.some(f => String((r as any)[f] ?? '').toLowerCase().includes(needle)));
    }

    for (const c of q.filters) {
      if (!c.values.length) continue;
      if (c.op === 'in') {
        const set = new Set(c.values);
        out = out.filter(r => set.has(String((r as any)[c.field] ?? '')));
      } else if (c.op === 'contains') {
        const v = c.values[0].toLowerCase();
        out = out.filter(r => String((r as any)[c.field] ?? '').toLowerCase().includes(v));
      }
    }

    if (q.sort.length) {
      // Copy first: the shared fixture must not be reordered in place.
      out = out.slice().sort((a, b) => {
        for (const s of q.sort) {
          const r = compare((a as any)[s.field], (b as any)[s.field], COLUMN_TYPES.get(s.field) ?? 'string');
          if (r !== 0) return s.dir === 'desc' ? -r : r;
        }
        return 0;
      });
    }
    return out;
  }

  fetch(query: GridQuery): Observable<Page<EnterpriseRecord>> {
    const started = performance.now();
    return this.all$.pipe(
      switchMap(all => {
        if (this.failNextRequest) {
          this.failNextRequest = false;
          return throwError(() => new Error('Simulated upstream failure (503). The request was not completed.'));
        }
        const matched = this.applyQuery(all, query);
        const start = query.page * query.pageSize;
        return of<Page<EnterpriseRecord>>({
          rows: matched.slice(start, start + query.pageSize),
          total: matched.length,
          page: query.page,
          pageSize: query.pageSize,
          elapsedMs: Math.round(performance.now() - started),
        });
      }),
      delay(this.latency()),
    );
  }

  fetchAll(query: GridQuery, limit: number): Observable<EnterpriseRecord[]> {
    return this.all$.pipe(map(all => this.applyQuery(all, query).slice(0, limit)));
  }

  distinctValues(field: string): Observable<string[]> {
    return this.all$.pipe(
      map(all => [...new Set(all.map(r => String((r as any)[field] ?? '')))]
        .sort((a, b) => compare(a, b, COLUMN_TYPES.get(field) ?? 'string'))),
    );
  }

  fetchChildren(rowId: string): Observable<ChildRecord[]> {
    return this.all$.pipe(
      map(all => {
        const row = all.find(r => r.id === rowId);
        const n = row?.childCount ?? 0;
        const kinds = ['Annual Report', 'Amendment', 'Registered Agent Change', 'Franchise Tax', 'Certificate of Good Standing', 'Merger Filing'];
        return Array.from({ length: n }, (_, i) => ({
          id: `${rowId}-C${i + 1}`,
          filing: kinds[i % kinds.length],
          filedOn: row?.date ?? '',
          state: row?.state ?? '',
          amount: '$' + (250 + i * 175).toLocaleString('en-US'),
        }));
      }),
      delay(this.latency()),
    );
  }
}
