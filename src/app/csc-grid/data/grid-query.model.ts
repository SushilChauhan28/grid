import { CscRow, GridColumnDef } from '../models/grid.models';

/** The 10k fixture and the DummyJSON feed are both normalised into this shape.
 *  Extends CscRow so the existing grid can render it unchanged. */
export interface EnterpriseRecord extends CscRow {
  priority: string;
  owner: string;
  ownerEmail: string;
  revenue: number;
  childCount: number;
}

export type FilterOp = 'in' | 'contains' | 'between';

export interface FilterClause {
  field: string;
  op: FilterOp;
  values: string[];
}

export interface SortClause {
  field: string;
  dir: 'asc' | 'desc';
}

export interface GridQuery {
  search: string;
  filters: FilterClause[];
  /** Ordered — index 0 is the primary sort. */
  sort: SortClause[];
  page: number;
  pageSize: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Wall-clock time the adapter took, surfaced in the UI so the perf story is visible. */
  elapsedMs: number;
}

/** A row's lazily-fetched child records, shown in the expandable detail panel. */
export interface ChildRecord {
  id: string;
  filing: string;
  filedOn: string;
  state: string;
  amount: string;
}

export const STATUS_COLORS: Record<string, string> = {
  'Active': '#1f8a5b',
  'In Good Standing': '#1f8a5b',
  'Pending': '#c79a14',
  'Under Review': '#c79a14',
  'Dissolved': '#6b7280',
  'Suspended': '#b3261e',
};

export const PRIORITY_COLORS: Record<string, string> = {
  'Critical': '#b3261e',
  'High': '#c2410c',
  'Medium': '#c79a14',
  'Low': '#1f8a5b',
};

/** Columns for the All Features section. `type` drives typed sorting — the
 *  legacy sections compare everything as text, so dates sort lexicographically. */
export const ALL_FEATURE_COLUMNS: GridColumnDef[] = [
  { field: 'doc', label: 'Document', editable: false, type: 'number' },
  { field: 'entity', label: 'Entity', type: 'string' },
  { field: 'address', label: 'Address', type: 'string' },
  { field: 'city', label: 'City', type: 'string', editor: 'combo', cascadeFrom: 'state' },
  { field: 'state', label: 'State', type: 'enum', editor: 'combo', cascadeFrom: 'country' },
  { field: 'zip', label: 'Zip', type: 'string' },
  { field: 'country', label: 'Country', type: 'enum', editor: 'combo' },
  { field: 'date', label: 'Date', type: 'date' },
  { field: 'status', label: 'Status', type: 'enum', editor: 'combo' },
  { field: 'priority', label: 'Priority', type: 'enum', editor: 'combo' },
  { field: 'owner', label: 'Owner', type: 'string' },
  { field: 'updated', label: 'Last Updated', editable: false, type: 'datetime' },
];

export const EMPTY_QUERY: GridQuery = {
  search: '', filters: [], sort: [], page: 0, pageSize: 50,
};
