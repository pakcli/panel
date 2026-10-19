# 📌 Master Brief: VS Code Style Scrollable Workspace & Table Tabs (pakcli-panel)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `panel/src/styles/main.scss` & `panel/src/main.ts`  
> **Platform**: Desktop & Mobile  
> **Date**: 2026-10-19  

---

## 1. Objective & Problem Statement
- **Problem**:
  1. **Tab Headers Shrinking and Becoming Illegible**:
     - In Obsidian's default workspace tab header behavior, when multiple tabs (table tabs, note tabs, view tabs) are open, tab headers shrink aggressively to fit the window width.
     - This causes titles to be truncated to 1–2 letters, making it impossible to identify open documents or tables without hovering.
  2. **Lack of VS Code-like Smooth Horizontal Navigation**:
     - VS Code maintains a readable tab width (~15 characters title) and makes the entire tab bar horizontally scrollable with mouse wheel or trackpad, keeping tab headers legible regardless of how many tabs are open.
     - The active tab (`div.workspace-tab-header.tappable.is-active`) should remain prominent and automatically scroll into view when activated.

---

## 2. Solution & Technical Architecture
1. **VS Code Style Tab Header Sizing & Max 15 Chars**:
   - Limit tab title text (`.workspace-tab-header-inner-title`) to `max-width: 15ch` with `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`.
   - Keep tab items (`div.workspace-tab-header.tappable`) with `flex: 0 0 auto`, `min-width: 80px`, and `max-width: 180px` so tabs never shrink into tiny boxes.
2. **Scrollable Tab Container (`overflow-x: auto`)**:
   - Container `.workspace-tabs .workspace-tab-header-container` set to `display: flex !important; flex-wrap: nowrap !important; overflow-x: auto !important; scroll-behavior: smooth !important;`.
   - Subtle scrollbar that appears on hover and keeps the interface clean.
3. **Mouse-Wheel Horizontal Scrolling**:
   - Register a wheel listener in `main.ts` on `.workspace-tab-header-container` to map vertical scroll wheel (`deltaY`) to horizontal scroll (`scrollLeft`), exactly like VS Code tab bar behavior.
4. **Active Tab Auto-Scroll into View**:
   - On `active-leaf-change`, smooth scroll the active tab header (`div.workspace-tab-header.tappable.is-active`) into view if it is partially or completely offscreen.

---

## 3. Implementation Plan & Target Files
| File | Status | Description |
| :--- | :---: | :--- |
| `docs/brief-workspace-tabs-vscode-style-scrollable.md` | ⏳ | Master brief (Status 0 -> 1) |
| `src/settings.ts` | ⏳ | Add `enableVsCodeTabs` & `tabTitleMaxChars` to settings |
| `src/styles/main.scss` | ⏳ | Add CSS rules for scrollable tab bar, max 15ch title, and active tab indicator |
| `src/main.ts` | ⏳ | Add horizontal wheel scroll and active tab scroll-into-view listener |

---

## 4. Acceptance Criteria Checklist
- [ ] Status 0 brief created and committed
- [ ] Tab title text capped at max 15 characters with clean ellipsis (`max-width: 15ch`)
- [ ] Tab headers never compress into unreadable narrow boxes when many tabs are open
- [ ] Tab header bar is smoothly scrollable horizontally (`overflow-x: auto`)
- [ ] Mouse wheel on tab bar scrolls tabs horizontally like VS Code
- [ ] Active tab (`div.workspace-tab-header.tappable.is-active`) is clearly styled and scrolls into view on selection
- [ ] Production build (`npm run build`) passes with 0 errors and bundle size < 5.0 MB
- [ ] Status 1 brief updated and committed
