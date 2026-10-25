/**
 * TreeCodeblockRenderer.ts
 *
 * 3-Layer Architecture for "Table with Note Thing" Codeblock:
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  TOP HUD (top huio): Top Ruler, Column Controls (- < > :: +), Wires    │
 * │  ⚡ Dynamic Listener: Reacts to Live Editing & updates HUD in real-time │
 * ├────────────────────────────────────────────────────────────────────────┤
 * │  LAYER 1: ASCII ADDITIONS (chreon, branch simbol)                       │ ALSO 100% copy-pasteable rendered
 * │  - Chevrons (v, >) & ASCII Branch connectors (├──, └──, │)             │
 * │  - Rendered cleanly without disturbing or displacing codeblock content  │
 * ├────────────────────────────────────────────────────────────────────────┤
 * │  LAYER 0: NATIVE CODEBLOCK (layer codeblock)                           │
 * │  - 🚨 DO NOT TOUCH AND DO NOT OFFSET ANYTHING                           │
 * │  - Keep codeblock native: natural indentation, spaces, and note text   │
 * │  - Full native Live Editing experience; 100% copy-pasteable rendered    │
 * └────────────────────────────────────────────────────────────────────────┘
 */

import { MarkdownRenderChild, MarkdownPostProcessorContext, MarkdownView, Notice, TFile } from 'obsidian';
import { ParsedTreeGrid, TreeGridColumn, TreeGridNode } from './types';
import { CopyButton, PillGroup } from '../../uiComponents';
import { parseTreeGrid, serializeTreeToSource, getMaxCol0Length, getAsciiBranchPrefix, isFileName, getExtension, alignTreeBlockNotes, resolveNoteSpacing } from './treeParser';
import { buildCodeblockPrompt } from '../codeblock/codeblockPromptTemplates';

export class TreeCodeblockRenderer extends MarkdownRenderChild {
    private source: string;
    private ctx: MarkdownPostProcessorContext;
    private plugin: any;
    private parsed: ParsedTreeGrid;
    private columns: TreeGridColumn[] = [];

    // DOM Elements
    private linesContainerEl!: HTMLElement;

    // Metrics
    private charWidthPx = 8.6;
    private readonly ROW_HEIGHT_PX = 24;
    private isSyncing = false;

    constructor(
        containerEl: HTMLElement,
        source: string,
        ctx: MarkdownPostProcessorContext,
        plugin?: any
    ) {
        super(containerEl);
        this.source = source;
        this.ctx = ctx;
        this.plugin = plugin;
        this.parsed = parseTreeGrid(source);

        this.initColumns();
    }

    onload(): void {
        this.render();

        // ⚡ Dynamic Listener: Reacts to Live Editing & updates codeblock lines in real-time
        this.setupDynamicLiveListener();
    }

    onunload(): void {
        if (this.liveUpdateTimer) {
            clearTimeout(this.liveUpdateTimer);
            this.liveUpdateTimer = null;
        }
    }

    private renderRaw(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('pakcli-tree-raw-container');
        const pre = containerEl.createEl('pre', { cls: 'language-panel-tree HyperMD-codeblock' });
        pre.createEl('code', { text: this.source, cls: 'language-panel-tree' });
        if (this.plugin?.codeblockScaler) {
            this.plugin.codeblockScaler.processContainer(pre);
        }
    }

    private measureCharWidth(): void {
        const testSpan = document.createElement('span');
        testSpan.style.fontFamily = 'var(--font-monospace, monospace)';
        testSpan.style.fontSize = 'var(--code-size, 0.85rem)';
        testSpan.style.lineHeight = `${this.ROW_HEIGHT_PX}px`;
        testSpan.style.visibility = 'hidden';
        testSpan.style.position = 'absolute';
        testSpan.style.whiteSpace = 'pre';
        testSpan.textContent = 'WWWWWWWWWW0000000000'; // 20 chars
        this.containerEl.appendChild(testSpan);
        const w = testSpan.getBoundingClientRect().width / 20;
        this.containerEl.removeChild(testSpan);
        if (w > 4 && w < 30) {
            this.charWidthPx = w;
        }
    }

