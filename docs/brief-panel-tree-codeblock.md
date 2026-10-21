# 📌 Master Brief: `panel-tree` Codeblock Renderer (Tree-Grid, Draggable Columns, Cascading Sticky Headers)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-21  

---

## 1. Objective & Problem Statement
- **Problem**: Documenting complex software structures, project trees, and directory manifests (like the volleyball site manifest with `data`, `src`, `dist`, CSV databases, and WebP media) in Obsidian currently results in ragged text representations. Comments tagged with `#` are misaligned across lines, parent folder context is lost when scrolling long lists, and column widths cannot be dynamically adjusted.
- **Solution**: Implement the `panel-tree` codeblock processor with:
  1. **Extension-based Rule**:
     - Items with file extension (`.json`, `.csv`, `.webp`, `.md`, `.js`, `.html`, `.css`, etc.) or known dotfiles (`.env`, `.gitignore`) are rendered as **Row Items (File Nodes)**.
     - Items without extension (`data`, `src`, `modules`, `menu`) or with trailing slash (`player/`) are rendered as **Directory Columns / Container Headers**.
  2. **Multi-Column `#` Alignment (Max 10 Columns)**:
     - Parses `# col1`, `## col2`, `### col3` up to `########## col10`.
     - Automatically aligns all columns into a clean, horizontal grid (`clean # sejajar on that one line`).
  3. **Cascading Sticky Headers (`t -> h1 -> h2 -> h3`)**:
     - Visual sticky hierarchy where parent directory headers remain pinned at the top as the user scrolls down through nested children.
  4. **Draggable Column Resizing & Double-Click Auto-Fit**:
     - Draggable divider handles between columns allowing live resizing.
     - Double-clicking any column divider auto-fits the column width to its widest cell content (with minimum width safeguard).
  5. **Toggleable Folders**:
     - Expand/collapse chevrons on each folder node.
     - Global Expand All / Collapse All controls.
  6. **Custom & Multiple Aliases in Settings**:
     - Codeblock tag renamable in settings (comma-separated).
     - Default: `panel-tree, panel-tree-structure, tree-structure`.

## 2. Technical Architecture & Constraints
- **Parser**: `treeParser.ts` converts tab/space-indented text lines with `#` column tokens into an AST (`TreeGridNode`).
- **Renderer**: `TreeCodeblockRenderer.ts` (`MarkdownRenderChild`) builds DOM with CSS Grid, sticky positioning, resize drag listeners, and toggle state.
- **Settings**: `panelTreeAliases: string` in plugin settings, default `'panel-tree, panel-tree-structure, tree-structure'`.

## 3. Implementation Plan & Files
| File | Status | Description |
| :--- | :---: | :--- |
| `panel/docs/brief-panel-tree-codeblock.md` | ⏳ | Master brief (Status 0 / Status 1) |
| `panel/src/features/treeGrid/types.ts` | ⏳ | AST node types, column definitions, and options |
| `panel/src/features/treeGrid/treeParser.ts` | ⏳ | Indentation and multi-column `#` parser |
| `panel/src/features/treeGrid/TreeCodeblockRenderer.ts` | ⏳ | Interactive DOM renderer with sticky scroll & draggable resizers |
| `panel/src/features/treeGrid/index.ts` | ⏳ | Module exports |
| `panel/src/styles/treeGrid.scss` | ⏳ | SCSS stylesheet for cascading sticky, grid, and resizer handles |
| `panel/src/settings.ts` | ⏳ | Settings interface and default value for `panelTreeAliases` |
| `panel/src/main.ts` | ⏳ | Dynamic codeblock processor registration for all aliases |

## 4. Acceptance Criteria Checklist
- [x] Status 0 brief created and committed
- [ ] Extension vs Column rule: with extension = file item, without extension = directory column
- [ ] Multi-column `#` alignment: clean grid alignment up to 10 columns
- [ ] Cascading sticky headers (`h1 -> h2 -> h3`) pinned during scroll
- [ ] Draggable column resizer handles with live width adjustment
- [ ] Double-click column divider auto-fits column to widest content
- [ ] Toggleable folder expansion/collapse and global toolbar
- [ ] Configurable comma-separated codeblock aliases in settings
- [ ] TypeScript compiles cleanly with 0 errors
- [ ] Auto-deployed to Obsidian vault
- [ ] Status 1 updated and committed
