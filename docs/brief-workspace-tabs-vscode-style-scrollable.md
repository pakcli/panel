# 📌 Master Brief: VS Code Style Scrollable Workspace & Table Tabs (pakcli-panel)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `panel/src/styles/main.scss` & `panel/src/main.ts`  
> **Platform**: Desktop & Mobile  
> **Date**: 2026-10-19  

---

## 1. Objective & Problem Statement
- **Problem**:
  1. **Tab Headers Shrinking in Center Workspace**:
     - In Obsidian's default center workspace tab header behavior, when multiple tabs (table tabs, note tabs, view tabs) are open, tab headers shrink aggressively to fit the window width.
     - This causes titles to be truncated to 1–2 letters, making it impossible to identify open documents or tables without hovering.
  2. **Sidebar Left & Right Should Not Be Affected**:
     - Left sidebar (File Explorer, Bookmarks, Search) and Right sidebar (Outline, Backlinks, Tags) have distinct tab layouts and must remain in their native default style without horizontal scroll or forced widths.
  3. **Need for Instant Toggle (Default / Active)**:
     - Users must be able to switch between standard Obsidian tabs (`default`) and VS Code-style scrollable tabs (`active`) via settings dropdown and Command Palette without restarting Obsidian.

---

## 2. Solution & Technical Architecture
1. **Strictly Scoped to Center Workspace (`.mod-root`)**:
   - All tab styling is prefixed with `body.pakcli-vscode-tabs .mod-root`.
   - Sidebars (`.mod-left-split` and `.mod-right-split`) are 100% excluded and retain native styling.
2. **VS Code Style Tab Header Sizing & Max 15 Chars (Strict Width-Only Constraint)**:
   - **Zero Height / Text Height Adjustments**: No modifications to height, line-height, font-size, display, vertical-align, padding, margins, or borders. Native vertical footprint and font rendering are 100% preserved.
   - Limit center tab title text (`.mod-root div.workspace-tab-header.tappable .workspace-tab-header-inner-title`) and active tab title text (`.mod-root div.workspace-tab-header.tappable.is-active .workspace-tab-header-inner-title`) to `max-width: 15ch !important;` (leaves all text line-height, ellipsis, and baseline to Obsidian native).
   - Center tab headers dynamically scale their width based on text char count using `width: fit-content !important; min-width: fit-content !important; max-width: fit-content !important;` so short titles stay compact, titles up to 15ch fit cleanly, and active tabs with the close button expand without truncating title text.
3. **Scrollable Center Tab Inner Container & Sticky Right Buttons**:
   - Container `.mod-root .workspace-tab-header-container` set to fixed row layout (`overflow: hidden !important; width: 100% !important;`).
   - Inner container `.mod-root .workspace-tab-header-container-inner` set to `flex: 1 1 auto !important; min-width: 0 !important; overflow-x: auto !important; overflow-y: hidden !important;` so only tabs scroll.
   - Right action buttons (`+` new tab, dropdown `v`, and right sidebar toggle) set to `position: sticky !important; right: 0 !important; flex: 0 0 auto !important; z-index: 15 !important;` so they remain permanently pinned and completely unaffected by tab scrolling.
   - Scrollbar set to `scrollbar-width: none !important;` and `display: none !important; height: 0 !important;` (0px vertical height impact).
4. **Mouse-Wheel 60fps RAF Momentum Smooth Scrolling**:
   - Register a wheel listener in `main.ts` with a `requestAnimationFrame` momentum easing loop (`diff * 0.22`) on `.mod-root .workspace-tab-header-container-inner`. Maps wheel delta to silky-smooth 60/120fps interpolated horizontal glide, exactly like VS Code tab bar physics.
5. **Active Tab Auto-Scroll into View**:
   - On `active-leaf-change`, smooth scroll the active center tab header (`div.workspace-tab-header.tappable.is-active`) into view if it is partially or completely offscreen.
6. **Toggleable: Default / Active**:
   - Dropdown in Settings under CSV / Tablite: `Center Workspace Tabs Style` with options `Active` and `Default`.
   - Command Palette shortcut: `Toggle Center Workspace Tabs: Default / Active`.

---

## 3. Implementation Plan & Target Files
| File | Status | Description |
| :--- | :---: | :--- |
| `docs/brief-workspace-tabs-vscode-style-scrollable.md` | ✅ | Master brief (Status 0 -> 1) |
| `src/settings.ts` | ✅ | Add `vscodeTabsMode` ('default' | 'active') to settings & defaults |
| `src/styles/main.scss` | ✅ | CSS rules scoped strictly to `.mod-root` center workspace |
| `src/main.ts` | ✅ | Add center-only wheel listener, auto scroll-into-view, command, and settings dropdown |

---

## 4. Acceptance Criteria Checklist
- [x] Status 0 brief created and committed
- [x] Tab styling strictly scoped to center workspace (`.mod-root`)
- [x] Left and right sidebars (`.mod-left-split`, `.mod-right-split`) remain untouched in default style
- [x] Toggleable between `default` and `active` in Settings dropdown
- [x] Command Palette command available: `Toggle Center Workspace Tabs: Default / Active`
- [x] Tab title text capped at max 15 characters with clean ellipsis (`max-width: 15ch`)
- [x] Center tab headers never compress into unreadable narrow boxes when many tabs are open
- [x] Center tab header bar is smoothly scrollable horizontally (`overflow-x: auto`)
- [x] Mouse wheel on center tab bar scrolls tabs horizontally like VS Code
- [x] Active tab (`div.workspace-tab-header.tappable.is-active`) clearly styled and scrolls into view on selection
- [x] Production build (`npm run build`) passes with 0 errors and bundle size < 5.0 MB
- [x] Status 1 brief updated and committed
