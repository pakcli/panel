/**
 * TreeCodeblockRenderer.ts
 * Interactive Tree-Grid Renderer with Draggable Columns, Auto-Fit,
 * and Cascading Sticky Headers.
 */

import { MarkdownRenderChild, MarkdownPostProcessorContext, Notice } from 'obsidian';
import { ParsedTreeGrid, TreeGridColumn, TreeGridNode } from './types';
import { parseTreeGrid } from './treeParser';

export class TreeCodeblockRenderer extends MarkdownRenderChild {
    private source: string;
    private ctx: MarkdownPostProcessorContext;
    private parsed: ParsedTreeGrid;
    private columns: TreeGridColumn[] = [];
    private filterKeyword = '';

    private gridWrapperEl!: HTMLElement;
    private headerRowEl!: HTMLElement;
    private bodyContainerEl!: HTMLElement;

    constructor(containerEl: HTMLElement, source: string, ctx: MarkdownPostProcessorContext) {
        super(containerEl);
        this.source = source;
        this.ctx = ctx;
        this.parsed = parseTreeGrid(source);

        // Initialize default column widths
        this.initColumns();
    }

    onload(): void {
        this.render();
    }

    private initColumns(): void {
        this.columns = [];
        const total = this.parsed.totalColumns;

        for (let i = 0; i < total; i++) {
            const title = this.parsed.columnTitles[i] || (i === 0 ? 'Name' : `Column ${i + 1}`);
            // Column 0 (Tree node path) starts wider, metadata columns start at 180px
            const width = i === 0 ? 320 : 200;
            const minWidth = i === 0 ? 140 : 80;

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

        // 1. Control Toolbar
        this.renderToolbar(containerEl);

        // 2. Main Scrollable Container for Grid & Cascading Sticky Headers
        const scrollContainer = containerEl.createDiv({ cls: 'pakcli-tree-scroll-container' });

        this.gridWrapperEl = scrollContainer.createDiv({ cls: 'pakcli-tree-grid-wrapper' });
        this.updateGridTemplate();

        // 3. Render Header Row (Draggable & Auto-Fit)
        this.headerRowEl = this.gridWrapperEl.createDiv({ cls: 'pakcli-tree-header-row' });
        this.renderHeaderRow();

        // 4. Render Tree Body
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
        const badge = leftGroup.createSpan({ cls: 'pakcli-tree-badge', text: '🌲 TREE GRID' });
        badge.title = 'Hierarchical multi-column tree explorer';

        const countLabel = leftGroup.createSpan({
            cls: 'pakcli-tree-node-count text-muted',
            text: `${this.countTotalNodes(this.parsed.rootNodes)} items`,
        });

        const rightGroup = toolbar.createDiv({ cls: 'pakcli-tree-toolbar-right' });

        // Search Filter Input
        const searchInput = rightGroup.createEl('input', {
            cls: 'pakcli-tree-search-input',
            attr: { type: 'text', placeholder: '🔍 Filter files...', spellcheck: 'false' },
        });
        searchInput.addEventListener('input', () => {
            this.filterKeyword = searchInput.value.trim().toLowerCase();
            this.renderBody();
        });

        // Expand All Button
        const expandBtn = rightGroup.createEl('button', {
            cls: 'pakcli-tree-btn',
            text: '⤢ Expand All',
            attr: { type: 'button' },
        });
        expandBtn.addEventListener('click', () => {
            this.setAllExpanded(this.parsed.rootNodes, true);
            this.renderBody();
        });

        // Collapse All Button
        const collapseBtn = rightGroup.createEl('button', {
            cls: 'pakcli-tree-btn',
            text: '⤡ Collapse All',
            attr: { type: 'button' },
        });
        collapseBtn.addEventListener('click', () => {
            this.setAllExpanded(this.parsed.rootNodes, false);
            this.renderBody();
        });

        // Copy Clean Tree Button
        const copyBtn = rightGroup.createEl('button', {
            cls: 'pakcli-tree-btn',
            text: '📋 Copy Tree',
            attr: { type: 'button' },
        });
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.source);
            new Notice('Tree structure copied to clipboard!');
            copyBtn.setText('✅ Copied!');
            window.setTimeout(() => copyBtn.setText('📋 Copy Tree'), 1400);
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

    /**
     * Renders table headers with interactive resizers and double-click auto-fit.
     */
    private renderHeaderRow(): void {
        this.headerRowEl.empty();

        for (let i = 0; i < this.columns.length; i++) {
            const col = this.columns[i];
            const th = this.headerRowEl.createDiv({ cls: 'pakcli-tree-th' });

            const titleSpan = th.createSpan({ cls: 'pakcli-tree-th-title', text: col.title });

            // Resizer handle (on all columns)
            const resizer = th.createDiv({ cls: 'pakcli-col-resizer' });
            resizer.title = 'Drag to resize, double-click to auto-fit width';

            // Drag Resizing Logic
            this.wireColumnResizer(resizer, i);

            // Double Click Auto-Fit Logic
            resizer.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.autoFitColumn(i);
            });
        }
    }

    /**
     * Wires mouse drag events to resize a column smoothly.
     */
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

    /**
     * Auto-fits the column width to the widest content currently rendered in that column.
     */
    private autoFitColumn(colIndex: number): void {
        const colCells = this.bodyContainerEl.querySelectorAll<HTMLElement>(
            `.pakcli-tree-row > .pakcli-tree-cell[data-col-index="${colIndex}"]`
        );

        let maxContentWidth = this.columns[colIndex].minWidth;

        colCells.forEach((cell) => {
            const contentSpan = cell.querySelector<HTMLElement>('.pakcli-cell-content') || cell;
            const width = contentSpan.scrollWidth + 32; // Include cell padding & icons
            if (width > maxContentWidth) {
                maxContentWidth = width;
            }
        });

        // Cap at 700px maximum to prevent extreme blowup
        const fittedWidth = Math.min(700, Math.max(this.columns[colIndex].minWidth, maxContentWidth));
        this.columns[colIndex].width = fittedWidth;
        this.updateGridTemplate();

        new Notice(`Fitted column '${this.columns[colIndex].title}' to ${fittedWidth}px`);
    }

    /**
     * Renders the hierarchical tree body with cascading sticky headers.
     */
    private renderBody(): void {
        this.bodyContainerEl.empty();

        if (this.parsed.rootNodes.length === 0) {
            const emptyEl = this.bodyContainerEl.createDiv({ cls: 'pakcli-tree-empty text-muted' });
            emptyEl.setText('No items found in tree.');
            return;
        }

        for (const rootNode of this.parsed.rootNodes) {
            this.renderNode(this.bodyContainerEl, rootNode, 0);
        }
    }

    /**
     * Recursively renders a tree node.
     * Folders receive sticky styling cascading by depth (`top: calc(depth * 32px)`).
     */
    private renderNode(parentContainer: HTMLElement, node: TreeGridNode, depth: number): void {
        // Filter match check
        const matchesSelf = !this.filterKeyword || node.name.toLowerCase().includes(this.filterKeyword);
        const matchesChildren = this.hasMatchingDescendant(node, this.filterKeyword);

        if (!matchesSelf && !matchesChildren) {
            return;
        }

        if (node.isDirectory) {
            // Directory Container Block
            const dirBlock = parentContainer.createDiv({ cls: 'pakcli-tree-dir-block' });
            dirBlock.style.setProperty('--tree-depth', String(depth));

            // Sticky Header Row for Directory
            const row = dirBlock.createDiv({
                cls: `pakcli-tree-row is-directory ${depth <= 4 ? 'pakcli-tree-sticky' : ''}`,
            });

            // Cascading Sticky positioning: top = depth * 32px
            row.style.top = `${depth * 32}px`;
            row.style.zIndex = `${30 - depth}`;

            // Column 0: Folder Title with Chevron & Icon
            const col0 = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-primary' });
            col0.dataset.colIndex = '0';
            col0.style.paddingLeft = `${depth * 20 + 8}px`;

            const chevron = col0.createSpan({
                cls: `pakcli-tree-chevron ${node.isExpanded ? 'is-open' : 'is-closed'}`,
                text: node.isExpanded ? '▼' : '▶',
            });
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                node.isExpanded = !node.isExpanded;
                this.renderBody();
            });

            const folderIcon = col0.createSpan({
                cls: 'pakcli-tree-icon',
                text: node.isExpanded ? '📂' : '📁',
            });

            const nameSpan = col0.createSpan({ cls: 'pakcli-cell-content pakcli-folder-name', text: node.name });

            // Folder click also toggles
            row.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (!target.closest('.pakcli-col-resizer')) {
                    node.isExpanded = !node.isExpanded;
                    this.renderBody();
                }
            });

            // Metadata Columns for folder (if any)
            for (let c = 1; c < this.columns.length; c++) {
                const cell = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-meta' });
                cell.dataset.colIndex = String(c);
                const val = node.columns[c - 1] || '';
                cell.createSpan({ cls: 'pakcli-cell-content text-muted', text: val });
            }

            // Children Container (collapsible)
            if (node.isExpanded) {
                const childrenContainer = dirBlock.createDiv({ cls: 'pakcli-tree-children' });
                for (const child of node.children) {
                    this.renderNode(childrenContainer, child, depth + 1);
                }
            }
        } else {
            // Leaf File Row
            const row = parentContainer.createDiv({ cls: 'pakcli-tree-row is-file' });

            // Column 0: File with Icon & Indentation
            const col0 = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-primary' });
            col0.dataset.colIndex = '0';
            col0.style.paddingLeft = `${depth * 20 + 26}px`; // Indented past chevron

            const fileIcon = col0.createSpan({
                cls: 'pakcli-tree-icon',
                text: this.resolveFileIcon(node.extension),
            });

            const nameSpan = col0.createSpan({ cls: 'pakcli-cell-content pakcli-file-name', text: node.name });

            if (node.extension) {
                const extBadge = col0.createSpan({
                    cls: 'pakcli-tree-ext-badge',
                    text: `.${node.extension}`,
                });
            }

            // Metadata Columns (Columns 1 to 10)
            for (let c = 1; c < this.columns.length; c++) {
                const cell = row.createDiv({ cls: 'pakcli-tree-cell pakcli-tree-cell-meta' });
                cell.dataset.colIndex = String(c);
                const val = node.columns[c - 1] || '';
                cell.createSpan({ cls: 'pakcli-cell-content', text: val });
            }
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

    /**
     * File type emoji resolver for clean aesthetic representation.
     */
    private resolveFileIcon(ext?: string): string {
        if (!ext) return '📄';
        const e = ext.toLowerCase();

        switch (e) {
            case 'csv':
            case 'tsv':
                return '📊';
            case 'json':
            case 'yaml':
            case 'yml':
            case 'toml':
                return '⚙️';
            case 'js':
            case 'ts':
            case 'jsx':
            case 'tsx':
            case 'mjs':
                return '⚡';
            case 'html':
            case 'htm':
                return '🌐';
            case 'css':
            case 'scss':
            case 'sass':
            case 'less':
                return '🎨';
            case 'webp':
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'gif':
            case 'svg':
            case 'ico':
                return '🖼️';
            case 'md':
            case 'markdown':
            case 'txt':
                return '📝';
            case 'ps1':
            case 'sh':
            case 'bat':
            case 'cmd':
                return '💻';
            case 'mp3':
            case 'wav':
            case 'ogg':
                return '🎵';
            case 'mp4':
            case 'webm':
            case 'mov':
            case 'mkv':
                return '🎬';
            case 'zip':
            case 'rar':
            case '7z':
            case 'tar':
            case 'gz':
                return '📦';
            case 'env':
            case 'gitignore':
            case 'ds_store':
                return '🔒';
            default:
                return '📄';
        }
    }
}
