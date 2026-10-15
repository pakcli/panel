# 📌 Master Brief: ASCII Studio Theme-Adaptive Rulers & Professional Guide Lines (pakcli-panel)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `panel/src/features/asciidraw`  
> **Platform**: Cross-platform (Desktop & Mobile)  
> **Date**: 2026-10-15  

---

## 1. Objective & Problem Statement

### A. Dark / Jarring Ruler Contrast on Light Themes
- **Problem**: The ruler canvas was hardcoded to a dark `#1e1e22` background. When users use a warm, light, or solarized theme (such as the khaki/cream palette shown in user testing), the rulers appear as pitch-black jarring bars that clash with the rest of the workspace and make ticks hard to read.
- **Solution**: Dynamically resolve theme colors directly from Obsidian's active computed CSS variables (`--background-secondary`, `--text-normal`, `--text-muted`, `--background-modifier-border`, and `--interactive-accent`). The ruler will automatically match light and dark themes seamlessly.

### B. Professional-Grade Ruler Guide Lines (Drag-to-Create Guides)
- **Problem**: Users need precise alignment reference lines across the canvas (identical to professional-grade photo editors and vector layout tools), but currently cannot pull guide lines from rulers.
- **Solution**:
  1. **Drag from Top Ruler**: Clicking and dragging down from the top horizontal ruler pulls out a dynamic **Horizontal Guide Line** across the entire canvas.
  2. **Drag from Left Ruler**: Clicking and dragging right from the left vertical ruler pulls out a dynamic **Vertical Guide Line** across the entire canvas.
  3. **Live Coordinate Tooltip**: While dragging, a floating HUD shows the exact column or row index (e.g. `X: 45 col` / `Y: 12 row`).
  4. **Interactive Reposition & Delete**: Guides can be hovered and dragged to move. Dragging a guide back into its originating ruler or right-clicking deletes it.
  5. **Guide Overlay Layer**: High-visibility cyan/accent dashed guide lines that scale smoothly with zoom and pan without interfering with cell selection.
  6. **Toggle Guides**: Quick button or shortcut (`Ctrl + ;` or toolbar toggle) to show/hide and lock guides.

---

## 2. Technical Architecture & Constraints
- **Theme-Adaptive Palette Engine**:
  - `AsciiRulerCanvas` reads computed colors from `getComputedStyle(containerEl)` or active `THEME_PALETTES`.
  - Contrast checker ensures tick lines and numeric text maintain optimal WCAG contrast ratio against the ruler background.
- **Guide Line Data Model**:
  - `guides: { horizontal: number[]; vertical: number[] }` stored in workspace state.
  - Rendered on a dedicated non-blocking SVG/canvas overlay layer inside `canvasTransformEl`.
- **Zero-Config Synergy**:
  - Automatically adheres to Obsidian's active light/dark mode and vault theme.

---

## 3. Implementation Plan & Files
| File | Status | Description |
| :--- | :---: | :--- |
| `docs/brief-asciidraw-ruler-theme-guides.md` | ✅ | Master feature brief |
| `src/features/asciidraw/ui/AsciiRulerCanvas.ts` | ✅ | Theme-adaptive colors, crisp contrast, ruler drag-start triggers |
| `src/features/asciidraw/ui/AsciiStudioWorkspace.ts` | ✅ | Guide line creation, dragging, repositioning, and HUD overlay |
| `src/styles/asciidraw.scss` | ✅ | Guide lines CSS, HUD tooltip styling, ruler theme styling |

---

## 4. Acceptance Criteria Checklist
- [x] Status 0 brief created and committed
- [x] Ruler background and text automatically adapt to light/warm/dark themes with crisp contrast
- [x] Dragging from top ruler creates a horizontal guide line with live coordinate HUD
- [x] Dragging from left ruler creates a vertical guide line with live coordinate HUD
- [x] Existing guide lines can be dragged, moved, or deleted
- [x] Guide lines scale seamlessly with zoom and pan
- [x] Production build passes with bundle size strictly < 5.0 MB (verified at 4.59 MB)
- [x] Status 1 brief updated and committed
