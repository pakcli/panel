# 📌 Master Brief: ASCII Codeblock Native Layering Architecture (pakcli-panel)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Features**: `table with note thing` (`panel-tree`) & `tree-interactive`  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-21  

---

## 1. Objective & User Vision

The user identified a fundamental flaw in the previous codeblock rendering and manipulation approach:
- Previously, artificial character space padding (`targetColStartChars`), SVG wire overlays, and custom inline DOM structures were forcibly injected into the codeblock text.
- This broke the native Obsidian codeblock behavior: text was distorted, `# note` comments were shifted unpredictably, rendered views were not cleanly copy-pasteable, and Live Editing did not feel like a native Obsidian codeblock.

### What the User Wants: The Exact Layering Blueprint
```text
┌────────────────────────────────────────────────────────────────────────┐
│  TOP HUD (top huio): Top Ruler, Column Controls (- < > :: +), Wires    │
│  ⚡ Dynamic Listener: Reacts to Live Editing & updates HUD in real-time │
├────────────────────────────────────────────────────────────────────────┤
│  LAYER 1: ASCII ADDITIONS (chreon, branch simbol)                       │ ALSO 100% copy-pasteable rendered
│  - Chevrons (v, >) & ASCII Branch connectors (├──, └──, │)             │
│  - Rendered cleanly without disturbing or displacing codeblock content  │
├────────────────────────────────────────────────────────────────────────┤
│  LAYER 0: NATIVE CODEBLOCK (layer codeblock)                           │
│  - 🚨 DO NOT TOUCH AND DO NOT OFFSET ANYTHING                           │
│  - Keep codeblock native: natural indentation, spaces, and note text   │
│  - Full native Live Editing experience; 100% copy-pasteable rendered    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Feature Scope

### Feature 1: "Table with Note Thing" (`panel-tree`)
- **Definition**: Indented folder/file hierarchy where additional columns represent `# note` comments or structured metadata.
- **Native Codeblock Layer**:
  - The raw text in the codeblock remains 100% natural:
    ```text
    asset                           asdasdasdasdasdasd
        player
            yolla.webp
            tisya.webp
        matches
            poster-m01.webp
    ```
  - **DO NOT TOUCH AND DO NOT OFFSET ANYTHING**: Stop artificial space padding calculations that shift text. The codeblock rendered text matches exactly what was typed.
- **ASCII Addition Layer**:
  - Chevrons (`v ` / `> `) and branch symbols (`├── `, `└── `, `│   `) accompany the directory items cleanly without breaking column alignments.
- **Top HUD Layer**:
  - Sticky header bar with column markers, `- < > :: +` actions, and guideline resizers.
  - **Live Editing Listener**: Listens to active editor changes and dynamically measures column boundaries to update the top HUD in real-time.

### Feature 2: `tree-interactive` Codeblock
- **Definition**: Interactive collapsible ASCII tree diagram (`tree-interactive` and `tree`).
- **Native Codeblock Layer**:
  - Clean indented source markdown text.
- **ASCII Addition Layer**:
  - Authentic ASCII branch characters (`├── `, `└── `, `│   `) with interactive chevrons (`(v)` / `(>)`).
  - **100% Copy-Pasteable**: Selecting text in the rendered view and copying it produces authentic, intact ASCII tree text.
- **Top HUD Layer**:
  - Controls bar (search, toggle all, copy tree, view mode).

---

## 3. Core Architectural Rules

1. **Zero Text Displacement in Layer 0**:
   - The native codeblock text stream must not have artificial character offsets or inline width spans injected that would disturb cursor navigation or break clipboard copying.
2. **Dynamic Top HUD Sync (Live Editing Listener)**:
   - In Live Preview / Live Editing, an observer/listener monitors input changes.
   - When new columns, notes, or indentation depths are typed, the top HUD re-evaluates column guidelines and updates its ruler without re-creating or un-focusing the editor.
3. **Copy-Paste Integrity**:
   - Copying from either the native codeblock or via the copy button (`📋`) must yield pure, clean text that can be pasted into any text editor (Notepad, VS Code, Discord, Obsidian) perfectly formatted.
4. **Theme & Monospace Conformity**:
   - Uses native Obsidian monospace font (`var(--font-monospace)`), line height (`var(--line-height-normal)`), and theme variables.

---

## 4. Implementation Roadmap

| Phase | Description | Status |
| :--- | :--- | :---: |
| **Phase 0** | Create brief in `panel/docs/` and commit status 0 | ✅ Complete |
| **Phase 1** | Refactor `TreeCodeblockRenderer.ts` Layer 0 to preserve native codeblock text without artificial space offsets | ✅ Complete |
| **Phase 2** | Integrate ASCII additions (chevrons, branch symbols) in Layer 1 cleanly | ✅ Complete |
| **Phase 3** | Implement Live Editing listener that dynamically updates the Top HUD (`top huio`) | ✅ Complete |
| **Phase 4** | Verify copy-paste output and interactive toggle parity on `tree-interactive` | ✅ Complete |
| **Phase 5** | Run `npm run build`, bundle check (< 5 MB), update brief to Status 1 and commit | ✅ Complete |

---

## 5. Acceptance Criteria Checklist

- [x] Brief created at `panel/docs/brief-ascii-codeblock-native-layering.md` with status 0
- [x] Status 0 brief committed to git
- [x] Layer 0 codeblock text left 100% native without artificial space offsets
- [x] Layer 1 ASCII additions (chevrons, branches) rendered without displacing text
- [x] Top HUD dynamically listens to live editing and updates ruler/wires in real time
- [x] Rendered view of `panel-tree` and `tree-interactive` is 100% copy-pasteable as authentic text
- [x] `npm run build` passes with 0 errors and bundle size < 5.0 MB (4.62 MB verified)
- [x] Status 1 brief updated and committed
