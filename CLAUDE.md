# CSC Grid — working notes

Angular data grid component (WAI-ARIA grid pattern) with five demo sections:
Basic usage, Advanced features, Editable, Simplified editable, Expandable,
All features. One `CscGridComponent` instance renders all of them, switching on
a `section` signal.

Main files:

- `src/app/csc-grid/csc-grid.component.ts` (~3000 lines)
- `src/app/csc-grid/csc-grid.component.html` (~1230 lines)
- `src/app/csc-grid/csc-grid.component.scss`

## How to work on this

**Diagnose before fixing.** Explain what is wrong and why, propose the change,
and wait for approval before editing. This has been the working pattern
throughout and it catches wrong assumptions early.

**Verify with the Angular compiler, not `ng build`.** The CLI refuses to run on
some Node versions in this environment. Use:

```
npx ngc -p tsconfig.app.json --rootDir src --outDir /tmp/ngc-out
```

This runs the full AOT template type-check, which is what catches template
binding errors.

**Comment the reasoning, not the mechanics.** Where a non-obvious ARIA or
focus decision is made, the comment should say what breaks if it is done the
obvious way. Several of the fixes below exist because an earlier "obvious"
version was wrong in a screen reader.

**Test with NVDA in both Chrome and Firefox.** Several bugs here were invisible
without a screen reader and behaved differently between engines.

## Hard-won constraints — do not regress these

**Never make a control inside a `role="grid"` cell the roving tab stop.**
NVDA switches to focus mode automatically for gridcells and columnheaders, but
never for a checkbox (checkboxes are operable from browse mode). Putting the
roving `tabindex` on the select-all checkbox itself killed arrow-key grid
navigation on that one cell — arrows went to the virtual cursor instead. Focus
belongs on the cell; interactive content inside it stays non-focusable.

**Focus-mode announcement does not walk into cell content.** When a gridcell has
focus, NVDA announces the focused element's name and coordinates. It does *not*
read an embedded checkbox's `aria-checked`. Verified in both Chrome and Firefox.
This is why the row select checkbox carries a **flipping name**
("Select X" / "Deselect X") — the name is the only state channel that reaches
the user in this navigation model. `role="checkbox"` + `aria-checked` stay for
browse-mode reading and automated checks.

**State reaches the user through the focused CELL, never through the checkbox
inside it.** The two constraints above describe the same trap from two sides, so
the rule they imply is written out here once:

- Grid navigation focus stays on `gridcell` / `columnheader`. Nothing else in
  the grid body is a tab stop.
- The embedded checkbox stays non-focusable. Do **not** move the roving
  `tabindex` onto it — that is what killed arrow-key navigation on the
  select-all cell.
- Do **not** change the cell's role to `checkbox` to make the state announce.
  Two separate walls: a `role="row"` may only own `gridcell` / `columnheader` /
  `rowheader`, so changing it breaks `aria-colindex`, the arrow-key model and
  the automatic focus-mode switch NVDA gives those roles; and `aria-checked` is
  not a supported state of `gridcell` anyway (`aria-selected` is, and rows
  already carry it — a second checked channel on the cell would be free to
  disagree with it).
- So any state that must be heard in focus mode belongs in the **focused cell's
  accessible name or description**. It must not be left to a non-focused
  descendant's `aria-checked` and hoped for.

`role="checkbox"` + `aria-checked` still stay on the control. They are not dead:
browse mode reads them correctly and automated checks rely on them. They are
simply unreachable in the one mode grid navigation puts the user in.

What each control uses today:

- **Row select** — flipping accessible name on the checkbox
  ("Select X" / "Deselect X"), read out of cell content.
