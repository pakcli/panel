/**
 * treeEditorSuggest.ts
 * Native-grade interactive inline autocomplete for panel-tree codeblocks and fence language types in Obsidian.
 *
 * Supported Autocomplete Modes:
 * 1. Fence Language Types: Triggers on ```, ```pa, ```panel, ```tree, ```postit, suggesting:
 *    - panel-tree-postit-cascading
 *    - panel-tree-cascading
 *    - panel-tree
 *    - panel-tree-structure
 *    - panel-tree-interactive
 *    - panel-tree-cascading-postit
 *    - panel-tree-cascading-note-sticky
 *    - tree-cascading / tree-structure
 * 2. Bare-Line Scaffolder: Triggers when typing panel-tree* or tree-* as plain text on a line,
 *    instantly offering 1-click scaffolding of a full closed codeblock.
 * 3. Inside Codeblock Directives: Triggers on f?, f, dep, status, tier, priority, tags, author, summary.
 * 4. Directive Preset Values: Triggers after f?status:, f?tier:, f?priority:, f?type:.
 * 5. Vault Wikilinks: Triggers on [[ anywhere inside codeblock lines or dependencies.
 * 6. Tree Settings: Triggers on # for layout, badges, and note-spacing configs.
 * 7. Line Starters: Triggers at beginning of lines for v folder/, > folder/, file.md, component.tsx.
 */

import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { isTreeBlockAlias } from './treeParser';
import type PakCLIPlugin from '../../main';

export type PanelTreeSuggestionKind =
    | 'codeblock-fence'
    | 'codeblock-scaffold'
    | 'directive'
    | 'preset-value'
    | 'wikilink'
    | 'setting'
    | 'starter';

export interface PanelTreeSuggestionItem {
    kind: PanelTreeSuggestionKind;
    label: string;          // Display text in dropdown
    insertText: string;     // Text inserted into editor
    detail: string;         // Secondary descriptive category/info
    badge: string;          // Visual pill badge
    cursorOffset?: number;  // Relative cursor shift after insertion
    score?: number;
}

