# 📌 Master Brief: Cascading Sticky Tree Headers (panel-tree-cascading)

> **Feature Status**: `1` (Completed & Deployed)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile (Live Preview & Reading View)  
> **Date**: 2026-10-22  

---

## 1. Objective & Problem Statement

### Problem
In large projects, `panel-tree` structures routinely scale to 50–200+ lines with deeply nested directory structures (`data/` → `asset/` → `player/` → subfiles). As users scroll through a long tree:
1. **Loss of Context**: Deeply nested children (`yolla.webp`, `tisya.webp`) scroll into view while ancestor folders (`data`, `asset`, `player`) scroll out of the viewport. The user loses orientation regarding which directory branch they are inspecting.
2. **Tedious Navigation**: To add a file/folder to an ancestor or check its sibling branches, the user must manually scroll all the way back up to locate the parent folder.
3. **Screen Real Estate on Mobile**: Mobile viewports are vertically constrained; standard large headers waste space, requiring a tidy, compact mobile-style sticky presentation.

### Solution
Implement **`panel-tree-cascading`** — a high-performance, sticky cascading header component inspired by VS Code Sticky Scroll and the mobile-compact cascading header design:
1. **Dynamic Active Ancestor Resolution**: As the document scrolls, the active directory hierarchy leading to the top visible tree node is continuously computed.
2. **Pinned Cascading Bar**: Pins the active ancestor chain at the top of the tree codeblock container.
3. **Dual Display Modes (Desktop Cascading vs. Mobile Compact Breadcrumb)**:
   - **Cascading Stack Mode**: Stacked compact rows (22px each) with branch connector rails (`├── `, `└── `).
   - **Compact Breadcrumb Mode**: A single, tidy 24px bar with pill tokens (`data › asset › player`), identical to the sleek mobile header style.
4. **Interactive UI Component Integration**:
   - Reuses `src/uiComponents/actions/` (`ActionBtn`, `CopyButton`, `PillGroup`).
   - Contextual `[+File]` and `[+Folder]` action badges stay directly accessible on the sticky header.
   - Click-to-Jump: Clicking any pinned folder smoothly scrolls the editor to that folder's definition.

---

## 2. UI/UX Wireframe & Visual Specifications

### Wireframe 1: Desktop Cascading Stack Mode (Expanded Hierarchy)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ```panel-tree                                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ 📌 Pinned Cascading Tree Stack (Sticky at top of codeblock, z-index: 20)      │
│ ├── 📁 data                                                [+File] [+Folder] │
│ │   └── 📁 asset                                           [+File] [+Folder] │
│ │       └── 📂 player                                      [+File] [+Folder] │
├──────────────────────────────────────────────────────────────────────────────┤
│ │   │   ├── yolla.webp                                                       │
│ │   │   └── tisya.webp                                                       │
│ │   ├── matches                                            [+File] [+Folder] │
│ │   │   └── poster-m01.webp                                                  │
│ │   ├── news                                               [+File] [+Folder] │
│ │   │   ├── match-win-popsivo.webp                                           │
│ │   │   └── content                                        [+File] [+Folder] │
│ │   │       ├── pln-libas-popsivo-3-1.md                                     │
│ │   │       └── pemain-asing-baru-tiba.md                                    │
│ └── index.json                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe 2: Mobile / Compact Breadcrumb Pill Mode (Tidy 24px Single-Bar)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 📌 Sticky Breadcrumb (Tidy single 24px bar, sleek mobile style)              │
│ 📁 data › 📁 asset › 📂 player                             [+File] [+Folder] │
├──────────────────────────────────────────────────────────────────────────────┤
│ │   │   ├── yolla.webp                                                       │
│ │   │   └── tisya.webp                                                       │
│ │   ├── matches                                            [+File] [+Folder] │
│ │   │   └── poster-m01.webp                                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe 3: Inline Quick-Add from Sticky Header

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 📁 data › 📁 asset › 📂 player   [ 🔍 input: new-file.webp | ↵ Enter | ✕ Esc ]│
├──────────────────────────────────────────────────────────────────────────────┤
│ │   │   ├── yolla.webp                                                       │
│ │   │   └── tisya.webp                                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Interaction & Scroll Behavior Lifecycle

