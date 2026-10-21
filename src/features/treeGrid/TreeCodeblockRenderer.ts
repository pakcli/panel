/**
 * TreeCodeblockRenderer.ts
 * Authentic Unreplaced Native Codeblock with Floating Extra GUI Overlay Layer.
 *
 * Architecture (100% Zero DOM Overwrite):
 * 1. Base Layer (Native Codeblock):
 *    - Rendered via Obsidian's official MarkdownRenderer.render().
 *    - 100% Authentic theme inheritance: native card border, rounded corners, native code background,
 *      native codeblock padding, native Copy Code button (📋), and native indent guides.
 *    - Pure plain-text content: folder/file names with indentation + dynamic space padding for #note columns.
 *    - Zero custom cell containers, zero table elements, zero horizontal divider lines!
 *
 * 2. Extra GUI Overlay Layer (+1 Layer Above, z-index: 10):
 *    - Floating Top Header Ruler: Displays column markers (PATH, #, ##) with :: reorder, < > shift, + add, - delete.
 *    - Floating Draggable Guideline Wires: Vertical lines at column boundary offsets (cursor: col-resize).
 *      Dragging dynamically adjusts #note padding spaces and syncs directly to the markdown note on release.
 *    - Floating Fold Chevrons (v / >): Interactive chevrons floating right before folder items to expand/collapse.
 */

import { MarkdownRenderChild, MarkdownPostProcessorContext, MarkdownRenderer, Notice, TFile } from 'obsidian';
import { ParsedTreeGrid, TreeGridColumn, TreeGridNode } from './types';
import { parseTreeGrid, getMaxCol0Length } from './treeParser';

export class TreeCodeblockRenderer extends MarkdownRenderChild {
    private source: string;
    private ctx: MarkdownPostProcessorContext;
    private plugin: any;
    private parsed: ParsedTreeGrid;
    private columns: TreeGridColumn[] = [];

    private overlayEl: HTMLElement | null = null;

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
                    const indentChars = node.depth * 2;
                    const len = indentChars + node.name.length;
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
            const treeMinPx = Math.ceil((maxTreeChars + 2) * 8.6) + 40;
            const minWidth = i === 0 ? Math.max(120, treeMinPx) : 60;
            const snugWidth = Math.ceil(maxChars * 8.6) + 40;
            const width = Math.max(minWidth, Math.min(800, snugWidth));

