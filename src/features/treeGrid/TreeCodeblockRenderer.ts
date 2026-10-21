/**
 * TreeCodeblockRenderer.ts
 * Interactive ASCII Tree-Grid Renderer with In-Place Live Editing,
 * ASCII L-Branching, Draggable Columns, and Cascading Sticky Headers.
 */

import { MarkdownRenderChild, MarkdownPostProcessorContext, Notice, TFile } from 'obsidian';
import { ParsedTreeGrid, TreeGridColumn, TreeGridNode } from './types';
import { parseTreeGrid, getAsciiBranchPrefix, serializeTreeToSource } from './treeParser';

export class TreeCodeblockRenderer extends MarkdownRenderChild {
    private source: string;
    private ctx: MarkdownPostProcessorContext;
    private plugin: any;
    private parsed: ParsedTreeGrid;
    private columns: TreeGridColumn[] = [];
    private filterKeyword = '';

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
    }

    private initColumns(): void {
        this.columns = [];
        const total = this.parsed.totalColumns;

        for (let i = 0; i < total; i++) {
            const title = this.parsed.columnTitles[i] || (i === 0 ? 'NAME / PATH' : `COL ${i + 1}`);
            const width = i === 0 ? 300 : 180;
            const minWidth = i === 0 ? 120 : 70;

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

        // 1. Sleek Monospace Control Toolbar
        this.renderToolbar(containerEl);

        // 2. Main Scroll Container for Cascading Sticky & Tree Grid
        const scrollContainer = containerEl.createDiv({ cls: 'pakcli-tree-scroll-container' });

        this.gridWrapperEl = scrollContainer.createDiv({ cls: 'pakcli-tree-grid-wrapper' });
        this.updateGridTemplate();

        // 3. Header Row (Draggable & Auto-Fit)
        this.headerRowEl = this.gridWrapperEl.createDiv({ cls: 'pakcli-tree-header-row' });
        this.renderHeaderRow();

        // 4. Tree Body
        this.bodyContainerEl = this.gridWrapperEl.createDiv({ cls: 'pakcli-tree-body-container' });
        this.renderBody();
    }

    private updateGridTemplate(): void {
        if (!this.gridWrapperEl) return;
        const template = this.columns.map((c) => `${c.width}px`).join(' ');
        this.gridWrapperEl.style.gridTemplateColumns = template;
    }

    private renderToolbar(parentEl: HTMLElement): void {
        const toolbar = parentEl.createDiv({ cls: 'pakcli-tree-toolbar' });

        const leftGroup = toolbar.createDiv({ cls: 'pakcli-tree-toolbar-left' });
        leftGroup.createSpan({ cls: 'pakcli-tree-badge', text: 'TREE' });
        leftGroup.createSpan({
            cls: 'pakcli-tree-node-count text-muted',
            text: `${this.countTotalNodes(this.parsed.rootNodes)} nodes`,
        });

        const rightGroup = toolbar.createDiv({ cls: 'pakcli-tree-toolbar-right' });

        // Search Filter Input
        const searchInput = rightGroup.createEl('input', {
            cls: 'pakcli-tree-search-input',
            attr: { type: 'text', placeholder: 'filter...', spellcheck: 'false' },
        });
        searchInput.addEventListener('input', () => {
            this.filterKeyword = searchInput.value.trim().toLowerCase();
            this.renderBody();
        });

        // Expand All
        const expandBtn = rightGroup.createEl('button', {
            cls: 'pakcli-tree-btn',
            text: 'Expand All',
            attr: { type: 'button' },
        });
        expandBtn.addEventListener('click', () => {
            this.setAllExpanded(this.parsed.rootNodes, true);
            this.renderBody();
        });

        // Collapse All
        const collapseBtn = rightGroup.createEl('button', {
            cls: 'pakcli-tree-btn',
            text: 'Collapse All',
            attr: { type: 'button' },
        });
        collapseBtn.addEventListener('click', () => {
            this.setAllExpanded(this.parsed.rootNodes, false);
            this.renderBody();
        });

        // Copy Plain Indented Source
        const copyBtn = rightGroup.createEl('button', {
            cls: 'pakcli-tree-btn',
            text: 'Copy',
            attr: { type: 'button' },
        });
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.source);
            new Notice('Tree source copied to clipboard!');
            copyBtn.setText('Copied!');
            window.setTimeout(() => copyBtn.setText('Copy'), 1200);
        });
    }

    private countTotalNodes(nodes: TreeGridNode[]): number {
        let count = 0;
        for (const n of nodes) {
            count += 1 + this.countTotalNodes(n.children);
        }
        return count;
    }

    private setAllExpanded(nodes: TreeGridNode[], expanded: boolean): void {
        for (const n of nodes) {
            if (n.isDirectory) {
                n.isExpanded = expanded;
                this.setAllExpanded(n.children, expanded);
            }
        }
    }

    private renderHeaderRow(): void {
        this.headerRowEl.empty();

        for (let i = 0; i < this.columns.length; i++) {
            const col = this.columns[i];
            const th = this.headerRowEl.createDiv({ cls: 'pakcli-tree-th' });

            th.createSpan({ cls: 'pakcli-tree-th-title', text: col.title });

            // Resizer handle
            const resizer = th.createDiv({ cls: 'pakcli-col-resizer' });
            resizer.title = 'Drag to resize, double-click to auto-fit width';

            this.wireColumnResizer(resizer, i);

            resizer.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.autoFitColumn(i);
            });
        }
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
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    private autoFitColumn(colIndex: number): void {
        const colCells = this.bodyContainerEl.querySelectorAll<HTMLElement>(
            `.pakcli-tree-row > .pakcli-tree-cell[data-col-index="${colIndex}"]`
        );

        let maxContentWidth = this.columns[colIndex].minWidth;

        colCells.forEach((cell) => {
            const contentSpan = cell.querySelector<HTMLElement>('.pakcli-editable-val') || cell;
            const width = contentSpan.scrollWidth + 36;
            if (width > maxContentWidth) {
                maxContentWidth = width;
            }
        });

        const fittedWidth = Math.min(750, Math.max(this.columns[colIndex].minWidth, maxContentWidth));
        this.columns[colIndex].width = fittedWidth;
        this.updateGridTemplate();
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
     * cascading sticky directory headers, and in-place live editable cells.
     */
    private renderNode(parentContainer: HTMLElement, node: TreeGridNode, depth: number): void {
        const matchesSelf = !this.filterKeyword || node.name.toLowerCase().includes(this.filterKeyword);
        const matchesChildren = this.hasMatchingDescendant(node, this.filterKeyword);

        if (!matchesSelf && !matchesChildren) {
            return;
        }

        // Compute exact ASCII tree branches (├──, └──, │   )
        const asciiBranch = getAsciiBranchPrefix(node, this.parsed.rootNodes);

        if (node.isDirectory) {
            const dirBlock = parentContainer.createDiv({ cls: 'pakcli-tree-dir-block' });
            dirBlock.style.setProperty('--tree-depth', String(depth));

            // Cascading sticky header for folder
            const row = dirBlock.createDiv({
                cls: `pakcli-tree-row is-directory ${depth <= 4 ? 'pakcli-tree-sticky' : ''}`,
            });

            row.style.top = `${depth * 28}px`;
            row.style.zIndex = `${30 - depth}`;

            // Column 0: Tree path with ASCII branching and toggle chevron
            const col0 = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-primary' });
            col0.dataset.colIndex = '0';

            // ASCII Branch Prefix (fixed monospace)
            if (asciiBranch) {
                const branchSpan = col0.createSpan({ cls: 'pakcli-tree-branch-prefix', text: asciiBranch });
            }

            // Minimalist Toggle Indicator (▼/▶)
            const chevron = col0.createSpan({
                cls: `pakcli-tree-chevron ${node.isExpanded ? 'is-open' : 'is-closed'}`,
                text: node.isExpanded ? '▼' : '▶',
            });
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                node.isExpanded = !node.isExpanded;
                this.renderBody();
            });

            // Live Editable Folder Name
            const nameSpan = col0.createSpan({
                cls: 'pakcli-editable-val pakcli-folder-name',
                text: node.name,
                attr: { title: 'Double click to edit folder name' },
            });
            this.makeCellEditable(nameSpan, (newVal) => {
                node.name = newVal;
                this.syncChangesToNote();
            });

            // Metadata Columns 1 to N
            for (let c = 1; c < this.columns.length; c++) {
                const cell = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-meta' });
                cell.dataset.colIndex = String(c);
                const val = node.columns[c - 1] || '';

                const valSpan = cell.createSpan({
                    cls: 'pakcli-editable-val text-muted',
                    text: val,
                    attr: { title: 'Click or double click to edit' },
                });
                this.makeCellEditable(valSpan, (newVal) => {
                    while (node.columns.length < c) node.columns.push('');
                    node.columns[c - 1] = newVal;
                    this.syncChangesToNote();
                });
            }

            // Recursive Children
            if (node.isExpanded) {
                const childrenContainer = dirBlock.createDiv({ cls: 'pakcli-tree-children' });
                for (const child of node.children) {
                    this.renderNode(childrenContainer, child, depth + 1);
                }
            }
        } else {
            // Leaf File Node Row
            const row = parentContainer.createDiv({ cls: 'pakcli-tree-row is-file' });

            // Column 0: ASCII Branching + Clean File Name
            const col0 = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-primary' });
            col0.dataset.colIndex = '0';

            // ASCII Branch Prefix (fixed monospace)
            if (asciiBranch) {
                col0.createSpan({ cls: 'pakcli-tree-branch-prefix', text: asciiBranch });
            }

            // Small spacer where chevron would be
            col0.createSpan({ cls: 'pakcli-tree-file-spacer', text: '  ' });

            // Live Editable File Name
            const nameSpan = col0.createSpan({
                cls: 'pakcli-editable-val pakcli-file-name',
                text: node.name,
                attr: { title: 'Double click to edit file name' },
            });
            this.makeCellEditable(nameSpan, (newVal) => {
                node.name = newVal;
                this.syncChangesToNote();
            });

            // Metadata Columns 1 to N
            for (let c = 1; c < this.columns.length; c++) {
                const cell = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-meta' });
                cell.dataset.colIndex = String(c);
                const val = node.columns[c - 1] || '';

                const valSpan = cell.createSpan({
                    cls: 'pakcli-editable-val',
                    text: val,
                    attr: { title: 'Click or double click to edit' },
                });
                this.makeCellEditable(valSpan, (newVal) => {
                    while (node.columns.length < c) node.columns.push('');
                    node.columns[c - 1] = newVal;
                    this.syncChangesToNote();
                });
            }
        }
    }

    /**
     * Attaches live in-place editable behavior to an element.
     * When user finishes editing (Enter or blur), onChange callback is triggered.
     */
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

    /**
     * Serializes tree in memory back to plain indented markdown source (NO ASCII branches)
     * and modifies the active note file in the vault.
     */
    private async syncChangesToNote(): Promise<void> {
        const app = this.plugin?.app;
        if (!app?.vault || !this.ctx?.sourcePath) return;

        try {
            const file = app.vault.getAbstractFileByPath(this.ctx.sourcePath);
            if (!(file instanceof TFile)) return;

            const newLines = serializeTreeToSource(this.parsed.rootNodes);
            const newSource = newLines.join('\n');

            const fileContent = await app.vault.read(file);

            // Replace the old source block
            if (fileContent.includes(this.source)) {
                const updatedContent = fileContent.replace(this.source, newSource);
                this.source = newSource;
                await app.vault.modify(file, updatedContent);
                new Notice('✓ Saved tree changes to note');
            }
        } catch (err) {
            console.warn('[TreeGrid] Failed to sync changes to note:', err);
        }
    }

    private hasMatchingDescendant(node: TreeGridNode, keyword: string): boolean {
        if (!keyword) return true;
        for (const child of node.children) {
            if (child.name.toLowerCase().includes(keyword)) return true;
            if (this.hasMatchingDescendant(child, keyword)) return true;
        }
        return false;
    }
}
