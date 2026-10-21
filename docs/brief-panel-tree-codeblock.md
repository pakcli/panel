# 📌 Master Brief: `panel-tree` Codeblock Renderer (Authentic Unreplaced Codeblock + Floating GUI Overlay Layer)

> **Feature Status**: `0` (Draft / Pending Authentic Codeblock + Floating Overlay Implementation)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-21  

---

## 1. Core Paradigm: "Do Not Overwrite the DOM"
- **User Instruction**:
  > *"make sure instead overwrite the dom leave its as is + offset for the notes## and line before it, and floating overlaygui on top of the layer of the codeblock asli"*
  > 1. **Codeblock asli unreplaced**: The codeblock text remains in its native `<pre><code>` container. No custom cell containers or HTML tables.
  > 2. **Offset bagian `#note##` saja**: The `#note` comments are shifted using an inline spacer/offset based on the column width.
  > 3. **Floating GUI (+1 layer above)**: An independent overlay layer (`z-index: 10`) floating over the native codeblock containing the top column rulers and vertical guideline handles.

---

## 2. Structural Layer Diagram

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [LAYER 2: FLOATING OVERLAY GUI (+1 Layer Above, z-index: 10, Absolute Position)]                       │
│ <--------- PATH ---------> │ <------------ # ------------> │ <----------- ## ----------->  +           │
│                            │   ::   <   >   #   +   -      │   ::   <   >   ##   +   -               │
└────────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┘
                             │ (Guideline Wire Overlay)      │ (Guideline Wire Overlay)
                             │                               │
┌────────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┐
│ [LAYER 1: NATIVE CODEBLOCK ASLI (Unreplaced <pre><code>, Native Text)]                                 │
│                                                                                                        │
│ v data                                                                                                 │
│ ├── v asset                │ [offset] # note1              │ [offset] ## note2                         │
│ │   ├── v player           │                               │                                           │
│ │   │   ├── yolla.webp     │ [offset] # setter             │                                           │
│ │   │   └── tisya.webp     │                               │                                           │
│ │   ├── v matches          │                               │                                           │
│ │   │   └── poster-m01.webp│                               │                                           │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Specification

### 1. Layer 1: Codeblock Asli (Unreplaced)
- Uses authentic Obsidian `<pre><code>` codeblock structure without destroying or replacing it with grid cells.
- Text content is rendered line-by-line:
  - Tree branch & name: `v data`, `├── v asset`, `│   ├── v player`.
  - Fold indicators `v ` and `> ` are minimalist interactive inline markers.
  - `#note` offset: A single dynamic spacer (`display: inline-block; width: ...px` or text space padding) offsets the `#note` comment so it aligns perfectly with the column guideline.
  - If a line has no comment, **nothing is added**: the line simply ends at the file/folder name. Zero empty cell boxes.
  - Zero horizontal lines between lines (`border-bottom: none !important`).
  - Hovering a line highlights the entire row smoothly (`background: var(--background-modifier-hover)`).

### 2. Layer 2: Floating Overlay GUI (+1 Layer Above)
- Positioned as a floating layer (`position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 10`).
- **Floating Top Ruler Bar**:
  - Pinned at the top of the codeblock.
  - Column 0: `PATH` and `+` (add `#` column).
  - Column 1..N: `::` (drag to reorder), `<` and `>` (shift column left/right), `#` (column title), `+` (add/duplicate), `-` (delete column).
  - Buttons and drag handles have `pointer-events: auto`.
- **Vertical Guideline Wires**:
  - Vertical guideline lines (`.pakcli-col-guideline`) drop down directly over the column boundary offsets.
  - `pointer-events: auto; cursor: col-resize;`.
  - Dragging the guideline dynamically adjusts the `#note` offset width in real time.
  - On mouseup: updates the codeblock markdown source by padding spaces before `#`.
  - Double-clicking the guideline auto-fits the column width to the longest text.



---

## 2. Architecture: Pure Codeblock + Overlay GUI Layer

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [OVERLAY LAYER: Floating Top Column Ruler]                                                             │
│ <--------- PATH ---------> │ <------------ # ------------> │ <----------- ## ----------->  +           │
│                            │   ::   <   >   #   +   -      │   ::   <   >   ##   +   -               │
└────────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┘
                             │ (Draggable Guideline Overlay) │ (Draggable Guideline Overlay)
