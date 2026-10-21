/**
 * TreeCodeblockRenderer.ts
 * Authentic Native Codeblock with Floating Extra GUI Overlay Layer.
 *
 * Exact User Specification:
 * - "ITS A TEXT LADS THE ELEMENTED IS TEXT ELEMENT LADS"
 * - Base Layer lines: div.cm-line.HyperMD-codeblock.HyperMD-codeblock-bg containing PURE TEXT NODES ONLY.
 * - Extra GUI Overlay: Floating SVG vector layer drawing the blue lines from media_1792590031684_53a169a5.png:
 *   1. Blue tree branches connecting parents to children (zero gaps, round joins)
 *   2. Blue vertical guideline wire at column boundary
 *   3. Blue header controls "- < > :: +" above comment column
 *   4. Blue chevrons (v / >) in front of folder items
 */

import { MarkdownRenderChild, MarkdownPostProcessorContext, Notice, TFile } from 'obsidian';
import { ParsedTreeGrid, TreeGridColumn, TreeGridNode } from './types';
import { CopyButton, PillGroup } from '../../uiComponents';
import { parseTreeGrid, serializeTreeToSource, getMaxCol0Length, getAsciiBranchPrefix } from './treeParser';

export class TreeCodeblockRenderer extends MarkdownRenderChild {
    private source: string;
    private ctx: MarkdownPostProcessorContext;
    private plugin: any;
    private parsed: ParsedTreeGrid;
    private columns: TreeGridColumn[] = [];

    // DOM Elements
    private cardContainerEl!: HTMLElement;
    private bodyEl!: HTMLElement;
    private linesContainerEl!: HTMLElement;
    private overlayEl!: HTMLElement;
    private svgOverlayEl!: SVGSVGElement;
    private controlsContainerEl!: HTMLElement;