    private getAllNodes(nodes: TreeGridNode[]): TreeGridNode[] {
        const result: TreeGridNode[] = [];
        const traverse = (list: TreeGridNode[]) => {
            for (const n of list) {
                result.push(n);
                if (n.children && n.children.length > 0) {
                    traverse(n.children);
                }
            }
        };
        traverse(nodes);
        return result;
    }

    private initColumns(): void {
        this.columns = [];
        const total = this.parsed.totalColumns;
        const allNodes = this.getAllNodes(this.parsed.rootNodes);

        for (let i = 0; i < total; i++) {
            const title = this.parsed.columnTitles[i] || (i === 0 ? 'PATH' : '#'.repeat(i));

            let maxChars = title.length;
            if (i === 0) {
                for (const node of allNodes) {
                    const prefix = getAsciiBranchPrefix(node, this.parsed.rootNodes);
                    const chevronLen = 2;
                    const len = prefix.length + chevronLen + node.name.length;
                    if (len > maxChars) maxChars = len;
                }
            } else {
                for (const node of allNodes) {
                    const val = node.columns[i - 1] || '';
                    if (val) {
                        const len = val.length;
                        if (len > maxChars) maxChars = len;
                    }
                }
            }

            const maxTreeChars = getMaxCol0Length(this.parsed.rootNodes);
            const treeMinPx = Math.ceil((maxTreeChars + 4) * 8.6);
            const minWidth = i === 0 ? Math.max(160, treeMinPx) : 80;
            const snugWidth = Math.ceil((maxChars + 6) * 8.6);
            const width = Math.max(minWidth, Math.min(800, snugWidth));

            this.columns.push({
                id: i,
                title,
                width,
                minWidth,
            });
        }
    }

    private getFlattenedVisibleNodes(): TreeGridNode[] {
        const result: TreeGridNode[] = [];
        const traverse = (nodes: TreeGridNode[]) => {
            for (const n of nodes) {
                result.push(n);
                if (n.isDirectory && n.isExpanded) {
                    if (n.children && n.children.length > 0) {
                        traverse(n.children);
                    }
                }
            }
        };
        traverse(this.parsed.rootNodes);
        return result;
    }

