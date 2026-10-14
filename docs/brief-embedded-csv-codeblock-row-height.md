# 📌 Master Brief: Embedded CSV Codeblock Renderer with Dynamic Row-Height (`pakcli-panel`)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `pakcli-panel` (`src/features/csv`)  
> **Platform**: Obsidian Desktop & Mobile (Markdown CodeBlock Processor `csv` / `tsv`)  
> **Date**: 2026-10-14  

---

## 1. Executive Summary & Problem Analysis

### 🚨 Current Problem
- When users paste or export tabular data into ````csv```` codeblocks in Obsidian:
  ```csv
  id,age,fullName,nickname,action,weight,thumb,position,updatedAt,category,number,isCaptain,height,isActive
  2,25 th,SEPTIA RAMADHANI LENGKAPLAH,SEPTIA AUAUAUAUAU WOW 1,assets/player-img/full/2.png,58 kg,assets/player-img/2.png,OUTSIDE HITTER,2026-10-14T04:07:07.832Z,outside-hitter,2,false,163 cm,true
  ```
- By default, Obsidian renders this as raw, monochromatic code text wrapped in `<pre><code>`.
- If rendered with typical table widgets, containers often impose a large fixed minimum height (e.g. 300px–400px) or awkward scrollbars, resulting in massive empty gaps when there is only 1 or 3 rows.
- Wide columns (such as 14 columns of player attributes) break readability without responsive horizontal scrolling.

### 🎯 Objective
- Automatically render ````csv```` (and ````tsv````) codeblocks as clean, native, embedded interactive tables.
- **Dynamic Auto-Height**: The height of the table container strictly matches the total rows in the codeblock (`height = height of the total rows`). 1 row fits 1 row, 3 rows fit 3 rows. No wasted blank void or vertical scrollbars on short tables.
- **Horizontal Overflow Handling**: Tables with many columns scroll horizontally without breaking note layouts.
- **Header Toolbar**: Displays row/column count badge, 1-click Copy CSV button, and Raw Code / Table View toggle.
- **Media & Type Awareness**: Recognizes image paths/thumbnails, booleans, and numbers with clean formatting.

---

## 2. Technical Architecture & Component Structure

### A. CodeBlock Processor Registration
- Register `csv` and `tsv` via Obsidian `registerMarkdownCodeBlockProcessor` in `panel/src/main.ts`.
- Uses `MarkdownRenderChild` lifecycle to handle cleanup on DOM unload.

### B. Dynamic Row-Height Calculation
- The outer card (`.pakcli-csv-card`) uses `height: auto; max-width: 100%;` without arbitrary min-heights.
- The inner table wrapper (`.pakcli-csv-table-wrapper`) sets `overflow-x: auto; overflow-y: hidden;`.
- For datasets $\le 15$ rows: Height naturally matches $(headerRowHeight + N \times dataRowHeight)$, achieving 100% pixel-perfect fit.
- For large datasets ($> 15$ rows): `max-height: 520px; overflow-y: auto;` engages with sticky table header.

### C. UI/UX Hierarchy Diagram

```mermaid
flowchart TD
    CodeBlock["```csv CodeBlock Input"] --> Processor["CsvCodeblockRenderer"]
    Processor --> Parser["PapaParse / CSV Parser (Detect Delimiter)"]
    Parser --> Card["Card Container (.pakcli-csv-card)"]
    
    subgraph CardUI ["Embedded CSV View"]
        HeaderBar["Header Toolbar: Badge (N rows, M cols) + Copy + Toggle View"]
        TableWrapper["Table Viewport (Dynamic Row-Height, Auto-fit)"]
        Table["Interactive Table (.pakcli-csv-table)"]
        RawView["Raw Code Block (.pakcli-csv-raw-code)"]
    end
    
    Card --> HeaderBar
    Card --> TableWrapper
    TableWrapper --> Table
    Card -. Toggle .-> RawView
```

---

## 3. Implementation Plan & Target Files

| Target File | Changes |
| :--- | :--- |
| `panel/src/features/csv/CsvCodeblockRenderer.ts` | Complete MarkdownRenderChild processor for `csv` and `tsv` codeblocks. |
| `panel/src/styles/csvCodeblock.scss` | Styling for embedded card, auto-height viewport, sticky headers, badges, and horizontal scroll. |
| `panel/src/styles/main.scss` | Import `@use 'csvCodeblock';`. |
| `panel/src/main.ts` | Register `csv` and `tsv` markdown codeblock processors. |
| `panel/docs/brief-embedded-csv-codeblock-row-height.md` | Feature brief & lifecycle tracking (Status 0 -> 1). |

---

## 4. Acceptance Criteria Checklist

- [x] Status 0 brief created and committed to git.
- [x] ````csv```` codeblocks render as embedded visual tables.
- [x] Table container height strictly matches total rows in the codeblock (no empty void for 1 or 3 rows).
- [x] Horizontal scroll enabled for wide tables (e.g. 14 columns).
- [x] Header toolbar includes row/col count badge, Copy CSV button, and Raw/Table view toggle.
- [x] Image paths and boolean values rendered cleanly.
- [x] `npm run build` succeeds with 0 errors and bundle size $< 5.0\text{ MB}$ (Bundle: 4.58 MB).
- [x] Auto-deployed to target vaults.
- [x] Brief updated to Status 1 and committed.
