/**
 * TreeCodeblockRenderer.ts
 * Authentic Native Codeblock with Floating Extra GUI Overlay Layer.
 *
 * Architecture inspired by retroPairPicker pattern:
 * 1. Base Layer (Native Codeblock Asli - Unreplaced):
 *    - Rendered via Obsidian's native MarkdownRenderer.render('```\n' + pureText + '\n```').
 *    - 100% Native Obsidian <pre><code> container, theme styling, font, padding, copy button.
 *    - Pure monospace text lines with real space offsets for #note comments.
 *    - Zero custom cell divs, zero table elements, zero horizontal divider lines!
 *
 * 2. Extra GUI Overlay Layer (+1 Layer Above, z-index: 10, position: absolute):
 *    - Floats directly over the native codeblock (pointer-events: none).
 *    - Sticky Header Ruler Bar: Displays column titles (PATH, #, ##) with :: reorder, < > shift, + add, - delete.
 *    - Draggable Guideline Wires: Vertical lines at column boundary offsets (cursor: col-resize; pointer-events: auto).
 *      Dragging dynamically adjusts #note space padding in real time and syncs to note on release.
 *    - Seamless Continuous CSS Tree Branches (├──, └──, │) connecting vertically with 100% zero gaps.
 *    - Minimalist Fold Chevrons (v / >) floating right before folder items (pointer-events: auto; cursor: pointer).
 */

import { MarkdownRenderer, MarkdownRenderChild, MarkdownPostProcessorContext, Notice, TFile } from 'obsidian';
import { ParsedTreeGrid, TreeGridColumn, TreeGridNode } from './types';
import { parseTreeGrid, serializeTreeToSource, getMaxCol0Length, isLastChild } from './treeParser';

interface BranchRails {
    ancestors: boolean[];
    isLast: boolean;
}

export class TreeCodeblockRenderer extends MarkdownRenderChild {
    private source: string;
    private ctx: MarkdownPostProcessorContext;
    private plugin: any;
    private parsed: ParsedTreeGrid;
    private columns: TreeGridColumn[] = [];

    // DOM Elements
    private codeblockWrapEl!: HTMLElement;
    private nativePreEl: HTMLElement | null = null;
    private nativeCodeEl: HTMLElement | null = null;

    private overlayEl!: HTMLElement;
    private rulerBarEl!: HTMLElement;
    private guidelinesContainerEl!: HTMLElement;
    private overlayRowsEl!: HTMLElement;

    // Monospace Font Metrics
    private charWidthPx = 8.6;
    private lineHeightPx = 24;
    private paddingLeftPx = 16;
    private paddingTopPx = 10;

    private readonly INDENT_CHARS = 4;
    private readonly CHEVRON_CHARS = 2;

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

