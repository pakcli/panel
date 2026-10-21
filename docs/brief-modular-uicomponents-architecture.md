# 📌 Master Brief: Modular UIComponents Architecture (pakcli-panel)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-21  

---

## 1. Objective & Problem Statement

### Problem
Across the `pakcli-panel` suite (covering 15+ features including Table, Tree, CSV, AsciiDraw, SQLSeal, Tierlist, BubbleGraph, and Media Inspectors), UI controls have evolved independently within individual feature directories:
1. **Duplicate Action Buttons**: Copy buttons (`📋`), pill buttons (`- < > :: +`), toolbar icons, and close/reset buttons are repeatedly written with manual `document.createElement` / `createEl` and bespoke inline styles.
2. **Scattered Inputs & Form Controls**: Toggles (`(v) / (>)`, checkboxes), text search inputs, range sliders, and dropdown selectors are duplicated across `bubbleGraphView.ts`, `TreeCodeblockRenderer.ts`, `asciidraw`, and `SettingsPanel.ts`.
3. **Redundant Modal Dialogs**: Confirmation modals (`ConfirmModal`, `DeleteConfirmationModal`), preset pickers, and prompt modals are reimplemented in at least 8 different sub-features.
4. **Scattered Styling**: UI styles are mixed between feature stylesheets (`treeGrid.scss`, `bubbleGraph.scss`, `asciidraw.scss`, `core.scss`), creating visual inconsistencies across Obsidian themes.

### Solution
Establish a standardized, modular **`src/uiComponents`** directory in `panel` following the clean 4-pillar architectural layout:
```text
panel/src/
├── uiComponents/
│   ├── actions/          # Reusable action controls (ActionBtn, CopyButton, PillGroup, DragHandle, IconButton)
│   ├── inputs/           # Form primitives (SearchInput, ToggleSwitch, RangeSlider, InlineEditableText, DropdownSelect)
│   ├── modals/           # Universal modal foundations (BaseModal, ConfirmModal, PromptModal, PresetSelectorModal)
│   ├── table/            # Core table & grid primitives (Table, Cell, HeaderCell, ColumnResizer, TableRuler)
│   └── index.ts          # Central export barrel for clean feature imports
└── styles/
    └── ui/               # Modular styling matching uiComponents
        ├── actions.scss
        ├── inputs.scss
        ├── modals.scss
        └── table.scss
```

---

## 2. Feature Scope & Inclusions

### Included in UI Architecture
* **Table & Grid Systems**: Core `Table`, `Cell`, `HeaderCell`, `TableRuler`, `ColumnResizer` (consolidated from `src/components/*` and `treeGrid`).
* **Bubble View UI Components**:
  * Bubble Graph Top Header Toolbar (scope selector, layout switch, lock toggle, timelapse triggers).
  * Scope Filter Bar & Search Input.
  * Inspector Panel Controls (sliders, toggles, badges).
  * Preset Selection & Save Modals (`PresetViewScopeModal`, `SavePresetPromptModal`).
  * Bezier Curve Editor widget (`BezierCurveEditor.ts`).
* **Tree & Outliner UI Controls**:
  * Copy buttons, interactive folder chevrons (`v ` / `> `), column control pills (`- < > :: +`).
  * Confirmation modals (`ConfirmModal`).
* **AsciiDraw, CSV & SQLSeal UI**:
  * Common action toolbars, copy triggers, cell selection markers.

### Explicitly Excluded
* **Bubble Graph Simulation Physics**: The D3-force simulation, cluster collision, velocity damping, and tick loop in `src/features/bubblegraph/simulation.ts` remain strictly encapsulated inside `bubblegraph` as core domain physics logic.

---

## 3. Directory & File Architecture Blueprint