    /**
     * Master Render: Builds authentic codeblock lines matching panel-tree-cascading live-editing rows:
     * - Opening fence row with ✨ Prompt and 📋 Copy buttons
     * - Authentic CodeMirror line rows (.cm-line.pakcli-tree-line) with rails and interactive fold chevrons
     * - Closing fence row
     * Zero card wrappers, zero Top HUD ruler, zero SVG wires, zero flattening!
     */
    private render(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('pakcli-tree-codeblock');
        containerEl.addClass('language-panel-tree');

        // Opening fence line with action buttons (✨ Prompt + 📋 Copy)
        const beginLine = containerEl.createDiv({
            cls: 'cm-line HyperMD-codeblock HyperMD-codeblock-begin pakcli-tree-fence-line',
        });
        beginLine.createSpan({ text: '```panel-tree', cls: 'code-block-flair' });

        const actionsWrap = beginLine.createSpan({ cls: 'pakcli-tree-header-actions' });
        const PROMPT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3Z"/><path d="M19 3v4"/><path d="M21 5h-4"/></svg>`;
        const promptBtn = actionsWrap.createEl('button', {
            cls: 'pakcli-cb-prompt-btn',
            attr: { title: 'Copy AI Prompt (panel-tree)', 'aria-label': 'Copy AI Prompt (panel-tree)' },
        });
        promptBtn.innerHTML = PROMPT_ICON;
        promptBtn.onclick = async (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const rawTree = this.getRawTreeText();
            const promptText = buildCodeblockPrompt(rawTree, 'panel-tree');
            try {
                if (this.plugin?.codeblockScaler) {
                    await this.plugin.codeblockScaler.writeToClipboard(promptText);
                } else {
                    await navigator.clipboard.writeText(promptText);
                }
            } catch {
                await navigator.clipboard.writeText(promptText);
            }
            promptBtn.classList.add('pakcli-cb-prompt-btn--done');
            setTimeout(() => promptBtn.classList.remove('pakcli-cb-prompt-btn--done'), 1200);
            new Notice('✨ Copied panel-tree AI Prompt to clipboard!', 2000);
        };

        const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        const copyBtn = actionsWrap.createEl('button', {
            cls: 'pakcli-cb-copy-btn',
            attr: { title: 'Copy tree content', 'aria-label': 'Copy tree content' },
        });
        copyBtn.innerHTML = COPY_ICON;
        copyBtn.onclick = async (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const textToCopy = this.getRawTreeText();
            try {
                if (this.plugin?.codeblockScaler) {
                    await this.plugin.codeblockScaler.writeToClipboard(textToCopy);
                } else {
                    await navigator.clipboard.writeText(textToCopy);
                }
            } catch {
                await navigator.clipboard.writeText(textToCopy);
            }
            copyBtn.classList.add('pakcli-cb-copy-btn--done');
            setTimeout(() => copyBtn.classList.remove('pakcli-cb-copy-btn--done'), 1200);
            new Notice('📋 Copied tree to clipboard!', 2000);
        };

        // Render code lines
        this.linesContainerEl = containerEl.createDiv({ cls: 'pakcli-code-lines' });
        this.renderCodeLines();

        // Closing fence line
        const endLine = containerEl.createDiv({
            cls: 'cm-line HyperMD-codeblock HyperMD-codeblock-end pakcli-tree-fence-line',
        });
        endLine.createSpan({ text: '```', cls: 'code-block-flair' });
    }

    /**
     * LAYER 0 (NATIVE CODEBLOCK) + LAYER 1 (ASCII ADDITIONS)
     * - DO NOT TOUCH AND DO NOT OFFSET ANYTHING on node.name + trailingContent!
     * - 100% genuine text; 100% copy-pasteable rendered!
     */
    private renderCodeLines(): void {
        this.linesContainerEl.empty();

        const visibleNodes = this.getFlattenedVisibleNodes();
        if (visibleNodes.length === 0) {
            const emptyEl = this.linesContainerEl.createDiv({
                cls: 'cm-line HyperMD-codeblock HyperMD-codeblock-bg pakcli-tree-empty text-muted',
            });
            emptyEl.textContent = 'Empty tree.';
            return;
        }

        for (const node of visibleNodes) {
            const lineEl = this.linesContainerEl.createDiv({
                cls: 'cm-line HyperMD-codeblock HyperMD-codeblock-bg pakcli-tree-line pakcli-code-line',
            });
            lineEl.dataset.nodeId = node.id;
            lineEl.style.height = `${this.ROW_HEIGHT_PX}px`;

            lineEl.addEventListener('mouseenter', () => {
                lineEl.addClass('cm-active');
            });
            lineEl.addEventListener('mouseleave', () => {
                lineEl.removeClass('cm-active');
            });

            // LAYER 1: Authentic ASCII tree branch prefix: ├── , └── , │
            const branchPrefix = getAsciiBranchPrefix(node, this.parsed.rootNodes);

            // Folder chevron indicator: v  or >  (or spaces for alignment/leaf files)
            const hasChildren = node.isDirectory && node.children && node.children.length > 0;
            const chevronText = node.isDirectory
                ? (hasChildren ? (node.isExpanded ? 'v ' : '> ') : '  ')
                : '  ';

            // LAYER 0: Native codeblock content: name + trailingContent
            const bodyContent = node.name + (node.trailingContent || '');

            if (branchPrefix) {
                lineEl.createSpan({ text: branchPrefix, cls: 'pakcli-tree-rails' });
            }

            if (hasChildren) {
                const chevronSpan = lineEl.createSpan({
                    cls: 'pakcli-interactive-chevron-inline pakcli-tree-chevron',
                    text: chevronText,
                });
                chevronSpan.title = node.isExpanded ? 'Click to collapse folder' : 'Click to expand folder';
                chevronSpan.onclick = (e) => {
                    e.stopPropagation();
                    node.isExpanded = !node.isExpanded;
                    this.render();
                };
            } else if (chevronText) {
                lineEl.createSpan({ text: chevronText, cls: 'pakcli-tree-chevron pakcli-tree-spacer' });
            }

            lineEl.createSpan({ text: bodyContent, cls: 'pakcli-tree-node-text' });
        }
    }