- **Header select-all** — the cell has no `aria-label` on purpose, so its name
  comes from content ("Select all rows"); the tri-state is carried by
  `aria-describedby` → `selectall-count-desc` ("No rows selected" / "2 of 40
  rows selected" / "All 40 rows selected"). Pin state rides on the same cell's
  `aria-description` for the same reason — a label there would replace the
  content-derived name and take the count with it.

Caveat worth knowing before editing this cell: the row-level behaviour was
verified with NVDA, but the header lead cell's source comment claims the
embedded checkbox "is announced from content — role, checked/mixed state",
which contradicts the focus-mode constraint above. Both cannot be true. Treat
the header as **unverified** and re-test with NVDA before relying on either
reading.

**Never bake a role word into an accessible name.** "Deselect checkbox X" would
double-announce as "Deselect checkbox X, checkbox". The role attribute already
supplies it.

**Firefox announces "not selected" on every grid cell.** Gecko exposes a
selectable state on cells inside a grid that has a selection model. The cell is
never selected (the row is), so NVDA reads "not selected" everywhere. Chromium
does not do this. It is an engine behaviour, not a markup defect, and the only
way to remove it would be dropping `aria-selected` from rows — which is the
correct pattern and stays.

**24 hardcoded DOM ids block multiple live instances.** `gc-header-lead`,
`chooser-title`, `filter-opt-0`, `selectall-count-desc`, `csc-live`,
`grid-instructions`, … plus 20 `getElementById` call sites. Two live instances
would duplicate every id: `aria-labelledby`/`describedby`/`controls` resolve to
the wrong element and `getElementById` always returns the first match. Any
multi-instance work needs id namespacing first.

**`aria-checked` supports `"mixed"`; `aria-selected` and `aria-pressed` do not
carry the same meaning.** Tri-state select-all controls must use
`role="checkbox"`. `aria-pressed` does accept `mixed` but announces as
"toggle button, mixed", which is not what a checkbox affordance should say.

**`radiogroup` may only own `radio`, never `menuitemradio`.** The column menu
uses `radiogroup` + `radio`, which is what produces the "1 of 3" position
announcement. Do not mix the two idioms.

**State properties are for state the user can change.** Autosize items are
`menuitem`, not `menuitemcheckbox`: activating one autosizes, and the tick
clears only as a side effect of a manual resize. There is no way to uncheck it,
so announcing "checked" would invite a Space press that does nothing. The
applied state is carried by `aria-describedby` instead.

## Work completed

### Autosize

- `autosizeAllColumns(silent)` has two modes. Explicit (menu click) re-measures
  **every** visible column including hand-resized ones — the click *is* the user
  overriding their earlier manual choice. Silent (first load, text-size change,
  reset) preserves manual widths **and** their cleared autofit flags.
- Autofit flags are set only for columns actually measured and applied in that
  pass, never for skipped ones or hidden columns' stale width entries. The old
  code skipped manual columns but flagged them anyway, so the menu checkmark
  lied and a second click behaved differently from the first.

### Pin = freeze

- Pinning was only reordering columns and drawing a badge. It now freezes:
  `pinOffsets()` computes each frozen column's sticky left/right offset (the
  summed width of the frozen columns ahead of it), consumed by both the header
  row and every data row from one source so they cannot drift.
- Leading action columns (checkbox / expand / delete) freeze **only** when
  something is pinned left, otherwise they would scroll away underneath a
  column parked at `left:0`.
- `background: inherit` on frozen cells, never a hardcoded colour — the colour
  lives on the row (zebra / hover / selected) and inheriting picks up whichever
  is active.
- Specificity trap: `.csc-cell-dirty` and `.csc-cell-editable` set
  `position:relative` at two-class specificity, so the sticky rules are written
  as `.csc-grid-inner .csc-gridcell.csc-pinned-left` — otherwise any dirty or
  editable cell in a frozen column silently unfreezes.
- Edge shadow uses `box-shadow` on data cells but a `::before` on the data
  column header, because that header binds `box-shadow` inline for the drag
  drop-target indicator and inline always wins.
- `setPinDirection` calls `refitAfterHeaderChange`: pinning adds a 5th header
  icon, and nothing used to re-measure, so the pin icon overflowed
  `.csc-header-content`'s `overflow:hidden` and was never visible.