interface TreeSuggestMatch {
    kind: PanelTreeSuggestionKind;
    query: string;
    colStart: number;
    colEnd: number;
    items: PanelTreeSuggestionItem[];
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Codeblock Fence Types Dictionaries
// ───────────────────────────────────────────────────────────────────────────

const FENCE_TYPE_SUGGESTIONS: PanelTreeSuggestionItem[] = [
    {
        kind: 'codeblock-fence',
        label: 'panel-tree-postit-cascading',
        insertText: 'panel-tree-postit-cascading',
        detail: 'Post-It sticky note card cascading tree architecture',
        badge: 'Post-It',
    },
    {
        kind: 'codeblock-fence',
        label: 'panel-tree-cascading',
        insertText: 'panel-tree-cascading',
        detail: 'Diagonal cascading branches with floating sticky notes & guidelines',
        badge: 'Cascading',
    },
    {
        kind: 'codeblock-fence',
        label: 'panel-tree',
        insertText: 'panel-tree',
        detail: 'Interactive multi-column directory tree grid with real-time editing',
        badge: 'Tree Grid',
    },
    {
        kind: 'codeblock-fence',
        label: 'panel-tree-structure',
        insertText: 'panel-tree-structure',
        detail: 'Clean directory structure and file architecture hierarchy',
        badge: 'Structure',
    },
    {
        kind: 'codeblock-fence',
        label: 'panel-tree-interactive',
        insertText: 'panel-tree-interactive',
        detail: 'Interactive tree grid with checkboxes, action pills, and status filtering',
        badge: 'Interactive',
    },
    {
        kind: 'codeblock-fence',
        label: 'panel-tree-cascading-postit',
        insertText: 'panel-tree-cascading-postit',
        detail: 'Alias: Post-it sticky note cascading tree layout',
        badge: 'Post-It',
    },
    {
        kind: 'codeblock-fence',
        label: 'panel-tree-cascading-note-sticky',
        insertText: 'panel-tree-cascading-note-sticky',
        detail: 'Alias: Sticky note cascading tree with guideline wires',
        badge: 'Sticky',
    },
    {
        kind: 'codeblock-fence',
        label: 'tree-cascading',
        insertText: 'tree-cascading',
        detail: 'Shorthand alias: Cascading diagonal branch layout',
        badge: 'Alias',
    },
    {
        kind: 'codeblock-fence',
        label: 'tree-structure',
        insertText: 'tree-structure',
        detail: 'Shorthand alias: Directory structure tree layout',
        badge: 'Alias',
    },
    {
        kind: 'codeblock-fence',
        label: 'timeline-narrative',
        insertText: 'timeline-narrative',
        detail: 'Interactive narrative flowchart with jumps and sentence nodes',
        badge: 'Timeline',
    },
    {
        kind: 'codeblock-fence',
        label: 'timeline-tree',
        insertText: 'timeline-tree',
        detail: 'Hierarchical timeline tree view with milestone connections',
        badge: 'Timeline',
    },
];

// ───────────────────────────────────────────────────────────────────────────
// 2. Directives & Presets Dictionaries
// ───────────────────────────────────────────────────────────────────────────

const DIRECTIVE_SUGGESTIONS: PanelTreeSuggestionItem[] = [
    {
        kind: 'directive',
        label: 'f?dependencies: [...]',
        insertText: 'f?dependencies: []',
        detail: 'Link prerequisites or required vault notes',
        badge: 'f?',
        cursorOffset: 16, // places cursor inside []
    },
    {
        kind: 'directive',
        label: 'f?status: active',
        insertText: 'f?status: active',
        detail: 'Lifecycle state (draft, active, wip, done, planned)',
        badge: 'f?',
        cursorOffset: 15,
    },
    {
        kind: 'directive',
        label: 'f?tier: S',
        insertText: 'f?tier: S',
        detail: 'Tierlist ranking (S, A, B, C, D)',
        badge: 'f?',
        cursorOffset: 9,
    },
    {
        kind: 'directive',
        label: 'f?priority: high',
        insertText: 'f?priority: high',
        detail: 'Priority level (critical, high, medium, low)',
        badge: 'f?',
        cursorOffset: 15,
    },
    {
        kind: 'directive',
        label: 'f?tags: [...]',
        insertText: 'f?tags: []',
        detail: 'Taxonomy tags or categories',
        badge: 'f?',
        cursorOffset: 9, // places cursor inside []
    },
    {
        kind: 'directive',
        label: 'f?author: ""',
        insertText: 'f?author: ""',
        detail: 'Assignee, author, or module owner',
        badge: 'f?',
        cursorOffset: 10,
    },
    {
        kind: 'directive',
        label: 'f?summary: ""',
        insertText: 'f?summary: ""',
        detail: 'Concise note or component description',
        badge: 'f?',
        cursorOffset: 11,
    },
    {
        kind: 'directive',
        label: 'f?type: component',
        insertText: 'f?type: component',
        detail: 'Architectural archetype (spec, component, hook, service)',
        badge: 'f?',
        cursorOffset: 17,
    },
];

const STATUS_PRESETS: PanelTreeSuggestionItem[] = [
    { kind: 'preset-value', label: 'draft', insertText: 'draft', detail: 'Initial drafting or blueprint phase', badge: 'Status' },
    { kind: 'preset-value', label: 'active', insertText: 'active', detail: 'Actively in progress / maintained', badge: 'Status' },
    { kind: 'preset-value', label: 'wip', insertText: 'wip', detail: 'Work in progress', badge: 'Status' },
    { kind: 'preset-value', label: 'done', insertText: 'done', detail: 'Verified and completed', badge: 'Status' },
    { kind: 'preset-value', label: 'planned', insertText: 'planned', detail: 'Scheduled for future sprint', badge: 'Status' },
    { kind: 'preset-value', label: 'review', insertText: 'review', detail: 'Under peer review or automated audit', badge: 'Status' },
    { kind: 'preset-value', label: 'archived', insertText: 'archived', detail: 'Deprecated or archived reference', badge: 'Status' },
];

const TIER_PRESETS: PanelTreeSuggestionItem[] = [
    { kind: 'preset-value', label: 'S', insertText: 'S', detail: 'Tier S: Foundational / Mission-Critical', badge: 'Tier' },
    { kind: 'preset-value', label: 'A', insertText: 'A', detail: 'Tier A: High Impact Core Feature', badge: 'Tier' },
    { kind: 'preset-value', label: 'B', insertText: 'B', detail: 'Tier B: Standard Feature / Utility', badge: 'Tier' },
    { kind: 'preset-value', label: 'C', insertText: 'C', detail: 'Tier C: Minor Enhancement / Nice-to-have', badge: 'Tier' },
    { kind: 'preset-value', label: 'D', insertText: 'D', detail: 'Tier D: Experimental / Backlog', badge: 'Tier' },
];

const PRIORITY_PRESETS: PanelTreeSuggestionItem[] = [
    { kind: 'preset-value', label: 'critical', insertText: 'critical', detail: 'Immediate Blocker / P0', badge: 'Priority' },
    { kind: 'preset-value', label: 'high', insertText: 'high', detail: 'High Priority / P1', badge: 'Priority' },
    { kind: 'preset-value', label: 'medium', insertText: 'medium', detail: 'Normal Priority / P2', badge: 'Priority' },
    { kind: 'preset-value', label: 'low', insertText: 'low', detail: 'Low Priority / P3', badge: 'Priority' },
];

const TYPE_PRESETS: PanelTreeSuggestionItem[] = [
    { kind: 'preset-value', label: 'spec', insertText: 'spec', detail: 'Specification / Brief Document', badge: 'Type' },
    { kind: 'preset-value', label: 'component', insertText: 'component', detail: 'UI or Visual Component', badge: 'Type' },
    { kind: 'preset-value', label: 'service', insertText: 'service', detail: 'Backend / Business Logic Service', badge: 'Type' },
    { kind: 'preset-value', label: 'hook', insertText: 'hook', detail: 'State Controller / React Hook', badge: 'Type' },
    { kind: 'preset-value', label: 'util', insertText: 'util', detail: 'Utility Function or Helper', badge: 'Type' },
    { kind: 'preset-value', label: 'model', insertText: 'model', detail: 'Data Schema or Type Definition', badge: 'Type' },
    { kind: 'preset-value', label: 'doc', insertText: 'doc', detail: 'Documentation or Reference Note', badge: 'Type' },
];

const SETTING_SUGGESTIONS: PanelTreeSuggestionItem[] = [
    { kind: 'setting', label: '# badges: folder', insertText: '# badges: folder', detail: 'Show badges only on directory nodes', badge: 'Config' },
    { kind: 'setting', label: '# badges: all', insertText: '# badges: all', detail: 'Show badges across all items', badge: 'Config' },
    { kind: 'setting', label: '# badges: none', insertText: '# badges: none', detail: 'Hide line badges', badge: 'Config' },
    { kind: 'setting', label: '# note-spacing: 1', insertText: '# note-spacing: 1', detail: 'Compact 1-space comment alignment', badge: 'Config' },
    { kind: 'setting', label: '# note-spacing: 2', insertText: '# note-spacing: 2', detail: 'Spaced 2-space comment alignment', badge: 'Config' },
    { kind: 'setting', label: '# note-gap: 24', insertText: '# note-gap: 24', detail: 'Fixed column gap width in pixels', badge: 'Config' },
    { kind: 'setting', label: '# layout: cascading', insertText: '# layout: cascading', detail: 'Cascading diagonal branch layout', badge: 'Config' },
    { kind: 'setting', label: '# layout: postit', insertText: '# layout: postit', detail: 'Post-it sticky note cards layout', badge: 'Config' },
    { kind: 'setting', label: '# layout: tree', insertText: '# layout: tree', detail: 'Standard vertical tree layout', badge: 'Config' },
];

const STARTER_SUGGESTIONS: PanelTreeSuggestionItem[] = [
    { kind: 'starter', label: 'v folder/', insertText: 'v folder/', detail: 'Collapsible folder branch node', badge: 'Folder', cursorOffset: 9 },
    { kind: 'starter', label: '> folder/', insertText: '> folder/', detail: 'Collapsed folder branch node', badge: 'Folder', cursorOffset: 9 },
    { kind: 'starter', label: 'feature.md', insertText: 'feature.md', detail: 'Markdown document note', badge: 'File', cursorOffset: 10 },
    { kind: 'starter', label: 'component.tsx', insertText: 'component.tsx', detail: 'UI Component file', badge: 'File', cursorOffset: 13 },
    { kind: 'starter', label: 'service.ts', insertText: 'service.ts', detail: 'TypeScript service module', badge: 'File', cursorOffset: 10 },
];

// ───────────────────────────────────────────────────────────────────────────
// PanelTreeEditorSuggest Implementation
// ───────────────────────────────────────────────────────────────────────────

export class PanelTreeEditorSuggest extends EditorSuggest<PanelTreeSuggestionItem> {
    constructor(app: App, private plugin?: PakCLIPlugin) {
        super(app);
    }