    // Metrics
    private charWidthPx = 8.6;
    private readonly ROW_HEIGHT_PX = 24;
    private paddingLeftPx = 10;
    private paddingTopPx = 34; // Room for top "- < > :: +" controls

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
        requestAnimationFrame(() => {
            this.measureCharWidth();
            this.renderOverlayGUI();
        });
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
                if (n.isDirectory && n.isExpanded && n.children && n.children.length > 0) {
                    traverse(n.children);
                }
            }
        };
        traverse(this.parsed.rootNodes);
        return result;
    }

    private render(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('pakcli-tree-root-container');

        // Card Container holding the Live Preview Codeblock lines
        this.cardContainerEl = containerEl.createDiv({
            cls: 'pakcli-tree-card-container HyperMD-codeblock-bg',
        });

        // Native Copy Button (📋) using CopyButton from uiComponents
        new CopyButton({
            containerEl: this.cardContainerEl,
            cls: 'pakcli-tree-copy-btn',
            tooltip: 'Copy clean formatted tree',
            textGetter: () => {
                const lines: string[] = [];
                const flatNodes = this.getFlattenedVisibleNodes();
                for (const node of flatNodes) {
                    const branchPrefix = getAsciiBranchPrefix(node, this.parsed.rootNodes);
                    const chevronPrefix = node.isDirectory
                        ? (node.children.length > 0 ? (node.isExpanded ? 'v ' : '> ') : '  ')
                        : (node.depth === 0 ? '  ' : '');
                    const pathSegment = branchPrefix + chevronPrefix + node.name;
                    let lineStr = pathSegment;
                    let curChars = pathSegment.length;

                    for (let c = 1; c < this.columns.length; c++) {
                        const rawVal = node.columns[c - 1] || '';
                        const cleanVal = rawVal.replace(/^#+\s*/, '').trim();

                        let targetColStartChars = 0;
                        for (let k = 0; k < c; k++) {
                            targetColStartChars += Math.max(4, Math.round(this.columns[k].width / this.charWidthPx));
                        }
                        const spacesCount = Math.max(2, targetColStartChars - curChars);
                        curChars += spacesCount;
                        if (cleanVal) {
                            lineStr += ' '.repeat(spacesCount) + cleanVal;
                            curChars += cleanVal.length;
                        }
                    }
                    lines.push(lineStr);
                }
                return lines.join('\n');
            },
        });

        // Main Tree Body (relative wrapper for overlay and code lines)
        this.bodyEl = this.cardContainerEl.createDiv({ cls: 'pakcli-tree-body' });
        this.bodyEl.style.paddingTop = `${this.paddingTopPx}px`;

        // Layer 1: Codeblock Lines (div.cm-line.HyperMD-codeblock.HyperMD-codeblock-bg)
        this.linesContainerEl = this.bodyEl.createDiv({ cls: 'pakcli-code-lines' });
        this.renderCodeLines();

        // Layer 2: Floating Extra GUI Overlay (+1 Layer Above, z-index: 10, position: absolute)
        this.overlayEl = this.bodyEl.createDiv({ cls: 'pakcli-floating-extra-gui' });

        // SVG layer for continuous blue vector tree branches & column guideline wire
        this.svgOverlayEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgOverlayEl.setAttribute('class', 'pakcli-tree-svg-overlay');
        this.overlayEl.appendChild(this.svgOverlayEl);

        // Interactive Controls Container (Chevrons & Header Buttons: - < > :: +)
        this.controlsContainerEl = this.overlayEl.createDiv({ cls: 'pakcli-gui-controls-layer' });

        this.renderOverlayGUI();
    }

    /**
     * LAYER 1: Codeblock Asli (div.cm-line.HyperMD-codeblock.HyperMD-codeblock-bg)
     * 100% PURE TEXT NODES ONLY — ZERO SPANS, ZERO CELL DIVS!
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

            // Authentic ASCII tree branch prefix: ├── , └── , │   
            const branchPrefix = getAsciiBranchPrefix(node, this.parsed.rootNodes);

            // Folder chevron indicator: v  or >  (or empty for root/leaf files)
            const chevronPrefix = node.isDirectory
                ? (node.children.length > 0 ? (node.isExpanded ? 'v ' : '> ') : '  ')
                : (node.depth === 0 ? '  ' : '');

            const pathSegment = branchPrefix + chevronPrefix + node.name;
            let fullLineText = pathSegment;
            let currentCursorChars = pathSegment.length;

            for (let c = 1; c < this.columns.length; c++) {
                const rawVal = node.columns[c - 1] || '';
                const cleanVal = rawVal.replace(/^#+\s*/, '').trim();

                let targetColStartChars = 0;
                for (let k = 0; k < c; k++) {
                    targetColStartChars += Math.max(4, Math.round(this.columns[k].width / this.charWidthPx));
                }

                const spacesCount = Math.max(2, targetColStartChars - currentCursorChars);
                currentCursorChars += spacesCount;

                const hasSubsequentVal = node.columns.slice(c - 1).some((v) => v && v.trim().length > 0);
                if (hasSubsequentVal || cleanVal) {
                    fullLineText += ' '.repeat(spacesCount) + cleanVal;
                    currentCursorChars += cleanVal.length;
                }
            }

            // PURE TEXT ELEMENT ONLY: 100% Copy-pasteable authentic tree!
            lineEl.textContent = fullLineText;
        }
    }

    /**
     * LAYER 2: Extra GUI Overlay (Blue SVG Tree Branches, Chevrons, Guideline Wire & - < > :: +)
     */
    private renderOverlayGUI(): void {
        this.controlsContainerEl.empty();
        while (this.svgOverlayEl.firstChild) {
            this.svgOverlayEl.removeChild(this.svgOverlayEl.firstChild);
        }

        const visibleNodes = this.getFlattenedVisibleNodes();
        if (visibleNodes.length === 0) return;

        // Size SVG canvas to match content
        const bodyWidth = Math.max(this.bodyEl.scrollWidth, this.bodyEl.offsetWidth);
        const bodyHeight = this.bodyEl.scrollHeight || (visibleNodes.length * this.ROW_HEIGHT_PX + this.paddingTopPx);
        this.svgOverlayEl.setAttribute('width', `${bodyWidth}`);
        this.svgOverlayEl.setAttribute('height', `${bodyHeight}`);
        this.svgOverlayEl.style.width = `${bodyWidth}px`;
        this.svgOverlayEl.style.height = `${bodyHeight}px`;

        // 1. Render Column Guideline Wires & Header Controls (- < > :: +) in Blue
        let currentLeft = this.paddingLeftPx;
        for (let c = 0; c < this.columns.length - 1; c++) {
            currentLeft += this.columns[c].width;
            const wireX = currentLeft;

            // Blue Vertical Guideline Wire
            const wireLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            wireLine.setAttribute('x1', `${wireX}`);
            wireLine.setAttribute('y1', `${this.paddingTopPx - 10}`);
            wireLine.setAttribute('x2', `${wireX}`);
            wireLine.setAttribute('y2', `${bodyHeight}`);
            wireLine.setAttribute('class', 'pakcli-svg-wire');
            this.svgOverlayEl.appendChild(wireLine);

            // Draggable Hit-Box for Resizing
            const wireHit = this.controlsContainerEl.createDiv({ cls: 'pakcli-wire-hitbox' });
            wireHit.style.left = `${wireX - 6}px`;
            wireHit.style.top = `${this.paddingTopPx - 10}px`;
            wireHit.style.height = `${bodyHeight - this.paddingTopPx + 10}px`;
            wireHit.title = 'Drag to adjust column width • Double-click to auto-fit';
            this.wireGuidelineResizer(wireHit, c);

            // Floating Header Controls (- < > :: +) above comment column (using PillGroup)
            const pill = new PillGroup({
                containerEl: this.controlsContainerEl,
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
            pill.containerEl.style.top = '6px';
        }

        // 2. Render Interactive Chevrons (v / >) matching character position
        this.renderInteractiveChevrons();
    }

    private renderInteractiveChevrons(): void {
        const visibleNodes = this.getFlattenedVisibleNodes();

        for (let i = 0; i < visibleNodes.length; i++) {
            const node = visibleNodes[i];
            if (node.isDirectory && node.children.length > 0) {
                const branchPrefix = getAsciiBranchPrefix(node, this.parsed.rootNodes);
                const chevronCharOffset = branchPrefix.length;
                const chevronX = this.paddingLeftPx + (chevronCharOffset * this.charWidthPx);
                const chevronY = this.paddingTopPx + (i * this.ROW_HEIGHT_PX) + 3;

                const chevronEl = this.controlsContainerEl.createSpan({
                    cls: 'pakcli-overlay-chevron',
                    text: node.isExpanded ? 'v' : '>',
                    attr: { title: node.isExpanded ? 'Collapse folder' : 'Expand folder' },
                });
                chevronEl.style.left = `${chevronX}px`;
                chevronEl.style.top = `${chevronY}px`;
                chevronEl.style.width = `${Math.round(this.charWidthPx * 1.8)}px`;

                chevronEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    node.isExpanded = !node.isExpanded;
                    this.renderCodeLines();
                    this.renderOverlayGUI();
                });
            }
        }
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

                this.renderCodeLines();
                this.renderOverlayGUI();
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

        this.renderCodeLines();
        this.renderOverlayGUI();
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
