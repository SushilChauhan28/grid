export interface CscRow {
  id: string; doc: string; entity: string; address: string;
  city: string; state: string; zip: string; country: string; date: string;
  agent: string; jurisdiction: string; status: string; statusColor: string; updated: string;
}

/** Public column definition for the grid's `columns` input. */
export interface GridColumnDef {
  field: string;
  label: string;
  /** Whether cells in this column can be edited. Defaults to true. */
  editable?: boolean;
  /** Editor used in edit mode. Defaults to a free-text input. */
  editor?: 'text' | 'combo';
  /** Choice list for the combo editor. Omitted means "derive from the data". */
  options?: string[];
  /** Narrows the derived choice list to rows sharing this column's value,
   *  e.g. State cascades from Country. */
  cascadeFrom?: string;
  /** Explicit choices keyed by the `cascadeFrom` value, for pairs the data
   *  itself doesn't correlate. */
  optionsBy?: Record<string, string[]>;
  /** Drives typed comparators. Omitted means string. */
  type?: 'string' | 'number' | 'date' | 'datetime' | 'enum';
}
export type Section = 'basic' | 'advanced' | 'editable' | 'simple' | 'expandable' | 'all';

export interface NavItem { key:string; label:string; on:boolean; bar:string; bg:string; color:string; weight:string; }
export interface ColumnView {
  field:string; label:string; isAsc:boolean; isDesc:boolean; noSort:boolean; ariaSort:string;
  /** Position in a multi-column sort ("1", "2", …), or null when only one column sorts. */
  sortLevel:string|null; sortTitle:string;
  ariaColIndex:string; cellId:string; tabIndex:string;
  headerAriaLabel:string; headerAriaDesc:string;
  sortBg:string; sortBorder:string; filterBg:string; filterBorder:string;
  showMenu:boolean; resizable:boolean;
  draggable:boolean; dragOpacity:number; dropShadow:string;
  isRowHeader:boolean; isResizing:boolean;
  /** Shows the pencil affordance in the header for editable columns. */
  showEditableIcon:boolean;
  // ARIA separator pattern for resize grip
  resizerAriaLabel:string; resizerAriaValueNow:string; resizerAriaMin:string; resizerAriaMax:string;
}
export interface CellView {
  field:string; value:string; isLink:boolean; isEditing:boolean; isText:boolean;
  ariaColIndex:string; cellId:string; tabIndex:string; draft:string; isRowHeader:boolean;
  /** Cell-level editability, derived from the column definition. */
  editable:boolean;
  /** Exposed as aria-readonly on non-editable cells so the state is announced
   *  at the point of use, not only via the column header icon. */
  ariaReadonly:string|null;
  /** True when the column config asks for a dropdown editor instead of a text box. */
  isCombo:boolean;
  /** True when this cell's committed value differs from the original data. */
  dirty:boolean;
  /** State-aware hint: prefixed with "Edited." when the cell has been changed. */
  cellAriaDesc:string|null;
}
export interface RowView {
  id:string; doc:string; entity:string; address:string; city:string; state:string;
  zip:string; country:string; date:string; agent:string; jurisdiction:string;
  status:string; statusColor:string; updated:string; bg:string; selected:boolean;
  boxBorder:string; boxBg:string; showChevron:boolean; chevronDeg:number; isExpanded:boolean;
  showEdit:boolean; showDelete:boolean; editing:boolean; ariaRowIndex:string; rowAriaDesc:string|null;
  leadCellId:string; leadTabIndex:string;
  expandCellId:string; expandTabIndex:string;
  deleteCellId:string; deleteTabIndex:string;
  dragClass:string; canDrag:boolean; cells:CellView[];
}
export interface PageButton { isGap:boolean; notGap:boolean; label:string; ariaLabel:string; bg:string; color:string; weight:string; }
export interface ToolbarAction { label:string; icon:string; }
export interface FilterValue { label:string; checked:boolean; boxBorder:string; boxBg:string; }
export interface ChooserItem {
  /** 1-based position among the VISIBLE columns, matching what the grid shows.
   *  0 for a hidden column, which has no position — see `hasPos`. */
  pos:number; total:number; posLabel:string;
  /** False for hidden columns: they keep their checkbox but show no number,
   *  and are left out of the numbering entirely. */
  hasPos:boolean;
  /** Inclusive bounds of the column's own pin section. The Order field accepts
   *  only this range; anything else would change the pin, not the position. */
  posMin:number; posMax:number;
  /** Draws the thin rule that separates left-pinned / unpinned / right-pinned. */
  sepBefore:boolean;
  labelId:string;
  field:string; label:string; visible:boolean; posFieldId:string; boxBorder:string; boxBg:string;
  draggable:boolean; dragOpacity:number; dropShadow:string; posVal:string;
  /** '' | 'left' | 'right' — the empty string is the <select> value for "not pinned". */
  pin:string; pinId:string; dragId:string; dragLabel:string;
}
export interface AddField {
  field:string; label:string; value:string; fieldId:string; errorId:string;
  invalid:boolean; errorText:string; describedBy:string; borderColor:string;
}
export interface Shortcut { keys:string[]; desc:string; }
