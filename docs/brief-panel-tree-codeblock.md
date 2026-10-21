# 📌 Master Brief: `panel-tree` Codeblock Renderer (Pure Monospace Codeblock + Floating GUI Overlay Layer)

> **Feature Status**: `0` (Draft / Pending Pure Codeblock Re-Architecture)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-21  

---

## 1. Problem & Root Cause of Table-Alike Look
- **Root Cause**: Previous revisions still relied on a CSS Grid layout with individual cell containers (`.pakcli-tree-cell`) for every column on every row. Even when rows had no `#` comments, empty metadata cells were rendered on the right with vertical right-borders, creating visible spreadsheet-like cell grids and horizontal dividers.
- **Goal (Zero Table Structure)**: Eradicate all cell divs and table/grid structures. Re-architect as a **Pure Codeblock with Floating GUI Overlay Layer**:
  1. **Base Layer (Codeblock)**: Genuine `<pre><code>` text block where each row is a single, continuous `.pakcli-codeblock-line`. Zero horizontal borders. Rows without comments have no empty cell divs on the right.
  2. **Overlay Layer (GUI Controls)**: Independent floating top ruler for column controls (`::`, `<`, `>`, `+`, `-`) and vertical draggable guideline wires (`position: absolute`) that adjust the maximum distance / space padding before `#` comments.
  3. **Whole-Row Hover Highlight**: Hovering anywhere on a row highlights the entire line seamlessly across the codeblock like a modern code editor line highlight.

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