┌────────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┐
│ [BASE LAYER: Pure Codeblock Lines - NO GRID CELLS, NO HORIZONTAL LINES, NO EMPTY RIGHT BOXES]          │
│                                                                                                        │
│ v data                                                                                                 │
│ ├── v asset                │ # asdasdasdasdasd             │ ## 2                                      │
│ │   ├── v player                                                                                       │
│ │   │   ├── yolla.webp                                                                                 │
│ │   │   └── tisya.webp                                                                                 │
│ │   ├── v matches                                                                                      │
│ │   │   └── poster-m01.webp                                                                            │
│ │   └── v news                                                                                         │
│ │       └── match-win.webp                                                                             │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Differences from Previous Attempt:
1. **No CSS Grid for the Body**:
   - Rows are not broken down into multiple cell divs (`.pakcli-tree-cell`).
   - Each row is a single container (`<div class="pakcli-codeblock-line">`).
   - If a line has no comment, its DOM contains ONLY the tree branch and item name:
     `├── v player`
     There are NO empty `<div>`s sitting to the right!
2. **Zero Horizontal Lines**:
   - Absolutely no `border-bottom` or horizontal divider lines between lines.
3. **Floating Guideline Overlay**:
   - The vertical column separator lines (`│`) are independent overlay elements (`position: absolute; top: 0; bottom: 0; width: 1px; left: ...px; pointer-events: auto; cursor: col-resize;`).
   - Dragging the guideline changes the padding offset of `#` in the markdown source.
4. **Natural Text Codeblock Flow & Whole-Row Hover**:
   - Monospace font and background match Obsidian's codeblocks.
   - Hovering over any line triggers a clean, subtle full-row background highlight (`var(--background-modifier-hover)`).
5. **Interactive Controls Preserved in Overlay**:
   - Chevron toggle (`v ` / `> `) directly on folder items.
   - Click-to-type inline editing on names and comments.
   - Keyboard navigation (`Enter`, `Shift+Enter`, `Tab`, `Shift+Tab`, `ArrowUp`, `ArrowDown`).
   - Header ruler with `::` drag reorder, `< >` shifting, `+` add/duplicate, and `-` delete column.

## 2. Technical Architecture & Constraints
- **Parser**: `treeParser.ts` converts tab/space-indented text lines with `#` column tokens into an AST (`TreeGridNode`), computes `getAsciiBranchPrefix`, and serializes back via `serializeTreeToSource`.
- **Renderer**: `TreeCodeblockRenderer.ts` (`MarkdownRenderChild`) builds DOM with CSS Grid, sticky positioning, resize drag listeners, toggle state, and in-place `syncChangesToNote()`.
- **Settings**: `panelTreeAliases: string` in plugin settings, default `'panel-tree, panel-tree-structure, tree-structure'`.

## 3. Implementation Plan & Files
| File | Status | Description |
| :--- | :---: | :--- |
| `panel/docs/brief-panel-tree-codeblock.md` | ✅ | Master brief (Status 1) |
| `panel/src/features/treeGrid/types.ts` | ✅ | AST node types, column definitions, and options |
| `panel/src/features/treeGrid/treeParser.ts` | ✅ | Indentation, ASCII L-branching resolver, and source serializer |
| `panel/src/features/treeGrid/TreeCodeblockRenderer.ts` | ✅ | Monospace DOM renderer with ASCII branches, live editing, and sticky scroll |
| `panel/src/features/treeGrid/index.ts` | ✅ | Module exports |
| `panel/src/styles/treeGrid.scss` | ✅ | Minimalist SCSS stylesheet for monospace branches, resizers, and editing focus |
| `panel/src/settings.ts` | ✅ | Settings interface and default value for `panelTreeAliases` |
| `panel/src/main.ts` | ✅ | Dynamic codeblock processor registration for all aliases |

## 4. Acceptance Criteria Checklist
- [x] Status 0 brief created and committed
- [x] Extension vs Column rule: with extension = file item, without extension = directory column
- [x] Monospace ASCII L-branching (`├── `, `└── `, `│   `) generated in view while source mode remains clean
- [x] In-place live editable cells with bi-directional sync to active note codeblock
- [x] Multi-column `#` alignment: clean grid alignment up to 10 columns
- [x] Cascading sticky headers (`h1 -> h2 -> h3`) pinned during scroll
- [x] Draggable column resizer handles with live width adjustment
- [x] Double-click column divider auto-fits column to widest content
- [x] Toggleable folder expansion/collapse and global toolbar
- [x] Configurable comma-separated codeblock aliases in settings
- [x] TypeScript compiles cleanly with 0 errors
- [x] Auto-deployed to Obsidian vault
- [x] Status 1 updated and committed
