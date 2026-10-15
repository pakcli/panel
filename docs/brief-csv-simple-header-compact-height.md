# 📌 Master Brief: CSV Simple Header Mode Compact Height Sizing (pakcli-panel)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `panel/src/features/sqlseal`  
> **Platform**: Cross-platform (Desktop & Mobile)  
> **Date**: 2026-10-15  

---

## 1. Objective & Problem Statement
- **Problem**:
  - In `Simple` header mode, the header row was excessively tall (~80px) instead of being compact like standard table rows (~28px).
  - Root Cause:
    1. The `__row_num` column header still rendered 4 stacked sub-rows (Row 1 `#`, Row 2 `Row`, Row 3 sorting toggle + force sort checkbox, Row 4 `∑ Calc`).
    2. The `__select` column header rendered empty placeholder sub-rows 2, 3, 4.
    3. Because column `#` and `select` stretched vertically, the browser grid expanded all sibling header cells (`id`, `order`), leaving giant empty vertical gaps.
- **Solution**:
  1. **`Table.tsx` - Column `__row_num`**: In `simple` & `simple_calc` modes, renders only a single centered `#` text cell with no multi-row sort or calculation clutter.
  2. **`Table.tsx` - Column `__select`**: In `simple` & `simple_calc` modes, renders only a single centered select-all checkbox.
  3. **`HeaderCell.tsx`**: In `simple` & `simple_calc` modes, renders a clean single-row `.tablite-header-simple` displaying only column title text and resize handle.
  4. **CSS Styling**: Enforced compact `28px` header height on `.tablite-table.tablite-mode-simple thead tr`, `.tablite-table.tablite-mode-simple_calc thead tr`, `.tablite-th`, and `.tablite-header-simple`.

---

## 2. Technical Architecture & Constraints
- **Zero Layout Drift**:
  - Data cells already use ~28px row height. The simple header row strictly matches the 28px row height, achieving a 100% harmonious spreadsheet look.
- **Mode Isolation**:
  - `advance` mode retains full 4-row capability (letters, types, filters, sorts, calcs).
  - `simple_calc` retains clean title + calculation row in tfoot.

---

## 3. Implementation Plan & Target Files
| File | Status | Description |
| :--- | :---: | :--- |
| `docs/brief-csv-simple-header-compact-height.md` | ✅ | Master brief (Status 0 -> 1) |
| `src/features/sqlseal/components/Table.tsx` | ✅ | Compact `__row_num` & `__select` headers in simple mode |
| `src/features/sqlseal/components/HeaderCell.tsx` | ✅ | Clean single-line text cell in simple mode |
| `src/styles/csvCodeblock.scss` | ✅ | CSS rules for `.tablite-mode-simple` 28px header height |

---

## 4. Acceptance Criteria Checklist
- [x] Status 0 brief created and committed
- [x] In `Simple` mode, `__row_num` renders only `#` without sorting buttons or calculation label
- [x] In `Simple` mode, `__select` renders only the checkbox without empty placeholder rows
- [x] In `Simple` mode, data column headers render only column name text without empty vertical gap
- [x] Header height strictly locked to ~28px in simple mode
- [x] Advance mode retains full tools and controls
- [x] Production build passes with bundle size < 5.0 MB
- [x] Status 1 brief updated and committed

