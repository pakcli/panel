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
  2. **Minimalist ASCII L-Branching (No Bloat in Source Mode)**:
     - In **Source Mode**: Users write pure plain indentation (tabs/spaces) without manual branch characters.
     - In **Rendered View**: Dynamically renders authentic monospace ASCII guide branches (`├── `, `└── `, `│   `) with clean pixel alignment.
  3. **In-Place Live Editable**:
     - Double-click any cell (file/folder name or `#` metadata columns) to edit in-place.
     - Pressing Enter or clicking outside saves changes directly back to the active note's raw codeblock via Obsidian Vault API.
  4. **Multi-Column `#` Alignment (Max 10 Columns)**:
     - Parses `# col1`, `## col2`, `### col3` up to `########## col10`.
     - Automatically aligns all columns into a clean, horizontal grid (`clean # sejajar on that one line`).
  5. **Cascading Sticky Headers (`t -> h1 -> h2 -> h3`)**:
     - Visual sticky hierarchy where parent directory headers remain pinned at the top as the user scrolls down through nested children.
  6. **Draggable Column Resizing & Double-Click Auto-Fit**:
     - Draggable divider handles between columns allowing live resizing.
     - Double-clicking any column divider auto-fits the column width to its widest cell content (with minimum width safeguard).
  7. **Toggleable Folders**:
     - Expand/collapse chevrons on each folder node.
     - Global Expand All / Collapse All controls.
  8. **Custom & Multiple Aliases in Settings**:
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