    /**
     * 100% Copy-Pasteable Plain Text Generator:
     * Produces clean, intact ASCII diagram with untouched note columns.
     */
    public getPlainTextForCopy(): string {
        const lines: string[] = [];
        const visibleNodes = this.getFlattenedVisibleNodes();
        for (const node of visibleNodes) {
            const branchPrefix = getAsciiBranchPrefix(node, this.parsed.rootNodes);
            const hasChildren = node.isDirectory && node.children && node.children.length > 0;
            const chevronText = node.isDirectory
                ? (hasChildren ? (node.isExpanded ? 'v ' : '> ') : '  ')
                : '  ';
            const bodyContent = node.name + (node.trailingContent || '');
            lines.push(branchPrefix + chevronText + bodyContent);
        }
        return lines.join('\n');
    }

    /**
     * Returns raw, declarative panel-tree syntax with intact tab indentation
     * rather than flattened or ASCII-branched text.
     */
    public getRawTreeText(): string {
        if (this.source && this.source.trim().length > 0) {
            return this.source.replace(/\r\n/g, '\n');
        }
        const allNodes = this.getAllNodes(this.parsed.rootNodes);
        if (allNodes.length === 0) return '';
        return allNodes.map((n) => {
            const tabs = '\t'.repeat(n.depth);
            const trailing = n.trailingContent ? ` ${n.trailingContent}` : '';
            return `${tabs}${n.name}${trailing}`;
        }).join('\n');
    }

    /**
     * Rule #006: Inserts a new child item into a parent folder and syncs to note
     */
    private async insertChildNode(parentNode: TreeGridNode, rawInput: string): Promise<void> {
        const trimmed = rawInput.trim();
        if (!trimmed) return;

        const isDir = !isFileName(trimmed);
        const extension = isDir ? undefined : getExtension(trimmed);

        const newChild: TreeGridNode = {
            id: `tree-node-${Date.now()}`,
            name: trimmed,
            rawName: trimmed,
            depth: parentNode.depth + 1,
            isDirectory: isDir,
            extension,
            columns: [],
            children: [],
            parent: parentNode,
            isExpanded: true,
        };

        parentNode.children.push(newChild);
        parentNode.isExpanded = true;

        await this.syncChangesToNote();
        this.render();
        new Notice(`✓ Added ${trimmed}`);
    }



    private liveUpdateTimer: any = null;

    /**
     * ⚡ Dynamic Live Editing Listener:
     * Listens to live user typing in the note and updates HUD in real-time.
     * Uses 250ms debounce to ensure live typing and overwriting are never blocked!
     */
    private setupDynamicLiveListener(): void {
        const app = this.plugin?.app;
        if (!app?.workspace) return;

        this.registerEvent(
            app.workspace.on('editor-change', (editor) => {
                if (this.isSyncing) return;
                if (!this.ctx?.sourcePath) return;

                const activeFile = app.workspace.getActiveFile();
                if (activeFile && activeFile.path === this.ctx.sourcePath) {
                    if (this.liveUpdateTimer) clearTimeout(this.liveUpdateTimer);
                    this.liveUpdateTimer = setTimeout(() => {
                        const sectionInfo = this.ctx.getSectionInfo?.(this.containerEl);
                        if (sectionInfo) {
                            const fileContent = editor.getValue();
                            const lines = fileContent.split(/\r?\n/);
                            if (sectionInfo.lineStart < lines.length && sectionInfo.lineEnd <= lines.length) {
                                const newSource = lines.slice(sectionInfo.lineStart + 1, sectionInfo.lineEnd).join('\n');
                                if (newSource.trim() !== this.source.trim()) {
                                    this.source = newSource;
                                    this.parsed = parseTreeGrid(newSource);
                                    this.initColumns();
                                    this.render();
                                }
                            }
                        }
                    }, 250);
                }
            })
        );
    }



