# 📌 Master Brief: CSV Simple Header Mode Compact Height Sizing (pakcli-panel)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `panel/src/features/sqlseal`  
> **Platform**: Cross-platform (Desktop & Mobile)  
> **Date**: 2026-10-15  

---

## 1. Objective & Problem Statement
- **Problem**:
  - In `Simple` header mode, the header row is excessively tall (~80px) instead of being compact like standard table rows (~28px).
  - Root Cause:
    1. The `__row_num` column header still renders 4 stacked sub-rows (Row 1 `#`, Row 2 `Row`, Row 3 sorting toggle + force sort checkbox, Row 4 `∑ Calc`).
    2. The `__select` column header renders empty placeholder sub-rows 2, 3, 4.
    3. Because column `#` and `select` stretch vertically, the browser grid expands all sibling header cells (`id`, `order`), leaving giant empty vertical gaps.
- **Solution**:
  1. **`Table.tsx` - Column `__row_num`**: In `simple` mode, render only a single centered `#` text cell with no multi-row sort or calculation clutter.
  2. **`Table.tsx` - Column `__select`**: In `simple` mode, render only a single centered select-all checkbox.
  3. **`HeaderCell.tsx`**: In `simple` mode, render a clean single-row `.tablite-header-simple-cell` displaying only column grip, title text, and resize handle.
  4. **CSS Styling**: Enforce compact `28px` header height on `.tablite-table.tablite-mode-simple thead tr` and `.tablite-th`.

---

## 2. Technical Architecture & Constraints
- **Zero Layout Drift**:
  - Data cells already use ~28px row height. The simple header row will strictly match the 28px row height, achieving a 100% harmonious spreadsheet look.
- **Mode Isolation**:
  - `advance` mode retains full 4-row capability (letters, types, filters, sorts, calcs).
  - `simple_calc` retains clean title + calculation row.

---

## 3. Implementation Plan & Target Files
| File | Status | Description |
| :--- | :---: | :--- |
| `docs/brief-csv-simple-header-compact-height.md` | ⏳ | Master brief (Status 0 -> 1) |
| `src/features/sqlseal/components/Table.tsx` | ⏳ | Compact `__row_num` & `__select` headers in simple mode |
| `src/features/sqlseal/components/HeaderCell.tsx` | ⏳ | Clean single-line text cell in simple mode |
| `src/styles/main.scss` | ⏳ | CSS rules for `.tablite-mode-simple` 28px header height |

---

## 4. Acceptance Criteria Checklist
- [ ] Status 0 brief created and committed
- [ ] In `Simple` mode, `__row_num` renders only `#` without sorting buttons or calculation label
- [ ] In `Simple` mode, `__select` renders only the checkbox without empty placeholder rows
- [ ] In `Simple` mode, data column headers render only column name text without empty vertical gap
- [ ] Header height strictly locked to ~28px in simple mode
- [ ] Advance mode retains full tools and controls
- [ ] Production build passes with bundle size < 5.0 MB
- [ ] Status 1 brief updated and committed
