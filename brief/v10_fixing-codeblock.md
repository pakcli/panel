# v10 — Fixing Codeblock Scaler & Themes

**Status:** Brief (not implemented) · **Area:** `table-codeblock` settings section + `CodeblockScaler`

## 1. Problem

In *Settings → Codeblock Scaler & Themes*, only the first row (**Default Wrap & Flow Mode**) visibly works.
Everything else (slider mode, scroll-state, per-language rules, "theme") does nothing or looks inert.

## 2. Findings (from code audit)

| # | Finding | Where | Impact |
|---|---------|-------|--------|
| F1 | **No theme setting exists.** Section is titled "…& Themes" but has no theme control. The only "theme" dropdown is *Default ASCII Canvas Theme* in `table-ascii`, which has no settings key and is never persisted/applied. The ASCII enable toggle is hard-coded `setValue(true)` and saves nothing. | `main.ts` ~5686-5720, `settings.ts` | "Theme not working" is literally true |
| F2 | **Stale inline styles.** `processContainer` sets `!important` inline styles on `pre`, `code`, parent and `.cm-embed-block` for `scalefit`/`wrap`, but when switching behavior it only removes CSS *classes*, never the inline styles (or the SVG wrapper for non-scalefit is removed but wrap/flowclip styles linger). Switching mode in rules/dropdown shows no/partial change. | `scaler.ts` ~725-800 | Per-language rule changes appear to do nothing |
| F3 | **Rule changes don't invalidate caches.** Rule dropdown/clipboard handlers call only `scheduleRescale()`; slider mode calls `clearCache()` but sticky bars/scroll caches are keyed per block and `rescaleAll` bails when `isProcessing`. | `main.ts` 5511-5524, `scaler.ts` 391-395 | Needs reload to see change |
| F4 | **Slider mode & scroll-state are flowclip-only.** They have no effect when default mode is `wrap`/`scalefit`, and the default rule `ascii → scalefit` overrides default for ascii blocks. UI gives no hint of this. | `settings.ts` 352, `main.ts` 5415-5446 | Looks broken even when working |
| F5 | **Settings exist in two UIs** (local section in `main.ts` and hub schema `previewSchemas.ts` listing only 2 keys). Hub copy can drift. | `previewSchemas.ts` 186-195 | Inconsistent behavior |
| F6 | **Debug noise & cost.** ~10 `console.log('[PakCLI DBG]…')` per rule render; `dumpDebugInfo()` runs after *every* `rescaleAll()` and writes JSON to the vault `artifacts/` folder and a hard-coded `C:\Users\fsl\...\brain` path. | `main.ts` 5467-5525, `scaler.ts` 433-579 | Perf, vault pollution, machine-specific code |
| F7 | `Per-Language Rules` table: `rule.language` is not editable, no enable toggle, no validation/duplicate check, alias matching is implicit. | `main.ts` 5478-5625 | Hard to use |

> [!NOTE]
> F2/F3 are the likely root causes of "all not working"; first row works because it also calls `applyCodeblockStyle()` (body classes) before rescale.

## 3. Goals

1. Every setting in the section has an **immediate, visible effect** (no reload).
2. A real **Codeblock Theme** setting (see §4.3) with live preview.
3. Clear UI about which settings apply to which mode.
4. Remove debug side-effects; keep an opt-in debug toggle.

## 4. Proposed Solution

### 4.1 Behavior apply = reset-then-apply (fixes F2, F3)
- Add `resetBlock(pre, codeEl)` in `scaler.ts`: removes all `pakcli-codeblock-*` classes, removes the SVG wrapper, restores `codeEl.style.display`, and clears inline props set by the scaler (`white-space, word-break, overflow-*, max-width, width, min-width, box-sizing, contain`) on `pre`, `code`, parent and embed block.
- `processContainer` calls `resetBlock` whenever the resolved behavior differs from `pre.dataset.pakcliBehavior`, then applies and stores the new behavior.
- Add `scaler.refreshAll()` = `clearCache()` + mark all blocks dirty + `rescaleAll()` (queued if `isProcessing`, not dropped). Use it from **all** settings handlers.

### 4.2 Settings UI clarity (fixes F4, F5, F7)
- Group into cards: **Defaults**, **Flowclip options** (slider mode, save state; greyed out with hint when default is not `flowclip` and no rule uses it), **Per-language rules**, **Theme**.
- Per-language table: editable language cell (comma/alias input), enable toggle per rule, duplicate warning, "Reset to defaults" button.
- Single source of truth: hub `previewSchemas.ts` entry extended to all keys (or generated from one schema).

