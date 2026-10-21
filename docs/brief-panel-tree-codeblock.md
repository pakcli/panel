# 📌 Master Brief: `panel-tree` Codeblock Renderer (Tree-Grid, ASCII L-Branching, Live In-Place Editing, Draggable Columns & Sticky Headers)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-21  

---

## 1. Objective & Problem Statement
- **Problem**: Documenting directory manifests in Obsidian previously resulted in ragged text representations. Comments tagged with `#` were misaligned, parent folder context was lost on scroll, and UI renderers were often either too bloated ("fancy smansy") or read-only without inline editing.
- **Solution**: Implemented `panel-tree` codeblock processor with:
  1. **Extension-based Rule**:
     - Items with file extension (`.json`, `.csv`, `.webp`, `.md`, `.js`, `.html`, `.css`, etc.) or known dotfiles (`.env`, `.gitignore`) are rendered as **Row Items (File Nodes)**.
     - Items without extension (`data`, `src`, `modules`, `menu`) or with trailing slash (`player/`) are rendered as **Directory Columns / Container Headers**.
  2. **Authentic Monospace ASCII Branching (`├── `, `└── `) & Chevron Fold (`v ` / `> `)**:
     - In **Source Mode**: Users write pure plain indentation (tabs/spaces) without manual branch characters.
     - In **Rendered View**: Dynamically renders authentic monospace ASCII guide branches (`├── `, `└── `, `│   `).
     - Fold indicators use minimalist chevron `v ` when open and `> ` when closed.
     - 100% naturally selectable text across all lines.
  3. **Natural Codeblock Typing UX (Click-to-Type & Keyboard Navigation)**:
     - Single click on any cell (Column 0 or `#` comments) to immediately begin typing.
     - `Enter`: In Column 0, inserts a new sibling row below and focuses it; in comment columns, moves down to the next row.
     - `Shift + Enter`: Moves cursor to the cell in the row above.
     - `Tab`: In Column 0, indents the item to become a child of the previous sibling; in comment columns, shifts to the next column.
     - `Shift + Tab`: In Column 0, unindents the item to the parent level; in comment columns, shifts to the previous column.
     - `ArrowDown` / `ArrowUp`: Navigates up and down rows in the same column.
     - `Backspace` on empty line: Deletes the line and returns focus to the line above.
     - All edits immediately sync directly to the active note's raw markdown codeblock.
  4. **Multi-Column Alignment via `space + #` (Max 10 Columns)**:
     - Each occurrence of `space + #` creates a column (`#note1 #note2 ...`).
     - Automatically aligns all `#` comments into clean vertical lines (`clean # sejajar on that one line`).
  5. **Header Column Controls (`::`, `<`, `>`, `+`, `-`)**:
     - `::` drag handle for drag-and-drop column reordering.
     - `<` and `>` buttons for quick one-click column shifting.
     - `+` button to add or duplicate column.
     - `-` button to delete the column across all rows and sync to note.
  6. **Zero Horizontal Cell Lines & Full-Row Hover Highlight**:
     - 0% spreadsheet borders: all horizontal row lines (`border-bottom`) eliminated so text flows naturally as a genuine codeblock.
     - Single continuous vertical column guideline separating columns, with no outer border on the far right.
     - Full-row hover highlight: hovering anywhere on a line highlights the entire row from left to right as a unified rounded block (`var(--background-modifier-hover)`).
  7. **Column Handle & Live Source Codeblock Spacing Sync**:
     - The vertical column handle `│` in rendered view lets the user drag to adjust spacing.
     - Minimum Column 0 width is strictly bounded by the character width of the longest tree line (`minmimal size = chart character of the whole tree line`).
     - Releasing drag (`mouseup`) or double-clicking to auto-fit **immediately updates the source codeblock in the active markdown note** by padding spaces before `#`.
     - **No pipe `|` symbols** are written to the markdown file; only aligned spaces.
  8. **Cascading Sticky Headers (`t -> h1 -> h2 -> h3`)**:
     - Visual sticky hierarchy where parent directory headers remain pinned at the top as the user scrolls down through nested children.
  9. **Toggleable Folders**:
     - Expand/collapse chevrons on each folder node.
  10. **Custom & Multiple Aliases in Settings**:
     - Codeblock tag renamable in settings (comma-separated).
     - Default: `panel-tree, panel-tree-structure, tree-structure`.

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
