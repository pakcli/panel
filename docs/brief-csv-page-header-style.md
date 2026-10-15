# 📌 Master Brief: CSV Page Header Style Unification (pakcli-panel)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `panel/src/features/sqlseal`  
> **Platform**: Cross-platform (Desktop & Mobile)  
> **Date**: 2026-10-15  

---

## 1. Objective & Problem Statement
- **Problem**:
  - The clean, tactile header bar (with `📊 CSV Table`, row/col badge, `[⚡ Simple | 🛠 Advance | 🔢 Simple + Calc]`, `[📋 Copy]`, `[🔀 Raw]`, and `[⚙️ Tools ▼]`) was only rendered in embedded markdown codeblocks (`isEmbedded === true`).
  - When opening a `.csv` file in full page view (Obsidian tab / `CsvView`), the view lacked this header bar entirely, showing only the sprawling Toolbar without quick-action toggles or a clean compact state.
- **Solution**:
  - Unified the topbar across both Embedded and Full-Page Tab views (`tablite-topbar`).
  - Provided identical controls and styling in page view:
    1. Title: `📊 CSV Table` (with file path tooltip).
    2. Dynamic badge: `X rows • Y cols`.
    3. Header Mode segmented buttons: `⚡ Simple`, `🛠 Advance`, `🔢 Simple + Calc`.
    4. Action buttons: `📋 Copy`, `🔀 Raw`, `⚙️ Tools ▼`.
  - Defaulted `isToolsOpen` to `false` so opening a CSV page view is immediately clean, compact, and distraction-free, with the full Toolbar expandable on demand via `⚙️ Tools`.
  - Extracted `.tablite-topbar` styles out of `.tablite-codeblock-embed` so they apply universally with 100% fidelity to the screenshot.

---

## 2. Technical Architecture & Constraints
- **Zero Regressions for Embedded View**:
  - Embedded codeblocks retain their exact styling and layout.
- **Full View Responsive Flex Layout**:
  - In full page tab view, `.tablite-topbar` occupies full width at the top, `.tablite-container` manages vertical flex layout, and `.tablite-table-container` flexibly fills the remaining viewport.
- **Bundle Cap**:
  - Maintained `main.js` bundle size strictly below 5.0 MB Obsidian Sync limit (4.60 MB).

---

## 3. Implementation Plan & Target Files
| File | Status | Description |
| :--- | :---: | :--- |
| `docs/brief-csv-page-header-style.md` | ✅ | Master brief (Status 0 -> 1) |
| `src/features/sqlseal/components/App.tsx` | ✅ | Render topbar universally for both page & embedded views |
| `src/styles/csvCodeblock.scss` | ✅ | Universal `.tablite-topbar` styles for page & embed |
| `src/styles/main.scss` | ✅ | Ensure `.tablite-container` vertical flex layout |

---

## 4. Acceptance Criteria Checklist
- [x] Status 0 brief created and committed
- [x] Topbar renders in full page tab view (`CsvView`) matching the embedded codeblock header
- [x] Title `📊 CSV Table` and dynamic row/column badge render properly
- [x] Header Mode segmented control (`⚡ Simple`, `🛠 Advance`, `🔢 Simple + Calc`) works seamlessly in page view
- [x] Quick buttons `[📋 Copy]`, `[🔀 Raw]`, and `[⚙️ Tools ▼]` work as expected
- [x] `⚙️ Tools ▼` expands/collapses the full Toolbar cleanly
- [x] Production build succeeds with bundle size < 5.0 MB
- [x] Status 1 brief updated and committed