### 4.3 Codeblock Theme (fixes F1)
New settings:
```ts
codeblockTheme: 'obsidian' | 'midnight' | 'paper' | 'terminal' | 'custom';
codeblockThemeScope: 'all' | 'rules-only';
codeblockCustomColors?: { bg: string; fg: string; border: string; accent: string };
```
- Applied via body class `pakcli-cb-theme-<name>` + CSS vars (`--pakcli-cb-bg/fg/border/accent`) in `main.scss`, used by `pre`, `.cm-embed-block`, `.HyperMD-codeblock`, sticky bar and copy button.
- Theme dropdown shows a small live-preview block inside the settings card.
- Move *ASCII Canvas Theme* to persisted setting (`asciiCanvasTheme`) and wire ASCII enable toggle to a real key.

### 4.4 Cleanup (fixes F6)
- Remove `[PakCLI DBG]` logs.
- `dumpDebugInfo` only when new setting `codeblockDebug` is on; write only to vault `artifacts/` (drop hard-coded `C:\Users\fsl` path).

## 5. Wireframe

```
┌ Codeblock Scaler & Themes ───────────────────────────────┐
│ DEFAULTS                                                 │
│  Wrap & Flow Mode        [ Flow Clip ▾ ]                 │
│  Native Asset Drag       [ on ]                          │
│ FLOWCLIP OPTIONS      (ⓘ active: default + 1 rule)       │
│  Slider Mode             [ 1 bar · all lines ▾ ]         │
│  Save Scroll State       [ on ]                          │
│ THEME                                                    │
│  Theme  [ Midnight ▾ ]  Scope [ All blocks ▾ ]           │
│  ┌ preview ───────────────────────┐                      │
│  │ const x = 1;  // sample        │                      │
│  └────────────────────────────────┘                      │
│ PER-LANGUAGE RULES                                       │
│  on  Language      Behavior     Clipboard   ⌫            │
│  ☑   ascii         Scale Fit    —           ⌫            │
│  ☑   powershell    Flow Clip    {}.invoke() ⌫            │
│  [ + language ] [ behavior ▾ ] [ + Add Rule ]            │
└──────────────────────────────────────────────────────────┘
```

## 6. Implementation Plan

1. `scaler.ts`: `resetBlock`, behavior tracking, `refreshAll`, queued rescale.
2. `settings.ts`: add theme keys, `codeblockDebug`, `asciiCanvasTheme`, rule `enabled`.
3. `main.scss`: theme CSS variables + classes.
4. `main.ts`: rebuild `table-codeblock` section (cards, theme, rules table); `applyCodeblockStyle` also applies theme class; call on load.
5. `previewSchemas.ts`: sync keys.
6. Remove debug logs / gate `dumpDebugInfo`.

## 7. Acceptance Criteria

- [ ] Changing default mode, slider mode, or any rule behavior updates open notes instantly (Live Preview + Reading), with no leftover styles.
- [ ] Switching `scalefit → wrap → flowclip → scalefit` on the same block is lossless.
- [ ] Theme dropdown changes all codeblocks immediately and persists across reload.
- [ ] Flowclip-only options are visibly disabled when irrelevant.
- [ ] No console debug spam; no files written unless debug is on.
- [ ] `npm run build` passes with no new type errors.

## 8. Risks

- Inline `!important` styles may conflict with other themes/snippets → reset only props we set.
- Theme CSS vs. user snippets → scope under `body.pakcli-cb-theme-*`, low specificity override via vars.

---

## 9. Update (round 2) — field report

Reported after testing the first fixes: (a) default mode still overrides per-language mode, (b) two sliders appear under a codeblock, (c) slider must stick to the block bottom and hide when the block is off-screen, (d) **On Clipboard** presets (`{}.invoke()`, `.{}`, `@{}`) have no effect.

### 9.1 Two sliders (Live Preview)
Root cause: two independent bars are created for the same block.
- `injectInFlowBarForCmBlock` appends `.pakcli-codeblock-slider-bar` **inside** the anchor `.cm-line` (the pill inside the block) and it scrolls with the document, never sticky.
- `.pakcli-cb-sticky-bar` (fixed, on `document.body`) is created by `injectStickyBarForPre` for `<pre>` embeds and Reading View. When a Live Preview block is rendered as `pre` inside a `.cm-embed-block` that is not matched by `closest('.markdown-source-view, .cm-editor')` (or a stale bar survives a reload), a second bar shows below the block.
- Per-line mode CSS (`overflow-x:auto` on `.cm-line.HyperMD-codeblock`) may also show native scrollbars if body class `flowclip-mode-per-line` lingers.

