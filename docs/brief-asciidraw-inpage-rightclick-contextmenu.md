# 📌 Master Brief: ASCII Studio In-Page Tab & Layer Right-Click Context Menus (pakcli-panel)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `panel/src/features/asciidraw`  
> **Platform**: Cross-platform (Desktop & Mobile)  
> **Date**: 2026-10-15  

---

## 1. Objective & Problem Statement

### A. Missing Right-Click on Layer Items ("In-Page Tabs")
- **Problem**: In the ASCII Studio sidebar and tab workspace, clicking or right-clicking on layer items (e.g. `Layer 1` tab/pill shown in user testing) does not open a context menu. Users expecting professional photo-editor workflow cannot right-click layers to rename, duplicate, hide, lock, clear, invert, or delete them.
- **Solution**: Bind Obsidian native `Menu` on `contextmenu` for each `.asciidraw-layer-item`, providing full layer actions:
  - ✏️ Rename Layer
  - 📋 Duplicate Layer
  - 👁 Toggle Visibility (Show/Hide)
  - 🔒 Toggle Lock (Lock/Unlock)
  - 🔄 Invert Layer Mask
  - 🎨 Apply Active Character to Layer
  - ⬆ Move Layer Up
  - ⬇ Move Layer Down
  - ⮛ Merge Down (if upper layer)
  - 🧹 Clear Layer Content
  - 🗑 Delete Layer

### B. Missing Right-Click on Canvas / Inner Viewport
- **Problem**: Right-clicking on the canvas in the in-page tab view does nothing or triggers default browser inspect.
- **Solution**: Add contextmenu to `.asciidraw-inner-viewport` / canvas grid:
  - 📏 Add Horizontal Guide Line (Row)
  - 📏 Add Vertical Guide Line (Col)
  - 🧹 Clear All Guides
  - 📐 Toggle Rulers
  - 📋 Copy ASCII Text to Clipboard
  - 💾 Save to Note
  - ⊡ Fit Viewport (Ctrl+0)
  - 1:1 Actual Size (Ctrl+1)

### C. Missing Obsidian Tab Pane Menu
- **Problem**: Right-clicking on the Obsidian tab header in tab view does not expose custom ASCII Studio quick actions.
- **Solution**: Implement `onPaneMenu` in `AsciiStudioView` with Save, Fit, and Export options.

---

## 2. Technical Architecture & Constraints
- **Obsidian Native Synergy**:
  - Uses Obsidian's native `Menu` class (`obsidian.Menu`) for seamless UX, consistent styling, keyboard navigation, and theme compatibility.
- **Zero Performance Overhead**:
  - Event delegation or direct listener per layer item (typically 1-10 layers total), 0 ms runtime penalty.

---

## 3. Implementation Plan & Files
| File | Status | Description |
| :--- | :---: | :--- |
| `docs/brief-asciidraw-inpage-rightclick-contextmenu.md` | ⏳ | Master feature brief (Status 0 -> 1) |
| `src/features/asciidraw/ui/AsciiStudioWorkspace.ts` | ⏳ | Layer item contextmenu and canvas viewport contextmenu |
| `src/features/asciidraw/ui/AsciiStudioView.ts` | ⏳ | Tab pane header `onPaneMenu` handler |

---

## 4. Acceptance Criteria Checklist
- [ ] Status 0 brief created and committed
- [ ] Right-clicking on layer item (`Layer 1` tab) displays full layer operations context menu
- [ ] Right-clicking on canvas viewport displays canvas and guide operations context menu
- [ ] Tab pane header exposes ASCII Studio actions via `onPaneMenu`
- [ ] Build passes with bundle size < 5.0 MB
- [ ] Status 1 brief updated and committed