    /**
     * Determines whether active cursor matches a trigger:
     * 1. Codeblock fence typing (```panel*, ```tree*)
     * 2. Bare-line codeblock scaffolding (panel-tree*)
     * 3. Inside codeblock directives, presets, wikilinks, settings, starters
     */
    onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile): EditorSuggestTriggerInfo | null {
        const lineCount = editor.lineCount();
        const currentLine = editor.getLine(cursor.line);
        const textBeforeCursor = currentLine.slice(0, cursor.ch);

        // ─── TRIGGER MODE 1: Codeblock Fence Line (```<lang>) ───
        const fenceMatch = textBeforeCursor.match(/^```+([a-zA-Z0-9_-]*)$/);
        if (fenceMatch) {
            const query = fenceMatch[1].toLowerCase();
            const colStart = cursor.ch - fenceMatch[1].length;
            const colEnd = cursor.ch;

            const filtered = this.getFenceTypeSuggestions(query);
            if (filtered.length > 0) {
                return {
                    start: { line: cursor.line, ch: colStart },
                    end: { line: cursor.line, ch: colEnd },
                    query,
                };
            }
        }

        // ─── TRIGGER MODE 2: Bare Line Codeblock Scaffolder (panel-tree* without backticks) ───
        const scaffoldMatch = textBeforeCursor.match(/^(\s*)(panel(?:-tree)?(?:-[a-zA-Z0-9_-]*)?|tree(?:-[a-zA-Z0-9_-]*)?)$/i);
        if (scaffoldMatch) {
            const query = scaffoldMatch[2].toLowerCase();
            const colStart = scaffoldMatch[1].length;
            const colEnd = cursor.ch;

            const filtered = this.getScaffoldSuggestions(query);
            if (filtered.length > 0) {
                return {
                    start: { line: cursor.line, ch: colStart },
                    end: { line: cursor.line, ch: colEnd },
                    query,
                };
            }
        }

        // ─── TRIGGER MODE 3: Inside a Panel-Tree Codeblock ───
        // 1. Scan upwards to find opening fence
        let codeblockStart = -1;
        let codeblockEnd = -1;

        for (let l = cursor.line - 1; l >= 0; l--) {
            const line = editor.getLine(l);
            const openMatch = line.match(/^```+\s*([a-zA-Z0-9_-]+)/);
            if (openMatch) {
                if (isTreeBlockAlias(openMatch[1])) {
                    codeblockStart = l;
                    break;
                } else {
                    return null; // Inside an unrelated non-tree codeblock
                }
            }
            if (/^```+/.test(line.trim())) {
                return null; // Closing fence of previous block
            }
        }

        if (codeblockStart === -1) {
            return null; // Not inside a tree codeblock
        }

        // 2. Scan downwards (codeblock is valid even if closing fence is not yet typed)
        for (let l = cursor.line + 1; l < lineCount; l++) {
            const line = editor.getLine(l);
            if (/^```+\s*$/.test(line.trim())) {
                codeblockEnd = l;
                break;
            }
            if (/^```+\s*[a-zA-Z0-9_-]+/.test(line.trim())) {
                // Next codeblock started
                break;
            }
        }

        if (codeblockEnd !== -1 && cursor.line >= codeblockEnd) {
            return null; // On or past the closing fence
        }

        // 3. Inspect line text before cursor for active inside-codeblock triggers
        const match = this.detectInsideCodeblockMatch(currentLine, cursor.ch);
        if (!match || match.items.length === 0) {
            return null;
        }

        return {
            start: { line: cursor.line, ch: match.colStart },
            end: { line: cursor.line, ch: match.colEnd },
            query: match.query,
        };
    }

    /**
     * Extracts suggestions matching the active trigger query.
     */
    getSuggestions(context: EditorSuggestContext): PanelTreeSuggestionItem[] {
        const line = context.editor.getLine(context.start.line);
        const textBefore = line.slice(0, context.end.ch);

        // 1. Fence check
        const fenceMatch = textBefore.match(/^```+([a-zA-Z0-9_-]*)$/);
        if (fenceMatch) {
            return this.getFenceTypeSuggestions(fenceMatch[1].toLowerCase());
        }

        // 2. Bare-line scaffold check
        const scaffoldMatch = textBefore.match(/^(\s*)(panel(?:-tree)?(?:-[a-zA-Z0-9_-]*)?|tree(?:-[a-zA-Z0-9_-]*)?)$/i);
        if (scaffoldMatch) {
            return this.getScaffoldSuggestions(scaffoldMatch[2].toLowerCase());
        }

        // 3. Inside codeblock match
        const match = this.detectInsideCodeblockMatch(line, context.end.ch);
        return match ? match.items : [];
    }