Fix — **one bar per block, one implementation**:
1. Remove the in-flow `.pakcli-codeblock-slider-bar` for modes `all-lines`/`current`; keep only the fixed sticky bar (`.pakcli-cb-sticky-bar`) for both Reading and Live Preview.
2. Registry `Map<blockKey, Bar>`; creating a bar for a key first destroys any existing one; `clearCache()`/unload removes all `.pakcli-cb-sticky-bar`.
3. Sticky positioning rule (`positionBar`):
   - block rect fully/partly in viewport **and** has horizontal overflow → show
   - `barTop = min(blockBottom, viewportBottom) - BAR_H` (sticks to bottom of the visible part of the block, tracks scroll)
   - block fully out of view, hidden tab, source mode, or covered by a popover → `display:none`
   - clamp to the editor/leaf content rect (not window) so it never overlaps sidebars/other panes.
4. Drive updates from: scroll of the nearest scroller (`.cm-scroller` / `.markdown-preview-view`), `ResizeObserver`, `IntersectionObserver` (show/hide only), CM `geometryChanged`.
5. Hide native scrollbars on block lines/pre in these modes (`scrollbar-width:none`) so only the sticky bar exists.

### 9.2 Default overriding per-language rule
Root cause: behavior is resolved separately in three places (`getBehaviorForElement` for `<pre>`, `getDocCodeblocks` for CM lines, body class from `codeblockWrapMode`). Body classes `pakcli-<defaultMode>` apply CSS to **all** blocks (`body.pakcli-flowclip { ... }`), so a block whose rule says `wrap`/`scalefit` still inherits the default's CSS.

Fix:
1. Single resolver `resolveBehavior(lang)` used everywhere (pre, CM lines, copy button, bar logic).
2. Stamp every block with `data-pakcli-behavior="<mode>"` and style **only via that attribute/class** — remove the global `body.pakcli-flowclip/wrap/scalefit` block rules (keep body class only for the *default slider mode*).
3. On rule/default change: `resetBlock()` (see §4.1) then re-apply; no stale `!important` inline styles.
4. Unmatched language → default; matched → rule always wins. Add debug line in the "Per-language rules" card: "`powershell` → Flow Clip (rule)" / "`js` → Word Wrap (default)".

### 9.3 On Clipboard presets not applied
Behavior requested: the **On Clipboard column** value decides the prefix/suffix wrapper, i.e. `{}.invoke()` → `{ … }.invoke()`, `.{}` → `.{ … }`, `@{}` → `@{ … }`, optional "— none —".

Findings:
- Presets are only rendered for PowerShell aliases (`powershell/ps1/pwsh/ps`); other languages get a free textarea, so the 3 presets are not available/applied for them.
- The dropdown "selected" logic marks `— none —` selected when value is empty and can mark several options; value saved as `invoke|dot|at` but display falls back to the first option, so the UI shows `{}.invoke()` while nothing is stored (matches the screenshot).
- Transform only runs if copy is intercepted: `handleCodeblockCopyClick` needs the detected language; when lang is empty (Live Preview begin line scan fails, `ps1` alias, indented/nested block) no template is armed → native copy.
- `replaceExisting` unwrap is applied only for PowerShell.

Fix:
1. Make On Clipboard a **dropdown for every language**: `— none —`, `{}.invoke()`, `.{}`, `@{}`, `Custom…` (custom shows the textarea for `prefix`/`suffix` template).
2. Store explicit data: `clipboardWrap: 'none'|'invoke'|'dot'|'at'|'custom'` + optional `clipboardPrefix/Suffix`; migrate old `onClipboard` strings once.
3. Bind selected option strictly to stored value (single `selected`), save immediately, show Notice and refresh copy-button icon.
4. Transform pipeline: `raw → (replaceExisting ? unwrap existing prefix/suffix : raw) → apply preset prefix/suffix → sanitizer`. Applied to: custom copy button, native copy button, Ctrl+C selection, context-menu copy. Works for any language; `Replace Wrapper` column enabled for all.
5. Language detection fallback chain: `data-language` → classes → flair → CM begin-line scan → fence regex on source (`getDocCodeblocks`) — and log once when none found.
6. Unit tests for `transformClipboardContent` (invoke/dot/at × replaceExisting × already-wrapped input × CRLF).

### 9.4 Additional acceptance criteria
- [ ] Exactly one slider per overflowing block; none when block fits.
- [ ] Slider sits at the block bottom (or viewport bottom while block extends below) and disappears when the block is off-screen.
- [ ] A `wrap`/`scalefit` rule is honored while default is `flowclip`, and vice-versa.
- [ ] Each of the 3 clipboard presets changes the copied text in Reading View, Live Preview and Ctrl+C.

### 9.5 Order of work
1. Behavior resolver + data attribute + CSS cleanup (9.2) 2. Single sticky bar (9.1) 3. Clipboard model/UI/pipeline (9.3) 4. Theme + settings UI (§4) 5. Debug cleanup.