- `pinnedCols` was typed `Record<string, boolean>` while storing `'left'|'right'`,
  which is why read sites cast through `any`. Now typed honestly.

### Selection semantics

- Lead header cell is `role="gridcell"`, **not** `columnheader`. A columnheader
  is the label for the data beneath it, and screen readers echo that label on
  every row — which is why "Select all rows" was repeating endlessly. It labels
  nothing; it holds an action control.
- Select-all checkbox: `role="checkbox"` with tri-state `aria-checked`
  (`true`/`mixed`/`false`, as **strings**), `aria-controls` listing the row
  controls, and `aria-describedby` pointing at a live count
  (`selectAllCountDesc()`): "2 of 40 rows selected", "2 of 15 filtered rows
  selected", "All 40 rows selected", "No rows selected". The denominator is
  `baseRows` — the full filtered set across every page, because that is what
  `selectAll()` toggles. Deliberately not the word "visible", which a screen
  reader user reads as "the current page".
- Row select controls: `role="checkbox"` + binary `aria-checked` + flipping
  name (see constraints above). Row-level `aria-selected` stays.
- Filter popup converted from `listbox`/`option`/`aria-selected` to a checkbox
  group (`role="group"` + `role="checkbox"`), because a listbox cannot legally
  contain a checkbox and `aria-selected` has no mixed state. Side effect: the
  result count no longer includes Select All as though it were a filter value.
  Arrow-key roving is kept — these lists run to dozens of values and one tab
  stop each would bury the Clear and Apply buttons.
- Chooser select-all: `aria-pressed` toggle button → tri-state checkbox.

### Roving tabindex integrity

`ensureActiveCellValid()` guards the invariant that exactly one grid cell has
`tabindex=0`. Changing page, page size, a filter, or the visible column set can
destroy the active cell, after which **nothing** in the grid is tabbable and a
keyboard user cannot get back in (this is what made page 2+ unreachable).
Wired into `setPage`, `gotoGo`, `choosePageSize`, `applyFilter`, `clearFilter`,
`toggleColumn`, `toggleChooserSelectAll`, `chooserHideAll`. Delete flows manage
their own next-focus and are excluded.

### Modals

- All three dialog titles carry `role="heading" aria-level="2"`: chooser,
  Add record, delete confirm.
- Chooser "Done" renamed to **"Close"**. Column changes apply live as they are
  toggled, so the button commits nothing — it only dismisses, same as the ✕ and
  Escape. Named "Done" it implied a save step that does not exist, and next to
  "Reset" it read as the confirm half of a confirm/cancel pair. The meaning is
  carried by visible text rather than an `aria-label` so the accessible name and
  the label a speech-recognition user says stay identical (2.5.3).

### Column menu

- Sort is now a `radiogroup` with three radios: Sort Ascending / Sort Descending
  / **No Sort**. Previously plain menuitems with no state at all, and there was
  no way to clear a sort from the menu — only by clicking the header a third
  time.
- Pin stays `radiogroup` + `radio`. Both groups render through one template
  path.
- Autosize items are `menuitem` + `aria-describedby` (see constraints).
- Roving tabindex over a flattened item list (`menuFlatItems()`); previously all
  13 items had `tabindex="0"`, which an APG menu must not do.
- `openMenu()` moves focus into the menu — onto the checked radio of the first
  group if there is one, else the first enabled item. The popover renders at the
  document root, *after* the pager in DOM order, so leaving focus on the ⋮
  trigger meant Tab walked through pagination and "Go to page" first.
- Keyboard: ↑↓ move (wrapping, skipping disabled), ←→ move and select **within**
  a radio group only, Home/End first/last enabled, Enter/Space activate,
  Escape closes and restores focus to the trigger.
- Tab/Shift+Tab close the menu and **continue the tab sequence** rather than
  parking on the trigger. The keypress is not consumed; focus is restored to the
  trigger synchronously *before* the popover leaves the DOM (otherwise focus
  falls to `<body>` and tabbing resumes from the top of the document).