    public async alignNotesAction(customGap?: unknown): Promise<void> {
        const gap = customGap ?? this.plugin?.settings?.treeNoteSpacing ?? 1;
        const lines = this.source.split(/\r?\n/);
        const aligned = alignTreeBlockNotes(lines, gap);
        const newSource = aligned.join('\n');
        if (newSource === this.source) {
            new Notice('✓ # Notes are already vertically aligned');
            return;
        }

        this.source = newSource;
        this.parsed = parseTreeGrid(newSource);
        this.initColumns();
        this.render();
        await this.syncChangesToNote();
        const effectiveGap = resolveNoteSpacing(gap, 1);
        new Notice(`✓ Auto-aligned all # notes (gap: ${effectiveGap} space)`);
    }

    private async syncChangesToNote(): Promise<void> {
        const app = this.plugin?.app;
        if (!app?.vault || !this.ctx?.sourcePath) return;

        try {
            this.isSyncing = true;
            const file = app.vault.getAbstractFileByPath(this.ctx.sourcePath);
            if (!(file instanceof TFile)) return;

            const col0WidthPx = this.columns[0]?.width || 200;
            const col0TargetChars = Math.max(10, Math.round(col0WidthPx / this.charWidthPx));

            const colWidthsTargetChars: number[] = [];
            for (let i = 1; i < this.columns.length; i++) {
                const w = this.columns[i]?.width || 120;
                colWidthsTargetChars[i] = Math.max(4, Math.round(w / this.charWidthPx));
            }

            const newLines = serializeTreeToSource(
                this.parsed.rootNodes,
                col0TargetChars,
                colWidthsTargetChars
            );
            const newSource = newLines.join('\n');

            const activeView = app.workspace.getActiveViewOfType(MarkdownView);
            const sectionInfo = this.ctx.getSectionInfo?.(this.containerEl);

            if (
                activeView &&
                activeView.file?.path === this.ctx.sourcePath &&
                sectionInfo &&
                sectionInfo.lineStart !== undefined &&
                sectionInfo.lineEnd !== undefined
            ) {
                const editor = activeView.editor;
                const from = { line: sectionInfo.lineStart + 1, ch: 0 };
                const to = { line: sectionInfo.lineEnd, ch: 0 };
                editor.replaceRange(newSource + '\n', from, to);
                this.source = newSource;
                new Notice('✓ Updated codeblock lines');
                return;
            }

            const fileContent = await app.vault.read(file);

            let updatedContent = '';
            let replaced = false;

            if (sectionInfo && sectionInfo.lineStart !== undefined && sectionInfo.lineEnd !== undefined) {
                const lines = fileContent.split(/\r?\n/);
                if (sectionInfo.lineStart < lines.length && sectionInfo.lineEnd < lines.length) {
                    const before = lines.slice(0, sectionInfo.lineStart + 1);
                    const after = lines.slice(sectionInfo.lineEnd);
                    updatedContent = [...before, ...newLines, ...after].join('\n');
                    replaced = true;
                }
            }

            if (!replaced) {
                const normFile = fileContent.replace(/\r\n/g, '\n');
                const normSource = this.source.replace(/\r\n/g, '\n').trim();

                if (normFile.includes(normSource)) {
                    updatedContent = normFile.replace(normSource, newSource);
                    replaced = true;
                }
            }

            if (replaced) {
                this.source = newSource;
                await app.vault.modify(file, updatedContent);
                new Notice('✓ Updated codeblock lines');
            }
        } catch (err) {
            console.warn('[TreeGrid] Failed to sync changes to note:', err);
        } finally {
            this.isSyncing = false;
        }
    }
}
