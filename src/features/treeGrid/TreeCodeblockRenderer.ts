/**
 * TreeCodeblockRenderer.ts
 * Raw-style Monospace ASCII Tree-Grid with In-Place Live Editing,
 * Draggable Columns, and Cascading Sticky Headers.
 * No extra GUI bloat above, pure codeblock aesthetic with branch and column lines.
 */

import { MarkdownRenderChild, MarkdownPostProcessorContext, Notice, TFile } from 'obsidian';
import { ParsedTreeGrid, TreeGridColumn, TreeGridNode } from './types';
import { parseTreeGrid, getAsciiBranchPrefix, serializeTreeToSource, getMaxCol0Length } from './treeParser';

export class TreeCodeblockRenderer extends MarkdownRenderChild {
    private source: string;
    private ctx: MarkdownPostProcessorContext;
    private plugin: any;
    private parsed: ParsedTreeGrid;
    private columns: TreeGridColumn[] = [];

    private gridWrapperEl!: HTMLElement;
    private headerRowEl!: HTMLElement;
    private bodyContainerEl!: HTMLElement;

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
        // Fine-tune column widths after DOM is attached
        requestAnimationFrame(() => {
            this.autoFitAllColumns();
        });
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
            const title = this.parsed.columnTitles[i] || (i === 0 ? 'NAME / PATH' : '#'.repeat(i));

            let maxChars = title.length;
            if (i === 0) {
                for (const node of allNodes) {
                    const branch = getAsciiBranchPrefix(node, this.parsed.rootNodes);
                    const fold = node.children.length > 0 ? 2 : 0;
                    const len = branch.length + fold + node.name.length;
                    if (len > maxChars) maxChars = len;
                }
            } else {
                for (const node of allNodes) {
                    const val = node.columns[i - 1] || '';
                    if (val) {
                        const len = i + 1 + val.length; // '#' repeat + space + text
                        if (len > maxChars) maxChars = len;
                    }
                }
            }

            // Monospace font char width is approx 8.5px at 0.85rem
            // Add padding (16px) + resizer buffer (16px) = 32px
            const maxTreeChars = getMaxCol0Length(this.parsed.rootNodes);
            const treeMinPx = Math.ceil((maxTreeChars + 2) * 8.6) + 24;
            const minWidth = i === 0 ? Math.max(80, treeMinPx) : 50;
            const snugWidth = Math.ceil(maxChars * 8.6) + 32;
            const width = Math.max(minWidth, Math.min(800, snugWidth));

