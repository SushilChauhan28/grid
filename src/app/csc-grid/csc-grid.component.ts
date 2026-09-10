import {
  Component, OnInit, OnDestroy, AfterViewInit, AfterViewChecked, ChangeDetectionStrategy,
  signal, computed, effect, untracked, DestroyRef, inject, Input, ChangeDetectorRef, ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { A11yAnnounceService } from './services/a11y-announce.service';
import { FocusTrapDirective } from './directives/focus-trap.directive';
import { GridDataStore, PagingMode } from './data/grid-data.store';
import { ALL_FEATURE_COLUMNS } from './data/grid-query.model';
import {
  CscRow, Section, NavItem, ColumnView, RowView, CellView,
  PageButton, FilterValue, ChooserItem, AddField, Shortcut, ToolbarAction,
  GridColumnDef,
} from './models/grid.models';

// ─── Constants ────────────────────────────────────────────────────────────────
interface MenuItem {
  label: string; icon: string; iconColor: string; idx: number;
  radioValue?: string; checked?: boolean;
  /** Renders as aria-disabled rather than removed: a menu whose length changes
   *  as you move a column around is disorienting, and roving focus skips these. */
  disabled?: boolean;
  /** Extra context read after the label, e.g. "sized to fit content". */
  desc?: string;
}
interface MenuGroup { label?: string; isRadioGroup?: boolean; radioName?: string; groupId?: string; items: MenuItem[]; }
// The sample dataset pairs country and state at random, so the Country →
// State cascade is declared rather than derived.
const STATE_BY_COUNTRY: Record<string, string[]> = {
  'United States (USA)': ['AZ','CO','DE','FL','GA','ID','KY','MA','MO','NC','NJ','NV','OH','OR','PA','TX','WA','WI'],
  'Canada (CAN)':        ['AB','BC','MB','NB','NL','NS','ON','PE','QC','SK'],
  'Mexico (MEX)':        ['CDMX','JAL','MEX','NLE','PUE','QRO','VER','YUC'],
};
const DEFAULT_COLS: GridColumnDef[] = [
  { field: 'doc',     label: 'Document', editable: false },
  { field: 'entity',  label: 'Entity' },
  { field: 'address', label: 'Address' },
  { field: 'city',    label: 'City',    editor: 'combo', cascadeFrom: 'state' },
  { field: 'state',   label: 'State',   editor: 'combo', cascadeFrom: 'country', optionsBy: STATE_BY_COUNTRY },
  { field: 'zip',     label: 'Zip' },
  { field: 'country', label: 'Country', editor: 'combo' },
  { field: 'date',    label: 'Date' },
];
/**
 * The grid's own controls, which are now real columns: they take part in
 * ordering, pinning and the Choose Columns dialog exactly like data columns.
 *
 * They stay OUT of colDefs() because that is the host's public `columnDefs`
 * input - the host describes its data, not the grid's furniture. Everything
 * that needs "all columns" reads allColDefs() instead.
 */
type ActionKind = 'expand' | 'lead' | 'delete';
const ACTION_COLS: { field: string; label: string; kind: ActionKind }[] = [
  { field: 'expand-col', label: 'Expand', kind: 'expand' },
  { field: 'lead',       label: 'Select', kind: 'lead'   },
  { field: 'delete-col', label: 'Delete', kind: 'delete' },
];
const ACTION_FIELDS = ACTION_COLS.map(c => c.field);
/** Action columns can NEVER become rowheader - they carry no data meaning. */
const ACTION_COL_IDS = new Set(ACTION_FIELDS);
/**
 * Nothing is locked. Unchecking an action column in Choose Columns is not a
 * visibility toggle - it switches the whole FEATURE off. Select off means no
 * checkboxes, no Space-to-select and no selection bar; Delete off means no
 * delete buttons and a dead Delete key; Expand off means no chevrons and every
 * open row collapses. See the has*Feature computeds on the component.
 */
/** Action columns are frozen left out of the box: they are controls FOR a row,
 *  and a control that scrolls away from its row is useless. */
function defaultPins(): Record<string, 'left' | 'right'> {
  return Object.fromEntries(ACTION_FIELDS.map(f => [f, 'left' as const]));
}

/** Narrowest a column may be resized to, by mouse or keyboard. Also what the
 *  resize grip advertises as aria-valuemin, so the announced range and the
 *  enforced range cannot drift apart. */
const MIN_COL_W = 60;

// ─── Section-isolated state ───────────────────────────────────────────────────
interface SectionState {
  sortField: string | null;
  sortDir: 'asc' | 'desc' | null;
  filters: Record<string, string[]>;
  /** field -> which edge it is frozen against. Absent = not pinned.
   *  (Was typed Record<string,boolean> while actually storing 'left'/'right',
   *  which is why every read site had to cast through `any`.) */
  pinnedCols: Record<string, 'left' | 'right'>;
  colOrder: string[];
  colHidden: Record<string, boolean>;
}
function defaultSectionState(order?: string[]): SectionState {
  return {
    sortField: null, sortDir: null,
    filters: {}, pinnedCols: defaultPins(),
    colOrder: [...ACTION_FIELDS, ...(order ?? DEFAULT_COLS.map(c => c.field))],
    colHidden: {},
  };
}

// ─── Sample data ──────────────────────────────────────────────────────────────
function makeRows(): CscRow[] {
  const names = ['Affordable Aluminum Inc.','Affordable Food Cart Rentals','Affordable Trailers LLC','All-State Ford Truck Sales','Allegheny Ford Truck Sales','Alloy Wheel Repair Specialists','AMI Truck Equipment','Apple Ford Inc.','Archibald Ford','Ashford Manufacturing Co.','Bradford Built Inc.','Broadway Ford Truck Sales','Cedar Point Holdings','Delaware Trust Partners','Evergreen Logistics LLC','Frontier Equipment Co.','Gateway Industrial','Harbor Freight Depot','Ironclad Storage LLC','Junction Auto Group','Keystone Fabrication','Lakeside Ventures','Meridian Capital LLC','Northgate Supply Co.','Oakwood Enterprises','Pinnacle Freight','Quantum Materials','Riverside Holdings','Summit Trailers Inc.','Titan Equipment Co.','Union Logistics LLC','Valley Forge Supply','Westbrook Industries','Yellowstone Trading','Zenith Manufacturing','Beacon Hill LLC','Crestview Partners','Drexel Holdings','Eastgate Supply','Fairfield Trust LLC'];
  const places: [string,string,string][] = [['Wilmington','DE','19808'],['Largo','FL','33770'],['Mulino','OR','97042'],['Lubbock','TX','79404'],['Louisville','KY','40213'],['Pittsburgh','PA','15201'],['Norcross','GA','30071'],['Marlboro','MA','01752'],['St. Louis','MO','63102'],['Dover','DE','19901'],['Austin','TX','78701'],['Reno','NV','89501'],['Boise','ID','83702'],['Tacoma','WA','98402'],['Akron','OH','44301']];
  const agents = ['CSC - Lawyers Incorporating','C T Corporation System','Registered Agents Inc.','National Registered Agents','Corporation Service Company'];
  const statuses: [string,string][] = [['Active','#1f8a5b'],['Pending','#c79a14'],['In Good Standing','#1f8a5b'],['Under Review','#c79a14']];
  const juris = ['Delaware','Texas','Oregon','Kentucky','Pennsylvania','Florida','Georgia'];
  const streets = ['Main St','Starkey Rd','Industrial Pkwy','Gardiner Ln','50th Street','Windy City Rd'];
  return Array.from({ length: 40 }, (_, i) => {
    const p = places[i % places.length], st = statuses[i % statuses.length];
    const mm = String((i % 12) + 1).padStart(2, '0'), dd = String((i % 27) + 1).padStart(2, '0');
    return {
      id: 'D' + (100245 + i), doc: String(1000245 + i),
      entity: names[i % names.length],
      address: `${100 + i * 7} ${streets[i % streets.length]}, Suite ${100 + i}`,
      city: p[0], state: p[1], zip: p[2] + '-0000', country: 'United States (USA)',
      date: `${mm}/${dd}/2024`,
      agent: agents[i % agents.length], jurisdiction: juris[i % juris.length],
      status: st[0], statusColor: st[1], updated: `${mm}/${dd}/2024 09:1${i % 6} AM`,
    };
  });
}

/** One dataset, handed to every section as the SAME reference. Sections fork it
 *  only when they mutate it, so loading costs nothing extra. */
function seedBySection(rows: CscRow[]): Record<Section, CscRow[]> {
  return { basic: rows, advanced: rows, editable: rows, simple: rows, expandable: rows, all: rows };
}

// ─── Component ────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-csc-grid',
  standalone: true,
  imports: [CommonModule, FocusTrapDirective],
  templateUrl: './csc-grid.component.html',
  styleUrl: './csc-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CscGridComponent implements OnInit, AfterViewInit, AfterViewChecked, OnDestroy {
  @Input() accentColorProp: 'Teal' | 'Navy' = 'Teal';
  @Input() densityProp: 'Standard' | 'Compact' = 'Standard';
  @Input() zebraProp = true;

  /** Real row data from the host app. Falls back to built-in demo rows when not provided. */
  @Input() set data(v: CscRow[] | null | undefined) {
    if (v && v.length) { this._hostRows = true; this.setRowsForAllSections(v); this.clearAllSelections(); this.page.set(0); }
  }
  /** Host-supplied rows win over the live fetch, whichever arrives first. */
  private _hostRows = false;

  /** Column definitions (field + label). Falls back to the built-in 8 columns when not provided.
   *  Resets per-section order/visibility/filters/sort so stale field refs can't linger. */
  @Input() set columnDefs(defs: GridColumnDef[] | null | undefined) {
    if (!defs || !defs.length) return;
    this._colDefs.set(defs);
    const order = defs.map(d => d.field);
    this.sectionStates.update(all => {
      const next = { ...all } as typeof all;
      (Object.keys(next) as (keyof typeof next)[]).forEach(s => {
        if (s === 'all') return; // All Features owns its own column set
        next[s] = { ...next[s], colOrder: [...ACTION_FIELDS, ...order], colHidden: {}, filters: {},
                    pinnedCols: defaultPins(), sortField: null, sortDir: null };
      });
      return next;
    });
  }

  private _colDefs = signal<GridColumnDef[]>(DEFAULT_COLS);
  /** Active column definitions (default: the built-in 8 CSC columns). */
  colDefs = computed(() => this.isAllFeatures() ? ALL_FEATURE_COLUMNS : this._colDefs());
  /** Fields editable in the Add/inline-edit flows: every column except the doc link. */
  editFields = computed(() => this.colDefs().map(c => c.field).filter(f => f !== 'doc'));

  private hostEl: ElementRef<HTMLElement> = inject(ElementRef);
  private announceService = inject(A11yAnnounceService);
  private cdr = inject(ChangeDetectorRef);
  /** Async data layer. Only the All Features section reads from it. */
  readonly ds = inject(GridDataStore);

  // ── Global state (shared across sections) ─────────────────────────────────
  section  = signal<Section>('basic');
  /**
   * Row data is owned PER SECTION, not globally.
   *
   * The six demo sections are independent feature demos, not one shared
   * workspace: an edit made in Editable has no business appearing in Basic,
   * which is not even editable. A single `rows` signal made every section share
   * one array, so committing a cell in Editable rewrote the array Basic was
   * reading and its dirty marker (keyed only 'rowId::field') lit up there too.
   *
   * Isolation is by reference, not by copying: every section starts pointing at
   * the SAME array, and every mutation here is already copy-on-write
   * (`rows.map(...)` / `filter(...)`), so a write forks only the writing
   * section's array — and inside it, only the row object that actually changed.
   * Untouched sections keep the original array and the original row objects, so
   * nothing is cloned until something is edited. Row ids are never rewritten,
   * so selection, expansion and focus keys stay valid across the fork.
   */
  private _rowsBySection = signal<Record<Section, CscRow[]>>(seedBySection(makeRows()));
  rows = computed(() => this._rowsBySection()[this.section()]);
  /** Writes rows for the CURRENT section only. Every mutation path goes here. */
  private setRows(next: CscRow[]): void {
    const s = this.section();
    this._rowsBySection.update(all => ({ ...all, [s]: next }));
  }
  /** Seeds every section from one dataset — loading data is not a mutation, so
   *  all six go back to sharing a single array reference. */
  private setRowsForAllSections(next: CscRow[]): void {
    this._rowsBySection.set(seedBySection(next));
  }
  /** Selection is per-section, not global: checking rows in Basic must not
   *  show them checked in Advanced / Editable / Expandable. */
  private _selectedBySection = signal<Record<Section, Record<string, boolean>>>({
    basic: {}, advanced: {}, editable: {}, simple: {}, expandable: {}, all: {},
  });
  selected = computed(() => this._selectedBySection()[this.section()]);
  page     = signal(0);
  pageSize = signal(10);
  /** Which rows are currently in edit mode. Record (not a single id) so
   *  multiple rows can be edited concurrently — either individually (pencil
   *  icon per row) or all at once via the header "Edit All" control. */
  /** The single cell being edited, as 'rowId::field', or null. Deliberately a
   *  single value rather than a Record: model B allows exactly one cell in edit
   *  mode, so an invalid "two cells editing" state should not be representable. */
  editingCell = signal<string | null>(null);
  /** Each editing row's own in-progress draft, keyed by row id. */
  /** In-progress text for the cell currently being edited. */
  draft       = signal<string>('');
  /** Count of rows currently being edited — drives the header Edit/Save-All/Cancel-All UI. */
  editingCount = computed(() => this.editingCell() ? 1 : 0);
  expanded    = signal<Record<string, boolean>>({});

  // ── Text size ───────────────────────────────────────────────────────────
  /** Root font size in px. Every dimension in the stylesheet is expressed in
   *  rem, so changing this scales text AND the boxes around it - no clipping. */
  /** Discrete steps rather than free zoom, so every stop stays a tested layout. */
  readonly textSteps = [
    { px: 14, label: 'Small' },
    { px: 16, label: 'Default' },
    { px: 18, label: 'Large' },
    { px: 20, label: 'Extra large' },
  ];
  textStep = signal(1);
  textStepLabel = computed(() => this.textSteps[this.textStep()].label);
  canGrowText   = computed(() => this.textStep() < this.textSteps.length - 1);
  canShrinkText = computed(() => this.textStep() > 0);

  stepTextSize(delta: number): void {
    const next = Math.max(0, Math.min(this.textStep() + delta, this.textSteps.length - 1));
    if (next === this.textStep()) return;
    this.textStep.set(next);
    const opt = this.textSteps[next];
    // rem resolves against the document root, so the root is what has to move.
    // Setting it on the host did nothing - that was the bug.
    document.documentElement.style.fontSize = opt.px + 'px';
    // The control now shows a static "Text size" label, so the new value is
    // conveyed by announcement rather than by reading the visible text.
    this.announceService.announce('Text size ' + opt.label);
    // Widths were measured at the previous size and no longer fit; re-measure
    // once the browser has laid out at the new size.
    setTimeout(() => { this.autosizeAllColumns(true); this.cdr.markForCheck(); });
  }

  /** Cells whose committed value differs from the original data, keyed
   *  'rowId::field'. Survives commit (unlike drafts) because it is the
   *  "you changed this" indicator, and is cleared automatically when a value
   *  is edited back to what it started as. */
  /** Per section, for the same reason rows are: the key is 'rowId::field' with
   *  no section component, so one shared map showed Editable's markers in Basic
   *  on the very same row id. */
  private _dirtyBySection = signal<Record<Section, Record<string, boolean>>>({
    basic: {}, advanced: {}, editable: {}, simple: {}, expandable: {}, all: {},
  });
  dirtyCells = computed(() => this._dirtyBySection()[this.section()]);
  private updateDirty(fn: (m: Record<string, boolean>) => Record<string, boolean>): void {
    const s = this.section();
    this._dirtyBySection.update(all => ({ ...all, [s]: fn(all[s]) }));
  }
  /** Pristine snapshot taken on first edit of a cell, used to detect when a
   *  value has been returned to its original and the marker should clear.
   *  Per section too: sections now hold different values for the same cell, so
   *  one shared baseline would compare an edit against another section's data. */
  private _originalBySection: Record<Section, Record<string, string>> = {
    basic: {}, advanced: {}, editable: {}, simple: {}, expandable: {}, all: {},
  };
  private get _original(): Record<string, string> {
    return this._originalBySection[this.section()];
  }

  /** Column-level editability. Undefined means editable (opt-out, not opt-in). */
  isFieldEditable(field: string): boolean {
    return this.colDefs().find(c => c.field === field)?.editable !== false;
  }

  /** Fields whose editor is a dropdown. Simplified Editable honours the
   *  `editor: 'combo'` column metadata; the other demo sections are left on
   *  plain text inputs so their behaviour is unchanged. */
  private comboFields = computed((): Set<string> =>
    this.isSimple()
      ? new Set(this.colDefs().filter(c => c.editor === 'combo').map(c => c.field))
      : new Set<string>());

  /** Choice list for one cell: the column's own `options` when it declares
   *  one, otherwise the distinct values in the data — narrowed to rows that
   *  share this row's parent value when the column cascades. */
  private comboOptionsFor(field: string, row: CscRow | null | undefined): string[] {
    const def = this.colDefs().find(c => c.field === field);
    if (def?.options?.length) return [...def.options];
    const parent = def?.cascadeFrom;
    const pv = parent && row ? String((row as Record<string, any>)[parent] ?? '') : '';
    if (pv && def?.optionsBy?.[pv]?.length) return [...def.optionsBy[pv]];
    const src = this.isServerMode() ? (this.ds.rows() as unknown as CscRow[]) : this.rows();
    const distinct = (pool: CscRow[]): string[] =>
      [...new Set(pool.map(r => String((r as Record<string, any>)[field] ?? '')).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    if (pv) {
      const scoped = distinct(src.filter(r => String((r as Record<string, any>)[parent!] ?? '') === pv));
      // An unrecognised parent must not leave the editor with nothing to pick.
      if (scoped.length) return scoped;
    }
    return distinct(src);
  }

  /** Per-section+field autosize state: key = section+':'+field. True while the
   *  column's width is the autosized one; cleared on any MANUAL resize so the
   *  menu checkmark accurately reflects reality. */
  autoFitFlags = signal<Record<string, boolean>>({});
  /** Sections already default-autosized once (so we don't stomp user widths later). */
  private _defaultAutosized = new Set<string>();
  chooserOpen = signal(false);
  chooserSearch = signal('');
  /** Announce how many columns the chooser search matched. */
  onChooserSearch(v: string): void {
    this.chooserSearch.set(v);
    const n = this.chooserItems().length;
    this.announceService.announce(n === 0 ? 'No results found' : n + (n === 1 ? ' result shown' : ' results shown'));
  }
  cDragField  = signal<string | null>(null);
  cDropTarget = signal<string | null>(null);
  /** Which side of the hovered row/column the drop would land on, so the
   *  insertion line is drawn where the column will actually go. */
  cDropAfter  = signal(false);
  dragField   = signal<string | null>(null);
  dropTarget  = signal<string | null>(null);
  dropAfter   = signal(false);
  filterField = signal<string | null>(null);
  filterX     = signal(0);
  filterY     = signal(0);
  filterSearch= signal('');
  filterDraft = signal<string[] | null>(null);
  menuField   = signal<string | null>(null);
  menuX       = signal(0);
  menuY       = signal(0);
  // pin submenu
  pinMenuOpen = signal(false);
  toast       = signal<string | null>(null);
  legendOpen  = signal(false);
  copied      = signal(false);
  gotoVal     = signal('');
  /** True while select-all is fetching the ids of every matching row. */
  /**
   * Tooltip for text a column is too narrow to show.
   *
   * Nothing is precomputed. Whether a cell is clipped depends on the column
   * width, the text-size stepper and the data itself - all of which change
   * constantly, and 50 rows x 15 columns is 750 measurements to keep fresh.
   * Measuring the one element under the pointer, at the moment it is asked
   * for, is both cheaper and always right.
   */
  /** `flip` = placed ABOVE the cell rather than below it. */
  truncTip = signal<{ text: string; x: number; y: number; flip: boolean } | null>(null);
  /** Long enough that sweeping the mouse across the grid, or arrowing through a
   *  row, never strobes a tooltip on every cell it passes. This delay is what
   *  makes a focus-triggered tooltip usable at all. */
  private readonly tipDelay = 400;
  private _tipTimer: ReturnType<typeof setTimeout> | null = null;
  private _tipHideTimer: ReturnType<typeof setTimeout> | null = null;
  private _tipSource: HTMLElement | null = null;
  /** The cell the visible tooltip belongs to. Held so every reposition can
   *  re-read its rect: a rect captured once goes stale the moment anything
   *  scrolls, and the tooltip is position:fixed, so a stale rect strands it
   *  over unrelated rows instead of following its cell. */
  private _tipAnchor: HTMLElement | null = null;
  /** The clipped text element inside the anchor. It supplies the VERTICAL edge
   *  the tooltip sits against; the anchor cell supplies the horizontal one. */
  private _tipTextEl: HTMLElement | null = null;
  /**
   * The tooltip sits 1px off the source cell's TEXT, not off the cell box.
   *
   * A bigger gap looks like breathing room but there is none to take: rows are
   * adjacent - a cell's bottom edge IS the next row's top edge - so every pixel
   * of gap was carved out of the row below. The text lines are not adjacent
   * though: a 42px row carries 15px of glyphs centred in it, leaving an empty
   * band between one line and the next that the tooltip drops into instead of
   * landing on either.
   */
  private readonly tipGap = 1;
  /** Viewport inset kept clear on every side, and the threshold the flip
   *  decision is measured against. */
  private readonly tipPad = 8;

  selectingAll = signal(false);
  /** Same guard as selectingAll: the id fetch behind Expand all is async, and a
   *  second click while it is in flight would race two writes to `expanded`. */
  expandingAll = signal(false);
  /** Ceiling shared by select-all and export so the two never disagree about
   *  how much of a result set a bulk action covers. */
  private readonly bulkCap = 10000;
  activeRowKey = signal('header');
  activeColKey = signal('lead');
  addOpen  = signal(false);
  addDraft = signal<Partial<CscRow> | null>(null);
  addError = signal<{ field: string; message: string } | null>(null);
  deleteId = signal<string | null>(null);
  /** True while the BULK (delete-selected) confirmation dialog is open. */
  bulkDeleteOpen = signal(false);

  // ── Section-isolated state ────────────────────────────────────────────────
  private sectionStates = signal<Record<Section, SectionState>>({
    basic:      defaultSectionState(),
    advanced:   defaultSectionState(),
    editable:   defaultSectionState(),
    simple:     defaultSectionState(),
    expandable: defaultSectionState(),
    all:        defaultSectionState(ALL_FEATURE_COLUMNS.map(c => c.field)),
  });

  // ── Resize state ──────────────────────────────────────────────────────────
  // Separate colWidths per section
  // Per-section column widths. This MUST be a signal (not a plain object) —
  // gridCols is a computed() and only re-runs when a signal it read changes.
  // Mutating a plain object silently did nothing to the UI.
  private _colWidthsBySectionSig = signal<Record<Section, Record<string, number>>>({
    basic: this.autoWidths(), advanced: this.autoWidths(),
    editable: this.autoWidths(), simple: this.autoWidths(),
    expandable: this.autoWidths(), all: this.autoWidths(),
  });
  resizeModeField = signal<string | null>(null); // currently in keyboard resize mode
  /**
   * Shrink that the minimum-width clamp REFUSED, so a later grow can give it
   * back before it grows anything.
   *
   * Without this, arrow resize is not reversible across the clamp: from 127px,
   * Shift+Left applies -50 to 77, Shift+Left asks for -50 but can only apply
   * -17 (60px floor) and throws the other 33 away, then two Shift+Rights apply
   * a full +50 each and land on 160. The clamp truncates the applied delta
   * while the reverse press still assumes the full step was applied.
   *
   * `width` is the width this component last wrote. If the stored width has
   * moved since - a mouse drag, autosize, Reset columns - the slack is stale
   * and gets dropped, so it can never silently eat a later keypress.
   */
  private _resizeSlack: { field: string; width: number; debt: number } | null = null;

  // ── Internal caches ───────────────────────────────────────────────────────
  private nextSeq = signal(1);
  private _lastFocused: HTMLElement | null = null;
  private _pendingFocusId: string | null = null;
  private _docKeyDown!: (e: KeyboardEvent) => void;
  /** True while focus sits on a grid cell — the signal that virtualization is
   *  allowed to rescue focus if it unmounts that cell. */
  private _cellFocused = false;
  private _docFocusIn = (e: FocusEvent): void => {
    const t = e.target as HTMLElement | null;
    this._cellFocused = !!t?.closest?.('[role="gridcell"],[role="columnheader"]')
      && this.hostEl.nativeElement.contains(t);
  };
  private _filterScrollHandler: (() => void) | null = null;
  private _menuScrollHandler: (() => void) | null = null;
  protected _isDragging = false;
  private _toastTimer: any;
  /** Keyboard-navigable columns for the current section (computed, no effect needed). */
  /** Action columns live in visibleFields() now, so this IS the track order. */
  navCols = computed(() => this.visibleFields());
  _navRowIds: string[] = ['header'];
  // filter popup roving tabindex
  filterFocusIdx = signal(-1);

  // ── Items-per-page combobox (was a click-to-cycle button, which gave the
  //    user no way to see or choose among the options) ──
  pageSizeOpen     = signal(false);
  pageSizeFocusIdx = signal(0);
  readonly pageSizeOptions = [10, 20, 50];
  /** 10 rows per request is pointless against a 10,000-row API, so the server
   *  section offers a page size worth virtualising. */
  pageSizeOpts = computed(() => this.isServerMode() ? [25, 50, 100, 200] : this.pageSizeOptions);
  currentPageSize = computed(() => this.isServerMode() ? this.ds.pageSize() : this.pageSize());

  // ── Section state accessors ───────────────────────────────────────────────
  private ss = computed(() => this.sectionStates()[this.section()]);

  sortField  = computed(() => this.ss().sortField);
  sortDir    = computed(() => this.ss().sortDir);
  filters    = computed(() => this.ss().filters);
  pinnedCols = computed(() => this.ss().pinnedCols);
  colOrder   = computed(() => this.ss().colOrder);
  colHidden  = computed(() => this.ss().colHidden);

  private patchSS(patch: Partial<SectionState>): void {
    const s = this.section();
    this.sectionStates.update(all => ({ ...all, [s]: { ...all[s], ...patch } }));
  }

  private get _colWidths(): Record<string, number> {
    return this._colWidthsBySectionSig()[this.section()];
  }

  /** Immutably patch one column's width in the CURRENT section's width map. */
  private patchColWidth(section: Section, field: string, width: number): void {
    this._colWidthsBySectionSig.update(all => ({
      ...all,
      [section]: { ...all[section], [field]: width },
    }));
  }

  /** Replace the ENTIRE width map for one section (used by autosize-all / reset). */
  private setColWidths(section: Section, widths: Record<string, number>): void {
    this._colWidthsBySectionSig.update(all => ({ ...all, [section]: widths }));
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  accent = computed(() => this.accentColorProp === 'Navy' ? '#003B5C' : '#008996');
  rowH   = computed(() => this.densityProp === 'Compact' ? 34 : 42);

  /** The action columns this section actually renders. Expand and Delete only
   *  exist where the section supports them; Select is always there. */
  actionCols = computed(() => ACTION_COLS.filter(c =>
    c.kind === 'expand' ? this.canExpand() : c.kind === 'delete' ? this.canDelete() : true));

  /** Every column the section can show - action columns first, then the host's
   *  data columns. This, not colDefs(), is what ordering and the chooser use. */
  allColDefs = computed(() => [
    ...this.actionCols().map(c => ({ field: c.field, label: c.label })),
    ...this.colDefs().map(c => ({ field: c.field, label: c.label })),
  ]);

  private actionKindOf(field: string): ActionKind | null {
    return ACTION_COLS.find(c => c.field === field)?.kind ?? null;
  }

  /**
   * Is the feature switched on? Two conditions: the section has to offer it at
   * all, and the user must not have unchecked its column in Choose Columns.
   * Unchecking is a feature switch, so every route into the feature - the
   * buttons, the keyboard shortcuts, the selection bar - is gated on these,
   * not just the column's markup.
   */
  hasSelectFeature = computed(() => !this.colHidden()['lead']);
  hasDeleteFeature = computed(() => this.canDelete() && !this.colHidden()['delete-col']);
  hasExpandFeature = computed(() => this.canExpand() && !this.colHidden()['expand-col']);

  /** The header's delete button never disappears and is never disabled - it
   *  just means different things. With nothing selected it deletes everything
   *  that matches the current filters, across every page; with a selection it
   *  deletes exactly that. Keyed off the SELECTION, not off whether the Select
   *  column is switched on: an option that vanishes is more confusing than one
   *  whose label changes. */
  deleteAllMode = computed(() => !this.hasSelection());
  deleteAllCount = computed(() =>
    this.isServerMode() ? this.ds.total() : this.baseRows().length);

  orderedFields = computed(() => {
    const known = new Set(this.allColDefs().map(c => c.field));
    const order = this.colOrder().filter(f => known.has(f));
    // Action columns are the component's own, so a stored order that predates
    // them - or one rebuilt from a host columnDefs list, which never mentions
    // them - would drop them entirely. Any that are missing lead the list in
    // their canonical order rather than vanishing from the grid.
    const missing = this.actionCols().map(c => c.field).filter(f => !order.includes(f));
    return [...missing, ...order];
  });

  /** Which frozen block a column lives in. Every reorder is confined to one of
   *  these: crossing a boundary would silently change the column's pin state,
   *  which is the Pin control's decision, not a move's side effect. */
  private sectionOf(field: string): 'left' | 'center' | 'right' {
    return this.pinnedCols()[field] ?? 'center';
  }

  /** Applies hiding and pin grouping to a storage order. Split out of
   *  visibleFields so a CANDIDATE order can be projected and compared before it
   *  is committed - that is the only way to tell a reorder that changes what
   *  the user sees from one that storage accepts but the screen undoes. */
  private projectVisible(order: string[]): string[] {
    const hidden = this.colHidden(), pinned = this.pinnedCols();
    const vis = order.filter(f => !hidden[f]);
    return [
      ...vis.filter(f => pinned[f] === 'left'),
      ...vis.filter(f => !pinned[f]),
      ...vis.filter(f => pinned[f] === 'right'),
    ];
  }

  visibleFields = computed(() => this.projectVisible(this.orderedFields()));

  /** The first visible data column that is NOT an action column becomes rowheader */
  rowHeaderField = computed(() => {
    const vis = this.visibleFields();
    return vis.find(f => !ACTION_COL_IDS.has(f)) ?? null;
  });

  baseRows = computed(() => {
    // Server mode: the adapter already searched, filtered and sorted this window.
    // Re-running the client pipeline over it would sort only the loaded page and
    // silently contradict the server's ordering.
    if (this.isServerMode()) return this.ds.rows() as unknown as CscRow[];

    let r = this.rows().slice();
    const f = this.filters();
    Object.keys(f).forEach(field => { if (f[field]?.length) r = r.filter(x => f[field].includes((x as any)[field])); });
    const sf = this.sortField(), sd = this.sortDir();
    if (sf && sd) {
      const dir = sd === 'desc' ? -1 : 1;
      r.sort((a, b) => String((a as any)[sf]).localeCompare(String((b as any)[sf]), undefined, { numeric: true }) * dir);
    }
    return r;
  });

  isBasic      = computed(() => this.section() === 'basic');
  isAdvanced   = computed(() => this.section() === 'advanced');
  isEditable   = computed(() => this.section() === 'editable');
  /** Simplified Editable: same editing behaviour, but every column-layout
   *  control lives in the Choose columns dialog instead of the header. */
  isSimple     = computed(() => this.section() === 'simple');
  isExpandable = computed(() => this.section() === 'expandable');
  isAllFeatures = computed(() => this.section() === 'all');

  /** ── Capabilities ────────────────────────────────────────────────────────
   *  Features were previously gated on section IDENTITY (`isEditable()` etc.),
   *  which made "All Features" impossible to express and had already drifted:
   *  Shift+R and Ctrl+Arrow worked in Basic even though `resizable`/`draggable`
   *  were false there. Gating on capability instead lets one section own
   *  several, and keeps the mouse and keyboard surfaces in agreement. */
  canEdit    = computed(() => this.isEditable() || this.isSimple() || this.isAllFeatures());
  canExpand  = computed(() => this.isExpandable() || this.isAllFeatures());
  canDelete  = computed(() => this.canEdit());
  /** Simplified Editable moves reorder / pin / autosize out of the header, so
   *  the kebab and the header drag affordance have nothing left to offer. */
  canMenu    = computed(() => !this.isBasic() && !this.isSimple());
  canResize  = computed(() => !this.isBasic());
  canReorder = computed(() => !this.isBasic() && !this.isSimple());
  /** All Features reads from a paging API; the other sections hold their rows in memory. */
  isServerMode = computed(() => this.isAllFeatures());

  hasActiveFilter = computed(() => Object.keys(this.filters()).some(k => this.filters()[k]?.length > 0));

  /**
   * Measured widths for the non-data columns (checkbox / expand / delete).
   * These used to be literals in gridCols(); if anyone restyled the checkbox or
   * the action buttons, the literals went stale and the cell clipped - exactly
   * the failure mode the label's min-width caused for data columns.
   */
  leadWidths = signal<Record<string, number>>({});

  /** Track width for one column, whichever kind it is. Action columns keep
   *  their own measured widths (leadWidths) because they are sized from icon
   *  content, not text; the fallbacks apply only before the first measure. */
  private trackFor(field: string): string {
    const lw = this.leadWidths();
    if (field === 'lead') {
      return (lw['lead'] ?? (this.actionCols().length > 1 ? 48 : 72)) + 'px';
    }
    if (this.actionKindOf(field)) return (lw[field] ?? 52) + 'px';
    const w = this._colWidths[field];
    return w ? w + 'px' : 'minmax(100px,1fr)';
  }

  /** Tracks follow visibleFields() exactly, so an action column that has been
   *  reordered or pinned right lands where the user put it. */
  gridCols = computed(() => this.visibleFields().map(f => this.trackFor(f)).join(' '));

  /**
   * Pinning = FREEZING. A left-pinned column stops scrolling horizontally and
   * stays parked against the left edge of the scroll area; a right-pinned one
   * parks against the right edge. (Before this, pin only re-ordered columns
   * and drew a badge - the column still scrolled away like any other, which
   * is not what pinning means.)
   *
   * Implementation is `position:sticky` on the individual grid cells, which
   * needs an explicit left/right offset per column = the summed width of every
   * frozen column ahead of it. That sum is computed here, once, and consumed by
   * both the header row and every data row so they can never drift apart.
   *
   * visibleFields() already groups left-pinned first and right-pinned last, so
   * each frozen group is contiguous - the left group runs from the very start
   * of the row and the right group runs to the very end.
   *
   * Action columns need no special case here any more: they are ordinary
   * members of visibleFields() with their own pin state, left-pinned by default.
   *
   * A column whose width has not been measured yet has no known offset. Rather
   * than guess (a wrong offset shows as a visible gap or overlap), freezing
   * stops at that column - the ones before it still work.
   */
  pinOffsets = computed(() => {
    const left: Record<string, number> = {}, right: Record<string, number> = {};
    /** Paint order INSIDE a frozen block. A resize handle overhangs 9px into the
     *  next column, and a pinned header cell carries a z-index - which makes it
     *  a stacking context, so the handle can never rise above a sibling cell no
     *  matter what z-index the handle itself is given. The only thing that
     *  works is lifting the OWNING cell above the pinned sibling it overhangs,
     *  so each block is painted first-above-last. Cells in a block never
     *  overlap anywhere else, so the reversal costs nothing. Everything stays
     *  above 3, which is what keeps a scrolling column's handle from painting
     *  over the frozen block (see the .csc-pinned-left rule). */
    const z: Record<string, number> = {};
    const pinned = this.pinnedCols();
    const vis = this.visibleFields();
    const anyLeft  = vis.some(f => pinned[f] === 'left');
    const anyRight = vis.some(f => pinned[f] === 'right');
    if (!anyLeft && !anyRight) return { left, right, z, lastLeft: null as string | null, firstRight: null as string | null };

    const lw = this.leadWidths(), w = this._colWidths;
    const widthOf = (key: string): number | null => {
      if (key === 'lead') return lw['lead'] ?? (this.actionCols().length > 1 ? 48 : 72);
      if (this.actionKindOf(key)) return lw[key] ?? 52;
      return w[key] ?? null; // unmeasured data column
    };

    const leftKeys = vis.filter(f => pinned[f] === 'left');
    leftKeys.forEach((k, i) => { z[k] = 4 + (leftKeys.length - i); });
    let acc = 0, lastLeft: string | null = null;
    for (const k of leftKeys) {
      const cw = widthOf(k);
      if (cw === null) break; // unknown width - stop freezing here rather than misalign
      left[k] = acc;
      acc += cw;
      lastLeft = k;
    }

    // Freeze order from the right: walk the right-pinned group backwards.
    const rightKeys = vis.filter(f => pinned[f] === 'right');
    rightKeys.forEach((k, i) => { z[k] = 4 + (rightKeys.length - i); });
    let racc = 0, firstRight: string | null = null;
    for (let i = rightKeys.length - 1; i >= 0; i--) {
      const k = rightKeys[i], cw = widthOf(k);
      if (cw === null) break;
      right[k] = racc;
      racc += cw;
      firstRight = k;
    }
    return { left, right, z, lastLeft, firstRight };
  });

  /** Paint order for a pinned HEADER cell, or null when it is not frozen.
   *  Header cells only - data rows have no resize handle to uncover. */
  pinZ(key: string): number | null {
    const v = this.pinOffsets().z[key];
    return v === undefined ? null : v;
  }

  /** Sticky left offset for a column/action key, or null if it isn't frozen. */
  pinLeft(key: string): number | null {
    const v = this.pinOffsets().left[key];
    return v === undefined ? null : v;
  }
  /** Sticky right offset for a column key, or null if it isn't frozen. */
  pinRight(key: string): number | null {
    const v = this.pinOffsets().right[key];
    return v === undefined ? null : v;
  }
  /** True on the last frozen-left / first frozen-right column, which carries the
   *  shadow marking the boundary between frozen and scrolling content. */
  isPinEdgeLeft(key: string): boolean  { return this.pinOffsets().lastLeft === key; }
  isPinEdgeRight(key: string): boolean { return this.pinOffsets().firstRight === key; }

  sectionMeta = computed(() => ({
    basic:      { title: 'Basic Usage',       subtitle: 'Basic Grid shows simple data rendering with sorting, multi-select via checkboxes, and hyperlinked records enabled by default.' },
    advanced:   { title: 'Advanced Features', subtitle: 'Adds pagination, a column menu (pin, autosize, reset), per-column filtering with a live result count, and status confirmations for every action.' },
    editable:   { title: 'Editable Grid',     subtitle: 'Inline row editing with dedicated Edit and Delete columns. Press Enter to save, Escape to cancel.' },
    simple:     { title: 'Simplified Editable Grid', subtitle: 'Same inline editing, with a decluttered header: columns carry only their label, sort and filter. Visibility, order, pinning and autosize all move into the Choose columns dialog.' },
    expandable: { title: 'Expandable Rows',   subtitle: 'Each record expands to reveal a detail section with registered agent, jurisdiction, filing status, and last-updated metadata.' },
    all:        { title: 'All Features',      subtitle: 'Every capability in one grid over a live paging API: 10,000+ records with virtual scrolling, server-side search, filtering and multi-column sort, inline editing, lazy-loaded detail panels, export, and full keyboard and screen reader support.' },
  }[this.section()]));

  navItems = computed((): NavItem[] => {
    const s = this.section(), a = this.accent();
    return (['basic','advanced','editable','simple','expandable','all'] as Section[]).map((k, i) => ({
      key: k,
      label: ['Basic usage','Advanced features','Editable','Simplified editable','Expandable','All features'][i],
      on: s === k,
      bar: s === k ? a : 'transparent',
      bg: s === k ? '#eef6f7' : '#fff',
      color: s === k ? '#013a4f' : '#5b6b76',
      weight: s === k ? '700' : '400',
    }));
  });

  columns = computed((): ColumnView[] => {
    const s = this.section(), a = this.accent();
    const sf = this.sortField(), sd = this.sortDir();
    const canReorder = this.canReorder(), resizable = this.canResize();
    const tint = this.accentColorProp === 'Navy' ? 'rgba(0,59,92,0.18)' : 'rgba(0,137,150,0.16)';
    const visFields = this.visibleFields();
    const ark = this.activeRowKey(), ack = this.activeColKey();
    const pinned = this.pinnedCols(), filters = this.filters();
    const rhf = this.rowHeaderField();
    return visFields.map((field, fi) => {
      // Action columns render their own control instead of a sortable header,
      // so they only need identity, geometry and pin state. The template
      // switches on `kind` and ignores the rest.
      const kind = this.actionKindOf(field);
      if (kind) {
        const isActive = ark === 'header' && ack === field;
        // Pin state belongs here for the same reason it does on a data header:
        // the badge is gone and the frozen boundary is drawn as a separator,
        // which no screen reader can report. Without this an action column was
        // the one pinned thing in the grid that never said so.
        const pinNote = pinned[field] ? ', pinned ' + pinned[field] : '';
        return {
          kind, field, label: this.colLabel(field),
          ariaColIndex: String(fi + 1), cellId: 'gc-header-' + field,
          tabIndex: isActive ? '0' : '-1',
          isAsc: false, isDesc: false, noSort: true, ariaSort: 'none',
          sortLevel: null, sortTitle: '',
          headerAriaLabel: this.colLabel(field) + ' actions' + pinNote, headerAriaDesc: '',
          sortBg: 'transparent', sortBorder: 'none', filterBg: 'transparent', filterBorder: 'none',
          showMenu: false, resizable: false, showEditableIcon: false,
          // Reorderable exactly like a data column. The Choose columns dialog
          // has always let these be moved (they carry an Order field like every
          // other row), so leaving them out of drag and drop meant the two
          // paths disagreed about what the user was allowed to do - and the
          // header path failed silently, because a cell with no drop handler
          // simply swallows the drop.
          draggable: canReorder, dragOpacity: this.dragField() === field ? 0.4 : 1,
          dropShadow: canReorder && this.dropTarget() === field
            && this.dragField() && this.dragField() !== field
            ? (this.dropAfter() ? 'inset -3px 0 0 0 ' + a : 'inset 3px 0 0 0 ' + a) : 'none',
          isRowHeader: false, isResizing: false,
          resizerAriaLabel: '', resizerAriaValueNow: '', resizerAriaMin: '', resizerAriaMax: '',
        } satisfies ColumnView;
      }
      const c = this.colDefs().find(x => x.field === field)!;
      // In server mode the sort is a list, so a column can be sorted at level 2
      // even though it is not the primary key.
      const srv = this.isServerMode() ? this.ds.sortFor(field) : null;
      const isAsc = srv ? srv.dir === 'asc' : (sf === field && sd === 'asc');
      const isDesc = srv ? srv.dir === 'desc' : (sf === field && sd === 'desc');
      const sortLevel = srv && srv.of > 1 ? String(srv.level) : null;
      const sActive = isAsc || isDesc, filterActive = !!(filters[field]?.length);
      const isDropTarget = canReorder && this.dropTarget() === field && this.dragField() && this.dragField() !== field;
      const isActiveCell = ark === 'header' && ack === field;
      const isPinned = !!pinned[field];
      // aria-label for column header: include sort + filter state
      let headerAriaLabel = c.label;
      if (sActive) headerAriaLabel += ', sorted ' + (isAsc ? 'ascending' : 'descending');
      if (sortLevel) headerAriaLabel += `, sort level ${sortLevel} of ${srv!.of}`;
      if (filterActive) headerAriaLabel += ', filter applied';
      // The pin badge is gone from the header - the frozen boundary is drawn as
      // a separator instead, which no screen reader can report. This label is
      // now the only channel carrying pin state at the column itself, so it
      // applies in every section, not just Simplified Editable (which never had
      // a header pin control to fall back on).
      if (isPinned) headerAriaLabel += ', pinned ' + pinned[field];
      // aria-description: keyboard hints
      // "editable column" is spoken, not just shown as a pencil glyph, so the
      // affordance is not colour/icon-only (WCAG 1.4.1).
      const editableNote = (this.canEdit() && this.isFieldEditable(field)) ? ' Editable column.' : '';
      const headerAriaDesc = `Press Enter to sort${this.isServerMode() ? ', or Shift+Enter to add this column to the sort' : ''}. Press Ctrl+Enter to open filter${resizable ? '. Press Shift+R to enter resize mode' : ''}${this.canMenu() ? '. Press Shift+M to open column menu' : ''}.${editableNote}`;
      return {
        kind: 'data' as const,
        field, label: c.label, isAsc, isDesc, noSort: !sActive,
        sortLevel,
        sortTitle: this.isServerMode() ? 'Sort (Shift+click to add to sort)' : 'Sort',
        ariaSort: isAsc ? 'ascending' : isDesc ? 'descending' : 'none',
        // Action columns are part of the grid geometry now, so a data column's
        // index is simply its place in the visible list - no fixed +1 for a
        // lead cell that may not even be first any more.
        ariaColIndex: String(fi + 1), cellId: 'gc-header-' + field,
        tabIndex: isActiveCell ? '0' : '-1',
        headerAriaLabel, headerAriaDesc,
        sortBg: sActive ? tint : 'transparent', sortBorder: sActive ? '1px solid ' + a : '1px solid transparent',
        filterBg: filterActive ? tint : 'transparent', filterBorder: filterActive ? '1px solid ' + a : '1px solid transparent',
        showMenu: this.canMenu(), resizable,
        showEditableIcon: this.canEdit() && !this.isSimple() && this.isFieldEditable(field),
        draggable: canReorder, dragOpacity: this.dragField() === field ? 0.4 : 1,
        dropShadow: isDropTarget
          ? (this.dropAfter() ? 'inset -3px 0 0 0 ' + a : 'inset 3px 0 0 0 ' + a) : 'none',
        isRowHeader: field === rhf,
        isResizing: this.resizeModeField() === field,
        // ARIA separator pattern for the resize grip (role="separator" applied in template)
        resizerAriaLabel: c.label + ' column resizer',
        resizerAriaValueNow: String(this._colWidths[field] ?? 120),
        resizerAriaMin: String(MIN_COL_W),
        resizerAriaMax: '800',
      };
    });
  });

  private sliceInfo = computed(() => {
    const base = this.baseRows();
    if (this.isServerMode()) {
      // The window IS the page; slicing again would drop rows the server sent.
      const total = this.ds.total(), ps = this.ds.pageSize();
      const infinite = this.ds.mode() === 'infinite';
      const p = this.ds.page();
      return {
        base, total,
        pageCount: Math.max(1, Math.ceil(total / ps)),
        page: infinite ? 0 : p,
        usePaging: !infinite,
        start: infinite ? 0 : p * ps,
        end: (infinite ? 0 : p * ps) + base.length,
        slice: base,
      };
    }
    const total = base.length, ps = this.pageSize();
    const pageCount = Math.max(1, Math.ceil(total / ps));
    const p = Math.min(this.page(), pageCount - 1);
    const start = p * ps;
    return { base, total, pageCount, page: p, usePaging: true, start, end: start + ps, slice: base.slice(start, start + ps) };
  });

  // Expose sliceInfo to template
  get sliceInfoVal() { return this.sliceInfo(); }

  // ── Row virtualization ────────────────────────────────────────────────────
  /** Infinite mode is the only mode whose row set grows without bound; every
   *  other mode is already capped at one page, where windowing would cost more
   *  than it saves. */
  virtualOn = computed(() => this.isServerMode() && this.ds.mode() === 'infinite');

  // Geometry is tracked in viewport coordinates rather than scroll offsets, so
  // the same maths works whether the grid scrolls inside .csc-main or the page
  // itself is the scroller.
  private viewportTop = signal(0);
  private viewportH = signal(800);
  /** Viewport y of the first data row's top edge. */
  private rowsTop = signal(0);
  /** Sticky header height — a revealed row has to clear it, not hide under it. */
  private headerH = signal(48);
  /** Measured height of a collapsed row; the CSS min-height is only a floor. */
  private measuredRowH = signal(0);
  /** Measured detail-panel heights, so an open row still reserves the right
   *  amount of scroll space once it is windowed out. */
  private panelH = signal<Record<string, number>>({});
  private scroller: HTMLElement | null = null;
  private readonly overscan = 6;
  private readonly panelEstimate = 240;

  /** Prefix sums of row heights: rowTops()[i] is the top edge of row i. */
  private rowTops = computed(() => {
    const rows = this.sliceInfo().slice;
    const h = this.measuredRowH() || this.rowH() + 1;
    const exp = this.expanded(), ph = this.panelH();
    const tops = new Array<number>(rows.length + 1);
    tops[0] = 0;
    for (let i = 0; i < rows.length; i++) {
      const extra = exp[rows[i].id] ? (ph[rows[i].id] ?? this.panelEstimate) : 0;
      tops[i + 1] = tops[i] + h + extra;
    }
    return tops;
  });

  /** The stretch of loaded rows that is actually rendered, plus the spacer
   *  heights standing in for everything above and below it. */
  rowWindow = computed(() => {
    const n = this.sliceInfo().slice.length;
    if (!this.virtualOn() || !n) return { start: 0, end: n, padTop: 0, padBottom: 0 };
    const tops = this.rowTops();
    const top = this.viewportTop() - this.rowsTop();
    const at = (y: number) => {
      let a = 0, b = n;
      while (a < b) { const m = (a + b) >> 1; if (tops[m + 1] <= y) a = m + 1; else b = m; }
      return a;
    };
    const start = Math.max(0, at(Math.max(0, top)) - this.overscan);
    const end = Math.min(n, at(Math.max(0, top + this.viewportH())) + 1 + this.overscan);
    return { start, end, padTop: tops[start], padBottom: tops[n] - tops[end] };
  });

  /** False while the active cell's row is windowed out — the roving tabindex
   *  then has nowhere to live, so the header lead cell stands in as the grid's
   *  tab entry point (see leadHeaderTabIndex). */
  activeRowRendered = computed(() => {
    const rk = this.activeRowKey();
    return rk === 'header' || this.viewRows().some(r => r.id === rk);
  });

  viewRows = computed((): RowView[] => {
    const { slice, start } = this.sliceInfo();
    const s = this.section(), a = this.accent();
    const sel = this.selected(), edCell = this.editingCell(), edDraft = this.draft(), exp = this.expanded();
    const dirty0 = this.dirtyCells();
    const ark = this.activeRowKey(), ack = this.activeColKey();
    const visFields = this.visibleFields();
    const rhf = this.rowHeaderField();
    const comboSet = this.comboFields();
    // Nav spans the whole loaded set, not just the rendered window — otherwise
    // ArrowDown would dead-end at the window edge, which is a keyboard trap.
    this._navRowIds = ['header', ...slice.map(r => r.id)];
    const win = this.rowWindow();
    const rendered = win.start === 0 && win.end === slice.length ? slice : slice.slice(win.start, win.end);
    return rendered.map((r, i) => {
      const idx = win.start + i;
      const selected = !!sel[r.id];
      const zebra = this.zebraProp && (idx % 2 === 1);
      const bg = selected ? '#D5E5EB' : zebra ? '#F5F5F5' : '#FFFFFF';
      // Model B: editing is a CELL concept now; rows have no edit state.
      const isExpanded = this.canExpand() && !!exp[r.id];
      const isLeadActive = ark === r.id && ack === 'lead';
      const cells: CellView[] = visFields.map((field, ci) => {
        // Action cells carry only identity, geometry and focus state; the
        // template switches on `kind` and renders the control itself. Their ids
        // stay the ones the focus and keyboard code already uses.
        const kind = this.actionKindOf(field);
        if (kind) {
          const isActive = ark === r.id && ack === field;
          return {
            kind, field, value: '', isLink: false, isEditing: false, isText: false,
            ariaColIndex: String(ci + 1), cellId: 'gc-' + r.id + '-' + field,
            tabIndex: isActive ? '0' : '-1',
            draft: '', isRowHeader: false, editable: false, ariaReadonly: null,
            isCombo: false, dirty: false, cellAriaDesc: null,
          } satisfies CellView;
        }
        const isLink = field === 'doc';
        const editable = this.canEdit() && this.isFieldEditable(field);
        // Cell-level edit mode: only THIS cell is in edit mode, not the row.
        const cellEditing = editable && edCell === r.id + '::' + field;
        const isCellActive = ark === r.id && ack === field;
        const dirty = !!dirty0[r.id + '::' + field];
        const isCombo = editable && comboSet.has(field);
        const value = String((r as any)[field] ?? '');
        return {
          kind: 'data' as const,
          field, value, isLink, isEditing: cellEditing, isText: !isLink && !cellEditing,
          ariaColIndex: String(ci + 1), cellId: 'gc-' + r.id + '-' + field,
          tabIndex: isCellActive ? '0' : '-1',
          draft: cellEditing ? edDraft : value,
          isRowHeader: field === rhf,
          editable,
          isCombo,
          // Announced at the point of use; the header icon alone would only
          // help a user who happened to read the header first.
          ariaReadonly: (this.canEdit() && !editable) ? 'true' : null,
          dirty,
          cellAriaDesc: editable
            ? (dirty ? 'Edited. Press Enter to edit' : 'Press Enter to edit')
            : null,
        };
      });
      const isDeleteActive = ark === r.id && ack === 'delete-col';
      const isExpandActive = ark === r.id && ack === 'expand-col';
      return {
        ...r, bg, selected, boxBorder: selected ? a : '#9aa6ad', boxBg: selected ? a : '#fff',
        showChevron: this.canExpand(), chevronDeg: isExpanded ? 90 : 0, isExpanded,
        showEdit: false,   // the row-level edit button is gone in model B
        showDelete: this.canDelete(),
        editing: false,    // rows are never "in edit mode"; cells are
        ariaRowIndex: String(start + idx + 2),
        // Only Editable section gets a per-row hint — it's the one section with a
        // non-obvious action (Enter starts editing) that isn't already covered by
        // the generic #grid-instructions text. Other sections stay null so no
        // aria-description attribute renders (avoids repeating the same generic
        // instruction on every single row, which is verbose for screen reader users).
        // Hint lives on each CELL now - editability is per column, not per row.
        rowAriaDesc: null,
        leadCellId: 'gc-' + r.id + '-lead', leadTabIndex: isLeadActive ? '0' : '-1',
        deleteCellId: 'gc-' + r.id + '-delete-col', deleteTabIndex: isDeleteActive ? '0' : '-1',
        expandCellId: 'gc-' + r.id + '-expand-col', expandTabIndex: isExpandActive ? '0' : '-1',
        dragClass: '', canDrag: false, cells,
      };
    });
  });

  leadHeaderTabIndex = computed(() =>
    (this.activeRowKey() === 'header' && this.activeColKey() === 'lead') || !this.activeRowRendered() ? '0' : '-1');

  /** ── Tri-state select-all controls ──────────────────────────────────────
   *  All three "select all" controls follow the ARIA APG mixed-checkbox
   *  pattern: role=checkbox with aria-checked true / false / "mixed", plus
   *  aria-controls naming the checkboxes they govern.
   *
   *  Every one of them previously used a role whose state is BINARY - the
   *  grid header had no role or state at all, the chooser used a toggle
   *  button's aria-pressed, and the filter list used a listbox option's
   *  aria-selected. All three drew a dash for the partial state on screen
   *  while telling assistive tech "not pressed" / "not selected", so the
   *  visible state and the programmatic state disagreed (WCAG 1.3.1, 4.1.2).
   *  aria-checked is the only one of the three that has a "mixed" value.
   *
   *  aria-checked is a string attribute, so these return strings - binding a
   *  boolean would emit "false" for the unchecked case but drop the attribute
   *  entirely in some paths, and "mixed" is not a boolean at all. */
  selectAllAriaChecked = computed(() =>
    this.allSelected() ? 'true' : this.someSelected() ? 'mixed' : 'false');
  /** The per-row select controls this header checkbox governs. */
  // Names every row checkbox on the page, including any the window is not
  // currently rendering — aria-controls describes scope, not what is painted.
  rowSelectIds = computed(() => this.sliceInfo().slice.map(r => 'gc-' + r.id + '-lead').join(' '));

  /** Read via aria-describedby on the select-all checkbox, so the state
   *  announcement carries the actual numbers: "checkbox, half checked,
   *  2 of 40 rows selected". aria-checked="mixed" alone says that SOME rows
   *  are selected but not how many. The denominator is baseRows - the full
   *  FILTERED set across every page, because that is exactly the set
   *  selectAll() toggles - and the text says "filtered" whenever a filter is
   *  narrowing it, so a smaller denominator explains itself. Deliberately not
   *  the word "visible": to a screen reader user that means the current page,
   *  and this checkbox does not stop at the page boundary. */
  selectAllCountDesc = computed(() => {
    const total = this.selTotal(), n = this.selCount();
    const f = this.filters();
    const filtered = this.isServerMode()
      ? (this.ds.isFiltered() ? ' filtered' : '')
      : (Object.keys(f).some(k => f[k]?.length) ? ' filtered' : '');
    if (this.selectingAll()) return 'Selecting all rows';
    if (total === 0) return 'No rows to select';
    if (n === 0) return 'No rows selected';
    if (n >= total) return 'All ' + total.toLocaleString() + filtered + ' rows selected';
    return n.toLocaleString() + ' of ' + total.toLocaleString() + filtered + ' rows selected';
  });

  chooserAllAriaChecked = computed(() =>
    this.chooserAllVisible() ? 'true' : this.chooserSomeVisible() ? 'mixed' : 'false');
  chooserItemIds = computed(() => this.chooserItems().map(ci => 'chooser-chk-' + ci.field).join(' '));

  filterAllAriaChecked = computed(() =>
    this.allFilterChecked() ? 'true' : this.someFilterChecked() ? 'mixed' : 'false');
  filterValueIds = computed(() => this.filterValues().map((_, i) => 'filter-opt-' + (i + 1)).join(' '));
  editColHeaderTabIndex   = computed(() => this.activeRowKey() === 'header' && this.activeColKey() === 'edit-col'   ? '0' : '-1');
  deleteColHeaderTabIndex = computed(() => this.activeRowKey() === 'header' && this.activeColKey() === 'delete-col' ? '0' : '-1');
  expandColHeaderTabIndex = computed(() => this.activeRowKey() === 'header' && this.activeColKey() === 'expand-col' ? '0' : '-1');

  /** Action-column header hints. Every DATA header cell already carries an
   *  aria-description telling the user what Enter does there; these three
   *  action headers had none, so a screen reader user landing on them heard
   *  only "Edit actions" with no way to discover the Enter behaviour. */
  editColHeaderDesc = computed(() => this.editingCount() > 0
    ? 'Press Enter to save all ' + this.editingCount() + ' edited rows.'
    : 'Press Enter to edit all rows on this page.');
  deleteColHeaderDesc = computed(() => this.hasSelection()
    ? 'Press Enter to delete the ' + this.selCount() + ' selected rows.'
    : 'Select rows first, then press Enter to delete them.');
  expandColHeaderDesc = computed(() => this.allExpanded()
    ? 'Press Enter to collapse all rows.'
    : 'Press Enter to expand all rows.');
  /** Rows the select-all checkbox governs. In server mode that is the whole
   *  matching set, which is never fully loaded, so the count comes from the
   *  selection map and the total from the server rather than from baseRows. */
  selTotal = computed(() => this.isServerMode() ? this.ds.total() : this.baseRows().length);
  selCount = computed(() => {
    const sel = this.selected();
    if (this.isServerMode()) return Object.keys(sel).filter(k => sel[k]).length;
    return this.baseRows().filter(r => sel[r.id]).length;
  });
  allSelected  = computed(() => { const t = this.selTotal(); return t > 0 && this.selCount() >= t; });
  someSelected = computed(() => !this.allSelected() && this.selCount() > 0);
  hasSelection = computed(() => this.selCount() > 0);
  selectAllBorder = computed(() => (this.allSelected() || this.someSelected()) ? this.accent() : '#9aa6ad');
  selectAllBg     = computed(() => (this.allSelected() || this.someSelected()) ? this.accent() : '#fff');
  selectionNote   = computed(() => this.hasActiveFilter() ? 'Reflects rows currently visible' : 'Across all rows');
  ariaRowCount = computed(() => String(this.sliceInfo().total + 1));
  ariaColCount = computed(() => String(this.visibleFields().length + 1));
  /** The corner pencil badge is decorative, so "editable" has to reach a screen
   *  reader from the grid's own name instead of from an icon it cannot see. */
  gridLabel    = computed(() => this.sectionMeta().title + ' data grid'
    + (this.canEdit() ? ', inline editing enabled' : ''));
  rangeText    = computed(() => {
    const { start, end, total } = this.sliceInfo();
    if (this.isServerMode()) {
      if (this.ds.mode() === 'infinite') {
        return total === 0 ? '0 of 0' : `1-${this.ds.rows().length} of ${total} loaded`;
      }
      return total === 0 ? '0 of 0' : `${start + 1}-${Math.min(end, total)} of ${total}`;
    }
    const grand = this.rows().length;
    // When a filter is active `total` is the filtered count, which on its own
    // hides how much data actually exists - so the grand total is appended.
    const suffix = total !== grand ? ` Total: ${grand}` : '';
    return total === 0 ? `0 of 0${suffix}` : `${start + 1}-${Math.min(end, total)} of ${total}${suffix}`;
  });

  pageButtons = computed((): PageButton[] => {
    const { page: cur, pageCount } = this.sliceInfo();
    const last = pageCount - 1;
    const set = new Set([0, last, cur, cur-1, cur+1, 1, last-1]);
    const arr = [...set].filter(n => n >= 0 && n <= last).sort((a,b) => a-b);
    const buttons: PageButton[] = []; let prev = -1;
    arr.forEach(n => {
      if (n - prev > 1) buttons.push({ isGap:true, notGap:false, label:'', ariaLabel:'', bg:'', color:'', weight:'' });
      const on = n === cur, a = this.accent();
      buttons.push({ isGap:false, notGap:true, label:String(n+1), ariaLabel:'Page '+(n+1)+(on?' (current)':''),
        bg: on ? a : 'transparent', color: on ? '#fff' : '#3a4a52', weight: on ? '700' : '400' });
      prev = n;
    });
    return buttons;
  });

  toolbarActions = computed((): ToolbarAction[] => {
    const base: ToolbarAction[] = [
      { label:'Acknowledge', icon:'✓' }, { label:'Upload', icon:'↑' },
      { label:'Download', icon:'↓' }, { label:'Email', icon:'✉' },
      { label:'Track', icon:'◉' },
    ];
    if (this.canEdit()) base.push({ label:'Add Row', icon:'+' });
    base.push({ label:'Columns', icon:'▤' });
    return base;
  });

  // Column menu items with grouping
  menuGroups = computed(() => {
    const mf = this.menuField(); if (!mf) return [];
    const a = this.accent(), visFields = this.visibleFields();
    const sec = this.section(), flags = this.autoFitFlags();
    // Position within the visible list is no longer what gates Move Left/Right -
    // canMoveColumn() checks the pin section boundary instead.
    const pinned = this.pinnedCols();
    const pinnedDir = pinned[mf] || null; // 'left' | 'right' | null
    const sortF = this.sortField(), sortD = this.sortDir();
    const groups: MenuGroup[] = [
      // Sort is a mutually exclusive choice, exactly like Pin, so it gets the
      // same shape: a radiogroup with an explicit "No Sort" member. Previously
      // these were plain menuitems with no state at all, so a screen reader
      // user could not tell which direction was active - and there was no way
      // to clear a sort from the menu, only by clicking the header a third
      // time. "No Sort" fixes both. Keeping Sort and Pin on one pattern also
      // avoids two different radio idioms sitting in the same menu.
      {
        label: 'Sort Column',
        isRadioGroup: true,
        radioName: 'sort-' + mf,
        groupId: 'menu-sort-group',
        items: [
          { label:'Sort Ascending',  icon:'↑', iconColor:a, idx:0, radioValue:'asc',
            checked: sortF === mf && sortD === 'asc' },
          { label:'Sort Descending', icon:'↓', iconColor:a, idx:1, radioValue:'desc',
            checked: sortF === mf && sortD === 'desc' },
          { label:'No Sort',         icon:'⇅', iconColor:a, idx:9, radioValue:'none',
            checked: sortF !== mf || !sortD },
        ]
      },
      {
        items: [
          { label:'Move Left',  icon:'←', iconColor: this.canMoveColumn(mf, -1) ? a : '#c2c8cc', idx:2,
            disabled: !this.canMoveColumn(mf, -1) },
          { label:'Move Right', icon:'→', iconColor: this.canMoveColumn(mf, 1) ? a : '#c2c8cc', idx:3,
            disabled: !this.canMoveColumn(mf, 1) },
        ]
      },
      {
        label: 'Pin Column',
        isRadioGroup: true,
        radioName: 'pin-' + mf,
        groupId: 'menu-pin-group',
        items: [
          { label:'Pin Left',  icon:'⌖', iconColor:a, idx:10, radioValue:'left',  checked: String(pinnedDir) === 'left' },
          { label:'Pin Right', icon:'⌖', iconColor:a, idx:11, radioValue:'right', checked: String(pinnedDir) === 'right' },
          { label:'No Pin',    icon:'⌖', iconColor:a, idx:12, radioValue:'none',  checked: !pinnedDir },
        ]
      },
      {
        // Deliberately NOT menuitemcheckbox. A checkbox promises the user can
        // toggle it off; these cannot be. Activating one autosizes, and the
        // tick clears only as a side effect of the user resizing that column
        // by hand. A screen reader user hearing "checked" would press Space
        // expecting to uncheck it and nothing would happen. They are actions,
        // so they are menuitems, and the applied state is read after the label
        // via aria-describedby instead of being faked as a control state.
        items: [
          { label:'Autosize This Column', icon:'↔', iconColor:a, idx:5,
            desc: flags[sec + ':' + mf] ? 'sized to fit content' : '' },
          { label:'Autosize All Columns', icon:'⊙', iconColor:a, idx:6,
            desc: visFields.every(f => !!flags[sec + ':' + f]) ? 'all columns sized to fit content' : '' },
        ]
      },
      {
        items: [
          { label:'Choose Columns…', icon:'▤', iconColor:a, idx:7 },
          { label:'Reset Columns',   icon:'↺', iconColor:a, idx:8 },
        ]
      },
    ];
    return groups;
  });

  /** The chooser lists columns the way the grid renders them - left pinned,
   *  unpinned, right pinned - so a position number in the dialog always names
   *  the place the user actually sees. Hidden columns keep their slot inside
   *  their own section rather than being exiled to a group of their own: this
   *  dialog's first job is switching them back on. */
  chooserOrder = computed(() => {
    const all = this.orderedFields(), pinned = this.pinnedCols();
    return [
      ...all.filter(f => pinned[f] === 'left'),
      ...all.filter(f => !pinned[f]),
      ...all.filter(f => pinned[f] === 'right'),
    ];
  });

  chooserItems = computed((): ChooserItem[] => {
    const a = this.accent(), cq = this.chooserSearch().toLowerCase();
    const hidden = this.colHidden(), vis = this.visibleFields();
    const cdf = this.cDragField(), cdt = this.cDropTarget();
    const pinned = this.pinnedCols();
    const shown = this.chooserOrder().filter(f => this.colLabel(f).toLowerCase().includes(cq));
    return shown.map((field, i) => {
      const visible = !hidden[field], label = this.colLabel(field);
      // 0 when hidden: a column that is not on screen has no visible position,
      // and it is left out of the numbering rather than padding it.
      const pos = vis.indexOf(field) + 1;
      const { lo, hi } = this.sectionBounds(field);
      const isDrop = cdt === field && cdf && cdf !== field;
      return {
        field, label, visible,
        pos, total: vis.length, hasPos: visible,
        posMin: lo, posMax: hi,
        posVal: visible ? String(pos) : '',
        posLabel: visible
          ? 'Position of ' + label + ' is ' + pos + ' of ' + vis.length
          : label + ' is hidden and has no position',
        labelId: 'chooser-label-' + field,
        posFieldId: 'chooser-pos-' + field,
        boxBorder: visible ? a : '#9aa6ad', boxBg: visible ? a : '#fff',
        // Dragging is off while a search is active: the list on screen is then
        // a subset, so a drop between two rows has no unambiguous meaning in
        // the full order. It is off for hidden columns too - they have no place
        // in the visible order to be moved within.
        draggable: !cq && visible, dragOpacity: cdf === field ? 0.4 : 1,
        dropShadow: isDrop
          ? (this.cDropAfter() ? 'inset 0 -3px 0 0 ' + a : 'inset 0 3px 0 0 ' + a) : 'none',
        // A thin rule wherever the pin section changes, mirroring the frozen
        // boundary drawn in the grid. Computed after the search filter so a
        // filtered-away section never leaves a stray leading rule.
        sepBefore: i > 0 && (pinned[shown[i - 1]] ?? '') !== (pinned[field] ?? ''),
        pin: pinned[field] ?? '',
        pinId: 'chooser-pin-' + field,
        // Unchecking an action column turns its whole feature off, so the
        // checkbox needs to say so rather than reading as "hide a column".
        featureNote: this.actionKindOf(field)
          ? 'Switches the ' + label.toLowerCase() + ' feature off for this grid' : '',
        showLabel: 'Show ' + label,
        orderLabel: label + ' order',
        pinLabel: label + ' pin',
      };
    });
  });

  /** Roving tabindex for the filter listbox: index 0 is Select All, values
   *  start at 1. Only the focused option is tabbable, matching the grid's own
   *  roving model instead of making every checkbox its own tab stop. */
  filterOptTabIndex(idx: number): string {
    const f = this.filterFocusIdx();
    return (f < 0 ? idx === 0 : f === idx) ? '0' : '-1';
  }
  onFilterOptFocus(idx: number): void { this.filterFocusIdx.set(idx); }

  /** Values offered in the filter popup.
   *  In client mode every row is in memory, so the distinct set is exact.
   *  In server mode only ~50 of 10,000 rows are loaded, so deriving options
   *  from `rows()` would silently hide most of them - the adapter is asked
   *  for the real domain instead (cached per field). */
  private serverDistinct = signal<Record<string, string[]>>({});
  private distinctFor(field: string): string[] {
    if (this.isServerMode()) return this.serverDistinct()[field] ?? [];
    return [...new Set(this.rows().map(x => (x as any)[field]))].map(String);
  }

  filterValues = computed((): FilterValue[] => {
    const ff = this.filterField(); if (!ff) return [];
    const a = this.accent();
    const distinct = this.distinctFor(ff).sort((a: any,b: any) => String(a).localeCompare(String(b), undefined, {numeric:true}));
    const q = this.filterSearch().toLowerCase();
    const matches = distinct.filter(v => String(v).toLowerCase().includes(q));
    const draft = this.filterDraft() || [];
    return matches.map(v => ({
      label: String(v), checked: draft.includes(String(v)),
      boxBorder: draft.includes(String(v)) ? a : '#9aa6ad',
      boxBg: draft.includes(String(v)) ? a : '#fff',
    }));
  });

  filterCountText = computed(() => {
    const ff = this.filterField(); if (!ff) return '';
    const distinct = this.distinctFor(ff);
    const q = this.filterSearch().toLowerCase();
    const matches = q ? distinct.filter(v => String(v).toLowerCase().includes(q)) : distinct;
    if (q && !matches.length) return 'No matches found';
    return matches.length + (matches.length === 1 ? ' result' : ' results');
  });

  filterCountColor = computed(() => {
    const q = this.filterSearch().toLowerCase(), ff = this.filterField();
    if (!ff || !q) return '#5b6b76';
    const matches = this.distinctFor(ff).filter(v => String(v).toLowerCase().includes(q));
    return !matches.length ? '#b23b3b' : this.accent();
  });

  filterEmpty = computed(() => {
    const ff = this.filterField(); if (!ff) return false;
    const q = this.filterSearch().toLowerCase(); if (!q) return false;
    return !this.distinctFor(ff).some(v => String(v).toLowerCase().includes(q));
  });

  filterTitleId = computed(() => 'filter-dialog-title-' + (this.filterField() || 'none'));

  addFields = computed((): AddField[] => {
    const draft = this.addDraft() || {}, err = this.addError();
    return this.editFields().map(field => {
      const invalid = !!(err && err.field === field);
      return {
        field, label: this.colDefs().find(c => c.field === field)?.label ?? field,
        value: (draft as any)[field] ?? '', fieldId: 'add-field-' + field,
        errorId: 'add-field-' + field + '-error', invalid,
        errorText: invalid ? err!.message : '',
        describedBy: invalid ? 'add-field-' + field + '-error' : '',
        borderColor: invalid ? '#b23b3b' : '#D1D3D4',
      };
    });
  });

  /** Row lookup that works in both modes. In server mode only the loaded
   *  window exists, and that is exactly the set the user can interact with. */
  private rowById(id: string): CscRow | null {
    return (this.isServerMode() ? this.ds.rows() as unknown as CscRow[] : this.rows())
      .find(r => r.id === id) ?? null;
  }

  deleteRow = computed(() => this.deleteId() ? this.baseRows().find(r => r.id === this.deleteId()) ?? null : null);

  shortcuts: Shortcut[] = [
    { keys: ['Tab'],           desc: 'Enter / leave the grid' },
    { keys: ['↑','↓','←','→'], desc: 'Move between cells' },
    { keys: ['Home','End'],    desc: 'First / last cell in row' },
    { keys: ['Ctrl','Home'],   desc: 'First cell in grid' },
    { keys: ['Ctrl','End'],    desc: 'Last cell in grid' },
    { keys: ['Enter'],         desc: 'On a header: sort. On a cell: edit (editable columns). On an action header: select all, expand all, or delete selected' },
    { keys: ['Enter'],         desc: 'While editing a cell: save and return to the cell' },
    { keys: ['Tab'],           desc: 'While editing a cell: save and leave the grid' },
    { keys: ['Space'],         desc: 'Select row' },
    { keys: ['Ctrl','Enter'],  desc: 'Open filter (on header cell)' },
    { keys: ['Ctrl','←','→'], desc: 'Move column (on a header cell)' },
    { keys: ['Shift','R'],     desc: 'Enter column resize mode (on a header cell)' },
    { keys: ['Shift','M'],     desc: 'Open column menu (on a header cell)' },
    { keys: ['←','→'],        desc: 'Resize column (in resize mode), 10px per press' },
    { keys: ['Shift','←','→'], desc: 'Resize column faster, 50px per press' },
    { keys: ['Esc'],           desc: 'Cancel a cell edit / close dialog / exit resize mode' },
    { keys: ['Delete'],        desc: 'Delete selected rows (Editable section)' },
  ];

  /** The legend must not advertise shortcuts the current section removed. */
  visibleShortcuts = computed((): Shortcut[] => {
    const reorder = this.canReorder(), menu = this.canMenu();
    return this.shortcuts.filter(sc =>
      (reorder || sc.desc !== 'Move column (on a header cell)') &&
      (menu || sc.desc !== 'Open column menu (on a header cell)'));
  });

  legendDeg = computed(() => this.legendOpen() ? 90 : 0);
  copyColor = computed(() => this.copied() ? '#1f8a5b' : '#075A92');
  copyLabel = computed(() => this.copied() ? 'Copied' : 'Copy link');
  /** Every section pages, except All Features while it is in infinite mode -
   *  a pager there would contradict the scroll position. */
  showPagination = computed(() => !(this.isServerMode() && this.ds.mode() === 'infinite'));
  /** Boundary flags so Previous/Next can be disabled visually AND programmatically. */
  atFirstPage = computed(() => this.sliceInfo().page <= 0);
  atLastPage  = computed(() => this.sliceInfo().page >= this.sliceInfo().pageCount - 1);

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  /**
   * Child records load when an expanded row is RENDERED, not when it is opened.
   *
   * Expanding and fetching are separate concerns: Expand All marks the whole
   * filtered set open, and this brings each row's children in as the virtual
   * window reaches it. Attaching the fetch to the open event instead is what
   * forced Expand All to stop at the current page - and it also meant a row
   * expanded by any other route would have sat on "Loading…" with nothing to
   * finish it.
   *
   * The fetch is deferred out of the effect body because loadChildren writes a
   * signal of its own on entry, which must not happen while this effect runs.
   */
  private readonly loadVisibleChildren = effect(() => {
    if (!this.isServerMode()) return;
    const exp = this.expanded();
    const rendered = this.viewRows();
    const want = rendered
      .filter(r => exp[r.id])
      .map(r => r.id)
      .filter(id => untracked(() => this.ds.childrenFor(id)) === undefined);
    if (!want.length) return;
    queueMicrotask(() => want.forEach(id => void this.ds.loadChildren(id).then(() => {
      this.cdr.markForCheck();
      if (this.virtualOn()) setTimeout(() => this.measurePanel(id));
    })));
  });

  ngOnInit(): void { void this.loadClientDataset(); }

  /**
   * Every section now renders the same live dataset All Features fetches. The
   * client sections still run their own filter / sort / page over it, so their
   * state stays isolated from each other and from the server-mode query.
   */
  private async loadClientDataset(): Promise<void> {
    if (this._hostRows) return;
    try {
      const rows = await this.ds.fetchDataset(this.bulkCap);
      if (!rows.length || this._hostRows) return;
      this.setRowsForAllSections(rows as CscRow[]);
      this.clearAllSelections();
      this.page.set(0);
      this.announceService.announce(rows.length.toLocaleString() + ' records loaded');
      this.scheduleDefaultAutosize(this.section());
    } catch {
      // The built-in demo rows stay on screen, so the grid remains usable.
      this.showToast('Live data unavailable — showing sample records');
    }
  }

  ngAfterViewInit(): void {
    this.scheduleDefaultAutosize(this.section());
    this._docKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // First in the chain: a tooltip has to be dismissible on its own
        // without tearing down whatever is behind it (WCAG 1.4.13). A second
        // Escape then reaches the resize mode, dialog or menu as usual.
        if (this.truncTip())           { this.hideTip(); return; }
        if (this.resizeModeField())    { this.exitResizeMode(); return; }
        if (this.deleteId() != null || this.bulkDeleteOpen()) { this.closeDeleteConfirm(); return; }
        if (this.addOpen())            { this.closeAddModal(); return; }
        if (this.pageSizeOpen())       { this.closePageSizeMenu(); return; }
        if (this.chooserOpen())        { this.closeChooser(); return; }
        if (this.menuField())          { this.closeOverlays(); return; }
        if (this.filterField())        { this.closeOverlays(); return; }
        if (this.editingCell()) {
          const [rid, fld] = this.editingCell()!.split('::');
          this.cancelCellEdit(rid, fld);
          return;
        }
      }
      // Delete key — delete selected rows. Gated on the FEATURE, not just the
      // section: with the Delete column unchecked the key must be dead too,
      // and it stays selection-based, so it never triggers Delete all.
      if (e.key === 'Delete' && this.hasDeleteFeature() && !this.editingCount()) {
        // Delete is an ordinary text-editing key inside a field; without this
        // guard, clearing a character in the search or add-record inputs
        // opened a destructive confirmation dialog.
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
        if (this.deleteId() != null || this.bulkDeleteOpen() || this.addOpen()) return;
        const selIds = Object.keys(this.selected()).filter(id => this.selected()[id]);
        if (selIds.length === 1) { this.openDeleteConfirm(selIds[0]); }
        else if (selIds.length > 1) { this.openBulkDeleteConfirm(); } // was: instant delete, no confirm
      }
    };
    document.addEventListener('keydown', this._docKeyDown, true);
    document.addEventListener('focusin', this._docFocusIn, true);
    window.addEventListener('scroll', this._onScroll, { passive: true, capture: true });
    window.addEventListener('resize', this._onWinResize);
  }

  ngAfterViewChecked(): void {
    if (!this.virtualOn()) return;
    this.measureViewport();
    this.keepFocusInGrid();
  }

  ngOnDestroy(): void {
    this._probe?.remove(); this._probe = null;
    // The grid raised the document's font size; don't leave that behind.
    document.documentElement.style.fontSize = '';
    document.removeEventListener('keydown', this._docKeyDown, true);
    document.removeEventListener('focusin', this._docFocusIn, true);
    window.removeEventListener('scroll', this._onScroll, true);
    window.removeEventListener('resize', this._onWinResize);
    this.removeFilterScrollListener();
    this.removeComboScrollListener();
    clearTimeout(this._toastTimer);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private focusAfterRender(id: string): void {
    this._pendingFocusId = id;
    setTimeout(() => {
      if (this._pendingFocusId) {
        const el = document.getElementById(this._pendingFocusId);
        el?.focus(); this._pendingFocusId = null;
      }
    });
  }

  private saveFocus(): void { this._lastFocused = document.activeElement as HTMLElement; }
  private restoreFocus(): void {
    if (this._lastFocused && document.contains(this._lastFocused)) {
      this._lastFocused.focus(); this._lastFocused = null;
    }
  }

  // ── Truncation tooltip ────────────────────────────────────────────────────
  /** The clipped text inside a trigger, or null when nothing is cut off.
   *  The +1 absorbs sub-pixel layout: this grid renders 0.667px borders at some
   *  zoom levels, and scrollWidth/clientWidth round against each other. */
  private clippedText(host: HTMLElement): HTMLElement | null {
    const sel = '.csc-cell-text, .csc-doc-link, .csc-col-label';
    // A cell being edited renders an <input> instead of .csc-cell-text, so the
    // "not while editing" rule falls out of this lookup rather than needing a
    // separate guard.
    const el = (host.matches(sel) ? host : host.querySelector(sel)) as HTMLElement | null;
    return el && el.scrollWidth > el.clientWidth + 1 ? el : null;
  }

  /** Hover or focus on a cell / header label. Arms the delay; the tooltip only
   *  appears if the text is still clipped and the pointer is still here when it
   *  fires. */
  onTipEnter(trigger: HTMLElement): void {
    if (this._tipHideTimer) { clearTimeout(this._tipHideTimer); this._tipHideTimer = null; }
    if (this._tipTimer) clearTimeout(this._tipTimer);
    this._tipSource = trigger;
    this._tipTimer = setTimeout(() => {
      // Focus may have moved on during the delay - showing now would flash a
      // tooltip for a cell the user has already left.
      if (this._tipSource !== trigger) return;
      const el = this.clippedText(trigger);
      if (!el) return;
      this.placeTip(trigger, el, (el.textContent ?? '').trim());
    }, this.tipDelay);
  }

  /** Cancels a pending tooltip, or starts dismissing a visible one. The short
   *  grace period is what lets the pointer travel onto the tooltip without it
   *  vanishing underneath - WCAG 1.4.13's "hoverable". */
  onTipLeave(): void {
    if (this._tipTimer) { clearTimeout(this._tipTimer); this._tipTimer = null; }
    this._tipSource = null;
    if (this._tipHideTimer) clearTimeout(this._tipHideTimer);
    this._tipHideTimer = setTimeout(() => {
      this.truncTip.set(null);
      this._tipAnchor = null; this._tipTextEl = null;
      this.cdr.markForCheck();
    }, 120);
  }

  /** Pointer entered the tooltip itself - keep it up. */
  keepTip(): void {
    if (this._tipHideTimer) { clearTimeout(this._tipHideTimer); this._tipHideTimer = null; }
  }

  hideTip(): void {
    if (this._tipTimer) { clearTimeout(this._tipTimer); this._tipTimer = null; }
    if (this._tipHideTimer) { clearTimeout(this._tipHideTimer); this._tipHideTimer = null; }
    this._tipSource = null;
    this._tipAnchor = null; this._tipTextEl = null;
    this.truncTip.set(null);
  }

  /** Anchored to the CELL, not the text span, so header and data tooltips line
   *  up the same way. Below the row by default: covering the next row is far
   *  less harmful than covering the rest of the row being read. */
  private placeTip(trigger: HTMLElement, textEl: HTMLElement, text: string): void {
    const anchor = (trigger.closest('.csc-gridcell') as HTMLElement) ?? trigger;
    this._tipAnchor = anchor;
    this._tipTextEl = textEl;
    const r = anchor.getBoundingClientRect(), tb = textEl.getBoundingClientRect();
    this.truncTip.set({ text, x: r.left, y: tb.bottom + this.tipGap, flip: false });
    this.cdr.markForCheck();
    // Its height is unknown until it has rendered, so the clamp and the flip
    // happen once it exists. setTimeout, not rAF - rAF does not fire in a
    // hidden or throttled tab, which would strand the tooltip off-screen.
    setTimeout(() => this.reflowTip());
  }

  /** Re-runs the placement against the anchor's CURRENT rect and the tooltip's
   *  measured height. Called once after first render and again on every scroll
   *  or resize, because position:fixed does not travel with a scrolling cell.
   *
   *  Below by default: covering the next row is far less harmful than covering
   *  the rest of the row being read. Rows are adjacent, so "below" always means
   *  over the next row - there is no empty band between them to drop into. */
  private reflowTip(): void {
    const cur = this.truncTip();
    const anchor = this._tipAnchor;
    if (!cur || !anchor) return;
    const tip = document.getElementById('csc-trunc-tip');
    if (!tip) return;
    if (!document.contains(anchor)) { this.hideTip(); this.cdr.markForCheck(); return; }

    const r = anchor.getBoundingClientRect();
    // Scrolled clean out of its own grid body: a tooltip left hovering over the
    // toolbar or the pager is pointing at nothing.
    const clip = (anchor.closest('.csc-grid-scroll') as HTMLElement | null)?.getBoundingClientRect();
    if (clip && (r.bottom <= clip.top || r.top >= clip.bottom ||
                 r.right <= clip.left || r.left >= clip.right)) {
      this.hideTip(); this.cdr.markForCheck(); return;
    }

    const t = tip.getBoundingClientRect();
    // Vertical anchor is the TEXT's edge, not the cell's.
    //
    // Rows touch - a cell's bottom edge IS the next row's top edge - so a
    // tooltip hung off the cell had nowhere to go but on top of the next row's
    // words. The text lines do NOT touch: a 42px row carries 15px of glyphs
    // centred in it, leaving ~14px of padding below one line and ~13px above
    // the next - a 28px empty gutter that a 27px tooltip fits inside. Sitting
    // against the text instead of the box puts it in that gutter, covering
    // neither line. Measured live rather than hardcoded, because the padding
    // grows with the text-size stepper and shrinks in compact density.
    const tEl = this._tipTextEl;
    const tb = tEl && document.contains(tEl) ? tEl.getBoundingClientRect() : r;
    const x = Math.max(this.tipPad, Math.min(r.left, window.innerWidth - t.width - this.tipPad));
    const below = tb.bottom + this.tipGap;
    const above = tb.top - t.height - this.tipGap;
    // Flip only when the measured height genuinely does not fit below, and only
    // when there is somewhere better to go.
    const flip = below + t.height > window.innerHeight - this.tipPad && above > this.tipPad;
    const y = flip ? above : below;
    // Scroll fires continuously; skip the write when nothing moved so the
    // tooltip does not re-render on every frame of a scroll.
    if (Math.abs(cur.x - x) < 0.5 && Math.abs(cur.y - y) < 0.5 && cur.flip === flip) return;
    this.truncTip.set({ text: cur.text, x, y, flip });
    this.cdr.markForCheck();
  }

  showToast(msg: string): void {
    this.toast.set(msg); clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toast.set(null); this.cdr.markForCheck(); }, 3000);
    this.announceService.announce(msg);
  }

  announce(msg: string): void { this.announceService.announce(msg); }

  // ── Section ───────────────────────────────────────────────────────────────
  setSection(s: Section): void {
    this.section.set(s); this.page.set(0);
    this.editingCell.set(null); this.draft.set('');
    this.closeCombo();
    this.menuField.set(null); this.filterField.set(null);
    this.pinMenuOpen.set(false); this.resizeModeField.set(null);
    this.activeRowKey.set('header'); this.activeColKey.set('lead');
    this.scheduleDefaultAutosize(s);
    // The 10k dataset is fetched the first time the section is opened, not at
    // app start - the other four sections must not pay for it.
    if (s === 'all' && !this.ds.rows().length && !this.ds.loading()) void this.ds.load();
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  /** Replace the CURRENT section's selection map, leaving the others alone. */
  private setSelected(v: Record<string, boolean>): void {
    const s = this.section();
    this._selectedBySection.update(all => ({ ...all, [s]: v }));
  }

  private clearAllSelections(): void {
    this._selectedBySection.set({ basic: {}, advanced: {}, editable: {}, simple: {}, expandable: {}, all: {} });
  }

  /** Rows themselves are shared, so a delete must drop those ids from every
   *  section's selection - otherwise a hidden section keeps a dead id. */
  private dropFromSelections(ids: string[]): void {
    this._selectedBySection.update(all => {
      const next = { ...all } as Record<Section, Record<string, boolean>>;
      (Object.keys(next) as Section[]).forEach(s => {
        const m = { ...next[s] };
        ids.forEach(id => delete m[id]);
        next[s] = m;
      });
      return next;
    });
  }

  toggleSelect(id: string): void {
    const s = { ...this.selected() }, was = !!s[id];
    if (was) delete s[id]; else s[id] = true;
    this.setSelected(s);
    const row = this.rowById(id);
    const n = Object.keys(s).filter(k => s[k]).length;
    this.announceService.announce((was ? 'Row deselected: ' : 'Row selected: ') + (row?.entity ?? id) + '. ' + (n > 0 ? n + (n === 1 ? ' row selected' : ' rows selected') : 'No rows selected'));
  }

  selectAll(): void {
    if (this.selectingAll()) return;
    if (this.isServerMode()) { void this.selectAllMatching(); return; }
    const base = this.baseRows(), all = base.length > 0 && base.every(r => this.selected()[r.id]);
    const s = { ...this.selected() };
    if (all) base.forEach(r => delete s[r.id]); else base.forEach(r => { s[r.id] = true; });
    this.setSelected(s);
    this.announceService.announce(all ? 'All rows deselected' : base.length + (base.length === 1 ? ' row selected' : ' rows selected'));
  }

  /** Server mode never holds more than one page, so selecting "all" has to ask
   *  the adapter for the ids of every matching row — otherwise the checkbox
   *  quietly stops at the page boundary while claiming to have selected all. */
  private async selectAllMatching(): Promise<void> {
    if (this.allSelected()) {
      this.setSelected({});
      this.announceService.announce('All rows deselected');
      return;
    }
    this.selectingAll.set(true);
    this.announceService.announce('Selecting all matching rows');
    try {
      const ids = await this.ds.matchingIds(this.bulkCap);
      const s: Record<string, boolean> = {};
      ids.forEach(id => { s[id] = true; });
      this.setSelected(s);
      const total = this.ds.total();
      const capped = ids.length < total
        ? `. Selection is capped at ${this.bulkCap.toLocaleString()} rows, so ${(total - ids.length).toLocaleString()} matching rows are not selected`
        : '';
      this.announceService.announce(`${ids.length.toLocaleString()} rows selected${capped}`);
      if (capped) this.showToast(`Selected the first ${ids.length.toLocaleString()} of ${total.toLocaleString()} rows`);
    } catch {
      this.showToast('Could not select all rows');
      this.announceService.announce('Select all failed. Please try again.');
    } finally {
      this.selectingAll.set(false);
      this.cdr.markForCheck();
    }
  }

  clearSelection(): void { this.setSelected({}); this.announceService.announce('Selection cleared'); }

  // ── Sort ──────────────────────────────────────────────────────────────────
  sortBy(field: string, additive = false): void {
    this.menuField.set(null);
    const label = this.colLabel(field);

    if (this.isServerMode()) {
      const next = this.ds.toggleSort(field, additive);
      const mine = next.find(s => s.field === field);
      // Mirror into section state so the header arrows keep working unchanged.
      const primary = next[0] ?? null;
      this.patchSS({ sortField: primary?.field ?? null, sortDir: primary?.dir ?? null });
      if (!mine) { this.announceService.announce(`Sorting cleared for ${label} column`); return; }
      const rank = next.length > 1 ? `, sort level ${next.findIndex(s => s.field === field) + 1} of ${next.length}` : '';
      this.announceService.announce(`${label} column sorted ${mine.dir === 'asc' ? 'ascending' : 'descending'}${rank}`);
      return;
    }

    const cur = this.sortField(), curDir = this.sortDir();
    let dir: 'asc' | 'desc' | null = 'asc';
    if (cur === field) dir = curDir === 'asc' ? 'desc' : curDir === 'desc' ? null : 'asc';
    this.patchSS({ sortField: dir ? field : null, sortDir: dir });
    this.announceService.announce(dir ? `${label} column sorted ${dir === 'asc' ? 'ascending' : 'descending'}` : `Sorting cleared for ${label} column`);
  }

  // ── Column ops ────────────────────────────────────────────────────────────
  colLabel(field: string): string { return this.allColDefs().find(c => c.field === field)?.label ?? field; }

  openMenu(field: string, anchorEl: HTMLElement): void {
    this.saveFocus();
    const r = anchorEl.getBoundingClientRect();
    this.menuField.set(field);
    this.menuX.set(Math.min(r.left, window.innerWidth - 240));
    this.menuY.set(r.bottom + 4);
    this.filterField.set(null); this.pinMenuOpen.set(false);
    this.attachMenuScrollListener(field);
    this.announceService.announce(this.colLabel(field) + ' column menu opened');
    // Focus has to move INTO the menu. The popover renders at the document
    // root - after the grid and the pager in DOM order - so leaving focus on
    // the ⋮ trigger meant Tab walked through pagination and "Go to page"
    // before ever reaching the menu, and the menu could be tabbed straight
    // out of without closing. Focus lands on the checked radio of the first
    // group if there is one, else the first enabled item (APG menu pattern).
    this.menuFocusIdx.set(this.firstMenuFocusIdx());
    this.focusAfterRender('menu-item-' + this.menuFocusIdx());
  }

  // ── Column menu roving focus ──────────────────────────────────────────────
  /** Index into menuFlatItems() of the item that currently owns the tab stop.
   *  The menu is one tab stop, not thirteen: every item used to carry
   *  tabindex="0", which is what an APG menu explicitly must not do. */
  menuFocusIdx = signal(0);

  /** The menu's items flattened in visual order, which is the order arrow keys
   *  move through. Separators and group labels are not in here - they are not
   *  focusable and must not be landed on. */
  menuFlatItems = computed(() => {
    const out: { item: MenuItem; isRadio: boolean; groupStart: number; groupLen: number }[] = [];
    this.menuGroups().forEach(g => {
      const start = out.length;
      g.items.forEach(item => out.push({ item, isRadio: !!g.isRadioGroup, groupStart: start, groupLen: g.items.length }));
    });
    return out;
  });

  private firstMenuFocusIdx(): number {
    const flat = this.menuFlatItems();
    const checked = flat.findIndex(f => f.isRadio && f.item.checked);
    if (checked >= 0 && flat[checked].groupStart === 0) return checked;
    const firstEnabled = flat.findIndex(f => !f.item.disabled);
    return firstEnabled < 0 ? 0 : firstEnabled;
  }

  menuItemTabIndex(i: number): string { return this.menuFocusIdx() === i ? '0' : '-1'; }
  onMenuItemFocus(i: number): void { this.menuFocusIdx.set(i); }

  /** Flat position of an item, which is both its roving-focus index and its
   *  DOM id suffix. Item objects come from the same computed the template
   *  iterates, so identity comparison is sound here. */
  menuIndexOf(mi: MenuItem): number { return this.menuFlatItems().findIndex(f => f.item === mi); }

  /** Moves the roving focus by `step`, wrapping, skipping disabled items.
   *  Disabled items stay in the DOM and keep aria-disabled so the menu does
   *  not change length as a column moves to an end position. */
  private moveMenuFocus(step: number): void {
    const flat = this.menuFlatItems(); const n = flat.length; if (!n) return;
    let i = this.menuFocusIdx();
    for (let hops = 0; hops < n; hops++) {
      i = (i + step + n) % n;
      if (!flat[i].item.disabled) break;
    }
    this.menuFocusIdx.set(i);
    this.focusAfterRender('menu-item-' + i);
  }

  private setMenuFocus(i: number): void {
    this.menuFocusIdx.set(i);
    this.focusAfterRender('menu-item-' + i);
  }

  onMenuKeyDown(e: KeyboardEvent): void {
    const flat = this.menuFlatItems(); if (!flat.length) return;
    const cur = flat[this.menuFocusIdx()];
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); this.moveMenuFocus(1); break;
      case 'ArrowUp':   e.preventDefault(); this.moveMenuFocus(-1); break;
      case 'Home':      e.preventDefault(); this.setMenuFocus(flat.findIndex(f => !f.item.disabled)); break;
      case 'End': {
        e.preventDefault();
        for (let i = flat.length - 1; i >= 0; i--) if (!flat[i].item.disabled) { this.setMenuFocus(i); break; }
        break;
      }
      // Inside a radio group, Left/Right move between that group's radios and
      // select as they go, which is how a radio group behaves everywhere else.
      // Outside one they do nothing rather than leaking to the page.
      case 'ArrowRight':
      case 'ArrowLeft': {
        if (!cur || !cur.isRadio) return;
        e.preventDefault();
        const step = e.key === 'ArrowRight' ? 1 : -1;
        const rel = this.menuFocusIdx() - cur.groupStart;
        const next = cur.groupStart + ((rel + step + cur.groupLen) % cur.groupLen);
        this.setMenuFocus(next);
        this.activateMenuItem(flat[next].item);
        break;
      }
      case 'Tab':
        // APG: Tab closes the menu and moves focus to the NEXT item in the tab
        // sequence - not back to the trigger, which would cost the user an
        // extra Tab. Focus is restored to the trigger synchronously and the
        // browser's own Tab handling then continues from there, so forward and
        // backward both land where a user would expect.
        this.closeMenuKeepingTabSequence();
        break;
    }
  }

  /** One activation path for both pointer and keyboard, for every item type.
   *  Because the menu now stays open, anything that relocates the column has
   *  to drag the popover along with it - otherwise the menu sits over the
   *  column's old position and appears to belong to a different column. */
  activateMenuItem(mi: MenuItem): void {
    if (mi.disabled) return;
    const mf = this.menuField(); if (!mf) return;
    if (mi.radioValue !== undefined) {
      if (mi.idx >= 10) this.setPinDirection(mf, mi.radioValue as 'left' | 'right' | 'none');
      else this.setSortDirection(mf, mi.radioValue as 'asc' | 'desc' | 'none');
      this.repositionMenuAfterRender();
      return;
    }
    this.onMenuItemClick(mi.idx);
    if (mi.idx === 2 || mi.idx === 3 || mi.idx === 5 || mi.idx === 6) this.repositionMenuAfterRender();
  }

  /** Re-anchors the open menu under its column header once the DOM has
   *  settled. Also re-asserts focus: the activated item keeps it, so a screen
   *  reader reads the new state of the control the user just operated. */
  private repositionMenuAfterRender(): void {
    requestAnimationFrame(() => {
      const mf = this.menuField(); if (!mf) return;
      const header = document.getElementById('gc-header-' + mf);
      if (header) {
        const r = header.getBoundingClientRect();
        this.menuX.set(Math.min(r.left, window.innerWidth - 240));
        this.menuY.set(r.bottom + 4);
      }
      const el = document.getElementById('menu-item-' + this.menuFocusIdx());
      if (el && document.activeElement !== el) el.focus();
      this.cdr.markForCheck();
    });
  }

  /**
   * Closes the menu on Tab without swallowing the keypress. The event is left
   * to propagate, so after focus is put back on the ⋮ trigger the browser
   * moves on to whatever comes next (or previous, for Shift+Tab) in the tab
   * order by itself. Calling preventDefault and restoring focus - the obvious
   * approach - stranded the user on the trigger and cost them a second Tab.
   *
   * The focus move has to happen before the popover is removed from the DOM:
   * once the element holding focus is gone, focus falls back to <body> and the
   * browser resumes tabbing from the top of the document.
   */
  private closeMenuKeepingTabSequence(): void {
    const trigger = this._lastFocused;
    if (trigger && document.contains(trigger)) trigger.focus();
    this._lastFocused = null;
    const hadMenu = !!this.menuField();
    this.menuField.set(null);
    this.pinMenuOpen.set(false);
    if (hadMenu) {
      this.removeMenuScrollListener();
      this.announceService.announce('Column menu closed');
    }
    this.cdr.markForCheck();
  }

  private attachMenuScrollListener(field: string): void {
    this.removeMenuScrollListener();
    const reposition = () => {
      const header = document.getElementById('gc-header-' + field);
      if (!header) { this.menuField.set(null); return; }
      const r = header.getBoundingClientRect();
      this.menuX.set(Math.min(r.left, window.innerWidth - 240));
      this.menuY.set(r.bottom + 4);
      this.cdr.markForCheck();
    };
    this._menuScrollHandler = reposition;
    // .csc-grid-scroll = the grid's own horizontal scroll container (genuinely scrolls).
    // window = the real vertical page scroll. .csc-main has overflow:auto in CSS but
    // its parent (.csc-shell) only has min-height:100vh, not a fixed height, so
    // .csc-main never actually gets constrained/scrolls itself — the browser window
    // is what really scrolls vertically. Listening on .csc-main was a dead listener.
    document.querySelector('.csc-grid-scroll')?.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });
  }

  private removeMenuScrollListener(): void {
    if (!this._menuScrollHandler) return;
    document.querySelector('.csc-grid-scroll')?.removeEventListener('scroll', this._menuScrollHandler);
    window.removeEventListener('scroll', this._menuScrollHandler);
    this._menuScrollHandler = null;
  }

  onMenuItemClick(idx: number): void {
    const mf = this.menuField(); if (!mf) return;
    switch (idx) {
      case 0: this.setSortDirection(mf, 'asc'); break;
      case 1: this.setSortDirection(mf, 'desc'); break;
      case 9: this.setSortDirection(mf, 'none'); break;
      case 2: this.moveColumn(mf, -1); break;
      case 3: this.moveColumn(mf, 1); break;
      case 5: this.autosizeColumn(mf); break;
      case 6: this.autosizeAllColumns(); break;
      // These two are the only items that still close the menu. Choose
      // Columns opens a modal, so leaving the menu open would put two
      // overlays and two focus traps on screen at once; Reset can hide the
      // very column this menu belongs to, which would leave it orphaned.
      case 7: this.closeOverlays(); this.openChooser(); break;
      case 8: this.closeOverlays(); this.resetColumns(); break;
    }
  }

  /** The Sort radio group's single setter. "none" clears the sort, which the
   *  menu previously had no way to do at all - the only route was clicking the
   *  header a third time to get back round the cycle.
   *
   *  The menu deliberately stays open. It is a settings menu, not a one-shot
   *  command list: closing on every activation forced a reopen for each extra
   *  action, and - since these are radios - it also meant the user never heard
   *  the aria-checked change they had just made, because the control vanished
   *  in the same instant. Dismissal is the user's: Escape, an outside click,
   *  or Tab out. */
  setSortDirection(field: string, dir: 'asc' | 'desc' | 'none'): void {
    const label = this.colLabel(field);
    if (dir === 'none') {
      this.patchSS({ sortField: null, sortDir: null });
      this.announceService.announce('Sorting cleared for ' + label + ' column');
    } else {
      this.patchSS({ sortField: field, sortDir: dir });
      this.announceService.announce(label + ' column sorted ' + (dir === 'asc' ? 'ascending' : 'descending'));
    }
  }

  setPinDirection(field: string, dir: 'left' | 'right' | 'none'): void {
    const pinned = { ...this.pinnedCols() };
    if (dir === 'none') delete pinned[field]; else pinned[field] = dir as any;
    this.patchSS({ pinnedCols: pinned });
    this.announceService.announce(this.colLabel(field) + (dir === 'none' ? ' unpinned' : ` pinned ${dir}`));
    // Menu stays open - same reasoning as setSortDirection: these are radios,
    // and closing on activation hid the state change the user just made.
    this.pinMenuOpen.set(false);
    this.refitAfterHeaderChange(field);
  }

  /** Chooser pin dropdown. '' is the select's value for "not pinned". */
  setColumnPin(field: string, dir: string): void {
    this.setPinDirection(field, (dir || 'none') as 'left' | 'right' | 'none');
    // Pinning moves the row into another section of the list, and moving a DOM
    // node blurs whatever was inside it - here the select the user just
    // operated, which dropped a keyboard user onto <body>. Restored by column
    // id, because the row index is exactly what changed.
    // Deliberately here and not in setPinDirection: the column menu pins too,
    // and there focus belongs on the menu radio that repositionMenuAfterRender
    // re-asserts.
    this.focusAfterRender('chooser-pin-' + field);
  }

  /**
   * Pinning adds a 5th header icon (and unpinning removes it), so the width
   * measured when the header had 4 icons is now wrong by that icon + its gap.
   * Nothing used to re-measure on this change, so the extra icon simply
   * overflowed .csc-header-content's overflow:hidden and vanished - the pin
   * badge was there in the DOM but never visible.
   *
   * Deferred to the next frame because the new icon has to be in the DOM before
   * it can be measured.
   *
   * An autosized column is simply re-measured. A column the user resized by
   * hand keeps its width unless the new icon genuinely does not fit, in which
   * case it grows to exactly what fits - clipping a control is worse than
   * nudging a width - and keeps its autofit flag OFF, because that nudge is not
   * the user asking for autosize.
   */
  private refitAfterHeaderChange(field: string): void {
    requestAnimationFrame(() => {
      const s = this.section();
      const measured = this.measureColumnWidth(field);
      if (measured > 0) {
        const isAutoFit = !!this.autoFitFlags()[s + ':' + field];
        const cur = this._colWidths[field];
        if (isAutoFit || cur === undefined) this.patchColWidth(s, field, measured);
        else if (measured > cur) this.patchColWidth(s, field, measured);
      }
      // Frozen offsets are summed from column widths, so any still-unmeasured
      // column would stop the freeze short. Fill those in now.
      this.visibleFields().forEach(f => {
        if (this._colWidths[f] === undefined) {
          const w = this.measureColumnWidth(f);
          if (w > 0) { this.patchColWidth(s, f, w); this.setAutoFit(s, f); }
        }
      });
      this.cdr.markForCheck();
    });
  }

  /**
   * The visible neighbour a column would swap with when moved, or null when
   * the move cannot produce any visible change.
   *
   * Movement has to be reasoned about in VISUAL order (visibleFields), not
   * storage order (orderedFields). Pinning regroups the visible list into
   * left-pinned, then unpinned, then right-pinned; a column can only trade
   * places with a neighbour that shares its pin section. Swapping in
   * orderedFields alone was a silent no-op whenever the two lists disagreed:
   * a left-pinned column "moved right" changed colOrder, visibleFields put it
   * back at the front because it was still pinned, nothing on screen moved,
   * and the announcement still claimed a new position - worst of all for a
   * screen reader user, who was told about a change they could not verify.
   *
   * Moves stop at a section boundary rather than carrying the column into the
   * next section. Crossing one would silently change the column's pin state,
   * and pinning is the Pin radio group's decision to make, not a side effect
   * of an ordering command.
   */
  private moveTargetField(field: string, dir: number): string | null {
    const vis = this.visibleFields();
    const i = vis.indexOf(field); if (i < 0) return null;
    const j = i + dir; if (j < 0 || j >= vis.length) return null;
    return this.sectionOf(vis[j]) === this.sectionOf(field) ? vis[j] : null;
  }

  /** The 1-based range of visible positions a column may legally occupy: the
   *  span of its own pin section. Used to bound the chooser's Order field, so
   *  the number it accepts always means the same thing as the number it shows. */
  private sectionBounds(field: string): { lo: number; hi: number } {
    const vis = this.visibleFields(), sec = this.sectionOf(field);
    let lo = -1, hi = -1;
    vis.forEach((f, i) => { if (this.sectionOf(f) === sec) { if (lo < 0) lo = i; hi = i; } });
    return { lo: lo + 1, hi: hi + 1 };
  }

  /** Rewrites the order of one pin section's VISIBLE columns and leaves every
   *  other storage slot exactly where it was. Hidden columns therefore keep the
   *  place they will reappear at - showing one again must not teleport it, and
   *  unpinning must not invent a new position for anything.
   *  `mutate` receives that section's visible fields in visible order. */
  private withSectionResequenced(field: string, mutate: (seq: string[]) => string[]): string[] {
    const order = this.orderedFields().slice(), hidden = this.colHidden();
    const sec = this.sectionOf(field), slots: number[] = [];
    order.forEach((f, i) => { if (!hidden[f] && this.sectionOf(f) === sec) slots.push(i); });
    const seq = mutate(slots.map(i => order[i]));
    if (seq.length !== slots.length) return order;
    slots.forEach((slot, i) => { order[slot] = seq[i]; });
    return order;
  }

  /** Commits a reordered storage array ONLY when it changes the order the user
   *  can actually see, returning the column's new 1-based visible position.
   *  Returns null when nothing on screen would move, so the caller stays silent:
   *  a drop or a keypress is not by itself a move, and the old code announced
   *  plenty that never happened (a pinned column dragged into the scrolling
   *  block changed storage, got regrouped straight back, and still toasted). */
  private applyOrderIfVisiblyChanged(field: string, order: string[]): number | null {
    const before = this.visibleFields(), after = this.projectVisible(order);
    if (after.length === before.length && after.every((f, i) => f === before[i])) return null;
    this.patchSS({ colOrder: order });
    const pos = after.indexOf(field);
    return pos < 0 ? null : pos + 1;
  }

  /** True when Move Left / Move Right would do nothing, so the menu can mark
   *  the item aria-disabled instead of offering a control with no effect. */
  canMoveColumn(field: string, dir: number): boolean {
    return this.moveTargetField(field, dir) !== null;
  }

  /** Move Left/Right, from the column menu or Ctrl+Arrow on a header. Works on
   *  the visible list, so a pinned column can never report a new position while
   *  standing still. */
  moveColumn(field: string, dir: number): void {
    const dirWord = dir < 0 ? 'left' : 'right';
    const target = this.moveTargetField(field, dir);
    if (!target) {
      this.announceService.announce(
        this.colLabel(field) + ' cannot move ' + dirWord + ' any further');
      return;
    }
    const order = this.withSectionResequenced(field, seq => {
      const s = seq.slice(), i = s.indexOf(field), j = s.indexOf(target);
      if (i < 0 || j < 0) return seq;
      [s[i], s[j]] = [s[j], s[i]];
      return s;
    });
    const vPos = this.applyOrderIfVisiblyChanged(field, order);
    if (vPos === null) return;
    this.showToast(this.colLabel(field) + ' moved ' + dirWord
      + ', position ' + vPos + ' of ' + this.visibleFields().length);
  }

  /** Drag-and-drop reorder, shared by the header row and the chooser list. */
  /**
   * `after` is which SIDE of the target the pointer was on.
   *
   * Without it a drop could only ever mean "insert before this column", so the
   * last slot of a section was unreachable by dragging: to land after the final
   * column you have to be able to say "after", and nothing in the drag path
   * could. Dropping on the final column instead parked the dragged one in
   * second-to-last, and dropping on your own immediate right neighbour removed
   * and reinserted you in the same slot - a silent no-op that looked like the
   * drag had been ignored. Both symptoms are the same missing bit.
   */
  reorderTo(from: string, to: string, after = false): void {
    if (!from) return; // no drag in progress - not a user-visible outcome
    // Every OTHER outcome says something. A drop that lands on a cell which
    // quietly ignores it is the worst of the three: a sighted user sees the
    // column snap back with no reason given, and a screen reader user gets
    // nothing at all after "Grabbed ... for reordering".
    if (from === to) {
      this.announceService.announce(this.colLabel(from) + ' is already in that position');
      return;
    }
    const hidden = this.colHidden();
    if (hidden[from] || hidden[to]) {
      this.announceService.announce(
        this.colLabel(hidden[from] ? from : to) + ' is hidden and has no position to move to');
      return;
    }
    // A drop across a pin boundary is refused rather than half-applied: the
    // regrouping in projectVisible would put the column straight back, so the
    // drag would move nothing while still claiming it had. Changing the pin
    // itself belongs to the Pin control.
    if (this.sectionOf(from) !== this.sectionOf(to)) {
      this.announceService.announce(
        this.colLabel(from) + ' cannot move outside its pinned section');
      return;
    }
    const order = this.withSectionResequenced(from, seq => {
      const s = seq.filter(f => f !== from), i = s.indexOf(to);
      if (i < 0) return seq;
      // i + 1 lands past the end when `to` is the last column, which is exactly
      // how the final slot becomes reachable.
      s.splice(after ? i + 1 : i, 0, from);
      return s;
    });
    this.menuField.set(null);
    const vPos = this.applyOrderIfVisiblyChanged(from, order);
    if (vPos === null) {
      // Storage may have accepted the move while the projection undid it, so
      // the screen did not change. Say so rather than looking broken.
      this.announceService.announce(this.colLabel(from) + ' is already in that position');
      return;
    }
    this.showToast(this.colLabel(from) + ' moved, position '
      + vPos + ' of ' + this.visibleFields().length);
  }

  setColumnPosition(field: string, val: string): void {
    const vis = this.visibleFields(), cur = vis.indexOf(field);
    if (cur < 0) return; // hidden: no visible position to set
    const { lo, hi } = this.sectionBounds(field);
    const n = parseInt(val, 10);
    // Rejected, never clamped. Clamping would quietly give the number the user
    // typed a different meaning, and anything outside this column's own pin
    // section would change its pin state as a side effect. Nothing is written
    // and nothing is announced as a move.
    if (!n || n < lo || n > hi) {
      this.announceService.announce('Enter a position between ' + lo + ' and ' + hi);
      this.resyncPosInput(field);
      return;
    }
    if (n !== cur + 1) {
      const order = this.withSectionResequenced(field, seq => {
        const s = seq.filter(f => f !== field);
        s.splice(n - lo, 0, field);
        return s;
      });
      const vPos = this.applyOrderIfVisiblyChanged(field, order);
      if (vPos !== null) {
        this.announceService.announce(this.colLabel(field) + ' moved to position '
          + vPos + ' of ' + this.visibleFields().length);
      }
    }
    this.resyncPosInput(field);
  }

  /** Refocuses the Order field AND puts its text back in step with the model.
   *  Angular's [value] binding only writes when the bound value changes, so a
   *  rejected entry would otherwise sit in the box showing a position the
   *  column does not have - contradicting both the grid and the aria-valuenow
   *  right beside it, which is the exact mismatch this dialog is meant to end. */
  private resyncPosInput(field: string): void {
    const id = 'chooser-pos-' + field;
    this.focusAfterRender(id);
    setTimeout(() => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      const pos = this.visibleFields().indexOf(field) + 1;
      if (el && pos > 0) el.value = String(pos);
    });
  }

  /** Spinbutton keys on the position field. Handled explicitly (rather than
   *  relying on <input type="number">'s native spinner) so focus survives the
   *  re-render that reordering triggers. Bounded by the column's pin section,
   *  matching the range the field advertises as aria-valuemin/max.
   *
   *  A refused step ANNOUNCES rather than doing nothing: the arrow key is
   *  swallowed by preventDefault, aria-valuenow does not change, and the value
   *  in the box does not change, so silence leaves a screen reader user with no
   *  evidence the key was even received. Same wording and same live region as
   *  the menu's Move Left / Move Right boundary, so the two ways of reordering
   *  a column report a blocked move identically. Announce, not showToast - a
   *  blocked move is feedback on a keypress, not an action that happened. */
  onPosKeyDown(e: KeyboardEvent, field: string): void {
    const cur = this.visibleFields().indexOf(field) + 1;
    if (cur < 1) return;
    const { lo, hi } = this.sectionBounds(field);
    if (e.key === 'ArrowUp')   {
      e.preventDefault();
      if (cur > lo) this.setColumnPosition(field, String(cur - 1));
      else this.announceService.announce(this.colLabel(field) + ' cannot move up any further');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cur < hi) this.setColumnPosition(field, String(cur + 1));
      else this.announceService.announce(this.colLabel(field) + ' cannot move down any further');
      return;
    }
    if (e.key === 'Home')      { e.preventDefault(); this.setColumnPosition(field, String(lo)); return; }
    if (e.key === 'End')       { e.preventDefault(); this.setColumnPosition(field, String(hi)); return; }
  }

  // Auto-size: measure content width
  /**
   * Starting widths. Deliberately EMPTY: the old map keyed literal CSC field
   * names (doc/entity/address...), so any grid fed custom columnDefs got no
   * usable defaults and Reset restored widths for columns that didn't exist.
   * Columns with no entry render as minmax(100px,1fr) for the one frame before
   * the automatic measure-and-fit pass runs.
   */
  autoWidths(): Record<string, number> { return {}; }

  private setAutoFit(section: string, field: string): void {
    this.autoFitFlags.update(f => ({ ...f, [section + ':' + field]: true }));
  }
  private clearAutoFit(section: string, field: string): void {
    this.autoFitFlags.update(f => {
      if (!f[section + ':' + field]) return f;
      const n = { ...f }; delete n[section + ':' + field]; return n;
    });
  }

  /** Default-autosize a section ONCE, on first entry, after its header DOM has
   *  rendered (headerRequiredWidth reads live scrollWidth, hence setTimeout). */
  private scheduleDefaultAutosize(s: string): void {
    if (this._defaultAutosized.has(s)) return;
    this._defaultAutosized.add(s);
    // requestAnimationFrame rather than setTimeout(0): this guarantees the grid
    // has been laid out, so the measurement path never has to fall back to a
    // guess. Two frames because the first paint of a section can be partial.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.section() === s) { this.autosizeAllColumns(true); }
    }));
  }

  autosizeColumn(field: string): void {
    const w = this.measureColumnWidth(field);
    if (w > 0) this.patchColWidth(this.section(), field, w);
    this.setAutoFit(this.section(), field);
    this.patchSS({}); // trigger recompute
    this.cdr.markForCheck();
    this.showToast(this.colLabel(field) + ' column autosized');
  }

  /**
   * Exact pixel width the header row's icons/padding need, BEFORE the label
   * text itself. Every section that offers autosize (Advanced/Editable/
   * Expandable) always renders drag(24) + sort(24) + filter(24) + menu(24) =
   * 96px, plus .csc-header-content's own padding (16px) and flex gaps (~4px)
   * = 116px baseline. If this specific column is pinned, there's a 5th icon
   * (+24px) plus one more gap (+1px) = +25px on top of that.
   * The old code used a flat "+60" guess here, which is roughly half of what
   * the header row actually needs, causing the header label to visually
   * truncate even though the data cells (which have none of these icons)
   * fit comfortably at that same width.
   */
  /**
   * Exact pixel width this column's header needs to show everything
   * (label + drag/sort/filter/menu/pin icons + padding) without clipping.
   * Measured directly from the live, currently-rendered DOM via scrollWidth -
   * this is the browser's own "how wide would this need to be to show
   * everything without clipping" measurement, which automatically stays
   * correct if icons are ever added/removed/restyled in the template.
   * (The previous version hardcoded "4 icons = 96px" etc, which would
   * silently go stale the next time someone changes the header markup.)
   *
   * Falls back to a rough estimate only if the header isn't currently in
   * the DOM (shouldn't normally happen - autosize is triggered from that
   * column's own menu, so its header must be visible - but kept safe).
   */
  /**
   * Hidden span used to measure text. It copies the font off the element being
   * measured, so the result follows the real font family, weight and current
   * text size - unlike the old canvas code, which hardcoded '12px Lato'.
   */
  private _probe: HTMLElement | null = null;
  private textWidth(text: string, ref: Element | null): number {
    if (!text) return 0;
    if (!this._probe?.isConnected) {
      const el = document.createElement('span');
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;' +
                         'white-space:nowrap;pointer-events:none;';
      this.hostEl.nativeElement.appendChild(el);
      this._probe = el;
    }
    const cs = ref ? getComputedStyle(ref) : null;
    if (cs) {
      this._probe.style.fontSize   = cs.fontSize;
      this._probe.style.fontFamily = cs.fontFamily;
      this._probe.style.fontWeight = cs.fontWeight;
      this._probe.style.letterSpacing = cs.letterSpacing;
    }
    this._probe.textContent = text;
    return this._probe.getBoundingClientRect().width;
  }

  /** Sum of the horizontal padding on an element. */
  private padX(el: Element): number {
    const cs = getComputedStyle(el);
    return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  }

  /**
   * Width a column needs = the widest of its header and its rendered cells.
   *
   * Text is measured separately from "chrome" (icons, checkboxes, links'
   * leading glyphs) because those two behave differently: icons are flex:none
   * so their laid-out width is already correct, while text nodes sit inside
   * elements with overflow:hidden, which makes a flex item's min-width:auto
   * resolve to 0 - so they shrink to the current column width and can never
   * report the width they actually need. Measuring the text in a free-standing
   * probe sidesteps that entirely.
   */
  private measureColumnWidth(field: string): number {
    let maxW = 0;

    const header = document.getElementById('gc-header-' + field);
    const content = header?.querySelector<HTMLElement>('.csc-header-content');
    if (content) {
      const label = content.querySelector<HTMLElement>('.csc-col-label');
      // The label carries a min-width floor (so it can never collapse to
      // nothing in a narrow column). Measuring only its TEXT under-reports
      // every column whose label is shorter than that floor - which is why
      // City/State/Zip/Date came out ~20px short and clipped their filter icon.
      const labelMin = label ? (parseFloat(getComputedStyle(label).minWidth) || 0) : 0;
      const labelW = Math.max(this.textWidth(this.colLabel(field), label), labelMin);
      let w = this.padX(content) + labelW;
      // Every non-label child (drag handle, sort, filter, menu, pin, editable
      // pencil) keeps its intrinsic width, so offsetWidth is trustworthy here.
      Array.from(content.children).forEach(child => {
        if (!child.classList.contains('csc-col-label')) w += (child as HTMLElement).offsetWidth;
      });
      const gap = parseFloat(getComputedStyle(content).gap) || 0;
      w += gap * Math.max(0, content.children.length - 1);
      maxW = w;
    }

    document.querySelectorAll<HTMLElement>('.csc-data-cell[id$="-' + field + '"]').forEach(cell => {
      let w = this.padX(cell);
      const gap = parseFloat(getComputedStyle(cell).gap) || 0;
      const kids = Array.from(cell.children) as HTMLElement[];
      kids.forEach(child => {
        const isText = child.classList.contains('csc-cell-text') || child.classList.contains('csc-doc-link');
        if (isText) w += this.textWidth(child.textContent ?? '', child);
        else if (child.classList.contains('csc-cell-edit-btn')) { /* absolutely positioned overlay */ }
        else w += child.offsetWidth;
      });
      w += gap * Math.max(0, kids.length - 1);
      if (w > maxW) maxW = w;
    });

    // Nothing rendered yet: return 0 rather than a hand-tuned guess. The caller
    // keeps whatever width the column already has, and the automatic pass runs
    // again after layout, when a real measurement is possible.
    return maxW > 0 ? Math.min(Math.ceil(maxW) + 4, 420) : 0;
  }

  /**
   * Required width of a non-data header cell (checkbox / expand / delete),
   * derived from what is actually inside it plus its own padding - so a
   * restyled checkbox or a bigger action icon is picked up automatically.
   */
  private measureLeadWidth(key: string): number | null {
    const cell = document.getElementById('gc-header-' + key);
    if (!cell) return null;
    let w = this.padX(cell);
    const kids = Array.from(cell.children) as HTMLElement[];
    kids.forEach(k => { w += k.offsetWidth; });
    const gap = parseFloat(getComputedStyle(cell).gap) || 0;
    w += gap * Math.max(0, kids.length - 1);
    // The lead cell also holds each row's checkbox; take whichever is wider.
    if (key === 'lead') {
      const rowCell = document.querySelector<HTMLElement>('.csc-lead-cell');
      if (rowCell) {
        let rw = this.padX(rowCell);
        const rk = Array.from(rowCell.children) as HTMLElement[];
        rk.forEach(k => { rw += k.offsetWidth; });
        rw += (parseFloat(getComputedStyle(rowCell).gap) || 0) * Math.max(0, rk.length - 1);
        if (rw > w) w = rw;
      }
    }
    return w > 0 ? Math.ceil(w) + 4 : null;
  }

  /** Measure every visible column in one pass. */
  private measureAllColumns(): Record<string, number> {
    const out: Record<string, number> = {};
    this.visibleFields().forEach(f => { const w = this.measureColumnWidth(f); if (w > 0) out[f] = w; });
    return out;
  }




  /**
   * Two distinct modes, per the agreed AC:
   *
   *  - EXPLICIT (silent=false, i.e. the user clicked "Autosize All Columns"):
   *    every visible column is re-measured and applied - including ones the
   *    user resized by hand. The click IS the user overriding their earlier
   *    manual choice, so nothing is skipped, and the menu checkmark coming
   *    back on is truthful.
   *
   *  - MAINTENANCE (silent=true: first load, text-size change, reset):
   *    manually-resized columns (width present, autofit flag off) keep BOTH
   *    their width and their cleared flag. They are not re-applied and - the
   *    old bug - their flag is never silently forced back to true, so
   *    "Autosize All" correctly stays unchecked until the user asks for it.
   *
   * Flags are set only for columns actually measured AND applied in this pass
   * (never for hidden columns' stale width entries, never for skipped ones),
   * so the checkmark always reflects reality.
   *
   * Only columns that are actually on screen can be measured. Hidden ones keep
   * whatever they had and get measured when they are shown again - guessing a
   * width for something that isn't rendered is what the old estimate did, and
   * it was wrong often enough to be worth not doing.
   */
  autosizeAllColumns(silent = false): void {
    const measured = this.measureAllColumns();
    const widths: Record<string, number> = { ...this._colWidths };
    const sec = this.section(), flags0 = this.autoFitFlags(), cur = this._colWidths;
    const applied: string[] = [];
    Object.keys(measured).forEach(field => {
      const manual = cur[field] !== undefined && !flags0[sec + ':' + field];
      if (silent && manual) return; // maintenance pass respects manual widths - and leaves their flag off
      widths[field] = measured[field];
      applied.push(field);
    });
    // Leading (non-data) columns are measured too, so their widths stop being
    // literals that go stale whenever the checkbox or action icons are restyled.
    const lead: Record<string, number> = { ...this.leadWidths() };
    ['lead', 'expand-col', 'delete-col'].forEach(k => {
      const w = this.measureLeadWidth(k);
      if (w !== null) lead[k] = w;
    });
    this.leadWidths.set(lead);
    this.setColWidths(sec, widths);
    this.autoFitFlags.update(f => {
      const n = { ...f };
      applied.forEach(field => { n[sec + ':' + field] = true; });
      return n;
    });
    this.patchSS({});
    this.cdr.markForCheck();
    if (!silent) this.showToast('All columns autosized');
  }

  resetColumns(): void {
    // Seeded from THIS section's own columns. defaultSectionState() with no
    // argument falls back to the built-in eight, which are not the column set
    // in All Features or in a host that supplied its own columnDefs - resetting
    // to them left the grid with no data columns at all.
    this.patchSS(defaultSectionState(this.colDefs().map(c => c.field)));
    this.setColWidths(this.section(), {});
    this.menuField.set(null);
    // Reset now means "measure everything again" rather than "restore a
    // hardcoded map", so it works for any column set. Deferred one tick so the
    // reset layout is in the DOM before it is measured.
    setTimeout(() => {
      this.autosizeAllColumns(true);
      this.showToast('Columns reset to default layout');
    });
  }

  // ── Column resize (mouse) ─────────────────────────────────────────────────
  /** x of the full-height guide while a column is being dragged, measured from
   *  .csc-grid-inner's left edge. null when no drag is in progress. */
  resizeGuideX = signal<number | null>(null);

  private updateResizeGuide(field: string): void {
    const inner = this.hostEl.nativeElement.querySelector('.csc-grid-inner');
    const cell = document.getElementById('gc-header-' + field);
    if (!inner || !cell) { this.resizeGuideX.set(null); return; }
    // Right edge of the column being dragged, in .csc-grid-inner coordinates,
    // so the guide stays put while the scroll container moves under it.
    this.resizeGuideX.set(cell.getBoundingClientRect().right - inner.getBoundingClientRect().left);
  }

  startResize(field: string, e: MouseEvent): void {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, w0 = this._colWidths[field] || this.measureColumnWidth(field) || 120;
    const s = this.section();
    this.updateResizeGuide(field);
    const onMove = (ev: MouseEvent) => {
      const nw = Math.max(MIN_COL_W, w0 + (ev.clientX - startX));
      this.patchColWidth(s, field, nw);
      this.clearAutoFit(s, field); // manual resize -> autosize checkmark off
      // Mouse events fire outside Angular's zone; OnPush won't see the signal write
      // in the same tick unless we synchronously flush change detection.
      this.cdr.detectChanges();
      this.updateResizeGuide(field);
      this.cdr.detectChanges();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      this.resizeGuideX.set(null);
      this.cdr.detectChanges();
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Column resize (keyboard) ──────────────────────────────────────────────
  /** Keyboard resize gets the same full-height guide the mouse drag draws.
   *  Without it the only sign resize mode was active was an outline on the
   *  header cell - the boundary the user is actually moving looked no different
   *  from any other, so there was nothing to aim at while pressing arrows. */
  enterResizeMode(field: string): void {
    this.resizeModeField.set(field);
    this._resizeSlack = null; // each resize session starts square
    this.updateResizeGuide(field);
    this.announceService.announce(`Resize mode active for ${this.colLabel(field)} column. Use arrow keys to resize, Escape to exit.`);
  }

  exitResizeMode(): void {
    const f = this.resizeModeField();
    this.resizeModeField.set(null);
    this.resizeGuideX.set(null);
    this._resizeSlack = null;
    if (f) this.announceService.announce('Resize mode exited. ' + this.colLabel(f) + ' column width: ' + (this._colWidths[f] ?? 'auto') + 'px');
  }

  onResizeModeKeyDown(field: string, e: KeyboardEvent): void {
    if (!this.resizeModeField()) return;
    const step = e.shiftKey ? 50 : 10;
    const s = this.section();
    const cur = this._colWidths[field] || this.measureColumnWidth(field) || 120;
    // Only this column's own slack counts, and only while the width is still
    // the one it was recorded against.
    const slack = this._resizeSlack;
    let debt = slack && slack.field === field && slack.width === cur ? slack.debt : 0;
    let next: number;
    if (e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      // Repay refused shrink first: the press that undoes a clamped shrink has
      // to move the edge by what that shrink actually moved it, not by a full
      // step, or the column ends up wider than it started.
      const pay = Math.min(debt, step);
      debt -= pay;
      next = cur + (step - pay);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      const want = cur - step;
      next = Math.max(MIN_COL_W, want);
      debt += next - want; // 0 when nothing was clamped
    } else return;
    this.patchColWidth(s, field, next);
    this.clearAutoFit(s, field);
    this._resizeSlack = { field, width: next, debt };
    // The track only takes its new width once change detection has run, so the
    // guide is re-measured in a later task. setTimeout, not rAF: rAF does not
    // fire while the tab is hidden or throttled, which would leave the guide
    // stranded at the old boundary while the column kept moving.
    setTimeout(() => { this.updateResizeGuide(field); this.cdr.markForCheck(); });
  }

  // ── Column drag (header) ──────────────────────────────────────────────────
  onColDragStart(field: string, e: DragEvent): void {
    // canReorder is otherwise carried only by draggable="false" on the header,
    // which is a presentation attribute: it stops a real mouse from starting a
    // drag, but nothing stops a programmatic drag event from reaching these
    // handlers and reordering a section that declares reordering off. The
    // capability is enforced here too so the rule lives in the logic, not in
    // the markup. Guarded at all three points because each is an entry: start
    // sets the payload, over enables the drop, drop performs it.
    if (!this.canReorder()) return;
    this._isDragging = true;
    this.dragField.set(field);
    try { e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', field); } catch {}
    this.announceService.announce('Grabbed ' + this.colLabel(field) + ' column for reordering');
  }
  /** Which half of a header the pointer is over. Columns run horizontally, so
   *  the split is on x; the chooser list runs vertically and splits on y. */
  private pointerAfter(e: DragEvent, el: EventTarget | null, axis: 'x' | 'y'): boolean {
    const r = (el as HTMLElement | null)?.getBoundingClientRect();
    if (!r) return false;
    return axis === 'x' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
  }

  onColDragOver(field: string, e: DragEvent): void {
    if (!this.canReorder()) return; // no preventDefault -> the drop is refused by the browser
    e.preventDefault();
    const after = this.pointerAfter(e, e.currentTarget, 'x');
    if (this.dropTarget() !== field) this.dropTarget.set(field);
    if (this.dropAfter() !== after) this.dropAfter.set(after);
  }
  onColDrop(field: string, e: DragEvent): void {
    if (!this.canReorder()) return;
    e.preventDefault();
    this.reorderTo(this.dragField()!, field, this.pointerAfter(e, e.currentTarget, 'x'));
    this.dragField.set(null); this.dropTarget.set(null); this.dropAfter.set(false);
  }
  onColDragEnd(): void { this._isDragging = false; this.dragField.set(null); this.dropTarget.set(null); this.dropAfter.set(false); }

  // ── Chooser ───────────────────────────────────────────────────────────────
  openChooser(): void {
    this.saveFocus(); this.menuField.set(null);
    this.chooserOpen.set(true); this.chooserSearch.set('');
    this.announceService.announce('Choose columns dialog opened');
    this.focusAfterRender('chooser-search-input');
  }
  closeChooser(): void {
    this.chooserOpen.set(false); this.cDragField.set(null); this.cDropTarget.set(null);
    this.announceService.announce('Choose columns dialog closed');
    // Not plain restoreFocus(): this dialog can delete the very cell the user
    // opened it from. restoreFocus() stays as-is for the menu and filter
    // popovers, which never remove their trigger.
    this.restoreFocusToGrid();
  }
  toggleColumn(field: string): void {
    const wasHidden = !!this.colHidden()[field];
    const h = { ...this.colHidden() };
    // Any column, including the first, may be unchecked. With none selected the
    // grid shows an explicit empty state rather than blocking the interaction.
    if (!h[field]) h[field] = true; else delete h[field];
    this.patchSS({ colHidden: h });
    this.ensureActiveCellValid(); // hiding the active column would strand the tab stop
    if (h[field]) this.retireFeatureState(field);
    const kind = this.actionKindOf(field);
    this.announceService.announce(kind
      ? this.colLabel(field) + (h[field] ? ' feature switched off' : ' feature switched on')
      : this.colLabel(field) + (h[field] ? ' hidden' : ' shown'));
    // A column that was hidden was never measured; measure it now that it is
    // rendered, instead of leaving it on a stale width.
    if (wasHidden && !h[field]) {
      requestAnimationFrame(() => {
        const mw = this.measureColumnWidth(field);
        if (mw > 0) { this.patchColWidth(this.section(), field, mw); this.setAutoFit(this.section(), field); }
        this.cdr.markForCheck();
      });
    }
  }
  /** Switching a feature off has to drop the state it owned, or that state
   *  survives with nothing left on screen to reach it: a selection nobody can
   *  see or clear, and detail panels stuck open with no chevron to close them. */
  private retireFeatureState(field: string): void {
    if (field === 'lead') {
      this.setSelected({});
      this.selectingAll.set(false);
      // A confirm opened from the selection has nothing left to act on.
      if (this.bulkDeleteOpen()) this.closeDeleteConfirm();
    }
    if (field === 'expand-col') this.expanded.set({});
    if (field === 'delete-col' && (this.bulkDeleteOpen() || this.deleteId() != null)) {
      this.closeDeleteConfirm();
    }
  }

  /** True when every column currently listed in the chooser is visible. */
  chooserAllVisible = computed(() => {
    const items = this.chooserItems();
    return items.length > 0 && items.every(i => i.visible);
  });
  chooserSomeVisible = computed(() => {
    const items = this.chooserItems();
    return items.some(i => i.visible) && !items.every(i => i.visible);
  });
  /** Replaces the old Show all / Hide all pair with one stateful control. */
  toggleChooserSelectAll(): void {
    const items = this.chooserItems();
    if (!items.length) return;
    if (this.chooserAllVisible()) {
      const hidden = { ...this.colHidden() };
      items.forEach(i => { hidden[i.field] = true; }); // every one, action columns included
      this.patchSS({ colHidden: hidden });
      this.ensureActiveCellValid();
      items.forEach(i => this.retireFeatureState(i.field));
      this.announceService.announce('All ' + items.length + ' columns hidden');
    } else {
      const hidden = { ...this.colHidden() };
      items.forEach(i => { delete hidden[i.field]; });
      this.patchSS({ colHidden: hidden });
      this.announceService.announce('All ' + items.length + ' columns shown');
    }
  }

  /** Count label shown opposite Select all; narrows while a search is active. */
  chooserCountLabel = computed(() => {
    // allColDefs, not colDefs: the list now includes the action columns, so
    // counting only data columns read as "10 of 8".
    const shown = this.chooserItems().length, all = this.allColDefs().length;
    return shown === all ? `${all} columns` : `${shown} of ${all} columns`;
  });

  /** Drives the grid's empty state when the user hides every column. */
  noColumnsVisible = computed(() => this.visibleFields().length === 0);

  chooserShowAll(): void { this.patchSS({ colHidden: {} }); }
  chooserHideAll(): void {
    const h: Record<string,boolean> = {};
    const fields = this.orderedFields();
    // Keep the first DATA column. Slicing blindly at index 1 would now leave an
    // action column as the sole survivor and hide every data column instead.
    const firstData = fields.find(f => !ACTION_COL_IDS.has(f));
    fields.forEach(f => { if (f !== firstData) h[f] = true; });
    this.patchSS({ colHidden: h });
    this.ensureActiveCellValid();
    fields.forEach(f => { if (h[f]) this.retireFeatureState(f); });
    this.showToast('Showing ' + this.visibleFields().length + ' of ' + fields.length + ' columns');
  }
  onCDragStart(field: string): void { this.cDragField.set(field); }
  onCDragOver(field: string, e: DragEvent): void {
    e.preventDefault();
    const after = this.pointerAfter(e, e.currentTarget, 'y');
    if (this.cDropTarget() !== field) this.cDropTarget.set(field);
    if (this.cDropAfter() !== after) this.cDropAfter.set(after);
  }
  onCDrop(field: string, e: DragEvent): void {
    e.preventDefault();
    this.reorderTo(this.cDragField()!, field, this.pointerAfter(e, e.currentTarget, 'y'));
    this.cDragField.set(null); this.cDropTarget.set(null); this.cDropAfter.set(false);
  }
  onCDragEnd(): void { this.cDragField.set(null); this.cDropTarget.set(null); this.cDropAfter.set(false); }

  // ── Filter ────────────────────────────────────────────────────────────────
  openFilter(field: string, triggerEl?: HTMLElement): void {
    this.saveFocus();
    // Position below the trigger element or default
    const el = triggerEl ?? document.getElementById('gc-header-' + field);
    if (el) {
      const r = el.getBoundingClientRect();
      this.filterX.set(Math.min(r.left, window.innerWidth - 260));
      this.filterY.set(r.bottom + 4);
    }
    const cur = this.filters()[field];

    if (this.isServerMode()) {
      this.filterField.set(field);
      this.filterSearch.set('');
      this.filterDraft.set(cur ? [...cur] : []);
      this.filterFocusIdx.set(-1);
      this.menuField.set(null);
      this.announceService.announce(this.colLabel(field) + ' filter dialog opened. Loading values.');
      void this.ds.distinctValues(field).then(vals => {
        this.serverDistinct.update(m => ({ ...m, [field]: vals }));
        if (this.filterField() === field && !cur) this.filterDraft.set([...vals]);
        this.cdr.markForCheck();
        this.announceService.announce(vals.length + ' values available.');
      });
      setTimeout(() => { document.getElementById('filter-search-input')?.focus(); });
      this.attachFilterScrollListener(field);
      return;
    }

    const distinct = this.distinctFor(field);
    this.filterField.set(field);
    this.filterSearch.set('');
    this.filterDraft.set(cur ? [...cur] : distinct.map(String));
    this.filterFocusIdx.set(-1);
    this.menuField.set(null);
    this.announceService.announce(this.colLabel(field) + ' filter dialog opened. ' + distinct.length + ' values available.');
    // Focus search input
    setTimeout(() => { document.getElementById('filter-search-input')?.focus(); });
    // AC-FILTER-04: keep popup anchored to its header while grid scrolls.
    // Listen on the grid scroll container; recalculate position on every scroll event.
    this.attachFilterScrollListener(field);
  }

  /**
   * AC-FILTER-04: Attach a scroll listener to the grid scroll container so the
   * filter popup repositions itself relative to the trigger header while the
   * user scrolls. Also remove any previously-attached listener first to avoid
   * leaks when opening a new filter while another is still tracked.
   */
  private attachFilterScrollListener(field: string): void {
    this.removeFilterScrollListener();
    const reposition = (): void => {
      const header = document.getElementById('gc-header-' + field);
      if (!header) return;
      const r = header.getBoundingClientRect();
      this.filterX.set(Math.min(r.left, window.innerWidth - 260));
      this.filterY.set(r.bottom + 4);
      this.cdr.markForCheck();
    };
    this._filterScrollHandler = reposition;
    document.querySelector('.csc-grid-scroll')?.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });
  }

  /**
   * AC-FILTER-04: Remove the scroll listener attached in openFilter.
   * Called whenever the filter popup closes (overlay click, apply, clear, escape).
   */
  private removeFilterScrollListener(): void {
    if (!this._filterScrollHandler) return;
    document.querySelector('.csc-grid-scroll')?.removeEventListener('scroll', this._filterScrollHandler);
    window.removeEventListener('scroll', this._filterScrollHandler);
    this._filterScrollHandler = null;
  }

  onFilterSearchChange(val: string): void {
    this.filterSearch.set(val);
    this.filterFocusIdx.set(-1);
    // Announce result count for screen readers
    const ff = this.filterField(); if (!ff) return;
    const q = val.toLowerCase();
    const distinct = this.distinctFor(ff);
    const matches = q ? distinct.filter(v => String(v).toLowerCase().includes(q)) : distinct;
    const msg = !matches.length ? 'No matches found' : matches.length + (matches.length === 1 ? ' result' : ' results');
    this.announceService.announce(msg);
  }

  onFilterPopupKeyDown(e: KeyboardEvent): void {
    const vals = this.filterValues();
    const idx = this.filterFocusIdx();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // index 0 = the Select All row; value options occupy 1..vals.length
      const next = Math.min(idx + 1, vals.length);
      this.filterFocusIdx.set(next);
      document.getElementById('filter-opt-' + next)?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx <= 0) { document.getElementById('filter-search-input')?.focus(); this.filterFocusIdx.set(-1); }
      else { const prev = idx - 1; this.filterFocusIdx.set(prev); document.getElementById('filter-opt-' + prev)?.focus(); }
    }
  }

  /** Select-all state for the CURRENTLY VISIBLE (search-filtered) values. */
  allFilterChecked  = computed(() => { const v = this.filterValues(); return v.length > 0 && v.every(x => x.checked); });
  someFilterChecked = computed(() => { const v = this.filterValues(); return v.some(x => x.checked) && !v.every(x => x.checked); });

  toggleFilterSelectAll(): void {
    const visible = this.filterValues().map(v => v.label);
    const d = new Set(this.filterDraft() || []);
    if (this.allFilterChecked()) {
      visible.forEach(l => d.delete(l));
      this.announceService.announce('All filter values cleared');
    } else {
      visible.forEach(l => d.add(l));
      this.announceService.announce('All filter values selected');
    }
    this.filterDraft.set([...d]);
  }

  toggleFilterVal(val: string): void {
    const d = [...(this.filterDraft() || [])], i = d.indexOf(val);
    if (i >= 0) d.splice(i, 1); else d.push(val);
    this.filterDraft.set(d);
  }

  applyFilter(): void {
    const field = this.filterField()!;
    const distinct = this.distinctFor(field);
    const d = this.filterDraft() || [];
    const f = { ...this.filters() };
    if (d.length === distinct.length) delete f[field]; else f[field] = d;

    if (this.isServerMode()) {
      this.patchSS({ filters: f });
      this.ds.setFilter(field, f[field] ?? []);
      this.filterField.set(null);
      this.setSelected({});
      this.ensureActiveCellValid();
      this.removeFilterScrollListener();
      this.announceService.announce(this.colLabel(field) + ' filter applied. Loading results.');
      this.restoreFocus();
      return;
    }

    const sel = { ...this.selected() };
    const visible = new Set(this.rows().filter(x => Object.keys(f).every(ff => !f[ff]?.length || f[ff].includes((x as any)[ff]))).map(x => x.id));
    Object.keys(sel).forEach(id => { if (!visible.has(id)) delete sel[id]; });
    this.patchSS({ filters: f }); this.filterField.set(null); this.page.set(0); this.setSelected(sel);
    this.ensureActiveCellValid();
    this.removeFilterScrollListener();
    this.announceService.announce(this.colLabel(field) + ' filter applied. ' + this.baseRows().length + ' rows shown.');
    this.restoreFocus();
  }

  clearFilter(): void {
    const field = this.filterField()!;
    const f = { ...this.filters() }; delete f[field];
    this.patchSS({ filters: f }); this.filterField.set(null); this.page.set(0);
    if (this.isServerMode()) this.ds.clearFilter(field);
    this.ensureActiveCellValid();
    this.removeFilterScrollListener();
    this.announceService.announce(this.colLabel(field) + ' filter cleared'); this.restoreFocus();
  }

  closeOverlays(): void {
    const hadMenu = !!this.menuField(), hadFilter = !!this.filterField();
    this.menuField.set(null); this.filterField.set(null); this.pinMenuOpen.set(false);
    if (hadFilter) this.removeFilterScrollListener();
    if (hadMenu) this.removeMenuScrollListener();
    if (hadMenu) this.announceService.announce('Column menu closed');
    if (hadFilter) this.announceService.announce('Filter dialog closed');
    if (hadMenu || hadFilter) this.restoreFocus();
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  /** The roving-tabindex invariant: exactly one grid cell has tabindex=0,
   *  the one named by activeRowKey/activeColKey. Changing the page, the page
   *  size, a filter, or the visible column set can destroy that cell - and
   *  then NOTHING in the grid is tabbable, so Tab skips the whole grid and a
   *  keyboard user cannot get back in (this is exactly what happened on
   *  page 2+: the active row was still a page-1 row id). Every operation
   *  that can remove rows or columns from the DOM must call this. The delete
   *  flows manage their own next-focus and do not need it. */
  private ensureActiveCellValid(): void {
    const rk = this.activeRowKey();
    // Tested against the loaded set, not the rendered window: a row that is
    // merely scrolled out is still a valid active cell, and resetting on that
    // would throw the user back to the header on every scroll.
    if (rk !== 'header' && !this.sliceInfo().slice.some(r => r.id === rk)) {
      this.activeRowKey.set('header');
    }
    const cols = this.navCols();
    if (!cols.includes(this.activeColKey())) {
      // NOT a hardcoded 'lead' any more: lead is the Select column, and that can
      // be switched off from Choose columns. Falling back to it left the grid
      // with no tabbable cell at all - the exact state this guard exists to
      // prevent. The nearest surviving column also keeps the user roughly where
      // they were rather than throwing them to column one.
      this.activeColKey.set(this.nearestVisibleCol(this.activeColKey()) ?? cols[0] ?? 'lead');
    }
  }

  /** The visible column closest to one that has just gone: to the right first,
   *  then to the left. Searched in chooserOrder(), which still lists hidden
   *  columns, so the vanished column's place is still known. */
  private nearestVisibleCol(gone: string): string | null {
    const all = this.chooserOrder(), vis = new Set(this.navCols());
    const i = all.indexOf(gone);
    if (i < 0) return null;
    for (let j = i + 1; j < all.length; j++) if (vis.has(all[j])) return all[j];
    for (let j = i - 1; j >= 0; j--) if (vis.has(all[j])) return all[j];
    return null;
  }

  /**
   * Puts DOM focus back in the grid after a dialog that may have deleted the
   * element the user came from.
   *
   * restoreFocus() alone is not enough: it only restores when the saved element
   * is still in the document, and hiding its column removes it - so focus was
   * left on <body> and a keyboard user had to tab in from the top of the page.
   * ensureActiveCellValid() had already fixed the roving tabindex, so the cell
   * to land on is known; nothing was moving focus to it.
   */
  private restoreFocusToGrid(): void {
    if (this._lastFocused && document.contains(this._lastFocused)) { this.restoreFocus(); return; }
    this._lastFocused = null;
    // Every column hidden: the grid is display:none behind the empty state, so
    // neither a cell nor the grid root can take focus. The empty state's own
    // button is the only way back, and the only thing left to land on.
    if (this.noColumnsVisible()) { this.focusAfterRender('csc-empty-chooser-btn'); return; }
    const rk = this.activeRowKey(), ck = this.activeColKey();
    const cellId = rk === 'header' ? 'gc-header-' + ck : 'gc-' + rk + '-' + ck;
    this.focusAfterRender(document.getElementById(cellId) ? cellId : 'csc-grid-root');
  }

  setPage(p: number): void {
    const { pageCount, page: cur } = this.sliceInfo();
    const next = Math.max(0, Math.min(p, pageCount - 1));
    if (next === cur) return; // at a boundary - nothing to announce
    if (this.isServerMode()) {
      this.ds.page.set(next);
      void this.ds.load(false);
    } else {
      this.page.set(next);
    }
    this.ensureActiveCellValid();
    this.announceService.announce('Showing page ' + (next + 1) + ' of ' + pageCount + '. ' + this.rangeText());
  }
  // ── Items-per-page combobox ──
  togglePageSizeMenu(): void {
    const open = !this.pageSizeOpen();
    this.pageSizeOpen.set(open);
    if (open) {
      this.pageSizeFocusIdx.set(Math.max(0, this.pageSizeOpts().indexOf(this.currentPageSize())));
      this.focusAfterRender('page-size-opt-' + this.pageSizeFocusIdx());
    }
  }
  closePageSizeMenu(refocus = true): void {
    if (!this.pageSizeOpen()) return;
    this.pageSizeOpen.set(false);
    if (refocus) this.focusAfterRender('page-size-btn');
  }
  choosePageSize(size: number): void {
    if (this.isServerMode()) {
      this.ds.pageSize.set(size);
      this.ds.reload();
    } else {
      this.pageSize.set(size);
    }
    this.page.set(0);
    this.ensureActiveCellValid();
    this.closePageSizeMenu();
    this.announceService.announce(size + ' items per page. ' + this.rangeText());
  }
  /** Arrow / Home / End / Escape handling inside the size listbox. */
  onPageSizeKeyDown(e: KeyboardEvent): void {
    const opts = this.pageSizeOpts(), i = this.pageSizeFocusIdx();
    const go = (n: number) => {
      const idx = Math.max(0, Math.min(n, opts.length - 1));
      this.pageSizeFocusIdx.set(idx);
      document.getElementById('page-size-opt-' + idx)?.focus();
    };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(i + 1); break;
      case 'ArrowUp':   e.preventDefault(); go(i - 1); break;
      case 'Home':      e.preventDefault(); go(0); break;
      case 'End':       e.preventDefault(); go(opts.length - 1); break;
      case 'Escape':    e.preventDefault(); e.stopPropagation(); this.closePageSizeMenu(); break;
      case 'Tab':       this.closePageSizeMenu(false); break;
    }
  }
  /** Opening keys while focus is on the combobox button itself. */
  onPageSizeBtnKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!this.pageSizeOpen()) this.togglePageSizeMenu();
    }
  }

  gotoGo(): void {
    const n = parseInt(this.gotoVal(), 10);
    const { pageCount, page: cur } = this.sliceInfo();
    if (!n) { this.announceService.announce('Enter a page number between 1 and ' + pageCount); return; }
    const target = Math.min(Math.max(n - 1, 0), pageCount - 1);
    this.gotoVal.set('');
    // setPage owns the local-vs-server split; writing this.page here skipped
    // the server fetch entirely, so All Features never moved.
    if (target !== cur) { this.setPage(target); return; }
    // Without this the jump silently no-ops and a screen reader user gets no
    // confirmation of where they landed.
    this.announceService.announce('Already on page ' + (target + 1) + ' of ' + pageCount + '. ' + this.rangeText());
  }

  // ── Editing ───────────────────────────────────────────────────────────────
  // Multi-row capable: any number of rows can be in edit mode at once, each
  // with its own independent draft. Starting Row B's edit no longer force-
  // closes Row A - that was the old single-id limitation.
  /** Key for per-cell edit state and drafts. */
  private ck(rowId: string, field: string): string { return rowId + '::' + field; }

  /** Enter on an editable cell: focus moves INTO the input. Arrow keys then
   *  belong to the text caret, which is why cell-to-cell movement is only
   *  available in navigation mode. */
  startCellEdit(rowId: string, field: string): void {
    if (!this.isFieldEditable(field)) return;
    const r = this.rowById(rowId); if (!r) return;
    const k = this.ck(rowId, field);
    // Clicking straight from one cell into another must not leave the first
    // one dangling: commit whatever was open before opening this one.
    const open = this.editingCell();
    if (open && open !== k) { const [pr, pf] = open.split('::'); this.commitCell(pr, pf, false); }
    if (this._original[k] === undefined) this._original[k] = String((r as any)[field] ?? '');
    this.editingCell.set(k);
    this.draft.set(String((r as any)[field] ?? ''));
    const combo = this.comboFields().has(field);
    this.announceService.announce(combo
      ? 'Editing ' + this.colLabel(field) + '. Type to filter, arrow keys to choose, Enter to save, Escape to cancel.'
      : 'Editing ' + this.colLabel(field) + '. Press Enter to save, Escape to cancel.');
    setTimeout(() => {
      const cell = document.getElementById('gc-' + rowId + '-' + field);
      const input = cell?.querySelector<HTMLInputElement>('input.csc-edit-input');
      input?.focus(); input?.select();
      if (combo) this.openCombo(rowId, field);
    });
  }

  editCellField(rowId: string, field: string, val: string): void {
    if (this.editingCell() === this.ck(rowId, field)) this.draft.set(val);
  }

  // ── ComboBox editor (autocomplete, restricted to the option list) ─────────
  /** 'rowId::field' of the cell whose option list is open, or null. */
  comboCell = signal<string | null>(null);
  /** What the user has typed since the list opened. '' means "show everything". */
  private comboQuery = signal('');
  /** Index into comboMatches(); -1 when nothing is highlighted. */
  comboActive = signal(-1);
  /** Options for the open cell, resolved once so cascading isn't re-derived
   *  from 10k rows on every keystroke. */
  private comboAll = signal<string[]>([]);
  /** False until the user actually navigates or types, so simply opening and
   *  clicking away can never rewrite the cell. */
  private comboTouched = signal(false);
  comboX = signal(0); comboY = signal(0); comboW = signal(0);
  private _comboScrollHandler: (() => void) | null = null;
  readonly comboListId = 'combo-listbox';

  comboField = computed(() => this.comboCell()?.split('::')[1] ?? null);

  comboMatches = computed((): { value: string; id: string; active: boolean }[] => {
    const all = this.comboAll();
    const q = this.comboQuery().trim().toLowerCase();
    const hit = q ? all.filter(o => o.toLowerCase().includes(q)) : all;
    // Prefix matches first: typing "ar" should surface "Arizona" over "Ontario".
    const ranked = q
      ? [...hit].sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)))
      : hit;
    const act = this.comboActive();
    return ranked.map((value, i) => ({ value, id: 'combo-opt-' + i, active: i === act }));
  });

  comboActiveId = computed(() => {
    const i = this.comboActive();
    return i >= 0 && i < this.comboMatches().length ? 'combo-opt-' + i : null;
  });

  isComboOpen(rowId: string, field: string): boolean { return this.comboCell() === this.ck(rowId, field); }

  private openCombo(rowId: string, field: string): void {
    if (!document.getElementById('gc-' + rowId + '-' + field)) return;
    const opts = this.comboOptionsFor(field, this.rowById(rowId));
    this.comboAll.set(opts);
    this.comboCell.set(this.ck(rowId, field));
    this.comboQuery.set('');
    this.comboTouched.set(false);
    this.comboActive.set(Math.max(0, opts.indexOf(this.draft())));
    this.positionCombo(rowId, field);
    this.attachComboScrollListener(rowId, field);
    this.scrollComboOptionIntoView();
  }

  closeCombo(): void {
    if (!this.comboCell()) return;
    this.comboCell.set(null); this.comboActive.set(-1); this.comboQuery.set('');
    this.comboAll.set([]); this.comboTouched.set(false);
    this.removeComboScrollListener();
  }

  /** Chevron affordance: opens the editor with its list already down. */
  openComboCell(rowId: string, field: string): void {
    if (this.editingCell() !== this.ck(rowId, field)) { this.startCellEdit(rowId, field); return; }
    if (this.comboCell()) this.closeCombo(); else this.openCombo(rowId, field);
  }

  onComboInput(rowId: string, field: string, val: string): void {
    if (!this.comboCell()) this.openCombo(rowId, field);
    this.editCellField(rowId, field, val);
    this.comboQuery.set(val);
    this.comboTouched.set(true);
    const n = this.comboMatches().length;
    this.comboActive.set(n ? 0 : -1);
    this.announceService.announce(n ? n + (n === 1 ? ' option' : ' options') : 'No matching options');
  }

  /**
   * Arrows only ever move the highlight — nothing is written until Enter, Tab
   * or a click. Outside edit mode the same keys stay bound to grid navigation.
   */
  onComboKeyDown(e: KeyboardEvent, rowId: string, field: string): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.comboCell()) { this.openCombo(rowId, field); return; }
      const n = this.comboMatches().length; if (!n) return;
      const cur = this.comboActive();
      const next = e.key === 'ArrowDown' ? (cur + 1 >= n ? 0 : cur + 1) : (cur <= 0 ? n - 1 : cur - 1);
      this.comboActive.set(next);
      this.comboTouched.set(true);
      this.scrollComboOptionIntoView();
      this.announceService.announce(this.comboMatches()[next].value + ', ' + (next + 1) + ' of ' + n);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      const n = this.comboMatches().length;
      if (!this.comboCell() || !n) return;
      e.preventDefault();
      this.comboActive.set(e.key === 'Home' ? 0 : n - 1);
      this.comboTouched.set(true);
      this.scrollComboOptionIntoView();
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); this.commitCombo(rowId, field); return; }
    // Escape is handled by the document-level handler, which cancels the edit.
    // Tab deliberately keeps its grid-wide meaning: commit, then leave the grid.
    if (e.key === 'Tab') { this.commitCombo(rowId, field, false); return; }
  }

  pickComboOption(value: string): void {
    const key = this.comboCell(); if (!key) return;
    const [rowId, field] = key.split('::');
    this.closeCombo();
    this.draft.set(value);
    this.commitCell(rowId, field);
  }

  onComboBlur(rowId: string, field: string): void {
    // Option clicks prevent mousedown, so a real blur means the user left.
    if (this.editingCell() !== this.ck(rowId, field)) return;
    this.commitCombo(rowId, field, false);
  }

  /** Restricted to the list: an entry that matches nothing is discarded. */
  private commitCombo(rowId: string, field: string, announce = true): void {
    const matches = this.comboMatches(), i = this.comboActive();
    const typed = this.draft().trim().toLowerCase();
    const chosen = this.comboTouched() && i >= 0 && i < matches.length
      ? matches[i].value
      : this.comboAll().find(o => o.toLowerCase() === typed);
    this.closeCombo();
    if (chosen === undefined) {
      this.announceService.announce('No matching option. ' + this.colLabel(field) + ' left unchanged.');
      this.exitCellEdit(rowId, field);
      return;
    }
    this.draft.set(chosen);
    this.commitCell(rowId, field, announce);
  }

  private scrollComboOptionIntoView(): void {
    setTimeout(() => {
      const i = this.comboActive(); if (i < 0) return;
      document.getElementById('combo-opt-' + i)?.scrollIntoView({ block: 'nearest' });
    });
  }

  private positionCombo(rowId: string, field: string): void {
    const cell = document.getElementById('gc-' + rowId + '-' + field);
    if (!cell) { this.closeCombo(); return; }
    // Matched to the column so the list never spills over its neighbours.
    const r = cell.getBoundingClientRect(), w = r.width, h = 220;
    this.comboW.set(w);
    this.comboX.set(Math.max(4, Math.min(r.left, window.innerWidth - w - 8)));
    // Flip above the cell when the list would run off the bottom.
    this.comboY.set(r.bottom + h > window.innerHeight ? Math.max(4, r.top - h) : r.bottom);
  }

  private attachComboScrollListener(rowId: string, field: string): void {
    this.removeComboScrollListener();
    const reposition = (): void => { this.positionCombo(rowId, field); this.cdr.markForCheck(); };
    this._comboScrollHandler = reposition;
    document.querySelector('.csc-grid-scroll')?.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
  }

  private removeComboScrollListener(): void {
    if (!this._comboScrollHandler) return;
    document.querySelector('.csc-grid-scroll')?.removeEventListener('scroll', this._comboScrollHandler);
    window.removeEventListener('scroll', this._comboScrollHandler, true);
    this._comboScrollHandler = null;
  }

  /** Commit one cell, return to navigation mode with focus on that same cell. */
  commitCell(rowId: string, field: string, announce = true): void {
    const k = this.ck(rowId, field);
    // Explicit guard, not an accident of draft bookkeeping: blur fires again
    // after Enter/Tab/Escape have already closed the editor, and must be a no-op.
    if (this.editingCell() !== k) return;
    const draft = this.draft();
    if (this.isServerMode()) {
      // Write through to the loaded window so the edit survives re-render.
      this.ds.patchRow(rowId, field, draft);
      const changed = draft !== (this._original[k] ?? '');
      this.updateDirty(m => {
        const n = { ...m };
        if (changed) n[k] = true; else delete n[k];
        return n;
      });
      if (announce) this.announceService.announce(this.colLabel(field) + ' saved');
      this.exitCellEdit(rowId, field);
      return;
    }
    {
      this.setRows(this.rows().map(r => r.id === rowId ? { ...r, [field]: draft } as CscRow : r));
      // Marker clears when the value is put back to what it originally was -
      // nothing actually changed, so flagging it would be misleading.
      const changed = draft !== (this._original[k] ?? '');
      this.updateDirty(m => {
        const n = { ...m };
        if (changed) n[k] = true; else delete n[k];
        return n;
      });
      if (announce) this.announceService.announce(this.colLabel(field) + ' saved');
    }
    this.exitCellEdit(rowId, field);
  }

  cancelCellEdit(rowId: string, field: string): void {
    this.announceService.announce('Edit cancelled');
    this.exitCellEdit(rowId, field);
  }

  private exitCellEdit(rowId: string, field: string): void {
    const k = this.ck(rowId, field);
    this.closeCombo();
    if (this.editingCell() === k) { this.editingCell.set(null); this.draft.set(''); }
    this.activeRowKey.set(rowId); this.activeColKey.set(field);
    this.focusAfterRender('gc-' + rowId + '-' + field);
  }

  /**
   * Enter  -> commit, back to navigation mode on the same cell
   * Escape -> discard, same
   * Tab    -> commit, then let the browser move focus out of the grid
   *           (the input is tabindex=-1, so the next stop is outside).
   *           Committing rather than discarding: the user typed it on purpose.
   */
  onCellEditKeyDown(e: KeyboardEvent, rowId: string, field: string): void {
    if (e.key === 'Enter')       { e.preventDefault(); this.commitCell(rowId, field); return; }
    if (e.key === 'Escape')      { e.preventDefault(); e.stopPropagation(); this.cancelCellEdit(rowId, field); return; }
    if (e.key === 'Tab')         { this.commitCell(rowId, field, false); return; } // no preventDefault
  }
  // ── Expand ────────────────────────────────────────────────────────────────
  toggleExpand(id: string): void {
    const e = { ...this.expanded() }, will = !e[id];
    if (e[id]) delete e[id]; else e[id] = true;
    this.expanded.set(e);
    const row = this.rowById(id);
    // No fetch here on purpose: loadVisibleChildren owns that, keyed off the row
    // being rendered. Kicking one off here too would race it into a double fetch,
    // since loadChildren only short-circuits once a result is already in.
    if (will && this.virtualOn()) setTimeout(() => this.measurePanel(id));
    this.announceService.announce((will ? 'Expanded details for ' : 'Collapsed details for ') + (row?.entity ?? id));
  }

  /** True when every row is currently expanded (drives the header expand-all chevron). */
  /** Mirrors selTotal / selCount / allSelected, and for the same reason: in
   *  server mode baseRows() is only the LOADED page, so counting against it
   *  made "all expanded" mean "this page is expanded". The denominator comes
   *  from the server and the numerator from the expanded map instead. */
  expandTotal = computed(() => this.isServerMode() ? this.ds.total() : this.baseRows().length);
  expandCount = computed(() => {
    const e = this.expanded();
    if (this.isServerMode()) return Object.keys(e).filter(k => e[k]).length;
    return this.baseRows().filter(r => e[r.id]).length;
  });
  allExpanded = computed(() => { const t = this.expandTotal(); return t > 0 && this.expandCount() >= t; });

  /**
   * Header expand-all toggle — mirrors selectAll(): all expanded → collapse all,
   * else expand all. One control, whose meaning follows allExpanded().
   *
   * Scope is the whole filtered set, matching allExpanded() above. Expanding a
   * row is a STATE change (expanded[id] = true) and nothing more - no child
   * records are fetched here. They load when an expanded row is actually
   * rendered, see the effect in the constructor, so marking 10,000 rows open
   * costs one map rather than 10,000 requests.
   */
  toggleExpandAll(): void {
    if (this.expandingAll()) return;
    if (this.allExpanded()) {
      this.expanded.set({});
      this.announceService.announce('All rows collapsed');
      return;
    }
    if (this.isServerMode()) { void this.expandAllMatching(); return; }
    const e: Record<string, boolean> = {};
    this.baseRows().forEach(r => { e[r.id] = true; });
    this.expanded.set(e);
    this.announceService.announce('All rows expanded');
  }

  /** Server mode never holds more than one page, so "all" cannot be enumerated
   *  from what is loaded - marking only the loaded ids left every other page
   *  collapsed and flipped the toggle back to "Expand all" on the next page.
   *  The adapter is asked for the matching ids instead, exactly as
   *  selectAllMatching() does, and capped the same way. Only ids come back;
   *  the child records still load per row, on render. */
  private async expandAllMatching(): Promise<void> {
    this.expandingAll.set(true);
    this.announceService.announce('Expanding all matching rows');
    try {
      const ids = await this.ds.matchingIds(this.bulkCap);
      const e: Record<string, boolean> = {};
      ids.forEach(id => { e[id] = true; });
      this.expanded.set(e);
      const total = this.ds.total();
      const capped = ids.length < total
        ? `. Expansion is capped at ${this.bulkCap.toLocaleString()} rows, so ${(total - ids.length).toLocaleString()} matching rows are not expanded`
        : '';
      this.announceService.announce(`${ids.length.toLocaleString()} rows expanded${capped}`);
      if (capped) this.showToast(`Expanded the first ${ids.length.toLocaleString()} of ${total.toLocaleString()} rows`);
    } catch {
      this.showToast('Could not expand all rows');
      this.announceService.announce('Expand all failed. Please try again.');
    } finally {
      this.expandingAll.set(false);
      this.cdr.markForCheck();
    }
  }

  // ── Grid keyboard navigation ──────────────────────────────────────────────
  onGridKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const cols = this.navCols(), rowIds = this._navRowIds;
    let ri = rowIds.indexOf(this.activeRowKey()); if (ri < 0) ri = 0;
    let ci = cols.indexOf(this.activeColKey()); if (ci < 0) ci = 0;
    const ctrl = e.ctrlKey || e.metaKey;

    // Resize mode intercepts arrow keys on header
    if (this.resizeModeField() && rowIds[ri] === 'header') {
      this.onResizeModeKeyDown(cols[ci], e);
      return;
    }

    // Shift+R → enter resize mode (header cell, non-lead column)
    if (e.shiftKey && (e.key === 'R' || e.key === 'r') && rowIds[ri] === 'header' && cols[ci] !== 'lead' && this.canResize()) {
      e.preventDefault(); this.enterResizeMode(cols[ci]); return;
    }

    // Shift+M → open column menu (header cell, non-lead column, not in Basic)
    if (e.shiftKey && (e.key === 'M' || e.key === 'm') && rowIds[ri] === 'header' && cols[ci] !== 'lead' && this.canMenu()) {
      e.preventDefault();
      const headerEl = document.getElementById('gc-header-' + cols[ci]);
      const menuBtn = headerEl?.querySelector<HTMLElement>('.csc-menu-btn');
      if (menuBtn) this.openMenu(cols[ci], menuBtn);
      return;
    }

    // Ctrl+Enter → open filter (header cell)
    if (ctrl && e.key === 'Enter' && rowIds[ri] === 'header' && cols[ci] !== 'lead') {
      e.preventDefault();
      const el = document.getElementById('gc-header-' + cols[ci]);
      this.openFilter(cols[ci], el ?? undefined); return;
    }

    const moveTo = (r: number, c: number): void => {
      r = Math.max(0, Math.min(rowIds.length - 1, r));
      c = Math.max(0, Math.min(cols.length - 1, c));
      this.activeRowKey.set(rowIds[r]); this.activeColKey.set(cols[c]);
      this.revealRow(rowIds[r]);
      this.focusAfterRender('gc-' + rowIds[r] + '-' + cols[c]);
    };

    const canMoveCol = (r: number, c: number) => this.canReorder() && rowIds[r] === 'header' && cols[c] !== 'lead';

    if (e.key === 'ArrowRight') { e.preventDefault(); if (ctrl && canMoveCol(ri, ci)) { this.moveColumn(cols[ci], 1); this.focusAfterRender('gc-header-' + cols[ci]); } else moveTo(ri, ci+1); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); if (ctrl && canMoveCol(ri, ci)) { this.moveColumn(cols[ci], -1); this.focusAfterRender('gc-header-' + cols[ci]); } else moveTo(ri, ci-1); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveTo(ri+1, ci); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveTo(ri-1, ci); return; }
    if (e.key === 'PageDown')   { e.preventDefault(); moveTo(ri + 10, ci); return; }
    if (e.key === 'PageUp')     { e.preventDefault(); moveTo(ri - 10, ci); return; }
    if (e.key === 'Home') { e.preventDefault(); ctrl ? moveTo(0, 0) : moveTo(ri, 0); return; }
    if (e.key === 'End')  { e.preventDefault(); ctrl ? moveTo(rowIds.length-1, cols.length-1) : moveTo(ri, cols.length-1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Shift+Enter mirrors Shift+click: add to the sort rather than replace it.
      if (e.shiftKey && rowIds[ri] === 'header' && cols[ci] !== 'lead'
          && cols[ci] !== 'expand-col' && cols[ci] !== 'delete-col') {
        this.sortBy(cols[ci], true); return;
      }
      this.activateCell(rowIds[ri], cols[ci]); return;
    }
    // Space selects from ANY cell, so it has to follow the Select feature -
    // otherwise switching the column off would leave a keyboard route into a
    // selection the user can no longer see or clear.
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!this.hasSelectFeature()) return;
      const rk = rowIds[ri];
      if (rk === 'header') this.selectAll(); else this.toggleSelect(rk);
      return;
    }
  }

  activateCell(rowKey: string, colKey: string): void {
    if (rowKey === 'header') {
      if (colKey === 'lead') { this.selectAll(); return; }
      if (colKey === 'expand-col') { this.toggleExpandAll(); return; }
      if (colKey === 'delete-col') { this.openBulkDeleteConfirm(); return; }
      this.sortBy(colKey); return;
    }
    const row = this.rows().find(r => r.id === rowKey); if (!row) return;
    if (colKey === 'lead') {
      this.toggleSelect(rowKey); // model B: the lead cell only selects
      return;
    }
    if (colKey === 'expand-col') { this.toggleExpand(rowKey); return; }
    if (colKey === 'doc') { this.showToast('Opening document ' + row.doc); return; }
    if (colKey === 'delete-col') { this.openDeleteConfirm(rowKey); return; }
    if (this.canEdit() && this.isFieldEditable(colKey)) { this.startCellEdit(rowKey, colKey); return; }
  }

  onLeadHeaderFocus(): void { if (this.activeRowKey() !== 'header' || this.activeColKey() !== 'lead') { this.activeRowKey.set('header'); this.activeColKey.set('lead'); } }
  onCellFocus(rowId: string, colId: string): void { if (this.activeRowKey() !== rowId || this.activeColKey() !== colId) { this.activeRowKey.set(rowId); this.activeColKey.set(colId); } }

  // ── CRUD: Add ─────────────────────────────────────────────────────────────
  openAddModal(): void {
    this.saveFocus(); this.menuField.set(null); this.filterField.set(null);
    this.addDraft.set({ entity:'', address:'', city:'', state:'', zip:'', country:'United States (USA)', date:'' });
    this.addError.set(null); this.addOpen.set(true);
    this.announceService.announce('Add record dialog opened'); this.focusAfterRender('add-field-entity');
  }
  closeAddModal(): void {
    this.addOpen.set(false); this.addDraft.set(null); this.addError.set(null);
    this.announceService.announce('Add record dialog closed'); this.restoreFocus();
  }
  addDraftField(field: string, val: string): void {
    if (this.addError()?.field === field) this.addError.set(null);
    this.addDraft.set({ ...(this.addDraft() ?? {}), [field]: val });
  }
  saveAdd(): void {
    const d = this.addDraft() as any;
    if (!d?.entity?.trim()) {
      this.addError.set({ field:'entity', message:'Entity name is required.' });
      this.announceService.announce('Entity name is required'); this.focusAfterRender('add-field-entity'); return;
    }
    const seq = this.nextSeq(), id = 'D' + (900000 + seq);
    const row: CscRow = { id, doc:String(900000+seq), entity:d.entity, address:d.address||'', city:d.city||'', state:d.state||'', zip:d.zip||'', country:d.country||'United States (USA)', date:d.date||'', agent:'CSC - Lawyers Incorporating', jurisdiction:'Delaware', status:'Pending', statusColor:'#c79a14', updated:d.date||'' };
    if (this.isServerMode()) {
      this.ds.prependRow({ ...row, priority: 'Medium', owner: 'Unassigned', ownerEmail: '', revenue: 0, childCount: 0 });
    } else {
      this.setRows([row, ...this.rows()]);
    }
    this.nextSeq.set(seq+1); this.page.set(0);
    this.addOpen.set(false); this.addDraft.set(null); this.addError.set(null);
    this.activeRowKey.set(id); this.activeColKey.set('lead');
    this.showToast('Record added: ' + row.entity); this._lastFocused = null; this.focusAfterRender('gc-' + id + '-lead');
  }
  onAddFieldKeyDown(e: KeyboardEvent): void { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') { e.preventDefault(); this.saveAdd(); } }

  // ── CRUD: Delete ──────────────────────────────────────────────────────────
  openDeleteConfirm(id: string, e?: Event): void {
    e?.stopPropagation(); this.saveFocus(); this.menuField.set(null); this.filterField.set(null);
    this.deleteId.set(id); this.announceService.announce('Delete confirmation dialog opened'); this.focusAfterRender('delete-cancel-btn');
  }
  closeDeleteConfirm(): void {
    this.deleteId.set(null); this.bulkDeleteOpen.set(false);
    this.announceService.announce('Delete confirmation dialog closed'); this.restoreFocus();
  }

  /** Header "delete selected" — opens the SAME confirm dialog in bulk mode.
   *  Acts on the current selection, so "Select All" + this = delete everything. */
  openBulkDeleteConfirm(e?: Event): void {
    e?.stopPropagation();
    // No "select rows first" guard any more: with nothing selected this button
    // is Delete all, which needs no selection.
    this.saveFocus(); this.menuField.set(null); this.filterField.set(null);
    this.bulkDeleteOpen.set(true);
    this.announceService.announce(this.deleteAllMode()
      ? 'Delete confirmation dialog opened for all ' + this.deleteAllCount().toLocaleString() + ' records'
      : 'Delete confirmation dialog opened for ' + this.selCount() + ' selected records');
    this.focusAfterRender('delete-cancel-btn');
  }

  /** The ids Delete all removes: exactly the set Select All would have covered -
   *  the whole filtered set across EVERY page, not the page on screen. Server
   *  mode holds one page at a time, so the adapter has to be asked, and the
   *  answer is capped the same way selection is. */
  private async deleteAllTargetIds(): Promise<string[]> {
    if (this.isServerMode()) return this.ds.matchingIds(this.bulkCap);
    return this.baseRows().map(r => r.id);
  }

  async confirmDeleteAll(): Promise<void> {
    let ids: string[];
    try {
      ids = await this.deleteAllTargetIds();
    } catch {
      this.bulkDeleteOpen.set(false);
      this.showToast('Could not delete all records');
      this.announceService.announce('Delete all failed. Please try again.');
      return;
    }
    const n = ids.length;
    if (this.isServerMode()) this.ds.removeRows(ids);
    else this.setRows(this.rows().filter(r => !ids.includes(r.id)));
    this.dropFromSelections(ids);
    this.bulkDeleteOpen.set(false);
    if (ids.some(id => this.editingCell()?.startsWith(id + '::'))) { this.editingCell.set(null); this.draft.set(''); }
    this.expanded.set({});
    this.activeRowKey.set('header');
    this.activeColKey.set(this.visibleFields()[0] ?? 'lead');
    this.page.set(0);
    this.showToast(n.toLocaleString() + ' record' + (n === 1 ? '' : 's') + ' deleted');
    this.announceService.announce(n.toLocaleString() + ' record' + (n === 1 ? '' : 's') + ' deleted');
    this.focusAfterRender('gc-header-' + (this.visibleFields()[0] ?? 'lead'));
    this.cdr.markForCheck();
  }

  confirmBulkDelete(): void {
    if (this.deleteAllMode()) { void this.confirmDeleteAll(); return; }
    const selIds = Object.keys(this.selected()).filter(id => this.selected()[id]);
    const n = selIds.length;
    if (this.isServerMode()) this.ds.removeRows(selIds);
    else this.setRows(this.rows().filter(r => !selIds.includes(r.id)));
    this.dropFromSelections(selIds);
    this.bulkDeleteOpen.set(false);
    // Clear only the DELETED rows' edit state - other rows mid-edit are untouched.
    if (selIds.some(id => this.editingCell()?.startsWith(id + '::'))) { this.editingCell.set(null); this.draft.set(''); }
    // The lead column can be switched off now, so park on whatever column is
    // actually first rather than on an element that may not exist.
    const landing = this.visibleFields()[0] ?? 'lead';
    this.activeRowKey.set('header'); this.activeColKey.set(landing);
    this.page.set(0);
    this.showToast(n + ' record' + (n === 1 ? '' : 's') + ' deleted');
    this.announceService.announce(n + ' record' + (n === 1 ? '' : 's') + ' deleted');
    this.focusAfterRender('gc-header-' + landing);
  }
  confirmDelete(): void {
    const id = this.deleteId()!;
    const row = this.rowById(id);
    const visIds = this._navRowIds, pos = visIds.indexOf(id);
    let nextFocus = 'header';
    if (visIds.length > 1) { if (pos >= 0 && pos+1 < visIds.length) nextFocus = visIds[pos+1]; else if (pos > 1) nextFocus = visIds[pos-1]; }
    const stillEditing = !!this.editingCell()?.startsWith(id + '::');
    if (this.isServerMode()) this.ds.removeRows([id]);
    else this.setRows(this.rows().filter(r => r.id !== id));
    this.dropFromSelections([id]); this.deleteId.set(null);
    if (stillEditing) {
      this.editingCell.set(null); this.draft.set('');
    }
    const landing = this.visibleFields()[0] ?? 'lead';
    this.activeRowKey.set(nextFocus); this.activeColKey.set(landing);
    this.showToast('Record deleted' + (row ? ': ' + row.entity : ''));
    this._lastFocused = null;
    this.focusAfterRender(nextFocus === 'header' ? 'gc-header-' + landing : 'gc-' + nextFocus + '-' + landing);
  }

  deleteSelectedRows(): void {
    const selIds = Object.keys(this.selected()).filter(id => this.selected()[id]);
    if (!selIds.length) return;
    if (this.isServerMode()) this.ds.removeRows(selIds);
    else this.setRows(this.rows().filter(r => !selIds.includes(r.id)));
    this.dropFromSelections(selIds);
    this.showToast(selIds.length + ' records deleted');
  }

  // ── All Features: server-backed data bar ────────────────────────────────
  searchTerm = signal('');
  exporting = signal(false);
  private _searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounced so typing does not fire one request per keystroke, but the
   *  input stays fully controlled and the announcement waits for results. */
  onSearchInput(value: string): void {
    this.searchTerm.set(value);
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.ds.search.set(value);
      this.ds.reload();
      this.setSelected({});
      this.ensureActiveCellValid();
    }, 250);
  }

  clearSearch(): void {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.searchTerm.set('');
    this.ds.search.set('');
    this.ds.reload();
    this.announceService.announce('Search cleared');
    this.focusAfterRender('all-search-input');
  }

  /** Active server filters as removable chips, so the user can see and undo
   *  what is narrowing the result set without reopening each column menu. */
  filterChips = computed(() =>
    this.ds.filters().map(f => ({
      field: f.field,
      label: this.colLabel(f.field),
      text: f.values.length > 2 ? `${f.values.length} selected` : f.values.join(', '),
    })));

  removeChip(field: string): void {
    const f = { ...this.filters() }; delete f[field];
    this.patchSS({ filters: f });
    this.ds.clearFilter(field);
    this.announceService.announce(this.colLabel(field) + ' filter removed');
  }

  clearAllServerFilters(): void {
    this.patchSS({ filters: {} });
    this.searchTerm.set('');
    this.ds.clearAllFilters();
    this.announceService.announce('All filters cleared');
  }

  setPagingMode(m: PagingMode): void {
    this.ds.setMode(m);
    this.activeRowKey.set('header');
    this.announceService.announce(m === 'infinite'
      ? 'Infinite scrolling enabled. Rows load as you scroll, or use the Load more button.'
      : 'Pagination enabled.');
  }

  setDataSource(id: string): void {
    this.ds.setAdapter(id);
    this.setSelected({});
    this.expanded.set({});
    this.activeRowKey.set('header');
    this.announceService.announce('Data source changed. Loading.');
  }

  refreshData(): void {
    this.ds.reload();
    this.announceService.announce('Refreshing data');
  }

  simulateError(): void { this.ds.simulateFailure(); }

  retryLoad(): void {
    this.ds.reload();
    this.announceService.announce('Retrying');
  }

  loadMore(): void {
    if (!this.ds.hasMore()) return;
    this.ds.loadMore();
    this.announceService.announce('Loading more rows');
  }

  /**
   * Infinite scroll trigger. Scrolling is not an operable control, so this only
   * ever supplements the Load more button - it never becomes the sole way to
   * reach the remaining rows (WCAG 2.1.1).
   */
  /** One capture-phase listener on window catches scrolling from whichever
   *  element actually scrolls — .csc-main only becomes a scroller when a host
   *  page constrains its height, otherwise the document scrolls. */
  private _onScroll = (): void => {
    // Capture phase, so this also catches .csc-grid-scroll's own scrolling,
    // which does not bubble.
    this.reflowTip();
    if (this.virtualOn()) { this.measureViewport(); this.cdr.markForCheck(); }
    this.maybeLoadMore();
  };

  /** A resize changes both the viewport bounds the flip is measured against and
   *  the tooltip's own wrapped height. */
  private _onWinResize = (): void => { this.reflowTip(); };

  private maybeLoadMore(): void {
    if (!this.isServerMode() || this.ds.mode() !== 'infinite') return;
    if (this.ds.loading() || this.ds.loadingMore() || !this.ds.hasMore()) return;
    const sc = this.scroller ?? this.resolveScroller();
    if (sc && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 400) this.ds.loadMore();
  }

  private resolveScroller(): HTMLElement {
    const main = this.hostEl.nativeElement.querySelector<HTMLElement>('.csc-main');
    const doc = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    return main && main.scrollHeight > main.clientHeight + 1 ? main : doc;
  }

  /** Reads the geometry the windowing maths depends on. Cheap, but it forces
   *  layout, so only the virtualized section pays for it. */
  private measureViewport(): void {
    const host = this.hostEl.nativeElement;
    const sc = this.resolveScroller();
    this.scroller = sc;
    const inner = host.querySelector<HTMLElement>('.csc-grid-inner');
    const head = host.querySelector<HTMLElement>('.csc-header-row');
    if (!inner || !head) return;
    const hh = head.offsetHeight;
    const isDoc = sc === document.documentElement || sc === document.body;
    this.headerH.set(hh);
    this.viewportTop.set(isDoc ? 0 : sc.getBoundingClientRect().top);
    this.viewportH.set(isDoc ? window.innerHeight : sc.clientHeight);
    this.rowsTop.set(inner.getBoundingClientRect().top + hh);
    const row = host.querySelector<HTMLElement>('.csc-row:not(.csc-skeleton-row)');
    // +1 for the wrapper's bottom border, which is outside the row box.
    if (row?.offsetHeight) this.measuredRowH.set(row.offsetHeight + 1);
  }

  /** Records how tall an open detail panel actually turned out to be, so the
   *  spacers stay honest after that row scrolls out of the window. */
  private measurePanel(id: string): void {
    const el = document.getElementById('detail-' + id)?.parentElement;
    const h = el?.offsetHeight;
    if (!h || this.panelH()[id] === h) return;
    this.panelH.set({ ...this.panelH(), [id]: h });
  }

  /** Scrolls a loaded row back into the rendered window so it can be focused.
   *  Without this, arrowing past the window edge would move the active cell to
   *  a row that no longer exists in the DOM and focus would be lost. */
  private revealRow(rowId: string): void {
    if (!this.virtualOn() || rowId === 'header') return;
    const sc = this.scroller; if (!sc) return;
    const i = this.sliceInfo().slice.findIndex(r => r.id === rowId);
    if (i < 0) return;
    const tops = this.rowTops(), base = this.rowsTop();
    const top = base + tops[i], bottom = base + tops[i + 1];
    const vpTop = this.viewportTop() + this.headerH(), vpBottom = this.viewportTop() + this.viewportH();
    const delta = top < vpTop ? top - vpTop : bottom > vpBottom ? bottom - vpBottom : 0;
    if (!delta) return;
    sc.scrollTop = Math.max(0, sc.scrollTop + delta);
    this.measureViewport();
  }

  /** A wheel scroll can unmount the focused cell, and browsers drop focus to
   *  the body when that happens. Park it on the grid so the user is not thrown
   *  back to the top of the document (WCAG 2.4.3); the next arrow key resumes
   *  from the remembered active cell. */
  private keepFocusInGrid(): void {
    if (!this.virtualOn() || !this._cellFocused) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (this.activeRowRendered()) return;
    this.hostEl.nativeElement.querySelector<HTMLElement>('[role="grid"]')?.focus();
  }

  /** Placeholder rows drawn while the first page is in flight, so the layout
   *  does not jump when real data lands. */
  skeletonRows = computed(() => Array.from({ length: Math.min(this.ds.pageSize(), 12) }, (_, i) => i));

  serverStatusText = computed(() => {
    const d = this.ds;
    if (d.error()) return d.error()!;
    if (d.initialLoading()) return 'Loading records…';
    return `${d.total().toLocaleString()} records · ${d.adapter().label} · ${d.elapsedMs()} ms`;
  });

  // ── CSV export ───────────────────────────────────────────────────
  /**
   * A leading =, +, - or @ makes a spreadsheet treat the cell as a formula, so
   * an exported record can execute when the file is opened. Prefixing with a
   * single quote neutralises it (OWASP CSV injection).
   */
  private csvCell(v: unknown): string {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  async exportCsv(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.announceService.announce('Preparing export');
    try {
      const fields = this.visibleFields();
      const headers = fields.map(f => this.colLabel(f));
      const selIds = Object.keys(this.selected()).filter(k => this.selected()[k]);

      let source: CscRow[];
      let matched = 0;
      if (selIds.length) {
        const set = new Set(selIds);
        // A server-mode selection can span pages the grid never loaded, so the
        // rows have to be re-fetched before they can be written out.
        const pool = this.isServerMode()
          ? await this.ds.exportRows(this.bulkCap) as unknown as CscRow[]
          : this.baseRows();
        source = pool.filter(r => set.has(r.id));
        matched = selIds.length;
      } else if (this.isServerMode()) {
        // Export follows the query, not the loaded window - but is capped so a
        // mis-click cannot try to serialise the entire table into memory.
        source = await this.ds.exportRows(this.bulkCap) as unknown as CscRow[];
        matched = this.ds.total();
      } else {
        source = this.baseRows();
        matched = source.length;
      }

      const lines = [
        headers.map(h => this.csvCell(h)).join(','),
        ...source.map(r => fields.map(f => this.csvCell((r as any)[f])).join(',')),
      ];
      // BOM so Excel reads it as UTF-8 rather than the system code page.
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `csc-grid-${this.section()}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      // A silent truncation is the worst outcome here: the file looks complete.
      const short = matched > source.length ? matched - source.length : 0;
      const n = source.length.toLocaleString();
      this.showToast(short
        ? `Exported ${n} of ${matched.toLocaleString()} records — capped at ${this.bulkCap.toLocaleString()}`
        : `Exported ${n} record${source.length === 1 ? '' : 's'}`);
      this.announceService.announce(short
        ? `Export complete. ${n} of ${matched.toLocaleString()} records downloaded. The export is capped at ${this.bulkCap.toLocaleString()} rows, so ${short.toLocaleString()} records were not included.`
        : `Export complete. ${n} records downloaded.`);
    } catch {
      this.showToast('Export failed');
      this.announceService.announce('Export failed. Please try again.');
    } finally {
      this.exporting.set(false);
    }
  }

  // ── Misc ──────────────────────────────────────────────────────────────────
  copyLink(): void { this.copied.set(true); this.showToast('Link copied'); setTimeout(() => this.copied.set(false), 2500); }
  toggleLegend(): void { this.legendOpen.update(v => !v); }

  trapTabKey(e: KeyboardEvent, containerId: string): void {
    if (e.key !== 'Tab') return;
    const root = document.getElementById(containerId); if (!root) return;
    const list = Array.from(root.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
    if (!list.length) return;
    const first = list[0], last = list[list.length-1], active = document.activeElement;
    if (e.shiftKey) { if (active === first) { e.preventDefault(); last.focus(); } }
    else { if (active === last) { e.preventDefault(); first.focus(); } }
  }

  onToolbarAction(label: string): void {
    if (label === 'Add Row') { this.openAddModal(); return; }
    if (label === 'Columns') { this.openChooser(); return; }
    const suffix = label === 'Acknowledge' ? 'd' : label === 'Upload' ? ' started' : label === 'Download' ? ' started' : label === 'Email' ? ' drafted' : label === 'Track' ? 'ing enabled' : '';
    this.showToast(label + suffix);
  }
}
