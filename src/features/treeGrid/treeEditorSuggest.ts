/**
 * treeEditorSuggest.ts
 * Interactive inline autocomplete for panel-tree codeblocks in Obsidian.
 *
 * Provides intelligent, context-aware suggestions for:
 * 1. Frontmatter directives: f?dependencies:, f?status:, f?tier:, f?priority:, f?tags:, etc.
 * 2. Preset values: active/wip/done for status, S/A/B/C/D for tier, critical/high/medium for priority.
 * 3. Vault note wikilinks: [[NoteName]] inside dependencies or notes.
 * 4. Tree configuration directives: # badges: folder, # note-spacing: 1/2, # layout: cascading.
 * 5. Architectural line starters: v folder/, file.md, component.tsx.
 */

import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { isTreeBlockAlias } from './treeParser';
import type PakCLIPlugin from '../../main';

export type PanelTreeSuggestionKind =
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
// Preset Dictionaries
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
];

const SETTING_SUGGESTIONS: PanelTreeSuggestionItem[] = [
    { kind: 'setting', label: '# badges: folder', insertText: '# badges: folder', detail: 'Show badges only on directory nodes', badge: 'Config' },
    { kind: 'setting', label: '# badges: all', insertText: '# badges: all', detail: 'Show badges across all items', badge: 'Config' },
    { kind: 'setting', label: '# badges: none', insertText: '# badges: none', detail: 'Hide line badges', badge: 'Config' },
    { kind: 'setting', label: '# note-spacing: 1', insertText: '# note-spacing: 1', detail: 'Compact 1-space comment alignment', badge: 'Config' },
    { kind: 'setting', label: '# note-spacing: 2', insertText: '# note-spacing: 2', detail: 'Spaced 2-space comment alignment', badge: 'Config' },
    { kind: 'setting', label: '# layout: tree', insertText: '# layout: tree', detail: 'Standard vertical tree layout', badge: 'Config' },
    { kind: 'setting', label: '# layout: cascading', insertText: '# layout: cascading', detail: 'Cascading diagonal branch layout', badge: 'Config' },
];

const STARTER_SUGGESTIONS: PanelTreeSuggestionItem[] = [
    { kind: 'starter', label: 'v folder/', insertText: 'v folder/', detail: 'Collapsible folder branch', badge: 'Branch', cursorOffset: 9 },
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
     * Determines whether the cursor is inside a panel-tree codeblock and matches an active trigger.
     */
    onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile): EditorSuggestTriggerInfo | null {
        const lineCount = editor.lineCount();
        let codeblockStart = -1;
        let codeblockEnd = -1;

        // 1. Scan upwards to verify we are inside a panel-tree codeblock fence
        for (let l = cursor.line; l >= 0; l--) {
            const line = editor.getLine(l);
            const openMatch = line.match(/^```+\s*([a-zA-Z0-9_-]+)/);
            if (openMatch) {
                if (isTreeBlockAlias(openMatch[1])) {
                    codeblockStart = l;
                    break;
                } else {
                    return null; // Inside another non-tree codeblock
                }
            }
            if (l < cursor.line && /^```+/.test(line.trim())) {
                return null; // Closing fence found before start
            }
        }

        if (codeblockStart === -1 || codeblockStart === cursor.line) {
            return null; // Not inside codeblock or on the opening fence line
        }

        // 2. Scan downwards to find closing fence
        for (let l = cursor.line; l < lineCount; l++) {
            const line = editor.getLine(l);
            if (/^```+\s*$/.test(line.trim())) {
                codeblockEnd = l;
                break;
            }
        }

        if (codeblockEnd === -1 || cursor.line >= codeblockEnd) {
            return null; // Unclosed or on closing fence line
        }

        // 3. Inspect line text before cursor for active triggers
        const currentLine = editor.getLine(cursor.line);
        const match = this.detectTriggerMatch(currentLine, cursor.ch);

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
        const match = this.detectTriggerMatch(line, context.end.ch);
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
     * Applies the selected suggestion with cursor positioning.
     */
    selectSuggestion(item: PanelTreeSuggestionItem, _evt: MouseEvent | KeyboardEvent): void {
        if (!this.context) return;
        const editor = this.context.editor;
        const insertText = item.insertText;

        editor.replaceRange(insertText, this.context.start, this.context.end);

        const offset = item.cursorOffset !== undefined ? item.cursorOffset : insertText.length;
        editor.setCursor({
            line: this.context.start.line,
            ch: this.context.start.ch + offset,
        });
    }

    // ───────────────────────────────────────────────────────────────────────
    // Internal Detection & Matching Logic
    // ───────────────────────────────────────────────────────────────────────

    private detectTriggerMatch(line: string, cursorCh: number): TreeSuggestMatch | null {
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

        // B. Preset Values Trigger: f?status:, f?tier:, f?priority:, f?type:
        const presetMatch = textBeforeCursor.match(/(f\?(?:status|tier|priority|type)):\s*([a-zA-Z0-9_-]*)$/i);
        if (presetMatch) {
            const directive = presetMatch[1].toLowerCase();
            const query = (presetMatch[2] || '').toLowerCase();
            const colStart = cursorCh - query.length;
            const colEnd = cursorCh;

            let sourceList: PanelTreeSuggestionItem[] = [];
            if (directive === 'f?status') sourceList = STATUS_PRESETS;
            else if (directive === 'f?tier') sourceList = TIER_PRESETS;
            else if (directive === 'f?priority') sourceList = PRIORITY_PRESETS;
            else if (directive === 'f?type') sourceList = TYPE_PRESETS;

            const filtered = sourceList.filter((item) =>
                item.insertText.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query)
            );

            if (filtered.length > 0) {
                return { kind: 'preset-value', query, colStart, colEnd, items: filtered };
            }
        }

        // C. Directive Name Trigger: f? or f?dep...
        const directiveMatch = textBeforeCursor.match(/(?:^|\s)(f\?[a-zA-Z0-9_-]*)$/i);
        if (directiveMatch) {
            const query = directiveMatch[1].toLowerCase();
            const colStart = cursorCh - query.length;
            const colEnd = cursorCh;

            const filtered = DIRECTIVE_SUGGESTIONS.filter((item) =>
                item.insertText.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query)
            );

            if (filtered.length > 0) {
                return { kind: 'directive', query, colStart, colEnd, items: filtered };
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
        const starterMatch = textBeforeCursor.match(/^(\s*)([vfc]?)$/i);
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
