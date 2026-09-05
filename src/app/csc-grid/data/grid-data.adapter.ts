import { Observable } from 'rxjs';
import { ChildRecord, EnterpriseRecord, GridQuery, Page } from './grid-query.model';

/** Contract every data source honours. Filtering, sorting, searching and
 *  paging all happen behind this boundary — the grid never sees the full set. */
export abstract class GridDataAdapter {
  abstract readonly id: string;
  abstract readonly label: string;
  /** Shown in the UI so it is obvious which source is live. */
  abstract readonly description: string;

  abstract fetch(query: GridQuery): Observable<Page<EnterpriseRecord>>;

  /** Distinct values for a column's filter list. Must not depend on the
   *  currently loaded window — with 10k rows only ~50 are in memory. */
  abstract distinctValues(field: string): Observable<string[]>;

  /** Child records for an expanded row. Resolved on demand, never prefetched. */
  abstract fetchChildren(rowId: string): Observable<ChildRecord[]>;

  /** Whole result set for export, capped by the caller. */
  abstract fetchAll(query: GridQuery, limit: number): Observable<EnterpriseRecord[]>;
}