    /**
     * Renders each suggestion item in Obsidian's autocomplete popup menu.
     */
    renderSuggestion(item: PanelTreeSuggestionItem, el: HTMLElement): void {
        el.addClass('pakcli-tree-suggest-item');

        const badge = el.createSpan({ cls: `tree-suggest-badge badge-${item.kind}` });
        badge.setText(item.badge);

        const contentWrapper = el.createDiv({ cls: 'tree-suggest-content' });
        const label = contentWrapper.createSpan({ cls: 'tree-suggest-label' });
        label.setText(item.label);

        const detail = contentWrapper.createSpan({ cls: 'tree-suggest-detail' });
        detail.setText(item.detail);
    }

    /**
     * Applies the selected suggestion with intelligent cursor positioning and codeblock auto-closing.
     */
    selectSuggestion(item: PanelTreeSuggestionItem, _evt: MouseEvent | KeyboardEvent): void {
        if (!this.context) return;
        const editor = this.context.editor;
        const lineCount = editor.lineCount();
        const startLine = this.context.start.line;

        // A. Codeblock Fence Selection (```pa -> ```panel-tree-postit-cascading)
        if (item.kind === 'codeblock-fence') {
            let hasClosingBelow = false;
            for (let l = startLine + 1; l < lineCount; l++) {
                const text = editor.getLine(l).trim();
                if (/^```+\s*$/.test(text)) {
                    hasClosingBelow = true;
                    break;
                }
                if (/^```+/.test(text)) break;
            }

            if (hasClosingBelow) {
                // Editing existing fence: replace language identifier only
                editor.replaceRange(item.insertText, this.context.start, this.context.end);
                editor.setCursor({
                    line: startLine,
                    ch: this.context.start.ch + item.insertText.length,
                });
            } else {
                // New codeblock: insert language, boilerplate item, and closing fence
                const insertSnippet = `${item.insertText}\nv data\n\`\`\`\n`;
                editor.replaceRange(insertSnippet, this.context.start, this.context.end);
                editor.setCursor({
                    line: startLine + 1,
                    ch: 6, // right after "v data"
                });
            }
            return;
        }

        // B. Bare-Line Scaffold Selection (panel-tree... on empty line -> full ```panel-tree...``` block)
        if (item.kind === 'codeblock-scaffold') {
            const scaffold = `\`\`\`${item.insertText}\nv data\n\`\`\`\n`;
            const lineStart = { line: startLine, ch: 0 };
            const lineEnd = { line: startLine, ch: editor.getLine(startLine).length };
            editor.replaceRange(scaffold, lineStart, lineEnd);
            editor.setCursor({
                line: startLine + 1,
                ch: 6, // right after "v data"
            });
            return;
        }

        // C. Standard Inside-Codeblock Replacement
        const insertText = item.insertText;
        editor.replaceRange(insertText, this.context.start, this.context.end);

        const offset = item.cursorOffset !== undefined ? item.cursorOffset : insertText.length;
        editor.setCursor({
            line: startLine,
            ch: this.context.start.ch + offset,
        });
    }

