# 📌 Master Brief: Cascading Sticky Headers for Whole Page (pakcli-panel)

> **Feature Status**: `1` (Completed & Verified)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile (Live Preview & Reading View)  
> **Date**: 2026-10-22  

---

## 1. Objective & Root Cause Analysis

### Problem
In a previous commit (`c512ac2`), a naive 40-line CSS rule was added to `main.scss` targeting `.markdown-rendered h1, h2, h3` with hardcoded pixel positions (`top: 36px`, `top: 68px`). This completely failed in real-world usage:
1. **Zero Support for Live Preview**: Obsidian Live Preview uses CodeMirror 6 (`div.cm-line.HyperMD-header...`), not HTML `<h1>` tags. The CSS had zero effect in Live Preview.
2. **Heading Collision & Overlap**: In Reading View, multiple headings of the same level (e.g. three different `h2`s) all shared `top: 36px`, causing them to permanently stack on top of each other.
3. **Title Collision**: `.inline-title` and `h1` were both assigned `top: 0`, causing headers to scroll underneath or clip the title.
4. **No Section Awareness**: CSS `position: sticky` within a single container cannot calculate ancestor heading hierarchies (`h1 -> h2 -> h3`).

### Solution
Implement an active, dynamic **`CascadingStickyHeaderManager`** (VS Code Sticky Scroll architecture):
1. **Universal Dual-Mode Support**: Works on the entire page across both **Live Preview** (`.cm-scroller`) and **Reading View** (`.markdown-preview-view`).
2. **Dynamic Hierarchy Tracking (`h1 -> h2 -> h3`)**:
   - Queries `app.metadataCache.getFileCache(activeFile)?.headings`.
   - On scroll, determines the exact chain of active ancestor headings for the top visible line.
3. **Pinned Cascading Sticky Bar**:
   - Renders a floating, opaque, themed sticky container at the top of the editor view.
   - Pinned entries render as real HTML heading tags (`<h1>`, `<h2>`, `<h3>`...) inside `.markdown-rendered`, inheriting the theme's exact font size, font weight, and colors:
     ```text
     Brief: Fixing Theme CSS File Size & CSS Lint Warnings (H1 style)
     2. Technical Root Cause (H2 style)
     A. Why did css-masks trigger despite comments? (H3 style)
     ```
   - Zero badges (`[H1]`, `[H2]`) and zero staircase indentation; headings align flush with the document content.
   - Automatically hides when the user is above the first heading.
   - Updates dynamically as sections scroll past without collisions.
4. **Click-to-Jump Navigation**: Clicking any heading in the sticky stack instantly and smoothly scrolls the viewport directly to that heading.
5. **Settings Toggle**: Controlled via `enableCascadingStickyHeaders` in plugin settings.

---

## 2. Technical Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Workspace Markdown View (Live Preview or Reading View)                 │
├────────────────────────────────────────────────────────────────────────┤
│ 📌 Cascading Sticky Bar (.pakcli-cascading-sticky-bar, z-index: 20)    │
│ [H1] 1. Getting Started                                                │
│   [H2] 1.2 Installation Steps                                          │
│     [H3] 1.2.1 Dependencies Configuration                              │
├────────────────────────────────────────────────────────────────────────┤
│ Document Content (scrolling underneath)                                │
│ ...                                                                    │
└────────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown
1. **`CascadingStickyHeaderManager`** (`panel/src/features/stickyHeader/CascadingStickyHeaderManager.ts`):
   - Hooks into `workspace.on('active-leaf-change')` and `workspace.on('layout-change')`.
   - Attaches scroll listeners to `.cm-scroller` and `.markdown-preview-view`.
   - Uses `requestAnimationFrame` debouncing for 60fps smooth tracking.
   - Renders sticky header items with theme background, subtle bottom border/shadow, and level badges.
2. **Settings**:
   - `enableCascadingStickyHeaders: boolean` (default: `true`)
   - `stickyHeaderMaxDepth: number` (default: `3`, range: 1–6)

---

## 3. Implementation Roadmap

| Phase | Description | Status |
| :--- | :--- | :---: |
| **Phase 0** | Create brief in `panel/docs/` and commit status 0 | ✅ Completed |
| **Phase 1** | Implement `CascadingStickyHeaderManager.ts` with scroll listeners for Live Preview & Reading View | ✅ Completed |
| **Phase 2** | Add settings toggle and register manager in `panel/src/main.ts` | ✅ Completed |
| **Phase 3** | Replace flawed static CSS in `panel/src/styles/main.scss` with clean stylesheet in `panel/src/styles/stickyHeader.scss` | ✅ Completed |
| **Phase 4** | Build & verify bundle size (< 5.0 MB) | ✅ Completed |
| **Phase 5** | Update brief to Status 1 and commit | ✅ Completed |

---

## 4. Acceptance Criteria Checklist

- [x] Brief created at `panel/docs/brief-cascading-sticky-headers.md` with status 0
- [x] Status 0 brief committed to git
- [x] Active ancestor headings (`h1 -> h2 -> h3`) correctly identified on scroll
- [x] Sticky header bar rendered at top of editor view in Live Preview
- [x] Sticky header bar rendered at top of view in Reading View
- [x] Clicking any pinned heading scrolls editor to that section
- [x] Flawed static CSS in `main.scss` removed
- [x] Settings toggle added to plugin settings tab
- [x] Production build succeeds with bundle size < 5.0 MB (4.63 MB)
- [x] Status 1 brief updated and committed
