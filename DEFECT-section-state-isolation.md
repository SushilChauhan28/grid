# DEFECT: Section state is shared across tabs

**Component:** `csc-grid.component.ts` / `.html`
**Severity:** High — data from one demo section is visible in every other section
**Status:** Diagnosed, not fixed. Deferred by request.

---

## Summary

The grid renders all five sections (Basic usage, Advanced features, Editable,
Simplified editable, Expandable, All features) from a **single component
instance** that multiplexes on a `section` signal. Some state is correctly
keyed per section; a lot of it is not. Anything in the second group leaks:
a change made in one tab shows up in all the others.

The visible symptom that triggered this report: editing a cell in **Editable**
puts a dirty-marker triangle on that cell, and the same triangle then appears
in **Basic usage**, which is not editable at all.

---

## Root cause

`SectionState` (line ~40) is the per-section store. It currently holds six
fields only:

```ts
interface SectionState {
  sortField, sortDir, filters, pinnedCols, colOrder, colHidden
}
```

Everything else lives in plain component-level signals, which are global to the
instance and therefore shared by every section.

The dirty-marker case specifically:

```ts
rows       = signal<CscRow[]>(makeRows());          // line 134 - one array, all sections
dirtyCells = signal<Record<string, boolean>>({});   // line 192 - one map, all sections
```

The dirty key is built as `rowId + '::' + field` (line ~744, `viewRows`). There
is **no section component in the key**, so a flag written while in Editable
matches while rendering Basic, and `[class.csc-cell-dirty]` (template line 559)
paints the triangle.

The triangle is only the marker. The underlying data is shared too — editing a
cell calls `rows.set(...)` on the one shared array, so the **changed value
itself** is visible in every section. Hiding the triangle alone would leave the
data leak silently in place, which is worse.

---

## What is shared vs isolated

| State | Where it lives | Isolated? | Leak |
|---|---|---|---|
| `sortField`, `sortDir`, `filters`, `pinnedCols`, `colOrder`, `colHidden` | `SectionState` | Yes | — |
| Column widths, autofit flags | per-section keyed maps | Yes | — |
| `selected` | `_selectedBySection` (line 137) | Yes | — |
| `rows` | global signal (line 134) | **No** | Edits, added rows and deletions appear in every section |
| `dirtyCells` | global signal (line 192) | **No** | Dirty triangle appears in non-editable sections |
| `_original` | global object (line 195) | **No** | Pairs with `dirtyCells`; "reverted to original" detection goes wrong without it |
| `expanded` | global signal | **No** | Row expanded in Expandable stays expanded elsewhere |
| `editingCell`, `draft` | global signals | Partly | `setSection()` resets them, so no cross-tab leak, but an in-progress edit is silently discarded on tab switch |
| `page` | global signal (line 141) | **No** | Reset to 0 on every switch; returning to a section loses your place |
| `pageSize` | global signal (line 142) | **No** | Choosing 50 in one tab changes all tabs |
| `textStep` | global signal (line 167) | **No** | Text size carries across tabs |
| `legendOpen` | global signal (line 260) | **No** | Keyboard-shortcut legend open state carries across tabs |

**Not affected:** the *All features* section reads from the server-backed store
(`ds.rows()`), not the `rows` signal, so the data-sharing part of this defect
does not apply there.

---

## Secondary finding (resolved by the same fix)

`cellAriaDesc` (line ~759) is gated on `editable`:

```ts
cellAriaDesc: editable ? (dirty ? 'Edited. Press Enter to edit' : ...) : null
```

In a non-editable section `editable` is false, so the description is `null` —
the dirty triangle is **visible but never announced**. A sighted user sees a
marker a screen reader user is not told about (WCAG 1.3.1). Once isolation is
in place the triangle will not render in those sections at all, so this
disappears without a separate change.

---

## Fix options

### Option A — Extend `SectionState` (recommended)

Move every row in the "No" column above into `SectionState`, alongside the six
fields already there. `rows` becomes a per-section copy (`makeRows()` called
once per section), so each demo owns its own data.

- No DOM id problems — still one component instance
- State persists across tab switches, which is the current expectation
- The 4,187-line component body does not need restructuring
- One place defines what is per-section, so the next piece of state added has
  an obvious home

### Option B — One component instance per tab

Structurally cleaner (isolation becomes impossible to forget), but blocked by
two things:

1. **24 hardcoded DOM ids** (`gc-header-lead`, `chooser-title`, `filter-opt-0`,
   `selectall-count-desc`, `csc-live`, `grid-instructions`, …) and 20
   `getElementById` call sites. Two live instances means duplicate ids:
   `aria-labelledby` / `describedby` / `controls` resolve to the wrong element
   and `getElementById` always returns the first match, so one section's focus
   calls land in another's DOM. Every id would need instance namespacing first.
2. **Lifecycle trade-off.** Rendering one instance at a time (`@if`) keeps ids
   unique but destroys state on every tab switch — sort, filters and edits
   would all reset, which is the opposite problem. Keeping all instances alive
   and hidden preserves state but triggers problem 1, needs `inert`/`aria-hidden`
   on the hidden ones, and holds five grids in memory.

Either way, `textStep` still needs special handling: it sets
`document.documentElement.style.fontSize`, a global DOM side effect rather than
component state, so it must be re-applied when a section becomes active.

---

## Open decision

Per-section `textStep` means the **root font size changes on every tab switch**,
affecting the whole page (left nav, page title) and re-running the autosize pass
each time. Confirm this is the intended behaviour before implementing —
text size is arguably a user accessibility preference that should persist
app-wide rather than per demo.

---

## Reproduction

1. Open **Editable**. Edit any cell so the dirty triangle appears.
2. Switch to **Basic usage**.
3. The same cell shows the triangle, and the edited value is displayed —
   even though Basic usage is not editable.
4. Variants: set page size to 50 in one tab and check another; expand a row in
   Expandable and check elsewhere; change text size in one tab; open the
   keyboard-shortcut legend in one tab.