```text
User Scrolls Down
       │
       ▼
[Scroll Listener Debounce: requestAnimationFrame]
       │
       ▼
Determine Top Visible Tree Line in Viewport (Live Preview: EditorView coords / Reading View: getBoundingClientRect)
       │
       ▼
Lookup Node in Parsed Tree Model & Build Ancestor Chain:
[Root: 'data'] ──► [Parent: 'asset'] ──► [Current: 'player']
       │
       ▼
Is active tree scrolled beyond its first folder?
       ├─► NO  ──► Hide sticky bar (display: none)
       └─► YES ──► Render sticky bar with active chain
                    - Update branch rails & folder names
                    - Attach click-to-jump event listeners
                    - Render beside badges: [+File] [+Folder]
```

---

## 4. Technical Architecture & File Layout

### Component Hierarchy
```text
panel/src/
├── features/
│   └── treeGrid/
│       ├── TreeLivePreviewPlugin.ts       # Editor extension (Live Preview CM6 lines)
│       ├── TreeCodeblockRenderer.ts       # Reading View renderer
│       ├── treeParser.ts                  # Tree model & node hierarchy parser
│       ├── types.ts                       # TreeGridNode & settings types
│       └── cascading/
│           ├── TreeCascadingManager.ts     # Core scroll tracker & viewport positioner
│           ├── TreeCascadingView.ts        # DOM renderer for cascading stack & breadcrumb
│           └── index.ts
├── uiComponents/
│   ├── actions/
│   │   ├── ActionBtn.ts                   # Standardized icon buttons
│   │   ├── CopyButton.ts                  # 1-click tree copy trigger
│   │   └── PillGroup.ts                   # Mode toggle & controls
│   └── inputs/
│       └── InlineEditableText.ts          # Inline input for quick-add item
└── styles/
    ├── treeGrid.scss                      # Base tree styles
    └── ui/
        └── treeCascading.scss             # Sticky cascading stack & mobile breadcrumb
```

---

## 5. Settings & Configuration

| Setting Key | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `enableTreeCascadingHeaders` | `boolean` | `true` | Enable/disable sticky cascading headers in `panel-tree` |
| `treeCascadingStyle` | `'cascading' \| 'breadcrumb' \| 'auto'` | `'auto'` | Stacked cascading rows vs. compact single-line breadcrumb (`auto` = cascading on desktop, breadcrumb on mobile) |
| `treeCascadingMaxDepth` | `number` | `3` | Maximum ancestor folders pinned simultaneously (range: 1–5) |
| `treeCascadingShowBadges` | `boolean` | `true` | Display `[+File]` and `[+Folder]` on the pinned sticky headers |

---

## 6. Acceptance Criteria Checklist

- [x] Status 0 brief created at `panel/docs/brief-panel-tree-cascading.md`
- [x] User aligned on UI/UX wireframes (Cascading Stack vs. Compact Breadcrumb)
- [x] `TreeCascadingManager` tracks viewport scroll in Live Preview and Reading View
- [x] Active ancestor directory chain correctly resolved on scroll
- [x] Click-to-Jump smoothly scrolls to folder in the editor
- [x] Contextual `[+File]` / `[+Folder]` functional directly from sticky bar
- [x] Mobile responsive: auto-collapses to single tidy 24px breadcrumb strip
- [x] Production build clean (< 5.0 MB bundle cap)
- [x] Auto-deployed to test vaults
- [x] Zero Duplication Calculation: Folder pinned in sticky header IF AND ONLY IF its declaration line has completely scrolled out of view past top boundary (`lineNo < currentLine`). If visible on content page, sticky bar excludes it.
- [x] Root line 0 visibility: Sticky bar stays hidden until root line has scrolled out of view.
- [x] Status 1 updated upon completion
