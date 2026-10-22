# 📌 Master Brief: `panel-tree` Contextual Badges (`+File` / `+Folder`) & Root Adder Standard

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Rule Reference**: Rule #006 & Direct Folder Action Standard  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-22  

---

## 1. Objective & Problem Statement

### The Problem
Previously, in `panel-tree` Live Preview, attempting to add new items by appending virtual lines (`└── + add item...`) below folders caused a severe visual defect:
- When a folder was deeply nested (e.g. `data` → `asset` → `player` → `asd`), all 4 parent folders ended at the exact same leaf line.
- This produced a chaotic **"Staircase Cascade"** of 4+ stacked `└── + add item...` lines at the bottom of the tree, cluttering the codeblock and creating complete ambiguity over which button belonged to which folder.

### The Solution: Contextual Badges (`+File` & `+Folder`) Exactly Beside Folder Name + Zero Footer
Instead of inserting cascading virtual lines or footer bars:
1. **On Each Folder Row (Root & Sub-folders)**:
   - Every folder displays two contextual action badges placed **EXACTLY beside the folder name**:
     - `[+File]`: Directly inserts a new file into this folder.
     - `[+Folder]`: Directly inserts a new sub-folder into this folder.
2. **Zero Footer**:
   - As specifically instructed ("okre remofe footer"), footer bars and staircase prompts are 100% eliminated.
3. **Interactive Branch Symbols & Chevrons**:
   - Authentic branch rails (`├── `, `└── `, `│   `) are visually rendered.
   - Folders display an interactive chevron (`v ` when expanded, `> ` when collapsed) that toggles folding of all descendant lines.

---

## 2. Visual Layout & Interaction Specification

### A. Visual Representation

```text
```panel-tree
v data [+File] [+Folder]
├── v asset [+File] [+Folder]
│   ├── v player [+File] [+Folder]
│   │   ├── yolla.webp
│   │   └── tisya.webp
│   ├── v matches [+File] [+Folder]
│   │   └── poster-m01.webp
│   ├── v news [+File] [+Folder]
│   │   ├── match-win-popsivo.webp
│   │   └── v content [+File] [+Folder]
│   │       ├── pln-libas-popsivo-3-1.md
│   │       └── pemain-asing-baru-tiba.md
│   ├── v mitra [+File] [+Folder]
│   │   ├── pln.webp
│   │   └── mizuno.webp
│   ├── v gallery [+File] [+Folder]
│   │   ├── match-celebration-1.webp
│   │   └── monster-block-action.webp
│   └── v berkas [+File] [+Folder]
│       ├── regulasi-proliga-2026.pdf
│       └── press-kit-jepln-2026.pdf
├── player.csv
├── matches.csv
├── news.csv
├── mitra.csv
├── gallery.csv
├── berkas.csv
└── index.json
```
```

### B. Badge Styling & Behavior
- **Default State**:
  - Badges render inline at the end of the folder name with subtle muted styling (`opacity: 0.5` or appear on line hover).
- **Hover State**:
  - When the user hovers over a folder row, the `[+File]` and `[+Folder]` badges highlight clearly:
    - `[+File]` badge: accent cyan/blue border & text (`border: 1px solid var(--text-accent); color: var(--text-accent);`).
    - `[+Folder]` badge: warm accent border & text (`border: 1px solid var(--text-warning, #e5a50a); color: var(--text-warning);`).
- **Click Interaction**:
  1. User clicks `[+File]` on `player`:
     - An inline input appears right next to `[+File]` or directly on a temporary line below `player`:
       `[ Name (e.g. avatar.webp) ]`
     - User types `avatar.webp` and presses **Enter**.
     - An atomic CodeMirror transaction dispatches:
       Inserts `\t\t\tavatar.webp\n` right after the last child of `player`.
       Cursor focuses on the new item.
       Native `Ctrl + Z` undo works immediately.
  2. User clicks `[+Folder]` on `player`:
     - An inline input appears:
       `[ Folder Name (e.g. icons) ]`
     - User types `icons` and presses **Enter**.
     - Inserts `\t\t\ticons\n` right after the last child of `player`.
  3. User presses **Escape** or clicks outside (blur):
     - Cancels cleanly with zero modification to the note.

---

## 3. Technical Architecture & Invariants

1. **100% Native CodeMirror 6 Lines**:
   - Every line remains a real `.cm-line.HyperMD-codeblock`.
   - No `cm-embed-block` widget replacement; zero `contenteditable="false"` blocking.
   - 100% native typing, multi-cursor, text selection, and overwriting.
2. **Badge Injection via ViewPlugin / DOM Extension**:
   - Badges are injected inside the folder's `.cm-line` with `user-select: none; pointer-events: auto;`.
   - Selecting text across the line ignores the badges.
3. **Atomic Editor Transactions**:
   - Uses `view.dispatch({ changes: ... })` to ensure instant synchronization and native undo/redo.
4. **Bundle Size Constraint**:
   - Must remain strictly under the 5.00 MB Obsidian Sync cap (currently 4.63 MB).

---

## 4. Implementation Roadmap

| Step | Task | Description | Status |
| :---: | :--- | :--- | :---: |
| 1 | **Master Brief** | Create & align brief in `panel/docs/brief-panel-tree-add-item-uiux.md` | ✅ Done |
| 2 | **Remove Footer/Staircase** | Completely strip footer bars and stacked prompt loops ("okre remofe footer") | ✅ Done |
| 3 | **Branch Symbols & Chevrons** | Render authentic branch rails (`├── `, `└── `, `│   `) and interactive `v `/`> ` chevrons | ✅ Done |
| 4 | **Beside Badges** | Render `[+File]` and `[+Folder]` badges exactly beside folder name | ✅ Done |
| 5 | **Inline Input Handlers** | Interactive file/folder adder with atomic CodeMirror transactions on Enter/Esc | ✅ Done |
| 6 | **Build & Verify** | Run `npm --prefix panel run build`, verify 0 errors & < 5.0 MB bundle | ✅ Done |

---

## 5. Acceptance Criteria Checklist

- [x] Brief updated at `panel/docs/brief-panel-tree-add-item-uiux.md` with status 0
- [x] No git commit executed until user explicitly approves
- [x] Staircase cascade and footer completely removed (zero footer rule)
- [x] Branch symbols (`├── `, `└── `, `│   `) rendered accurately per tree hierarchy
- [x] Interactive folder chevrons (`v ` / `> `) toggle folder collapse/expand smoothly
- [x] Each folder row displays `[+File]` and `[+Folder]` badges exactly beside the folder text
- [x] Clicking `[+File]` opens inline input and inserts child file with proper tab indentation on Enter
- [x] Clicking `[+Folder]` opens inline input and inserts child folder on Enter
- [x] Esc / blur cleanly cancels without modifying the note
- [x] Ghost `add item` lines filtered and hidden
- [x] Native typing, text selection, and overwrite remain 100% unblocked
- [x] TypeScript build passes with bundle size < 5.0 MB (4.64 MB)
