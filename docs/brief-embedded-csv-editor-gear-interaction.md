# 📌 Master Brief: Embedded CSV Editor Direct Interaction with Toggle Gear & Exact Row-Height (`pakcli-panel`)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `pakcli-panel` (`src/features/csv`, `src/features/sqlseal`)  
> **Platform**: Obsidian Desktop & Mobile (Markdown CodeBlock Processor `csv` / `tsv`)  
> **Date**: 2026-10-14  

---

## 1. Objective & Problem Statement
- **Problem**: 
  - Standard markdown codeblocks render CSV data as plain monospaced text, lacking inline interactivity.
  - While basic custom table renderers can display static cells, users require the full power of Tablite CSV Editor directly inside the markdown note (`format langsung`): inline cell editing, arrow navigation, column sorting/hiding/reordering, calculations, search/replace, and cell selections.
  - When embedding such a full-featured spreadsheet, large toolbars crowd the note and containers often default to tall minimum heights with giant empty voids when there are only 1 to 3 rows.
- **Solution**:
  - Mount the native Tablite `App` Preact component directly into `csv` and `tsv` markdown codeblock renderers.
  - Implement a sleek embed topbar with a **collapsible gear button (`⚙️ Tools`)**: by default, the interface remains minimalist and compact; clicking `⚙️ Tools` reveals the full suite of Tablite CSV tools (View presets, Column visibility, Calcs, Find/Replace, Text Wrap, Delimiter options, Undo/Redo).
  - Enforce **strictly exact container height matching total rows** (`height = height of total rows`): 1 row matches 1 row (~68px table + compact bar), 3 rows match 3 rows (~132px table + compact bar), with zero wasted blank space. For large datasets (> 15 rows), max-height scroll engages with sticky headers.
  - Auto-save cell edits back into the note's codeblock with a smooth 800ms debounce.

---

## 2. Technical Architecture & Constraints
- **Platform Guards**: Cross-platform (Obsidian Desktop & Mobile via Preact and MarkdownRenderChild).
- **Synergy & Architecture**:
  - `CsvCodeblockRenderer.ts`: MarkdownRenderChild lifecycle mounting `App` via Preact `render(h(App, ...), container)`.
  - `App.tsx`: Added `isEmbedded?: boolean` prop and `isToolsOpen` toggle state. Embed topbar displays title, badge, Copy, Raw/Table view switch, and the `⚙️ Tools` gear button.
  - `csvCodeblock.scss`: Overrides `.tablite-codeblock-embed` with `height: auto !important; max-height: 620px;` and `.tablite-table-container` with `height: auto !important; flex: 0 1 auto !important; max-height: 480px;`.
  - **Vault Writeback**: Modifies note content using `ctx.getSectionInfo(containerEl)` and `vault.modify(file, newContent)` safely without cursor loss.

---

## 3. Implementation Plan & Target Files
| File | Status | Description |
| :--- | :---: | :--- |
| `panel/src/features/sqlseal/components/App.tsx` | ✅ | Support `isEmbedded` prop, toggle gear button `⚙️ Tools`, and conditional toolbar |
| `panel/src/features/csv/CsvCodeblockRenderer.ts` | ✅ | Mount Tablite `App` in codeblock with note writeback & lifecycle unmount |
| `panel/src/main.ts` | ✅ | Pass plugin instance into `CsvCodeblockRenderer` for config and vault access |
| `panel/src/styles/csvCodeblock.scss` | ✅ | Auto-height shrink-wrapping, compact embed bar, gear button styling |
| `panel/docs/brief-embedded-csv-editor-gear-interaction.md` | ✅ | Feature brief tracking (Status 0 -> 1) |

---

## 4. Acceptance Criteria Checklist
- [x] Status 0 brief committed
- [x] Tablite `App` mounted directly in `csv` and `tsv` codeblocks
- [x] Toggle gear button `⚙️ Tools` implemented in embed header
- [x] Toolbar cleanly expands/collapses on gear button toggle
- [x] Container height strictly matches total rows in codeblock (no empty space for 1 or 3 rows)
- [x] Inline cell editing and auto-save back to markdown note codeblock
- [x] Horizontal scroll smoothly supported for wide tables (e.g. 14 columns)
- [x] Build clean with 0 TypeScript errors and bundle size < 5.0 MB (4.58 MB)
- [x] Auto-deployed to target test vaults
- [x] Status 1 updated and committed to git