    async onload(): Promise<void> {
        await this.render();
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
                    const indent = (node.depth * this.INDENT_CHARS) + this.CHEVRON_CHARS;
                    const len = indent + node.name.length;
                    if (len > maxChars) maxChars = len;
                }
            } else {
                for (const node of allNodes) {
                    const val = node.columns[i - 1] || '';
                    if (val) {
                        const len = i + 1 + val.length;
                        if (len > maxChars) maxChars = len;
                    }
                }
            }

            const maxTreeChars = getMaxCol0Length(this.parsed.rootNodes);
            const treeMinPx = Math.ceil((maxTreeChars + 4) * 8.6);
            const minWidth = i === 0 ? Math.max(140, treeMinPx) : 60;
            const snugWidth = Math.ceil((maxChars + 4) * 8.6);
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
                if (n.isDirectory && n.isExpanded && n.children && n.children.length > 0) {
                    traverse(n.children);
                }
            }
        };
        traverse(this.parsed.rootNodes);
        return result;
    }

    /**
     * Builds pure text lines with indentation and space offsets for notes.
     */
    private buildFormattedText(): string {
        const visibleNodes = this.getFlattenedVisibleNodes();
        if (visibleNodes.length === 0) return 'Empty tree.';

        const lines: string[] = [];

        for (const node of visibleNodes) {
            const leadingSpacesCount = (node.depth * this.INDENT_CHARS) + this.CHEVRON_CHARS;
            let line = ' '.repeat(leadingSpacesCount) + node.name;
            let currentCursorChars = leadingSpacesCount + node.name.length;

            if (node.columns && node.columns.length > 0) {
                for (let c = 1; c < this.columns.length; c++) {
                    const rawVal = node.columns[c - 1] || '';
                    const cleanVal = rawVal.replace(/^#+\s*/, '').trim();

                    // Calculate target character offset for column boundary
                    let targetColStartChars = 0;
                    for (let k = 0; k < c; k++) {
                        targetColStartChars += Math.max(4, Math.round(this.columns[k].width / this.charWidthPx));
                    }

                    const spacesCount = Math.max(2, targetColStartChars - currentCursorChars);
                    currentCursorChars += spacesCount;

                    const hasSubsequentVal = node.columns.slice(c - 1).some((v) => v && v.trim().length > 0);
                    if (hasSubsequentVal || cleanVal) {
                        line += ' '.repeat(spacesCount);
                        const prefix = '#'.repeat(c);
                        const displayText = cleanVal ? `${prefix} ${cleanVal}` : `${prefix} `;
                        line += displayText;
                        currentCursorChars += displayText.length;
                    }
                }
            }

            lines.push(line);
        }

        return lines.join('\n');
    }

    private async render(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('pakcli-tree-root-container');
        containerEl.style.position = 'relative';

        // 1. LAYER 1: Codeblock Asli (Unreplaced via Native Obsidian Renderer)
        this.codeblockWrapEl = containerEl.createDiv({ cls: 'pakcli-native-codeblock-wrap' });
        const pureText = this.buildFormattedText();

        await MarkdownRenderer.render(
            this.plugin.app,
            '```\n' + pureText + '\n```',
            this.codeblockWrapEl,
            this.ctx.sourcePath,
            this
        );

        this.nativePreEl = this.codeblockWrapEl.querySelector('pre');
        this.nativeCodeEl = this.codeblockWrapEl.querySelector('code');

        if (this.nativePreEl) {
            this.nativePreEl.addClass('pakcli-native-codeblock-pre');
        }

        // Measure native codeblock metrics
        this.measureNativeMetrics();

        // 2. LAYER 2: Floating Extra GUI Overlay (+1 Layer Above, z-index: 10, position: absolute)
        this.overlayEl = containerEl.createDiv({ cls: 'pakcli-floating-extra-gui' });

        // 2A. Floating Header Ruler Bar
        this.rulerBarEl = this.overlayEl.createDiv({ cls: 'pakcli-ruler-bar' });
        this.renderRulerBar();

        // 2B. Draggable Column Guidelines
        this.guidelinesContainerEl = this.overlayEl.createDiv({ cls: 'pakcli-guideline-wires' });

        // 2C. Overlay Rows for Branches & Chevrons
        this.overlayRowsEl = this.overlayEl.createDiv({ cls: 'pakcli-overlay-rows' });

        this.renderOverlayRows();
        this.renderGuidelines();
        this.syncOverlayPosition();
    }

    private measureNativeMetrics(): void {
        if (!this.nativePreEl) return;

        const computed = window.getComputedStyle(this.nativePreEl);
        const pl = parseFloat(computed.paddingLeft) || 16;
        const pt = parseFloat(computed.paddingTop) || 10;
        const lh = parseFloat(computed.lineHeight) || 24;

        this.paddingLeftPx = pl;
        this.paddingTopPx = pt;
        this.lineHeightPx = lh;

        // Measure single character width inside pre/code
        const testSpan = document.createElement('span');
        testSpan.style.fontFamily = computed.fontFamily || 'var(--font-monospace, monospace)';
        testSpan.style.fontSize = computed.fontSize || '0.85rem';
        testSpan.style.lineHeight = `${lh}px`;
        testSpan.style.visibility = 'hidden';
        testSpan.style.position = 'absolute';
        testSpan.style.whiteSpace = 'pre';
        testSpan.textContent = 'WWWWWWWWWW0000000000'; // 20 chars
        this.nativePreEl.appendChild(testSpan);
        const w = testSpan.getBoundingClientRect().width / 20;
        this.nativePreEl.removeChild(testSpan);
        if (w > 4 && w < 30) {
            this.charWidthPx = w;
        }
    }

    private syncOverlayPosition(): void {
        if (!this.nativePreEl || !this.overlayEl) return;

        const preTop = this.nativePreEl.offsetTop;
        const preLeft = this.nativePreEl.offsetLeft;
        const preWidth = this.nativePreEl.offsetWidth;
        const preHeight = this.nativePreEl.offsetHeight;

        this.overlayEl.style.top = `${preTop}px`;
        this.overlayEl.style.left = `${preLeft}px`;
        this.overlayEl.style.width = `${preWidth}px`;
        this.overlayEl.style.height = `${preHeight}px`;

        // Position ruler at top of native pre
        this.rulerBarEl.style.paddingLeft = `${this.paddingLeftPx}px`;

        // Position overlay rows right over code lines (accounting for ruler + paddingTop)
        const rulerHeight = this.rulerBarEl.offsetHeight || 28;
        this.overlayRowsEl.style.top = `${rulerHeight + 4}px`;
        this.overlayRowsEl.style.left = `${this.paddingLeftPx}px`;

        // Position guideline wires
        this.guidelinesContainerEl.style.top = `${rulerHeight}px`;
        this.guidelinesContainerEl.style.left = `${this.paddingLeftPx}px`;

        // Push native code text down so it does not collide with ruler bar
        if (this.nativeCodeEl) {
            this.nativeCodeEl.style.display = 'block';
            this.nativeCodeEl.style.paddingTop = `${rulerHeight + 4}px`;
        }
    }

    private updateNativeCodeContent(): void {
        if (!this.nativeCodeEl) return;
        const pureText = this.buildFormattedText();
        this.nativeCodeEl.textContent = pureText;
    }

    private renderRulerBar(): void {
        this.rulerBarEl.empty();

        for (let i = 0; i < this.columns.length; i++) {
            const col = this.columns[i];
            const colEl = this.rulerBarEl.createDiv({ cls: 'pakcli-ruler-col' });
            colEl.dataset.colIndex = String(i);
            colEl.style.width = `${col.width}px`;

            if (i === 0) {
                colEl.createSpan({ cls: 'pakcli-ruler-title', text: col.title });

                const addBtn = colEl.createSpan({ cls: 'pakcli-ruler-btn pakcli-ruler-btn-add', text: '+' });
                addBtn.title = 'Add comment column (#)';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.addColumn(0);
                });
            } else {
                const dragHandle = colEl.createSpan({ cls: 'pakcli-ruler-drag-handle', text: '::' });
                dragHandle.title = 'Drag :: to reorder column';

                const leftBtn = colEl.createSpan({ cls: 'pakcli-ruler-btn pakcli-ruler-btn-move', text: '<' });
                leftBtn.title = 'Move column left';
                if (i === 1) leftBtn.addClass('is-disabled');
                leftBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (i > 1) this.moveColumn(i, i - 1);
                });

                const rightBtn = colEl.createSpan({ cls: 'pakcli-ruler-btn pakcli-ruler-btn-move', text: '>' });
                rightBtn.title = 'Move column right';
                if (i === this.columns.length - 1) rightBtn.addClass('is-disabled');
                rightBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (i < this.columns.length - 1) this.moveColumn(i, i + 1);
                });

                colEl.createSpan({ cls: 'pakcli-ruler-title', text: col.title });

                const addBtn = colEl.createSpan({ cls: 'pakcli-ruler-btn pakcli-ruler-btn-add', text: '+' });
                addBtn.title = 'Add new column (Alt+click to duplicate)';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.addColumn(i, e.altKey);
                });

                const delBtn = colEl.createSpan({ cls: 'pakcli-ruler-btn pakcli-ruler-btn-del', text: '-' });
                delBtn.title = 'Delete this column';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteColumn(i);
                });

                colEl.setAttribute('draggable', 'true');
                colEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer?.setData('text/plain', String(i));
                    colEl.addClass('is-dragging');
                });
                colEl.addEventListener('dragend', () => {
                    colEl.removeClass('is-dragging');
                    this.rulerBarEl.querySelectorAll('.pakcli-ruler-col').forEach((el) => el.removeClass('drag-over'));
                });
                colEl.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    colEl.addClass('drag-over');
                });
                colEl.addEventListener('dragleave', () => {
                    colEl.removeClass('drag-over');
                });
                colEl.addEventListener('drop', (e) => {
                    e.preventDefault();
                    colEl.removeClass('drag-over');
                    const fromStr = e.dataTransfer?.getData('text/plain');
                    if (fromStr !== undefined) {
                        const fromIdx = parseInt(fromStr, 10);
                        if (!isNaN(fromIdx) && fromIdx >= 1 && fromIdx !== i) {
                            this.moveColumn(fromIdx, i);
                        }
                    }
                });
            }

            colEl.addEventListener('dblclick', (e) => {
                if ((e.target as HTMLElement).classList.contains('pakcli-ruler-title') || e.target === colEl) {
                    e.stopPropagation();
                    this.autoFitColumn(i);
                }
            });
        }
    }

    private renderGuidelines(): void {
        this.guidelinesContainerEl.empty();

        let currentLeft = 0;
        for (let i = 0; i < this.columns.length - 1; i++) {
            currentLeft += this.columns[i].width;

            const guideline = this.guidelinesContainerEl.createDiv({ cls: 'pakcli-wire' });
            guideline.style.left = `${currentLeft}px`;
            guideline.title = 'Drag to adjust column width • Double-click to auto-fit';

            this.wireGuidelineResizer(guideline, i);

            guideline.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.autoFitColumn(i);
            });
        }
    }

    private wireGuidelineResizer(guidelineEl: HTMLElement, colIndex: number): void {
        guidelineEl.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startWidth = this.columns[colIndex].width;
            const colDef = this.columns[colIndex];
            const minWidth = colDef.minWidth;

            document.body.addClass('pakcli-is-col-resizing');
            guidelineEl.addClass('is-dragging');

            const onMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = moveEvent.clientX - startX;
                const newWidth = Math.max(minWidth, startWidth + deltaX);
                colDef.width = newWidth;

                this.updateColumnWidthsInDOM(colIndex, newWidth);
            };

            const onMouseUp = () => {
                document.body.removeClass('pakcli-is-col-resizing');
                guidelineEl.removeClass('is-dragging');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                this.renderGuidelines();
                this.syncChangesToNote();
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    private updateColumnWidthsInDOM(colIndex: number, newWidth: number): void {
        const rulerCol = this.rulerBarEl.querySelector<HTMLElement>(`.pakcli-ruler-col[data-col-index="${colIndex}"]`);
        if (rulerCol) rulerCol.style.width = `${newWidth}px`;

        this.updateNativeCodeContent();

        let currentLeft = 0;
        const allWires = this.guidelinesContainerEl.querySelectorAll<HTMLElement>('.pakcli-wire');
        for (let i = 0; i < this.columns.length - 1; i++) {
            currentLeft += this.columns[i].width;
            if (allWires[i]) {
                allWires[i].style.left = `${currentLeft}px`;
            }
        }
    }

    private getBranchRails(node: TreeGridNode): BranchRails {
        if (node.depth === 0) {
            return { ancestors: [], isLast: false };
        }

        const ancestors: boolean[] = [];
        let curr = node.parent;

        while (curr && curr.depth > 0) {
            const hasNext = !isLastChild(curr, this.parsed.rootNodes);
            ancestors.unshift(hasNext);
            curr = curr.parent;
        }

        const isLast = isLastChild(node, this.parsed.rootNodes);
        return { ancestors, isLast };
    }

    /**
     * Renders branches and chevrons on the Extra GUI layer overlaying the codeblock.
     */
    private renderOverlayRows(): void {
        this.overlayRowsEl.empty();

        const visibleNodes = this.getFlattenedVisibleNodes();
        const branchSegWidthPx = Math.round(this.INDENT_CHARS * this.charWidthPx);
        const chevronWidthPx = Math.round(this.CHEVRON_CHARS * this.charWidthPx);

        for (const node of visibleNodes) {
            const overlayRow = this.overlayRowsEl.createDiv({ cls: 'pakcli-overlay-row' });
            overlayRow.style.height = `${this.lineHeightPx}px`;

            const isFolderWithChildren = node.isDirectory && node.children.length > 0;
            const branchRails = this.getBranchRails(node);

            // 1. Continuous CSS Tree Branches
            if (node.depth > 0) {
                const branchContainer = overlayRow.createSpan({ cls: 'pakcli-branch-container' });

                for (const hasTrunk of branchRails.ancestors) {
                    const trunkEl = branchContainer.createSpan({
                        cls: `pakcli-branch-seg ${hasTrunk ? 'trunk' : 'empty'}`,
                    });
                    trunkEl.style.width = `${branchSegWidthPx}px`;
                }

                const segEl = branchContainer.createSpan({
                    cls: `pakcli-branch-seg ${branchRails.isLast ? 'corner' : 'tee'}`,
                });
                segEl.style.width = `${branchSegWidthPx}px`;
            }

            // 2. Minimalist Fold Chevron (v / >) in front of folder
            if (isFolderWithChildren) {
                const chevron = overlayRow.createSpan({
                    cls: 'pakcli-overlay-chevron',
                    text: node.isExpanded ? 'v' : '>',
                    attr: { title: node.isExpanded ? 'Collapse folder' : 'Expand folder' },
                });
                chevron.style.width = `${chevronWidthPx}px`;
                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    node.isExpanded = !node.isExpanded;
                    this.updateNativeCodeContent();
                    this.renderOverlayRows();
                    this.syncOverlayPosition();
                });
            } else {
                const spacer = overlayRow.createSpan({ cls: 'pakcli-overlay-chevron-spacer' });
                spacer.style.width = `${chevronWidthPx}px`;
            }
        }
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
                const indent = (node.depth * this.INDENT_CHARS) + this.CHEVRON_CHARS;
                const len = indent + node.name.length;
                if (len > maxChars) maxChars = len;
            }
        } else {
            for (const node of visibleNodes) {
                const rawVal = node.columns[colIndex - 1] || '';
                const clean = rawVal.replace(/^#+\s*/, '').trim();
                if (clean) {
                    const len = colIndex + 1 + clean.length;
                    if (len > maxChars) maxChars = len;
                }
            }
        }

        const fittedWidth = Math.max(this.columns[colIndex].minWidth, Math.ceil((maxChars + 4) * this.charWidthPx));
        this.columns[colIndex].width = fittedWidth;

        this.updateColumnWidthsInDOM(colIndex, fittedWidth);
        this.renderGuidelines();
        this.syncChangesToNote();
    }

    private async syncChangesToNote(): Promise<void> {
        const app = this.plugin?.app;
        if (!app?.vault || !this.ctx?.sourcePath) return;

        try {
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

            const fileContent = await app.vault.read(file);

            let updatedContent = '';
            let replaced = false;

            const sectionInfo = this.ctx.getSectionInfo?.(this.containerEl);
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
        }
    }
}
