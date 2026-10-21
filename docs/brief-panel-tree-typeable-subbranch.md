# 📌 Master Brief: panel-tree Typeable Sub-branch Standard (Rule #006)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Rule Reference**: `all-lads-tool/rule/006_asci-rule.md`  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-21  

---

## 1. Objective & Problem Statement

### Problem
Previously, in `panel-tree` (`TreeCodeblockRenderer`), adding a new child item to a directory required either:
1. Manually switching to raw source mode and typing tabs, or
2. Clicking toolbar column controls that add columns horizontally rather than inserting child items hierarchically into folders.

### Solution
Implement **Rule #006 (ASCII Tree Codeblock Invariant & Interactive Typeable Sub-branch Standard)**:
1. Any node without a file extension (`.ext`) is recognized as a parent directory.
2. In the rendered view, every expanded parent directory automatically displays **1 extra sub-branch line** (`└── `) at the end of its child list.
3. This extra line is **empty (*kosong*) and directly typeable**:
   - Shows `└── ` followed by an interactive placeholder (`Add item...`).
   - Clicking focuses an inline text input.
   - Pressing **Enter** inserts the item as a child in the parent directory in the markdown source with correct indentation.
   - Pressing **Esc** or blurring without input cancels and leaves the empty prompt line.

---

## 2. Specification & Visual Flow

### Example: Rendered View with Interactive Typeable Sub-branches
```text
item
├── Item
│   └── [Type new item...]    <-- Click & type to add 1st child
├── Item
│   ├── item
│   └── [Type new item...]    <-- Click & type to add 2nd child
└── item
```

### Commit Behavior:
1. User types `newfile.webp` into the empty `Item` sub-branch and presses Enter.
2. The renderer updates the markdown source with proper tabs:
   ```text
   item
       Item
           newfile.webp
   ```
3. The note is modified in Obsidian vault, re-rendering with the new item and generating the next empty `└── ` prompt line.

---

## 3. Technical Constraints

1. **Source Mode Purity**: The raw codeblock source remains clean text with tabs/spaces; no hardcoded ASCII branches are saved to markdown.
2. **Copy-Paste Cleanliness**: `getPlainTextForCopy()` copies the genuine ASCII tree and omits uncommitted placeholder prompt lines.
3. **Obsidian Sync 5 MB Limit**: Bundle size must remain strictly under 5.0 MB.
4. **Zero Layout Shift**: The inline input aligns precisely with the tree font and line height (`24px`).

---

## 4. Implementation Roadmap

| Phase | Description | Status |
| :--- | :--- | :---: |
| **Phase 0** | Create brief in `panel/docs/` and commit status 0 | ⏳ In Progress |
| **Phase 1** | Update `TreeCodeblockRenderer.ts` visible node flattening to include virtual prompt rows for folders | ⏳ Pending |
| **Phase 2** | Render interactive inline typeable input (`InlineEditableText` / inline input) for prompt rows | ⏳ Pending |
| **Phase 3** | Implement commit handler to insert new indented child in source and sync to active note | ⏳ Pending |
| **Phase 4** | Build & verify bundle size (< 5.0 MB) | ⏳ Pending |
| **Phase 5** | Update brief to Status 1 and commit | ⏳ Pending |

---

## 5. Acceptance Criteria Checklist

- [ ] Brief created at `panel/docs/brief-panel-tree-typeable-subbranch.md` with status 0
- [ ] Status 0 brief committed to git
- [ ] Nodes without `.extension` recognized as parents
- [ ] Every expanded parent displays 1 extra `└── ` prompt line
- [ ] Clicking the prompt line allows inline typing of new child item
- [ ] Pressing Enter inserts item into markdown source with correct tab indentation and syncs to note
- [ ] Copy button and plain text copy omit uncommitted empty prompt rows
- [ ] `npm run build` succeeds with 0 errors and bundle size < 5.0 MB
- [ ] Status 1 brief updated and committed