            this.columns.push({
                id: i,
                title,
                width,
                minWidth,
            });
        }
    }

    /**
     * Formats visible tree nodes into clean plain-text source lines with aligned #note columns.
     */
    private getVisibleSerializedLines(col0Target: number, colWidthsTarget: number[]): string[] {
        const lines: string[] = [];
        const maxCol0 = getMaxCol0Length(this.parsed.rootNodes);
        const effectiveCol0 = Math.max(maxCol0 + 2, col0Target);

        const serializeNode = (node: TreeGridNode) => {
            const indent = '  '.repeat(node.depth);
            let line = indent + node.name;
            if (node.isDirectory && node.rawName.endsWith('/')) {
                line += '/';
            }

            if (node.columns && node.columns.length > 0) {
                const itemVisualLength = (node.depth * 2) + node.name.length;
                const spacesCount = Math.max(2, effectiveCol0 - itemVisualLength);
                line += ' '.repeat(spacesCount);

                for (let c = 0; c < node.columns.length; c++) {
                    const colVal = node.columns[c];
                    const clean = colVal.replace(/^#+\s*/, '').trim();
                    const prefix = '#'.repeat(c + 1);
                    const formattedCol = clean ? `${prefix} ${clean}` : '';

                    if (formattedCol) {
                        if (c > 0) {
                            const colPad = colWidthsTarget[c] ? Math.max(4, colWidthsTarget[c]) : 6;
                            line += ' '.repeat(colPad);
                        }
                        line += formattedCol;
                    }
                }
            }

            lines.push(line);

            // Traverse children only if folder is expanded
            if (node.isDirectory && node.isExpanded && node.children && node.children.length > 0) {
                for (const child of node.children) {
                    serializeNode(child);
                }
            }
        };

        for (const root of this.parsed.rootNodes) {
            serializeNode(root);
        }

        return lines;
    }

    private getVisibleNodesList(): TreeGridNode[] {
        const list: TreeGridNode[] = [];
        const traverse = (node: TreeGridNode) => {
            list.push(node);
            if (node.isDirectory && node.isExpanded && node.children && node.children.length > 0) {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        };
        for (const root of this.parsed.rootNodes) {
            traverse(root);
        }
        return list;
    }

    /**
     * Renders 100% unreplaced native codeblock via MarkdownRenderer.render,
     * then attaches the floating Extra GUI Overlay on top.
     */
    public async render(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('pakcli-tree-codeblock-wrapper');
        containerEl.style.position = 'relative';

        const col0WidthPx = this.columns[0]?.width || 220;
        const col0TargetChars = Math.max(10, Math.round((col0WidthPx - 24) / 8.6));

        const colWidthsTargetChars: number[] = [];
        for (let i = 1; i < this.columns.length; i++) {
            const w = this.columns[i]?.width || 120;
            colWidthsTargetChars[i] = Math.max(4, Math.round((w - 24) / 8.6));
        }

        const visibleLines = this.getVisibleSerializedLines(col0TargetChars, colWidthsTargetChars);
        const codeText = visibleLines.join('\n');

        // 1. Render Authentic Native Codeblock via Obsidian's MarkdownRenderer
        const codeMarkdown = '```\n' + codeText + '\n```';
        await MarkdownRenderer.render(
            this.plugin.app,
            codeMarkdown,
            containerEl,
            this.ctx.sourcePath,
            this
        );

        // 2. Attach Floating Extra GUI Overlay (+1 Layer Above, z-index: 10)
        this.overlayEl = containerEl.createDiv({ cls: 'pakcli-tree-floating-overlay' });
        this.renderFloatingOverlay(this.overlayEl, visibleLines);
    }

    private renderFloatingOverlay(overlay: HTMLElement, visibleLines: string[]): void {
        overlay.empty();

        const preEl = this.containerEl.querySelector<HTMLElement>('pre');
        const codeEl = this.containerEl.querySelector<HTMLElement>('code');
        if (!preEl) return;

        // Header Ruler Overlay (Positioned along the top of the codeblock)
        const rulerBar = overlay.createDiv({ cls: 'pakcli-floating-ruler-bar' });
        this.renderRulerBar(rulerBar);

        // Draggable Column Guidelines
        const guidelinesContainer = overlay.createDiv({ cls: 'pakcli-floating-guidelines-container' });
        let currentLeft = this.columns[0].width;

        for (let i = 0; i < this.columns.length - 1; i++) {
            const guideline = guidelinesContainer.createDiv({ cls: 'pakcli-col-guideline-wire' });
            guideline.style.left = `${currentLeft}px`;
            guideline.title = 'Drag to adjust column width • Double-click to auto-fit';

            this.wireGuidelineResizer(guideline, i);
            currentLeft += this.columns[i + 1]?.width || 120;
        }

        // Minimalist Floating Fold Chevrons (v / >)
        const visibleNodes = this.getVisibleNodesList();
        const preStyles = window.getComputedStyle(preEl);
        const codeStyles = codeEl ? window.getComputedStyle(codeEl) : preStyles;

        const paddingTop = parseFloat(preStyles.paddingTop) || 12;
        const paddingLeft = parseFloat(preStyles.paddingLeft) || 16;
        const lineHeight = parseFloat(codeStyles.lineHeight) || 24;
        const rulerHeight = 32;

        for (let i = 0; i < visibleNodes.length; i++) {
            const node = visibleNodes[i];
            if (node.isDirectory && node.children.length > 0) {
                const chevron = overlay.createSpan({ cls: 'pakcli-floating-chevron' });
                chevron.setText(node.isExpanded ? 'v' : '>');
                chevron.title = node.isExpanded ? 'Collapse folder' : 'Expand folder';

                const topY = paddingTop + rulerHeight + (i * lineHeight);
                const leftX = Math.max(4, paddingLeft + (node.depth * 17) - 14);

                chevron.style.top = `${topY}px`;
                chevron.style.left = `${leftX}px`;

                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    node.isExpanded = !node.isExpanded;
                    this.render();
                });
            }
        }
    }

    private renderRulerBar(rulerBar: HTMLElement): void {
        rulerBar.empty();

        for (let i = 0; i < this.columns.length; i++) {
            const col = this.columns[i];
            const colEl = rulerBar.createDiv({ cls: 'pakcli-ruler-col' });
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
                    rulerBar.querySelectorAll('.pakcli-ruler-col').forEach((el) => el.removeClass('drag-over'));
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

                // Live update ruler width and guideline position
                const rulerCol = this.containerEl.querySelector<HTMLElement>(`.pakcli-ruler-col[data-col-index="${colIndex}"]`);
                if (rulerCol) rulerCol.style.width = `${newWidth}px`;

                let currentLeft = this.columns[0].width;
                const allWires = this.containerEl.querySelectorAll<HTMLElement>('.pakcli-col-guideline-wire');
                for (let w = 0; w < this.columns.length - 1; w++) {
                    if (allWires[w]) allWires[w].style.left = `${currentLeft}px`;
                    currentLeft += this.columns[w + 1]?.width || 120;
                }
            };

            const onMouseUp = () => {
                document.body.removeClass('pakcli-is-col-resizing');
                guidelineEl.removeClass('is-dragging');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                this.syncChangesToNote();
                this.render();
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
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

        const allNodes = this.getAllNodes(this.parsed.rootNodes);
        let maxChars = this.columns[colIndex].title.length;

        if (colIndex === 0) {
            for (const node of allNodes) {
                const len = (node.depth * 2) + node.name.length;
                if (len > maxChars) maxChars = len;
            }
        } else {
            for (const node of allNodes) {
                const val = node.columns[colIndex - 1] || '';
                if (val) {
                    const len = colIndex + 1 + val.length;
                    if (len > maxChars) maxChars = len;
                }
            }
        }

        const snugWidth = Math.ceil(maxChars * 8.6) + 40;
        const fittedWidth = Math.min(1000, Math.max(this.columns[colIndex].minWidth, snugWidth));
        this.columns[colIndex].width = fittedWidth;

        this.syncChangesToNote();
        this.render();
    }

    public autoFitAllColumns(): void {
        for (let i = 0; i < this.columns.length; i++) {
            this.autoFitColumn(i);
        }
    }

    private async syncChangesToNote(): Promise<void> {
        const app = this.plugin?.app;
        if (!app?.vault || !this.ctx?.sourcePath) return;

        try {
            const file = app.vault.getAbstractFileByPath(this.ctx.sourcePath);
            if (!(file instanceof TFile)) return;

            const col0WidthPx = this.columns[0]?.width || 220;
            const col0TargetChars = Math.max(10, Math.round((col0WidthPx - 24) / 8.6));

            const colWidthsTargetChars: number[] = [];
            for (let i = 1; i < this.columns.length; i++) {
                const w = this.columns[i]?.width || 120;
                colWidthsTargetChars[i] = Math.max(4, Math.round((w - 24) / 8.6));
            }

            const visibleLines = this.getVisibleSerializedLines(col0TargetChars, colWidthsTargetChars);
            const newSource = visibleLines.join('\n');

            const fileContent = await app.vault.read(file);

            let updatedContent = '';
            let replaced = false;

            const sectionInfo = this.ctx.getSectionInfo?.(this.containerEl);
            if (sectionInfo && sectionInfo.lineStart !== undefined && sectionInfo.lineEnd !== undefined) {
                const lines = fileContent.split(/\r?\n/);
                if (sectionInfo.lineStart < lines.length && sectionInfo.lineEnd < lines.length) {
                    const before = lines.slice(0, sectionInfo.lineStart + 1);
                    const after = lines.slice(sectionInfo.lineEnd);
                    updatedContent = [...before, ...visibleLines, ...after].join('\n');
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
