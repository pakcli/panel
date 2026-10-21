# 📌 Master Brief: Modular `uiComponents` Architecture (`pakcli-panel`)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-21  

---

## 1. Objective & Problem Statement
- **Problem**: 
  Across the `panel` codebase, UI elements (action buttons, toolbars, copy buttons, search/filter inputs, modals, and table cells) are duplicated and scattered independently across feature folders (`tree`, `treeGrid`, `bubblegraph`, `asciidraw`, `sqlseal`, `carousel`, `leaflet`). This leads to repetitive boilerplate, inconsistent styling, and fragmented UX.
- **Solution**: 
  Establish a centralized, modular UI component library in `src/uiComponents/` matching the user's architectural specification:
  - `uiComponents/actions/`: Generic action buttons, toolbars, copy buttons, drag handles, icon buttons.
  - `uiComponents/inputs/`: Search inputs, filter toggles, dropdowns, slider inputs, editable cells.
  - `uiComponents/modals/`: Base modal wrappers, confirmation dialogs, preset picker modals.
  - `uiComponents/table/`: Core table grid primitives, cell renderers, column resizers, ruler bars.
  - `uiComponents/index.ts`: Central export barrel.
  - Shared UI for all features including Bubble View controls (toolbar, presets, search/filter) while strictly **excluding** the bubble physics node simulation (`simulation.ts`).

---

## 2. Directory Architecture

```text
panel/src/
├── uiComponents/
│   ├── actions/
│   │   ├── ActionButton.ts
│   │   ├── CopyButton.ts
│   │   ├── PillButtonGroup.ts
│   │   ├── Toolbar.ts
│   │   └── index.ts
│   ├── inputs/
│   │   ├── SearchInput.ts
│   │   ├── ToggleSwitch.ts
│   │   ├── SliderInput.ts
│   │   ├── DropdownSelect.ts
│   │   └── index.ts
│   ├── modals/
│   │   ├── BaseModal.ts
│   │   ├── ConfirmModal.ts
│   │   ├── PresetPickerModal.ts
│   │   └── index.ts
│   ├── table/
│   │   ├── Table.tsx
│   │   ├── Cell.tsx
│   │   ├── HeaderCell.tsx
│   │   ├── ColumnResizer.ts
│   │   └── index.ts
│   └── index.ts
└── styles/
    └── ui/
        ├── actions.scss
        ├── inputs.scss
        ├── modals.scss
        ├── table.scss
        └── index.scss
```

---

## 3. Implementation Plan & Files

| File | Status | Description |
| :--- | :---: | :--- |
| `panel/docs/brief-ui-components-architecture.md` | ⏳ | Master architecture brief |
| `panel/src/uiComponents/actions/index.ts` | ⏳ | Standard action buttons, copy button, toolbars |
| `panel/src/uiComponents/inputs/index.ts` | ⏳ | Standard search, toggle, slider, dropdown inputs |
| `panel/src/uiComponents/modals/index.ts` | ⏳ | Base modals, confirm modal, preset modals |
| `panel/src/uiComponents/table/index.ts` | ⏳ | Generic table, cell, column resizer primitives |
| `panel/src/uiComponents/index.ts` | ⏳ | Central export barrel for all features |
| `panel/src/styles/ui/index.scss` | ⏳ | Modular SCSS matching `uiComponents` |

---

## 4. Acceptance Criteria Checklist
- [ ] Status 0 brief created and committed in `panel/docs/`.
- [ ] `src/uiComponents/` scaffolded with `actions`, `inputs`, `modals`, `table`, and `index.ts`.
- [ ] Reusable UI components extracted and standardized without touching bubble node physics simulation.
- [ ] Modular SCSS structured in `src/styles/ui/`.
- [ ] Build succeeds with 0 errors (`npm --prefix panel run build`).
- [ ] Bundle size remains strictly under 5.0 MB Obsidian Sync limit.
- [ ] Artifacts auto-deployed to vaults and Status 1 brief committed.
