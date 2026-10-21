# 📌 Master Brief: `panel-tree` Codeblock Renderer (Codeblock Asli Unreplaced + Extra GUI Overlay)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-21  

---

## 1. Core Paradigm: "Do Not Overwrite the DOM"
- **User Direct Instructions**:
  > *"brooo do not overwrite the dom :DDDDDD. its clearly u overwire the dom. make sure insted ovewire the dom leave its as is + offset for the notes## and line before it, and floating overlaygui ontop of the layer of thecodeblock asli"*  
  > 1. **Codeblock asli unreplaced**: The text remains in its native `<pre><code>` codeblock. Zero HTML table elements, zero CSS grid cells.
  > 2. **Offset bagian `#note##` saja**: Only the `#note` comment portion is pushed by an offset spacer matching the column width.
  > 3. **The GUI floating +1 layer above the codeblock**: All visual ornaments (**chevron fold `v ` / `> `**, **baris pohon `├── `, `└── `, `│`**, **column ruler**, and **draggable guideline wires**) live on the **Extra GUI Layer**!

---

## 2. Structural Layer Diagram

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [LAYER 2: EXTRA GUI OVERLAY (+1 Layer Above, z-index: 10, Absolute Position)]                          │
│                                                                                                        │
│   [Header Ruler] <--- PATH ---> │ <--------- # ---------> │ <-------- ## -------->  +                  │
│                                 │   ::  <  >  #  +  -     │   ::  <  >  ##  +  -                       │
│                                                                                                        │
│   [v Chevron]                   │ (Guideline Wire)        │ (Guideline Wire)                           │
│   [├── Branch] [v Chevron]      │                         │                                            │
│   [│   ├── Branch] [v Chevron]  │                         │                                            │
│   [│   │   ├── Branch]          │                         │                                            │
│   [│   │   └── Branch]          │                         │                                            │
└─────────────────────────────────┼─────────────────────────┼────────────────────────────────────────────┘
                                  │                         │
┌─────────────────────────────────┼─────────────────────────┼────────────────────────────────────────────┐
│ [LAYER 1: CODEBLOCK ASLI UNREPLACED (<pre><code> Murni, Teks Monospace Asli)]                          │
│                                                                                                        │
│ data                                                                                                   │
│   asset                         │ [offset] # note1        │ [offset] ## note2                          │
│     player                      │                         │                                            │
│       yolla.webp                │ [offset] # setter       │                                            │
│       tisya.webp                │                         │                                            │
│     matches                     │                         │                                            │
│       poster-m01.webp           │                         │                                            │
└─────────────────────────────────┴─────────────────────────┴────────────────────────────────────────────┘
```

---

## 3. Detailed Component Breakdown

### A. Layer 1: Codeblock Asli (Native Codeblock Teks Murni)
1. **DOM Asli Tidak Di-Overwrite**:
   - Kontainer tetap menggunakan elemen `<pre><code>` asli Obsidian tanpa diubah menjadi div sel atau tabel.
   - Background, border, dan font monospace mengikuti tema native Obsidian (`var(--code-background)`).
   - Teks mengalir alami per baris:
     ```text
     data
       asset                         # note1        ## note2
         player
           yolla.webp                # setter
           tisya.webp
     ```
2. **Offset Spasi `#note##` Saja**:
   - Teks path/item berada di sisi kiri secara natural.
   - Hanya token `#note` yang digeser menggunakan offset (spasi terhitung) agar posisinya tepat jatuh di bawah batas kolom yang bersangkutan.
   - Baris tanpa komentar berhenti setelah nama file/folder; tidak ada elemen kosong apa pun di sebelah kanannya.
3. **0% Garis Horizontal**:
   - Tidak ada garis horizontal antar baris (`border-bottom: none !important`).

### B. Layer 2: Extra GUI Overlay (+1 Layer di Atas Codeblock)
1. **Baris Pohon (ASCII Guide Branches: `├── `, `└── `, `│   `)**:
   - Garis-garis cabang pohon digambar oleh lapisan GUI overlay, diposisikan tepat di atas area indentasi setiap baris.
2. **Chevron Fold Toggles (`v ` / `> `)**:
   - Tombol lipat chevron dipasang oleh lapisan GUI overlay tepat di depan nama folder (`pointer-events: auto`).
   - Mengklik chevron melipat atau membuka sub-hierarki folder.
3. **Floating Header Ruler**:
   - Pinned tipis di bagian atas codeblock.
   - Menampilkan kontrol kolom: `PATH +`, `::` (drag urutan), `<` dan `>` (geser kolom), `+` (tambah/duplikat), `-` (hapus kolom).
4. **Vertical Guideline Wires (Garis Kawat Pembatas Kolom)**:
   - Garis vertikal melayang di pembatas kolom (`position: absolute; top: 0; bottom: 0;`).
   - Dapat di-drag ke kiri/kanan (`cursor: col-resize; pointer-events: auto`) untuk mengatur jarak offset `#note` secara langsung.
   - Double-click garis kawat untuk auto-fit jarak ke teks terpanjang.
5. **Whole-Row Hover Highlight**:
   - Menyorot seluruh baris secara mulus saat kursor mouse melayang di atas baris.

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
