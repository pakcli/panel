# 📌 Master Brief: CSV Sticky Columns Opaque Fix & Native div.view-header Styling (pakcli-panel)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `panel/src/features/sqlseal`  
> **Platform**: Cross-platform (Desktop & Mobile)  
> **Date**: 2026-10-15  

---

## 1. Objective & Problem Statement
- **Problem**:
  1. **Sticky Column Transparency & Text Bleed**:
     - When horizontal scrolling occurred, data columns scrolled underneath the frozen `#` (row number) and select checkbox columns.
     - Because `#` and checkbox columns lacked a 100% opaque background in both thead and tbody, the scrolling text (`b`, `assets/p...`) bled right through `#` and `1`, causing visual overlap.
  2. **Top Header Transparency & Layout Artifacts**:
     - In page view, the topbar had rounded corners and semi-transparent background, showing the underlying container background at the corners.
     - The user requested aligning the element class with Obsidian's native `div.view-header` (`.view-header`) so it is completely opaque, flush (`border-radius: 0`), and sticky at the top.

---

## 2. Solution & Technical Architecture
1. **Opaque Sticky Columns**:
   - Explicitly styled `.tablite-th-select`, `.tablite-th-row-num`, and `th.tablite-frozen-cell` with `background-color: var(--background-secondary) !important`, `opacity: 1 !important`, and `z-index: 8`.
   - Explicitly styled `.tablite-td-select`, `.tablite-td-row-num`, and `td.tablite-frozen-cell` with `background-color: var(--background-secondary-alt, var(--background-secondary)) !important`, `opacity: 1 !important`, and `z-index: 4`.
   - Added a subtle divider shadow on the row-num column (`box-shadow: 2px 0 4px rgba(0, 0, 0, 0.08)`) to clearly delineate frozen columns during horizontal scroll.
2. **Native `div.view-header` Topbar**:
   - Integrated `div.view-header` class on `tablite-topbar`.
   - In page view (`.tablite-is-page`), enforced `border-radius: 0 !important`, flush borders, and solid `background-color: var(--background-secondary) !important` with `position: sticky; top: 0; z-index: 20;`.
   - In embedded mode (`.tablite-is-embedded`), retained rounded top corners to blend inside note cards.

---

## 3. Implementation Plan & Target Files
| File | Status | Description |
| :--- | :---: | :--- |
| `docs/brief-csv-sticky-columns-and-view-header.md` | ✅ | Master brief (Status 0 -> 1) |
| `src/features/sqlseal/components/Table.tsx` | ✅ | Adjust getPinnedStyles z-index & pinned logic |
| `src/features/sqlseal/components/App.tsx` | ✅ | Add `div.view-header` & `tablite-is-page` / `tablite-is-embedded` |
| `src/styles/csvCodeblock.scss` | ✅ | Style `div.view-header.tablite-topbar` & simple header cells |
| `src/styles/main.scss` | ✅ | Solid opaque backgrounds for all sticky columns (`th` & `td`) |

---

## 4. Acceptance Criteria Checklist
- [x] Status 0 brief created and committed
- [x] Topbar has `div.view-header` class and solid background with 0 border-radius in page view
- [x] Sticky row number (`#` / `1`) and select checkbox columns have 100% opaque solid background
- [x] Horizontal scrolling never bleeds data column text through sticky columns
- [x] Divider shadow/border on sticky columns cleanly separates scrolling data
- [x] Production build passes with bundle size < 5.0 MB
- [x] Status 1 brief updated and committed