    // ───────────────────────────────────────────────────────────────────────
    // Internal Detection & Matching Logic
    // ───────────────────────────────────────────────────────────────────────

    private getFenceTypeSuggestions(query: string): PanelTreeSuggestionItem[] {
        if (!query) return FENCE_TYPE_SUGGESTIONS;
        const q = query.toLowerCase();
        return FENCE_TYPE_SUGGESTIONS.filter((item) =>
            item.insertText.toLowerCase().includes(q) ||
            item.detail.toLowerCase().includes(q) ||
            item.badge.toLowerCase().includes(q)
        );
    }

    private getScaffoldSuggestions(query: string): PanelTreeSuggestionItem[] {
        const q = query.toLowerCase();
        return FENCE_TYPE_SUGGESTIONS
            .filter((item) =>
                item.insertText.toLowerCase().includes(q) ||
                item.detail.toLowerCase().includes(q)
            )
            .map((item) => ({
                ...item,
                kind: 'codeblock-scaffold' as PanelTreeSuggestionKind,
                label: `\`\`\`${item.insertText}`,
                detail: `Insert ${item.detail} codeblock`,
            }));
    }

    private detectInsideCodeblockMatch(line: string, cursorCh: number): TreeSuggestMatch | null {
        const textBeforeCursor = line.slice(0, cursorCh);

        // A. Wikilink Trigger: [[ inside dependencies or notes
        const wikilinkMatch = textBeforeCursor.match(/\[\[([^\]|]*)$/);
        if (wikilinkMatch) {
            const query = wikilinkMatch[1];
            const colStart = cursorCh - (query.length + 2); // include [[
            const colEnd = cursorCh;
            const items = this.getVaultNoteSuggestions(query);
            if (items.length > 0) {
                return { kind: 'wikilink', query, colStart, colEnd, items };
            }
        }

        // B. Preset Values Trigger: f?status:, f?tier:, f?priority:, f?type: (or bare status:, tier:, etc.)
        const presetMatch = textBeforeCursor.match(/(?:f\?)?(status|tier|priority|type):\s*([a-zA-Z0-9_-]*)$/i);
        if (presetMatch) {
            const directive = presetMatch[1].toLowerCase();
            const query = (presetMatch[2] || '').toLowerCase();
            const colStart = cursorCh - query.length;
            const colEnd = cursorCh;

            let sourceList: PanelTreeSuggestionItem[] = [];
            if (directive === 'status') sourceList = STATUS_PRESETS;
            else if (directive === 'tier') sourceList = TIER_PRESETS;
            else if (directive === 'priority') sourceList = PRIORITY_PRESETS;
            else if (directive === 'type') sourceList = TYPE_PRESETS;

            const filtered = sourceList.filter((item) =>
                item.insertText.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query)
            );

            if (filtered.length > 0) {
                return { kind: 'preset-value', query, colStart, colEnd, items: filtered };
            }
        }

        // C. Directive Name Trigger: f?, f, dep, status, tier, priority, tags, author, summary, type
        const directiveMatch = textBeforeCursor.match(/(?:^|\s)(f(?:\?[a-zA-Z0-9_-]*)?|dep(?:endencies)?|stat(?:us)?|tier|prio(?:rity)?|tag(?:s)?|auth(?:or)?|sum(?:mary)?|type)$/i);
        if (directiveMatch) {
            const raw = directiveMatch[1].toLowerCase();
            const colStart = cursorCh - raw.length;
            const colEnd = cursorCh;

            const queryClean = raw.startsWith('f?') ? raw.slice(2) : (raw === 'f' ? '' : raw);
            const filtered = DIRECTIVE_SUGGESTIONS.filter((item) =>
                !queryClean || item.insertText.toLowerCase().includes(queryClean) || item.detail.toLowerCase().includes(queryClean)
            );

            if (filtered.length > 0) {
                return { kind: 'directive', query: raw, colStart, colEnd, items: filtered };
            }
        }

        // D. Settings Config Trigger: # badges:, # note-spacing:, etc.
        const settingMatch = textBeforeCursor.match(/(?:^|\s)(#[a-zA-Z0-9_ -]*)$/i);
        if (settingMatch) {
            const raw = settingMatch[1].toLowerCase();
            const colStart = cursorCh - raw.length;
            const colEnd = cursorCh;

            const filtered = SETTING_SUGGESTIONS.filter((item) =>
                item.insertText.toLowerCase().includes(raw) || item.detail.toLowerCase().includes(raw)
            );

            if (filtered.length > 0) {
                return { kind: 'setting', query: raw, colStart, colEnd, items: filtered };
            }
        }

        // E. Starter Snippets Trigger: at the beginning of empty or single-character lines
        const starterMatch = textBeforeCursor.match(/^(\s*)([vfc>s]?)$/i);
        if (starterMatch && cursorCh <= starterMatch[1].length + 1) {
            const query = (starterMatch[2] || '').toLowerCase();
            const colStart = cursorCh - query.length;
            const colEnd = cursorCh;

            const filtered = query
                ? STARTER_SUGGESTIONS.filter((item) => item.insertText.toLowerCase().startsWith(query))
                : STARTER_SUGGESTIONS;

            if (filtered.length > 0) {
                return { kind: 'starter', query, colStart, colEnd, items: filtered };
            }
        }

        return null;
    }

    /**
     * Resolves Markdown notes from vault cache for [[wikilink]] suggestions.
     */
    private getVaultNoteSuggestions(query: string): PanelTreeSuggestionItem[] {
        const cleanQuery = query.toLowerCase().trim();
        const files = this.app.vault.getMarkdownFiles();
        const results: PanelTreeSuggestionItem[] = [];

        for (const file of files) {
            const baseName = file.basename;
            const path = file.path;

            if (!cleanQuery || baseName.toLowerCase().includes(cleanQuery) || path.toLowerCase().includes(cleanQuery)) {
                results.push({
                    kind: 'wikilink',
                    label: `[[${baseName}]]`,
                    insertText: `[[${baseName}]]`,
                    detail: path !== `${baseName}.md` ? path : 'Vault Note',
                    badge: 'Note',
                });
            }

            if (results.length >= 25) break; // Limit dropdown list size for performance
        }

        return results;
    }
}
