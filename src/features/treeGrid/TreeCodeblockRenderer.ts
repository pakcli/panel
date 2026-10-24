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
    private cardContainerEl!: HTMLElement;
    private topHudEl!: HTMLElement;
    private bodyEl!: HTMLElement;
    private linesContainerEl!: HTMLElement;
    private svgOverlayEl!: SVGSVGElement;

    // Metrics
    private charWidthPx = 8.6;
    private readonly ROW_HEIGHT_PX = 24;
    private paddingLeftPx = 10;
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
        this.renderRaw();

        // ⚡ Dynamic Listener: Reacts to Live Editing & updates RAW codeblock in real-time
        this.setupDynamicLiveListener();
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
                    const chevronLen = node.isDirectory ? 2 : (node.depth === 0 ? 2 : 0);
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
     * Master Render: Builds Card, Top HUD, Background SVG Wires, and Native Codeblock Lines
     */
    private render(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('pakcli-tree-root-container');

        // Card Container holding the Live Preview Codeblock
        this.cardContainerEl = containerEl.createDiv({
            cls: 'pakcli-tree-card-container HyperMD-codeblock-bg',
        });

        // ══════════════════════════════════════════════════════════════════
        // TOP HUD (top huio): Top Ruler, Column Controls (- < > :: +), Copy
        // ══════════════════════════════════════════════════════════════════
        this.topHudEl = this.cardContainerEl.createDiv({
            cls: 'pakcli-tree-top-hud',
        });

        // 📋 1-Click Copy Button inside Top HUD
        new CopyButton({
            containerEl: this.topHudEl,
            cls: 'pakcli-tree-copy-btn',
            tooltip: 'Copy clean formatted tree',
            textGetter: () => this.getPlainTextForCopy(),
        });

        // ✨ Copy AI Prompt Button inside Top HUD
        new CopyButton({
            containerEl: this.topHudEl,
            cls: 'pakcli-tree-prompt-btn',
            label: '✨ Prompt',
            tooltip: 'Copy AI Prompt to scaffold this tree architecture',
            textGetter: () => buildCodeblockPrompt(this.getPlainTextForCopy(), 'panel-tree'),
            successMessage: '✨ Copied Tree AI Prompt to clipboard!',
        });

        // ⚡ Align # Notes Button inside Top HUD
        const currentGap = resolveNoteSpacing(this.plugin?.settings?.treeNoteSpacing, 1);
        const alignBtn = this.topHudEl.createSpan({
            cls: 'pakcli-tree-hud-btn pakcli-align-btn',
            text: `⚡ Align # Notes (${currentGap}sp)`,
            attr: { title: `Auto-align all # comments across this tree (longest word + ${currentGap} space). Click to format.` },
        });
        alignBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.alignNotesAction();
        });

        // 📏 Gap / Spacing button (number or sentence word count)
        const gapBtn = this.topHudEl.createSpan({
            cls: 'pakcli-tree-hud-btn pakcli-gap-btn',
            text: `Gap: ${currentGap}`,
            attr: { title: 'Adjust note spacing: enter number (e.g. 1, 4) or sentence (checks word count)' },
        });
        gapBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const val = prompt('Set note spacing:\nEnter number (e.g. 1, 4) or sentence (word count is used):', String(currentGap));
            if (val !== null) {
                await this.alignNotesAction(val);
            }
        });

        // Main Tree Body (relative wrapper for background wires and code lines)
        this.bodyEl = this.cardContainerEl.createDiv({ cls: 'pakcli-tree-body' });

        // Background Guideline SVG Wire Layer (strictly pointer-events: none)
        this.svgOverlayEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgOverlayEl.setAttribute('class', 'pakcli-tree-svg-overlay');
        this.bodyEl.appendChild(this.svgOverlayEl);

        // ══════════════════════════════════════════════════════════════════
        // LAYER 0 + LAYER 1: Codeblock Lines (100% Copy-Pasteable Authentic Text)
        // ══════════════════════════════════════════════════════════════════
        this.linesContainerEl = this.bodyEl.createDiv({ cls: 'pakcli-code-lines' });
        this.renderCodeLines();

        // Render Top HUD items and guideline wires
        this.renderTopHUD();
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
                cls: 'cm-line HyperMD-codeblock HyperMD-codeblock-bg pakcli-code-line',
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
                : (node.depth === 0 ? '  ' : '');

            // LAYER 0: Native codeblock content: name + trailingContent (UNTOUCHED! 0% artificial offset!)
            const bodyContent = node.name + (node.trailingContent || '');

            if (hasChildren) {
                if (branchPrefix) {
                    lineEl.createSpan({ text: branchPrefix });
                }
                const chevronSpan = lineEl.createSpan({
                    cls: 'pakcli-interactive-chevron-inline',
                    text: chevronText,
                });
                chevronSpan.title = node.isExpanded ? 'Click to collapse folder' : 'Click to expand folder';
                chevronSpan.onclick = (e) => {
                    e.stopPropagation();
                    node.isExpanded = !node.isExpanded;
                    this.render();
                };
                lineEl.createSpan({ text: bodyContent });
            } else {
                lineEl.textContent = branchPrefix + chevronText + bodyContent;
            }
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
                : (node.depth === 0 ? '  ' : '');
            const bodyContent = node.name + (node.trailingContent || '');
            lines.push(branchPrefix + chevronText + bodyContent);
        }
        return lines.join('\n');
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

    /**
     * TOP HUD (top huio):
     * Draws column guideline wires & places controls (- < > :: +) aligned with detected columns.
     */
    private renderTopHUD(): void {
        const existingPills = this.topHudEl.querySelectorAll('.pakcli-column-controls-pill, .pakcli-wire-hitbox');
        existingPills.forEach((p) => p.remove());

        while (this.svgOverlayEl.firstChild) {
            this.svgOverlayEl.removeChild(this.svgOverlayEl.firstChild);
        }

        const visibleNodes = this.getFlattenedVisibleNodes();
        if (visibleNodes.length === 0) return;

        // Size SVG canvas to match content
        const bodyWidth = Math.max(this.bodyEl.scrollWidth, this.bodyEl.offsetWidth, 400);
        const bodyHeight = this.bodyEl.scrollHeight || (visibleNodes.length * this.ROW_HEIGHT_PX);
        this.svgOverlayEl.setAttribute('width', `${bodyWidth}`);
        this.svgOverlayEl.setAttribute('height', `${bodyHeight}`);
        this.svgOverlayEl.style.width = `${bodyWidth}px`;
        this.svgOverlayEl.style.height = `${bodyHeight}px`;

        // Detect column positions dynamically from node trailingContent
        const allNodes = this.getAllNodes(this.parsed.rootNodes);
        let detectedColStartChar = 0;
        for (const node of allNodes) {
            if (node.trailingContent) {
                const match = node.trailingContent.match(/\S/);
                if (match && match.index !== undefined) {
                    const branchPrefix = getAsciiBranchPrefix(node, this.parsed.rootNodes);
                    const chevronLen = node.isDirectory ? 2 : (node.depth === 0 ? 2 : 0);
                    const charPos = branchPrefix.length + chevronLen + node.name.length + match.index;
                    if (charPos > detectedColStartChar) {
                        detectedColStartChar = charPos;
                    }
                }
            }
        }

        if (detectedColStartChar > 0) {
            const detectedWidth = Math.round(detectedColStartChar * this.charWidthPx);
            if (this.columns[0]) {
                this.columns[0].width = Math.max(this.columns[0].minWidth, detectedWidth);
            }
        }

        // Draw guideline wires & HUD control pills
        let currentLeft = this.paddingLeftPx;
        for (let c = 0; c < this.columns.length - 1; c++) {
            currentLeft += this.columns[c].width;
            const wireX = currentLeft;

            // Background Guideline Wire (strictly pointer-events: none)
            const wireLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            wireLine.setAttribute('x1', `${wireX}`);
            wireLine.setAttribute('y1', `0`);
            wireLine.setAttribute('x2', `${wireX}`);
            wireLine.setAttribute('y2', `${bodyHeight}`);
            wireLine.setAttribute('class', 'pakcli-svg-wire');
            this.svgOverlayEl.appendChild(wireLine);

            // Draggable Resizer Hitbox inside Top HUD
            const wireHit = this.topHudEl.createDiv({ cls: 'pakcli-wire-hitbox' });
            wireHit.style.left = `${wireX - 6}px`;
            wireHit.style.top = `0px`;
            wireHit.style.height = `28px`;
            wireHit.title = 'Drag to adjust column width • Double-click to auto-fit';
            this.wireGuidelineResizer(wireHit, c);

            // Column controls (- < > :: +) inside Top HUD
            const pill = new PillGroup({
                containerEl: this.topHudEl,
                cls: 'pakcli-column-controls-pill',
                items: [
                    { id: 'del', label: '-', tooltip: 'Delete column', onClick: () => this.deleteColumn(c + 1) },
                    { id: 'left', label: '<', tooltip: 'Move left', disabled: c === 0, onClick: () => { if (c > 0) this.moveColumn(c + 1, c); } },
                    { id: 'right', label: '>', tooltip: 'Move right', disabled: c === this.columns.length - 2, onClick: () => { if (c < this.columns.length - 2) this.moveColumn(c + 1, c + 2); } },
                    { id: 'drag', label: '::', tooltip: 'Drag to reorder', isHandle: true },
                    { id: 'add', label: '+', tooltip: 'Add new column (Alt+click to duplicate)', onClick: (e) => this.addColumn(c + 1, e.altKey) },
                ],
            });
            pill.containerEl.style.left = `${wireX + 10}px`;
            pill.containerEl.style.top = '2px';
        }
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
                                    this.renderRaw();
                                }
                            }
                        }
                    }, 250);
                }
            })
        );
    }

    private wireGuidelineResizer(wireHitEl: HTMLElement, colIndex: number): void {
        wireHitEl.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startWidth = this.columns[colIndex].width;
            const colDef = this.columns[colIndex];
            const minWidth = colDef.minWidth;

            document.body.addClass('pakcli-is-col-resizing');

            const onMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = moveEvent.clientX - startX;
                const newWidth = Math.max(minWidth, startWidth + deltaX);
                colDef.width = newWidth;

                this.renderTopHUD();
            };

            const onMouseUp = () => {
                document.body.removeClass('pakcli-is-col-resizing');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                this.syncChangesToNote();
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        wireHitEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.autoFitColumn(colIndex);
        });
    }

    private moveColumn(fromColIdx: number, toColIdx: number): void {
        if (fromColIdx < 1 || toColIdx < 1 || fromColIdx === toColIdx) return;
        if (fromColIdx >= this.columns.length || toColIdx >= this.columns.length) return;

        const allNodes = this.getAllNodes(this.parsed.rootNodes);
        const fromDataIdx = fromColIdx - 1;
        const toDataIdx = toColIdx - 1;

        for (const node of allNodes) {
            while (node.columns.length <= Math.max(fromDataIdx, toDataIdx)) {
                node.columns.push('');
            }
            const moved = node.columns.splice(fromDataIdx, 1)[0];
            node.columns.splice(toDataIdx, 0, moved);
        }

        const movedCol = this.columns.splice(fromColIdx, 1)[0];
        this.columns.splice(toColIdx, 0, movedCol);

        this.syncChangesToNote();
        this.render();
    }

    private deleteColumn(colIdx: number): void {
        if (colIdx < 1 || colIdx >= this.columns.length) return;
        const allNodes = this.getAllNodes(this.parsed.rootNodes);
        const dataIdx = colIdx - 1;

        for (const node of allNodes) {
            if (node.columns.length > dataIdx) {
                node.columns.splice(dataIdx, 1);
            }
        }

        this.columns.splice(colIdx, 1);
        this.parsed.totalColumns = Math.max(1, this.columns.length);

        this.syncChangesToNote();
        this.render();
    }

    private addColumn(afterColIdx: number, duplicate = false): void {
        const allNodes = this.getAllNodes(this.parsed.rootNodes);
        const targetDataIdx = Math.max(0, afterColIdx);

        for (const node of allNodes) {
            while (node.columns.length < targetDataIdx) {
                node.columns.push('');
            }
            const newVal = duplicate && afterColIdx > 0 && node.columns[afterColIdx - 1]
                ? node.columns[afterColIdx - 1]
                : '';
            node.columns.splice(targetDataIdx, 0, newVal);
        }

        this.parsed.totalColumns = Math.min(11, this.columns.length + 1);
        this.initColumns();
        this.syncChangesToNote();
        this.render();
    }

    public autoFitColumn(colIndex: number): void {
        if (colIndex < 0 || colIndex >= this.columns.length) return;

        const visibleNodes = this.getFlattenedVisibleNodes();
        let maxChars = this.columns[colIndex].title.length;

        if (colIndex === 0) {
            for (const node of visibleNodes) {
                const prefix = getAsciiBranchPrefix(node, this.parsed.rootNodes);
                const chevronLen = node.isDirectory ? 2 : (node.depth === 0 ? 2 : 0);
                const len = prefix.length + chevronLen + node.name.length;
                if (len > maxChars) maxChars = len;
            }
        } else {
            for (const node of visibleNodes) {
                const rawVal = node.columns[colIndex - 1] || '';
                const clean = rawVal.replace(/^#+\s*/, '').trim();
                if (clean) {
                    const len = clean.length;
                    if (len > maxChars) maxChars = len;
                }
            }
        }

        const fittedWidth = Math.max(this.columns[colIndex].minWidth, Math.ceil((maxChars + 6) * this.charWidthPx));
        this.columns[colIndex].width = fittedWidth;

        this.renderTopHUD();
        this.syncChangesToNote();
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
