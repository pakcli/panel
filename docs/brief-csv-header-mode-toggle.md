# 📌 Master Brief: CSV Header Mode Toggle: Simple, Advance & Simple+Calc (`pakcli-panel`)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `pakcli-panel` (`src/features/sqlseal`, `src/features/csv`)  
> **Platform**: Obsidian Desktop & Mobile (Tablite CSV View & Embedded CodeBlock)  
> **Date**: 2026-10-14  

---

## 1. Objective & Problem Statement
- **Problem**:
  - The default Tablite header is dense and advanced (spanning 3–4 sub-rows with column letters, drag grips, data type pills, filter dropdowns, and sort pills).
  - For clean reading, quick note editing, or embedded codeblocks, users frequently want a minimal, spreadsheet-style header (`text cell | text cell | text cell`) without visual noise.
  - Users also want a hybrid mode (`simple + calculation only`) where headers remain clean single-line text cells while calculation summaries (SUM, AVG, COUNT, MIN, MAX) remain active.
- **Solution**:
  - Introduce three distinct header display modes:
    1. **`simple`**: Single-line text cell headers (`text cell | text cell | text cell`). No filter/sort clutter, letters, or type pills.
    2. **`advance`**: Full-power multi-row headers with column letters, drag reorder grips, type indicators, filter dropdowns, and sort pills.
    3. **`simple_calc`**: Clean single-line text cell headers + calculation summary row enabled.
  - Add header mode toggle in:
    - **Tablite Toolbar / Ribbon**: Segmented 3-way toggle button (`[⚡ Simple | 🛠️ Advance | 🔢 Simple + Calc]`).
    - **Embedded CodeBlock Header**: Direct mode switcher right on the topbar.
    - **Obsidian Ribbon / Command Palette**: Quick toggle/cycle command and ribbon action.
  - Persist `headerMode` inside `ColumnConfig` so it saves per View preset and per file artifact.

---

## 2. Technical Architecture & Constraints
- **State Management**:
  - Extend `ColumnConfig` in `src/features/sqlseal/types.ts` with `headerMode?: 'simple' | 'advance' | 'simple_calc'`.
  - Handle in `useTableData`, `App.tsx`, and View presets.
- **Component Modifications**:
  - `HeaderCell.tsx`: When `headerMode === 'simple'` or `'simple_calc'`, render clean `.tablite-header-simple` (single flex row with header text, double-click to rename, subtle column select & resize handle).
  - `Table.tsx`: Pass `headerMode` to `HeaderCell` and compute `calcPosition` dynamically (`simple_calc` forces calculation row visible).
  - `Toolbar.tsx`: Add segmented mode toggle.
  - `App.tsx`: Provide mode toggle in embedded topbar and pass `headerMode` state.
- **Styling (`csvCodeblock.scss` & `main.scss`)**:
  - Style `.tablite-header-simple` to look like clean tabular text cells.
  - Style `.tablite-header-mode-toggle` segmented button group.

---

## 3. Implementation Plan & Target Files
| File | Status | Description |
| :--- | :---: | :--- |
| `panel/src/features/sqlseal/types.ts` | ⏳ | Add `headerMode` to `ColumnConfig` and normalization |
| `panel/src/features/sqlseal/components/HeaderCell.tsx` | ⏳ | Render minimalist text cell for `simple` and `simple_calc` |
| `panel/src/features/sqlseal/components/Table.tsx` | ⏳ | Wire `headerMode` and enable calculation row for `simple_calc` |
| `panel/src/features/sqlseal/components/Toolbar.tsx` | ⏳ | Segmented 3-way header mode toggle in toolbar |
| `panel/src/features/sqlseal/components/App.tsx` | ⏳ | Pass `headerMode` through state, view persistence, and embed bar |
| `panel/src/styles/csvCodeblock.scss` | ⏳ | Styling for simple header cells and mode toggle buttons |
| `panel/src/main.ts` | ⏳ | Ribbon action / command palette integration |
| `panel/docs/brief-csv-header-mode-toggle.md` | ⏳ | Master brief lifecycle tracking |

---

## 4. Acceptance Criteria Checklist
- [ ] Status 0 brief committed
- [ ] `ColumnConfig` updated with `headerMode`
- [ ] `HeaderCell` renders clean single-line text cell in `simple` mode
- [ ] `advance` mode retains full multi-row filter/sort controls
- [ ] `simple_calc` displays clean text cells + active calculation row
- [ ] Segmented toggle button present in Toolbar and embed header
- [ ] View presets save and restore `headerMode`
- [ ] Clean build with bundle size < 5.0 MB
- [ ] Status 1 updated and committed to git