- The menu **stays open** on activation. Only Choose Columns (opens a modal —
  two overlays and two focus traps otherwise) and Reset Columns (can hide the
  very column the menu belongs to) close it. Closing on every activation also
  meant the user never heard the `aria-checked` change they had just made,
  because the radio vanished in the same instant.
- `repositionMenuAfterRender()` re-anchors the still-open menu under its column
  header after an action that relocates the column, and re-asserts focus on the
  activated item.
- Move Left/Right are bounded by **pin section**. `moveColumn` used to swap in
  `orderedFields` (storage order) while the grid renders `visibleFields`
  (pinned-left, unpinned, pinned-right). A left-pinned column "moved right"
  changed storage, the visible list put it straight back, nothing moved on
  screen — and the announcement still claimed a new position. Moves stop at a
  section boundary rather than crossing it, because crossing would silently
  change the column's pin state, which is the Pin radio group's decision.
  Boundary items are `aria-disabled`, not removed, so the menu does not change
  length as a column travels.
- Toasts report the **visible** position, not the storage index.

## Open items

### 1. Section state isolation (High)

Anything not in `SectionState` is shared across all five demo sections. The
visible symptom: a cell edited in Editable shows its dirty triangle **and its
changed value** in Basic usage, which is not editable. See
`DEFECT-section-state-isolation.md` for the full writeup.

Shared and leaking: `rows`, `dirtyCells` (key is `rowId::field`, no section
component), `_original`, `expanded`, `page`, `pageSize`, `textStep`,
`legendOpen`. Already isolated: sort, filters, pins, column order, hidden
columns, widths, autofit flags, `selected`.

Agreed direction: each demo section owns its own data (these are independent
feature demos, not a shared workspace). Recommended fix is extending
`SectionState` rather than one component instance per tab — the id collision
problem above blocks the instance approach.

Open decision: per-section `textStep` means the root font size changes on every
tab switch, affecting the whole page and re-running autosize each time.
Text size is arguably an accessibility preference that should persist app-wide.

### 2. Chooser position numbers (open, direction chosen but not implemented)

`chooserItems` reports positions from `orderedFields()` (storage order) while
the grid renders `visibleFields()`. With anything pinned the numbers do not
match what the user sees — e.g. a pinned Entity shows as visual position 1 but
the chooser says 2. Consequences:

1. Position numbers disagree with the grid
2. Hidden columns are counted in `total`, so the numbers are wrong even with no
   pinning
3. Up/Down buttons (`moveColumn(fromChooser=true)`) still do a plain adjacent
   swap ignoring pin sections — the same silent no-op fixed in the menu
4. The position spinbutton writes straight to `colOrder`, so setting a pinned
   column's number does nothing visible, and `aria-valuenow` misreports
5. `isFirst`/`isLast` and the up/down disabled colours use storage indices

Underlying tension: the chooser does visibility **and** ordering in one list.
Visibility needs hidden columns shown; ordering needs visual order; a hidden
column has no visual position.

Preferred direction (Option A): the chooser mirrors the grid — list grouped as
Pinned left / Unpinned / Pinned right, numbers = position among visible columns,
hidden columns in their own group with no number, and moves clamped to the
column's section. Not yet confirmed: how hidden columns should be presented.

## Test checklist

`CSC-Grid-Functionality-Test-Checklist.xlsx` holds 99 test items across 21
areas, each with expected behaviour, steps, and a screen-reader expectation.
It predates the selection-semantics rework, so the Selection rows still assume a
stable row checkbox name (now flipping) and there is no row yet for the Firefox
per-cell "not selected" behaviour.

## Note on codebases

Two zips have been in play: an earlier `grid/` project and a later
`csc-grid-share/grid/` one with data adapters, a Simplified editable section and
an All features section backed by a server-side store. The column menu, heading
and Close work landed on `csc-grid-share`. Check which tree you are in before
assuming a fix is present.
