# 📌 Master Brief: Interactive Aligned #Note Adder & Sticky Post-it Tree (panel-tree-cascading-sticky-note)

> **Feature Status**: `1` (Completed & Verified)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile (Live Preview & Reading View)  
> **Date**: 2026-10-23  

---

## 1. Objective & Problem Statement

### Problem
Users organize complex projects and taxonomies using `panel-tree`. Often, tree nodes need brief annotations, task descriptions, or context notes (e.g. `blender # untuk3d`, `photoshop # untuknote2d`). Currently:
1. **Misaligned Comments**: Adding `#` comments with variable node lengths leads to ragged, unaligned comments that look messy and degrade readability.
2. **Manual Formatting Overhead**: Users have to manually insert spaces or tabs to align `#` comments across multiple lines, which breaks as soon as a node name is renamed or a new item is added.
3. **No Interactive Note Action**: Adding a `#` comment requires manually editing the raw markdown text; there is no quick interactive button like `[+#Note]` alongside `[+File]` and `[+Folder]`.
4. **Lack of Sticky Post-it Context**: In deeply nested trees, when ancestor folders stick to the top during scrolling, their associated `#` notes are hidden, losing crucial contextual overview.

### Solution
Implement **`panel-tree-cascading-sticky-note`** (Aliases: `panel-tree-cascading-note-sticky`, `panel-tree-cascading-postit`, `panel-tree-postit-cascading`):
1. **Auto-Aligned `#` Column Architecture**: Automatically aligns `#` annotations across all tree nodes into a clean, uniform column ruler.
2. **Interactive `[+Note]` Quick Adder**: Beside `[+File]` and `[+Folder]`, provide a `[+Note]` badge to quickly add or edit the node's `#` note via an inline prompt.
3. **Post-it / Sticky Note Visual Tagging**: Elegantly renders `#` notes as subtle post-it pills or monospace annotations with custom themes (yellow sticky note, muted badge, or inline code style).
4. **Cascading Sticky Note Preservation**: Pinned cascading ancestor folders display their aligned notes/post-it tokens right in the sticky bar.

---

## 2. Technical Architecture & Visual Specifications

### 2.1 Aliases & Parser Support
Register the following codeblock language identifiers:
- `panel-tree-cascading-note-sticky`
- `panel-tree-cascading-sticky-note`
- `panel-tree-cascading-postit`
- `panel-tree-postit-cascading`

### 2.2 Plain-Text Source Format (Clean Monospace Markdown)
```text
```panel-tree-cascading-sticky-note
folder app
   blender                 # untuk3d
   photoshop               # untuknote2d
   namanamalainnya         # its aligned to all #
```
```

### 2.3 Interactive Visual Rendering & HUD
```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ```panel-tree-cascading-sticky-note                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ 📌 Sticky Cascading Stack (with Post-it Note)                                │
│ ├── 📁 app                         [+File] [+Folder] [+Note]  📌 Core Tools  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ├── 📄 blender                     [+Note]                    📌 untuk3d     │
│ ├── 📄 photoshop                   [+Note]                    📌 untuknote2d │
│ └── 📄 namanamalainnya             [+Note]                    📌 aligned note│
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 Auto-Alignment Engine
- **Ruler Calculation**:
  $$\text{targetCol0} = \max_{\text{node} \in \text{tree}}(\text{visualLength}(\text{node.name}) + \text{indentSpaces}) + 4$$
- When an inline note is added or edited, the serializer automatically pads spaces between the name and the `#` symbol to keep all `#` symbols strictly flush along the computed ruler column.

---

## 3. Implementation Plan & Target Files

| File | Status | Description |
| :--- | :---: | :--- |
| `src/features/treeGrid/treeParser.ts` | ✅ | Enhanced `extractNameAndColumns` with `(?<=\S)#` and implemented `alignTreeBlockNotes` column ruler |
| `src/features/treeGrid/cascading/types.ts` | ✅ | Added `treeCascadingShowNoteBadge` and `treeCascadingPostItTheme` |
| `src/features/treeGrid/cascading/TreeCascadingManager.ts` | ✅ | Rendered `[+Note]` / `[✎Note]` badge, inline note input editor, and sticky note post-it tags |
| `src/features/treeGrid/TreeLivePreviewPlugin.ts` | ✅ | Live Preview inline `[+Note]` adder for folders and files, and column-aligned post-it widgets |
| `src/styles/treeCascading.scss` | ✅ | Sleek post-it styling (sticky yellow, slate, pill tag options) and alignment rules |
| `src/settings.ts` | ✅ | Settings toggles for note badge visibility and post-it visual theme |

---

## 4. Acceptance Criteria Checklist

- [x] Status 0 brief created and committed in `panel/docs/`.
- [x] Codeblock aliases (`panel-tree-cascading-sticky-note`, etc.) registered and handled seamlessly.
- [x] Auto-aligns `#` comments across all nodes to a clean vertical column ruler.
- [x] Interactive `[+Note]` action badge allows 1-click addition and editing of node comments.
- [x] Cascading sticky bar preserves and displays active folder notes when scrolling.
- [x] Fully copy-pasteable as authentic plain-text tree markdown without breaking formatting.
- [x] Bundle size remains strictly $< 5.00\text{ MB}$ (4.66 MB).
- [x] Status 1 completion commit and deployment verification.