```text
panel/src/uiComponents/
├── actions/
│   ├── ActionBtn.ts              # Universal button with Obsidian icon, tooltip, active/disabled state
│   ├── CopyButton.ts             # Standard 1-click clipboard button with native Notice feedback
│   ├── PillGroup.ts              # Reusable segmented controls (- < > :: +)
│   ├── DragHandle.ts             # Reorder handle (::) with drag events
│   └── index.ts
├── inputs/
│   ├── SearchInput.ts            # Debounced filter search input with clear (✖) icon
│   ├── ToggleSwitch.ts           # Accessible toggle / segmented pill switch
│   ├── RangeSlider.ts            # Slider control with live value badge
│   ├── InlineEditableText.ts     # In-place double-click editable label with Esc/Enter commit
│   ├── DropdownSelect.ts         # Standardized select dropdown wrapper
│   └── index.ts
├── modals/
│   ├── BaseModal.ts              # Base Obsidian Modal extension with consistent padding & footer
│   ├── ConfirmModal.ts           # Universal "Are you sure?" confirmation dialog
│   ├── PromptModal.ts            # Single-input prompt modal with validation
│   └── index.ts
├── table/
│   ├── Table.tsx                 # Core table container
│   ├── Cell.tsx                  # Cell component
│   ├── HeaderCell.tsx            # Header cell with sorting & resize hooks
│   ├── ColumnResizer.ts          # Draggable column boundary guideline with double-click auto-fit
│   ├── TableRuler.ts             # Sticky top ruler bar with column metadata
│   └── index.ts
└── index.ts                      # Central barrel: export * from './actions', './inputs', './modals', './table'
```

---

## 4. Technical Constraints & Verification Rules

1. **Zero Breaking Changes**: Existing imports from `src/components/*` will re-export from `src/uiComponents/table/*` to maintain 100% backward compatibility.
2. **Obsidian Native Theme Synergy**:
   * All components consume native CSS variables (`--interactive-accent`, `--background-modifier-border`, `--font-monospace`, `--text-normal`).
   * Zero hardcoded pixel colors; dynamic theme switching support.
3. **Obsidian Sync 5 MB Limit**:
   * Modularizing UI must not inflate bundle size.
   * Target bundle: `< 4.70 MB` (comfortably below the 5.0 MB Obsidian Sync cap).
4. **Clean Decoupling**:
   * `uiComponents` only handle DOM rendering, accessibility, and user events via callbacks (`onAction`, `onChange`, `onCommit`).
   * Business domain logic (e.g. Markdown file reads, SQL execution, graph simulation) remains in feature engines.

---

## 5. Implementation Roadmap

| Phase | Description | Status |
| :--- | :--- | :---: |
| **Phase 0** | Create brief in `panel/docs/` and commit status 0 | ✅ Complete |
| **Phase 1** | Scaffold `src/uiComponents/` folders (`actions`, `inputs`, `modals`, `table`, `index.ts`) | ✅ Complete |
| **Phase 2** | Implement core reusable primitives (`actions`, `inputs`, `modals`, `table`) | ✅ Complete |
| **Phase 3** | Migrate & connect feature UI (`panel-tree` controls, `bubblegraph` modals/toolbar) | ✅ Complete |
| **Phase 4** | Create modular stylesheets in `src/styles/ui/` | ✅ Complete |
| **Phase 5** | Run `npm run build`, verify zero errors, bundle size < 5 MB, commit status 1 | ✅ Complete |

---

## 6. Acceptance Criteria Checklist

- [x] Brief created at `panel/docs/brief-modular-uicomponents-architecture.md` with status 0
- [x] Status 0 brief committed to git
- [x] `src/uiComponents` directory structure created matching specification
- [x] Action buttons (`CopyButton`, `PillGroup`, `ActionBtn`) implemented and exported
- [x] Inputs (`SearchInput`, `ToggleSwitch`, `InlineEditableText`) implemented and exported
- [x] Modals (`ConfirmModal`, `PromptModal`, `BaseModal`) implemented and exported
- [x] Table primitives consolidated and re-exported
- [x] Bubble graph UI components (toolbar, inspector, preset modals) integrated with `uiComponents` (simulation excluded)
- [x] `npm run build` succeeds cleanly with 0 TypeScript errors
- [x] Bundle size strictly below 5.0 MB (4.62 MB verified)
- [x] Status 1 brief updated and committed