            this.columns.push({
                id: i,
                title,
                width,
                minWidth,
            });
        }
    }

    private render(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('pakcli-tree-grid-root');

        // Main Scroll Container (Raw Codeblock Style, NO extra GUI toolbar above)
        const scrollContainer = containerEl.createDiv({ cls: 'pakcli-tree-scroll-container' });

        this.gridWrapperEl = scrollContainer.createDiv({ cls: 'pakcli-tree-grid-wrapper' });
        this.updateGridTemplate();

        // Header Row (Column 0 | Column 1 | Column 2 ...)
        this.headerRowEl = this.gridWrapperEl.createDiv({ cls: 'pakcli-tree-header-row' });
        this.renderHeaderRow();

        // Tree Body
        this.bodyContainerEl = this.gridWrapperEl.createDiv({ cls: 'pakcli-tree-body-container' });
        this.renderBody();
    }

    private updateGridTemplate(): void {
        if (!this.gridWrapperEl) return;
        const template = this.columns.map((c) => `${c.width}px`).join(' ');
        this.gridWrapperEl.style.gridTemplateColumns = template;
    }

    private renderHeaderRow(): void {
        this.headerRowEl.empty();

        for (let i = 0; i < this.columns.length; i++) {
            const col = this.columns[i];
            const th = this.headerRowEl.createDiv({ cls: 'pakcli-tree-th' });
            th.dataset.colIndex = String(i);

            if (i === 0) {
                // Column 0: PATH / NAME
                th.createSpan({ cls: 'pakcli-tree-th-title', text: col.title });

                // Quick add first comment column if desired
                const addBtn = th.createSpan({ cls: 'pakcli-th-btn pakcli-th-btn-add', text: '+' });
                addBtn.title = 'Add comment column (#)';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.addColumn(0);
                });
            } else {
                // Column 1..N: Reorder handle (::), Shift (< and >), Title, Duplicate (+), Delete (-)
                const dragHandle = th.createSpan({ cls: 'pakcli-th-drag-handle', text: '::' });
                dragHandle.title = 'Drag :: to reorder column';

                const leftBtn = th.createSpan({ cls: 'pakcli-th-btn pakcli-th-btn-move', text: '<' });
                leftBtn.title = 'Move column left';
                if (i === 1) leftBtn.addClass('is-disabled');
                leftBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (i > 1) this.moveColumn(i, i - 1);
                });

                const rightBtn = th.createSpan({ cls: 'pakcli-th-btn pakcli-th-btn-move', text: '>' });
                rightBtn.title = 'Move column right';
                if (i === this.columns.length - 1) rightBtn.addClass('is-disabled');
                rightBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (i < this.columns.length - 1) this.moveColumn(i, i + 1);
                });

                th.createSpan({ cls: 'pakcli-tree-th-title', text: col.title });

                // + Add / Duplicate Column
                const addBtn = th.createSpan({ cls: 'pakcli-th-btn pakcli-th-btn-add', text: '+' });
                addBtn.title = 'Add new column (Alt+click to duplicate)';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.addColumn(i, e.altKey);
                });

                // - Delete Column
                const delBtn = th.createSpan({ cls: 'pakcli-th-btn pakcli-th-btn-del', text: '-' });
                delBtn.title = 'Delete this column';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteColumn(i);
                });

                // HTML5 Drag-and-drop column reordering
                th.setAttribute('draggable', 'true');
                th.addEventListener('dragstart', (e) => {
                    e.dataTransfer?.setData('text/plain', String(i));
                    th.addClass('is-dragging');
                });
                th.addEventListener('dragend', () => {
                    th.removeClass('is-dragging');
                    this.headerRowEl.querySelectorAll('.pakcli-tree-th').forEach((el) => el.removeClass('drag-over'));
                });
                th.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    th.addClass('drag-over');
                });
                th.addEventListener('dragleave', () => {
                    th.removeClass('drag-over');
                });
                th.addEventListener('drop', (e) => {
                    e.preventDefault();
                    th.removeClass('drag-over');
                    const fromStr = e.dataTransfer?.getData('text/plain');
                    if (fromStr !== undefined) {
                        const fromIdx = parseInt(fromStr, 10);
                        if (!isNaN(fromIdx) && fromIdx >= 1 && fromIdx !== i) {
                            this.moveColumn(fromIdx, i);
                        }
                    }
                });
            }

            // Draggable column divider handle (Resizer)
            const resizer = th.createDiv({ cls: 'pakcli-col-resizer' });
            resizer.title = 'Drag to resize • Double-click to auto-fit';

            this.wireColumnResizer(resizer, i);

            resizer.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.autoFitColumn(i);
            });

            th.addEventListener('dblclick', (e) => {
                if ((e.target as HTMLElement).classList.contains('pakcli-tree-th-title') || e.target === th) {
                    e.stopPropagation();
                    this.autoFitColumn(i);
                }
            });
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

    private wireColumnResizer(resizerEl: HTMLElement, colIndex: number): void {
        resizerEl.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startWidth = this.columns[colIndex].width;
            const minWidth = this.columns[colIndex].minWidth;

            document.body.addClass('pakcli-is-col-resizing');

            const onMouseMove = (moveEvt: MouseEvent) => {
                const deltaX = moveEvt.clientX - startX;
                const newWidth = Math.max(minWidth, startWidth + deltaX);
                this.columns[colIndex].width = newWidth;
                this.updateGridTemplate();
            };

            const onMouseUp = () => {
                document.body.removeClass('pakcli-is-col-resizing');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                // Immediately sync padded spaces to active note's raw markdown
                this.syncChangesToNote();
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    public autoFitColumn(colIndex: number): void {
        if (!this.bodyContainerEl || !this.columns[colIndex]) return;

        const colCells = this.bodyContainerEl.querySelectorAll<HTMLElement>(
            `.pakcli-tree-row > .pakcli-tree-cell[data-col-index="${colIndex}"]`
        );

        let maxContentWidth = this.columns[colIndex].minWidth;

        // Account for header title width
        const th = this.headerRowEl?.children[colIndex] as HTMLElement | undefined;
        if (th) {
            const titleSpan = th.querySelector<HTMLElement>('.pakcli-tree-th-title');
            if (titleSpan) {
                maxContentWidth = Math.max(maxContentWidth, titleSpan.scrollWidth + 32);
            }
        }

        colCells.forEach((cell) => {
            let cellContentWidth = 0;
            const children = Array.from(cell.children) as HTMLElement[];
            if (children.length > 0) {
                for (const child of children) {
                    cellContentWidth += child.scrollWidth || child.offsetWidth;
                }
            } else {
                cellContentWidth = cell.scrollWidth;
            }
            // Add padding (16px) + small safety buffer (12px) = 28px
            const width = cellContentWidth + 28;
            if (width > maxContentWidth) {
                maxContentWidth = width;
            }
        });

        const fittedWidth = Math.min(1000, Math.max(this.columns[colIndex].minWidth, maxContentWidth));
        this.columns[colIndex].width = fittedWidth;
        this.updateGridTemplate();
        this.syncChangesToNote();
    }

    public autoFitAllColumns(): void {
        for (let i = 0; i < this.columns.length; i++) {
            this.autoFitColumn(i);
        }
    }

    private renderBody(): void {
        this.bodyContainerEl.empty();

        if (this.parsed.rootNodes.length === 0) {
            const emptyEl = this.bodyContainerEl.createDiv({ cls: 'pakcli-tree-empty text-muted' });
            emptyEl.setText('Empty tree.');
            return;
        }

        for (const rootNode of this.parsed.rootNodes) {
            this.renderNode(this.bodyContainerEl, rootNode, 0);
        }
    }

    /**
     * Renders a tree node with ASCII L-branching (`├──`, `└──`, `│`),
     * vertical column divider lines, and live in-place editable cells.
     */
    private renderNode(parentContainer: HTMLElement, node: TreeGridNode, depth: number): void {
        const asciiBranch = getAsciiBranchPrefix(node, this.parsed.rootNodes);
        const stickyTop = `${25 + depth * 25}px`;
        const stickyZIndex = String(Math.max(10, 35 - depth));

        if (node.isDirectory) {
            const dirBlock = parentContainer.createDiv({ cls: 'pakcli-tree-dir-block' });
            dirBlock.style.setProperty('--tree-depth', String(depth));

            const row = dirBlock.createDiv({
                cls: `pakcli-tree-row is-directory ${depth <= 4 ? 'pakcli-tree-sticky' : ''}`,
            });

            // Column 0
            const col0 = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-primary' });
            col0.dataset.colIndex = '0';
            col0.style.top = stickyTop;
            col0.style.zIndex = stickyZIndex;

            // Monospace ASCII Branch Prefix (├──, └──, │   )
            if (asciiBranch) {
                col0.createSpan({ cls: 'pakcli-tree-branch-prefix', text: asciiBranch });
            }

            // Minimalist Fold Toggle (v / >) only if has children
            if (node.children.length > 0) {
                const foldBtn = col0.createSpan({
                    cls: 'pakcli-tree-fold-indicator',
                    text: node.isExpanded ? 'v ' : '> ',
                });
                foldBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    node.isExpanded = !node.isExpanded;
                    this.renderBody();
                    requestAnimationFrame(() => {
                        this.autoFitColumn(0);
                    });
                });
            }

            // Live Editable Folder Name
            const nameSpan = col0.createSpan({
                cls: 'pakcli-editable-val pakcli-folder-name',
                text: node.name,
                attr: { title: 'Double-click to edit' },
            });
            this.makeCellEditable(nameSpan, (newVal) => {
                node.name = newVal.trim();
                nameSpan.textContent = node.name;
                this.syncChangesToNote();
                this.autoFitColumn(0);
            });

            col0.addEventListener('dblclick', (e) => {
                if (e.target === col0) {
                    e.stopPropagation();
                    this.autoFitColumn(0);
                }
            });

            // Metadata Columns 1 to N
            for (let c = 1; c < this.columns.length; c++) {
                const cell = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-meta' });
                cell.dataset.colIndex = String(c);
                cell.style.top = stickyTop;
                cell.style.zIndex = stickyZIndex;

                const rawVal = node.columns[c - 1] || '';
                const prefix = '#'.repeat(c);
                const cleanVal = rawVal.replace(/^#+\s*/, '').trim();
                const displayText = cleanVal ? `${prefix} ${cleanVal}` : '';

                const valSpan = cell.createSpan({
                    cls: 'pakcli-editable-val text-muted',
                    text: displayText,
                    attr: { title: 'Double-click to edit' },
                });
                this.makeCellEditable(valSpan, (newVal) => {
                    const cleaned = newVal.replace(/^#+\s*/, '').trim();
                    while (node.columns.length < c) node.columns.push('');
                    node.columns[c - 1] = cleaned;
                    valSpan.textContent = cleaned ? `${prefix} ${cleaned}` : '';
                    this.syncChangesToNote();
                    this.autoFitColumn(c);
                });

                cell.addEventListener('dblclick', (e) => {
                    if (e.target === cell) {
                        e.stopPropagation();
                        this.autoFitColumn(c);
                    }
                });
            }

            // Children Container
            if (node.isExpanded) {
                const childrenContainer = dirBlock.createDiv({ cls: 'pakcli-tree-children' });
                for (const child of node.children) {
                    this.renderNode(childrenContainer, child, depth + 1);
                }
            }
        } else {
            // Leaf File Node Row
            const row = parentContainer.createDiv({ cls: 'pakcli-tree-row is-file' });

            // Column 0
            const col0 = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-primary' });
            col0.dataset.colIndex = '0';

            if (asciiBranch) {
                col0.createSpan({ cls: 'pakcli-tree-branch-prefix', text: asciiBranch });
            }

            // Live Editable File Name
            const nameSpan = col0.createSpan({
                cls: 'pakcli-editable-val pakcli-file-name',
                text: node.name,
                attr: { title: 'Double-click to edit' },
            });
            this.makeCellEditable(nameSpan, (newVal) => {
                node.name = newVal.trim();
                nameSpan.textContent = node.name;
                this.syncChangesToNote();
                this.autoFitColumn(0);
            });

            col0.addEventListener('dblclick', (e) => {
                if (e.target === col0) {
                    e.stopPropagation();
                    this.autoFitColumn(0);
                }
            });

            // Metadata Columns 1 to N
            for (let c = 1; c < this.columns.length; c++) {
                const cell = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-meta' });
                cell.dataset.colIndex = String(c);

                const rawVal = node.columns[c - 1] || '';
                const prefix = '#'.repeat(c);
                const cleanVal = rawVal.replace(/^#+\s*/, '').trim();
                const displayText = cleanVal ? `${prefix} ${cleanVal}` : '';

                const valSpan = cell.createSpan({
                    cls: 'pakcli-editable-val',
                    text: displayText,
                    attr: { title: 'Double-click to edit' },
                });
                this.makeCellEditable(valSpan, (newVal) => {
                    const cleaned = newVal.replace(/^#+\s*/, '').trim();
                    while (node.columns.length < c) node.columns.push('');
                    node.columns[c - 1] = cleaned;
                    valSpan.textContent = cleaned ? `${prefix} ${cleaned}` : '';
                    this.syncChangesToNote();
                    this.autoFitColumn(c);
                });

                cell.addEventListener('dblclick', (e) => {
                    if (e.target === cell) {
                        e.stopPropagation();
                        this.autoFitColumn(c);
                    }
                });
            }
        }
    }

    private makeCellEditable(element: HTMLElement, onChange: (newVal: string) => void): void {
        element.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.enterInlineEdit(element, onChange);
        });
    }

    private enterInlineEdit(element: HTMLElement, onSave: (val: string) => void): void {
        const originalText = element.textContent || '';
        element.contentEditable = 'true';
        element.addClass('is-editing');
        element.focus();

        let isSaved = false;

        const finish = (save: boolean) => {
            if (isSaved) return;
            isSaved = true;
            element.contentEditable = 'false';
            element.removeClass('is-editing');

            const newText = (element.textContent || '').trim();
            if (save && newText !== originalText) {
                onSave(newText);
            } else {
                element.textContent = originalText;
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                element.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
            }
        };

        const onBlur = () => {
            finish(true);
            element.removeEventListener('keydown', onKeyDown);
            element.removeEventListener('blur', onBlur);
        };

        element.addEventListener('keydown', onKeyDown);
        element.addEventListener('blur', onBlur);
    }

    private async syncChangesToNote(): Promise<void> {
        const app = this.plugin?.app;
        if (!app?.vault || !this.ctx?.sourcePath) return;

        try {
            const file = app.vault.getAbstractFileByPath(this.ctx.sourcePath);
            if (!(file instanceof TFile)) return;

            // Convert pixel width of col 0 to character width (approx 8.6px per char)
            const col0WidthPx = this.columns[0]?.width || 200;
            const col0TargetChars = Math.max(10, Math.round((col0WidthPx - 24) / 8.6));

            // Col 1..N character spacing
            const colWidthsTargetChars: number[] = [];
            for (let i = 1; i < this.columns.length; i++) {
                const w = this.columns[i]?.width || 120;
                colWidthsTargetChars[i] = Math.max(4, Math.round((w - 24) / 8.6));
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

            // 1. Try exact sectionInfo line range replacement
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

            // 2. Fallback: normalize line endings and replace exact source
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
