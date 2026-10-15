# 📌 Master Brief: ASCII Studio Precision Rulers, 60 FPS Lightweight Drawing & Workspace Tab View (pakcli-panel)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `panel/src/features/asciidraw`  
> **Platform**: Cross-platform (Desktop & Mobile)  
> **Date**: 2026-10-15  

---

## 1. Objective & Problem Statement
- **Problem 1 (Rulers Look Awful & Unreadable)**:
  - On large grids (e.g. `W: 600`, `H: 20`) or small zoom levels (e.g. `37%`), rulers generate hundreds of DOM elements and apply `scaleX(zoomScale)`, distorting numbers into illegible squished blurs.
  - Ticks are hardcoded to every 5 columns, causing dense overlapping numbers (e.g., `180, 185, 190` colliding into a solid black smudge).
- **Problem 2 (Sluggish Drawing Performance - "Slow af")**:
  - `renderCanvas()` completely destroys and re-creates the entire DOM grid (e.g. 12,000 `<span>` elements for 600×20) on every single `pointermove` event.
  - Moving the mouse at 120Hz creates/destroys over 1 million DOM nodes/sec, freezing the browser thread and dropping framerates to 1–2 FPS.
- **Problem 3 (Workspace Tab Page Embedding & Fullscreen)**:
  - ASCII Studio is currently confined to a popup modal or embedded codeblock.
  - Users need ASCII Studio to open as a dedicated native Obsidian Tab View (`ItemView`) that can be split side-by-side with notes or docked, alongside seamless fullscreen toggle.

---

## 2. Technical Architecture & Constraints
- **Adaptive Canvas Rulers**:
  - Replaced DOM-based tick track with high-DPI HTML5 `<canvas>` elements (`devicePixelRatio` aware).
  - Dynamically adjust major/minor tick intervals based on column pixel density (intervals adapt between 5, 10, 25, 50, and 100 columns so labels never collide).
  - Precision cursor tracking badge indicator showing current column and row cleanly.
- **Lightweight 60 FPS Direct-Cell DOM Mutation**:
  - Pre-allocate a persistent 2D matrix of cell spans (`HTMLSpanElement[][]`).
  - Drawing mutations (`pencil`, `eraser`, `typing`) update only the specific changed text nodes directly (`cellSpan.textContent = char`), bypassing full DOM reconstruction.
  - Queue changes during drag strokes with `requestAnimationFrame` batching.
- **Native Obsidian Tab View (`AsciiStudioView`)**:
  - Registered `ASCII_STUDIO_VIEW_TYPE = 'asciidraw-studio-view'` extending `ItemView`.
  - Provided commands (`ASCII Studio: Open Drawing Studio in New Tab`), ribbon icon, and header buttons to open/dock ASCII drawings in workspace tabs.
  - Supported full note codeblock round-trip synchronization.

---

## 3. Implementation Plan & Files
| File | Status | Description |
| :--- | :---: | :--- |
| `docs/brief-asciidraw-ruler-performance-tab-view.md` | ✅ | Master feature brief |
| `src/features/asciidraw/ui/AsciiRulerCanvas.ts` | ✅ | Crisp high-DPI canvas ruler with adaptive intervals |
| `src/features/asciidraw/ui/AsciiStudioWorkspace.ts` | ✅ | Shared workspace engine with 60 FPS direct-cell drawing & rulers |
| `src/features/asciidraw/ui/AsciiDrawModal.ts` | ✅ | Refactored modal delegating to workspace engine |
| `src/features/asciidraw/ui/AsciiStudioView.ts` | ✅ | Dedicated Obsidian ItemView for Tab page embedding |
| `src/features/asciidraw/ui/AsciiCodeblockRenderer.ts` | ✅ | Lightweight cell updates & "Open in Tab" button |
| `src/features/asciidraw/index.ts` | ✅ | Registration of Tab view, commands, and ribbon integration |
| `src/styles/asciidraw.scss` | ✅ | High-DPI ruler styles, tab view styles, fullscreen styles |

---

## 4. Acceptance Criteria Checklist
- [x] Status 0 brief created and committed
- [x] Adaptive canvas rulers render crisp numbers with no overlapping at any zoom or width
- [x] Drawing runs at 60 FPS with direct-cell DOM updates on large canvases (600×20+)
- [x] Dedicated Tab View (`AsciiStudioView`) opens and edits drawings in Obsidian workspace tabs
- [x] Codeblock renderer includes "Open in Tab" action
- [x] Production build passes with bundle size strictly < 5.0 MB (4.59 MB)
- [x] Status 1 brief updated and committed
