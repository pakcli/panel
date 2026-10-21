/**
 * TreeCodeblockRenderer.ts
 * Authentic Unreplaced Codeblock with Extra GUI Overlay.
 * 100% Not a Table: Native <pre><code> lines, zero cell grid, zero horizontal lines.
 *
 * Layer 1 (Base Codeblock):
 * - Native <pre><code> text flow.
 * - Monospace font, codeblock background.
 * - Dynamic column width offset for #note comments.
 * - Zero empty cell divs on lines without comments.
 * - Smooth whole-row hover highlight.
 *
 * Layer 2 (Extra GUI Overlay):
 * - Baris Pohon (ASCII branches: ├──, └──, │   ) and Chevron fold toggles (v / >).
 * - Floating Header Ruler with column controls (::, <, >, #, +, -).
 * - Draggable Vertical Guideline Wires (position: absolute) to adjust column spacing.
 * - Bi-directional markdown note sync without pipe symbols.
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

    private rootContainerEl!: HTMLElement;
    private scrollWrapperEl!: HTMLElement;
    private rulerOverlayEl!: HTMLElement;
    private codeblockPreEl!: HTMLElement;
    private codeblockCodeEl!: HTMLElement;
    private guidelinesOverlayEl!: HTMLElement;
    private linesContainerEl!: HTMLElement;

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
            const title = this.parsed.columnTitles[i] || (i === 0 ? 'PATH' : '#'.repeat(i));

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
                        const len = i + 1 + val.length;
                        if (len > maxChars) maxChars = len;
                    }
                }
            }

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
        containerEl.addClass('pakcli-tree-container-root');

        // Scrollable Wrapper
        this.scrollWrapperEl = containerEl.createDiv({ cls: 'pakcli-tree-scroll-wrapper' });

        // Layer 2A: Floating Header Ruler Overlay
        this.rulerOverlayEl = this.scrollWrapperEl.createDiv({ cls: 'pakcli-tree-ruler-overlay' });
        this.renderRulerOverlay();

        // Layer 1: Native Codeblock Element (<pre><code>)
        this.codeblockPreEl = this.scrollWrapperEl.createEl('pre', { cls: 'pakcli-tree-native-codeblock' });
        this.codeblockCodeEl = this.codeblockPreEl.createEl('code', { cls: 'pakcli-tree-code-content' });

        // Layer 2B: Draggable Guidelines Overlay
        this.guidelinesOverlayEl = this.codeblockPreEl.createDiv({ cls: 'pakcli-tree-guidelines-overlay' });

        // Codeblock Lines Container
        this.linesContainerEl = this.codeblockCodeEl.createDiv({ cls: 'pakcli-codeblock-lines' });

        this.renderLines();
        this.renderGuidelines();
    }

    private renderRulerOverlay(): void {
        this.rulerOverlayEl.empty();

        for (let i = 0; i < this.columns.length; i++) {
            const col = this.columns[i];
            const colEl = this.rulerOverlayEl.createDiv({ cls: 'pakcli-ruler-col' });
            colEl.dataset.colIndex = String(i);
            colEl.style.width = `${col.width}px`;

            if (i === 0) {
                // Column 0 Header
                colEl.createSpan({ cls: 'pakcli-ruler-title', text: col.title });

                const addBtn = colEl.createSpan({ cls: 'pakcli-ruler-btn pakcli-ruler-btn-add', text: '+' });
                addBtn.title = 'Add comment column (#)';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.addColumn(0);
                });
            } else {
                // Column 1..N Header: :: drag handle, < >, title, +, -
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

                // HTML5 Drag-and-drop
                colEl.setAttribute('draggable', 'true');
                colEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer?.setData('text/plain', String(i));
                    colEl.addClass('is-dragging');
                });
                colEl.addEventListener('dragend', () => {
                    colEl.removeClass('is-dragging');
                    this.rulerOverlayEl.querySelectorAll('.pakcli-ruler-col').forEach((el) => el.removeClass('drag-over'));
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
        this.guidelinesOverlayEl.empty();

        let currentLeft = 0;
        for (let i = 0; i < this.columns.length - 1; i++) {
            currentLeft += this.columns[i].width;

            const guideline = this.guidelinesOverlayEl.createDiv({ cls: 'pakcli-col-guideline' });
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
        // Update ruler header
        const rulerCol = this.rulerOverlayEl.querySelector<HTMLElement>(`.pakcli-ruler-col[data-col-index="${colIndex}"]`);
        if (rulerCol) rulerCol.style.width = `${newWidth}px`;

        // Update all line spans for this column
        const selector = colIndex === 0
            ? '.pakcli-codeblock-line .pakcli-tree-item-area'
            : `.pakcli-codeblock-line .pakcli-tree-note-area[data-col-index="${colIndex}"]`;

        this.linesContainerEl.querySelectorAll<HTMLElement>(selector).forEach((el) => {
            el.style.width = `${newWidth}px`;
        });

        // Reposition guidelines
        let currentLeft = 0;
        const allGuidelines = this.guidelinesOverlayEl.querySelectorAll<HTMLElement>('.pakcli-col-guideline');
        for (let i = 0; i < this.columns.length - 1; i++) {
            currentLeft += this.columns[i].width;
            if (allGuidelines[i]) {
                allGuidelines[i].style.left = `${currentLeft}px`;
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

        let maxContentWidth = 0;
        const selector = colIndex === 0
            ? '.pakcli-codeblock-line .pakcli-tree-item-area'
            : `.pakcli-codeblock-line .pakcli-tree-note-area[data-col-index="${colIndex}"] .pakcli-tree-note-text`;

        this.linesContainerEl.querySelectorAll<HTMLElement>(selector).forEach((el) => {
            const text = el.textContent || '';
            if (text.trim()) {
                const width = Math.ceil(text.length * 8.6) + 24;
                if (width > maxContentWidth) maxContentWidth = width;
            }
        });

        const fittedWidth = Math.min(1000, Math.max(this.columns[colIndex].minWidth, maxContentWidth));
        this.columns[colIndex].width = fittedWidth;

        this.updateColumnWidthsInDOM(colIndex, fittedWidth);
        this.renderGuidelines();
        this.syncChangesToNote();
    }

    public autoFitAllColumns(): void {
        for (let i = 0; i < this.columns.length; i++) {
            this.autoFitColumn(i);
        }
    }

    private renderLines(): void {
        this.linesContainerEl.empty();

        if (this.parsed.rootNodes.length === 0) {
            const emptyEl = this.linesContainerEl.createDiv({ cls: 'pakcli-tree-empty text-muted' });
            emptyEl.setText('Empty tree.');
            return;
        }

        for (const rootNode of this.parsed.rootNodes) {
            this.renderNodeLine(this.linesContainerEl, rootNode, 0);
        }
    }

    /**
     * Renders a single codeblock line:
     * - Column 0 Area: Extra GUI Baris Pohon (├──, └──) + Chevron (v / >) + Item Name.
     * - Columns 1..N: Only rendered if comments exist, offset by column width.
     * - Zero table cells, zero horizontal lines, zero empty right boxes!
     */
    private renderNodeLine(parentContainer: HTMLElement, node: TreeGridNode, depth: number): void {
        const asciiBranch = getAsciiBranchPrefix(node, this.parsed.rootNodes);

        // A single continuous line of codeblock text
        const lineEl = parentContainer.createDiv({
            cls: `pakcli-codeblock-line ${node.isDirectory ? 'is-directory' : 'is-file'}`,
        });
        lineEl.dataset.nodeId = node.id;

        // Column 0 Item Area (Tree Baris Pohon + Fold Chevron + Item Name)
        const col0Area = lineEl.createDiv({ cls: 'pakcli-tree-item-area' });
        col0Area.dataset.colIndex = '0';
        col0Area.style.width = `${this.columns[0].width}px`;

        // Extra GUI Layer: Baris Pohon (├──, └──, │   )
        if (asciiBranch) {
            col0Area.createSpan({ cls: 'pakcli-tree-gui-branch', text: asciiBranch });
        }

        // Extra GUI Layer: Minimalist Fold Chevron (v / >) only for directories with children
        if (node.isDirectory && node.children.length > 0) {
            const foldBtn = col0Area.createSpan({
                cls: 'pakcli-tree-gui-fold',
                text: node.isExpanded ? 'v ' : '> ',
            });
            foldBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                node.isExpanded = !node.isExpanded;
                this.renderLines();
                this.renderGuidelines();
            });
        }

        // Item Name (Editable in place)
        const nameSpan = col0Area.createSpan({
            cls: `pakcli-editable-val ${node.isDirectory ? 'pakcli-folder-name' : 'pakcli-file-name'}`,
            text: node.name,
            attr: { title: 'Click to type / Enter for new line / Tab to indent' },
        });
        this.makeCellEditable(nameSpan, (newVal) => {
            node.name = newVal.trim();
            nameSpan.textContent = node.name;
            this.syncChangesToNote();
            this.autoFitColumn(0);
        }, node, 0);

        // Columns 1 to N: Offset #note## areas
        // Notice: If line has no comments, col0Area is all that exists! No empty boxes on the right!
        for (let c = 1; c < this.columns.length; c++) {
            const rawVal = node.columns[c - 1] || '';
            const prefix = '#'.repeat(c);
            const cleanVal = rawVal.replace(/^#+\s*/, '').trim();
            const displayText = cleanVal ? `${prefix} ${cleanVal}` : '';

            const colMeta = lineEl.createDiv({ cls: 'pakcli-tree-note-area' });
            colMeta.dataset.colIndex = String(c);
            colMeta.style.width = `${this.columns[c].width}px`;

            const valSpan = colMeta.createSpan({
                cls: 'pakcli-editable-val pakcli-tree-note-text text-muted',
                text: displayText,
                attr: { title: 'Click to type comment' },
            });

            this.makeCellEditable(valSpan, (newVal) => {
                const cleaned = newVal.replace(/^#+\s*/, '').trim();
                while (node.columns.length < c) node.columns.push('');
                node.columns[c - 1] = cleaned;
                valSpan.textContent = cleaned ? `${prefix} ${cleaned}` : '';
                this.syncChangesToNote();
                this.autoFitColumn(c);
            }, node, c);
        }

        // Render visible children if folder is expanded
        if (node.isDirectory && node.isExpanded && node.children.length > 0) {
            for (const child of node.children) {
                this.renderNodeLine(parentContainer, child, depth + 1);
            }
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

    private insertNodeAfter(targetNode: TreeGridNode): TreeGridNode {
        const newNode: TreeGridNode = {
            id: `tree-node-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            name: '',
            rawName: '',
            rawLine: '',
            depth: targetNode.depth,
            isDirectory: true,
            columns: [],
            children: [],
            isExpanded: true,
        };

        if (targetNode.parent) {
            newNode.parent = targetNode.parent;
            const siblings = targetNode.parent.children;
            const idx = siblings.indexOf(targetNode);
            siblings.splice(idx + 1, 0, newNode);
        } else {
            const idx = this.parsed.rootNodes.indexOf(targetNode);
            this.parsed.rootNodes.splice(idx + 1, 0, newNode);
        }

        this.syncChangesToNote();
        this.render();

        requestAnimationFrame(() => {
            this.focusCell(newNode.id, 0);
        });

        return newNode;
    }

    private deleteNode(node: TreeGridNode): void {
        const flat = this.getFlattenedVisibleNodes();
        const idx = flat.indexOf(node);
        const prevNode = idx > 0 ? flat[idx - 1] : null;

        if (node.parent) {
            const siblings = node.parent.children;
            const sIdx = siblings.indexOf(node);
            if (sIdx !== -1) siblings.splice(sIdx, 1);
        } else {
            const rIdx = this.parsed.rootNodes.indexOf(node);
            if (rIdx !== -1) this.parsed.rootNodes.splice(rIdx, 1);
        }

        this.syncChangesToNote();
        this.render();

        if (prevNode) {
            requestAnimationFrame(() => {
                this.focusCell(prevNode.id, 0);
            });
        }
    }

    private indentNode(node: TreeGridNode): void {
        const siblings = node.parent ? node.parent.children : this.parsed.rootNodes;
        const idx = siblings.indexOf(node);
        if (idx <= 0) return;

        const prevSibling = siblings[idx - 1];
        siblings.splice(idx, 1);

        node.parent = prevSibling;
        node.depth = prevSibling.depth + 1;
        prevSibling.children.push(node);
        prevSibling.isExpanded = true;
        prevSibling.isDirectory = true;

        this.syncChangesToNote();
        this.render();

        requestAnimationFrame(() => {
            this.focusCell(node.id, 0);
        });
    }

    private unindentNode(node: TreeGridNode): void {
        if (!node.parent) return;

        const parent = node.parent;
        const grandparent = parent.parent;

        const siblings = parent.children;
        const idx = siblings.indexOf(node);
        if (idx !== -1) siblings.splice(idx, 1);

        node.depth = parent.depth;
        if (grandparent) {
            node.parent = grandparent;
            const gSiblings = grandparent.children;
            const pIdx = gSiblings.indexOf(parent);
            gSiblings.splice(pIdx + 1, 0, node);
        } else {
            node.parent = undefined;
            const pIdx = this.parsed.rootNodes.indexOf(parent);
            this.parsed.rootNodes.splice(pIdx + 1, 0, node);
        }

        this.syncChangesToNote();
        this.render();

        requestAnimationFrame(() => {
            this.focusCell(node.id, 0);
        });
    }

    private focusCell(nodeId: string, colIndex: number): void {
        const selector = colIndex === 0
            ? `.pakcli-codeblock-line[data-node-id="${nodeId}"] .pakcli-tree-item-area .pakcli-editable-val`
            : `.pakcli-codeblock-line[data-node-id="${nodeId}"] .pakcli-tree-note-area[data-col-index="${colIndex}"] .pakcli-editable-val`;

        const cell = this.linesContainerEl.querySelector<HTMLElement>(selector);
        if (cell) {
            cell.click();
        }
    }

    private focusNextRowCell(currentNode: TreeGridNode, colIndex: number): void {
        const flat = this.getFlattenedVisibleNodes();
        const idx = flat.indexOf(currentNode);
        if (idx !== -1 && idx < flat.length - 1) {
            const nextNode = flat[idx + 1];
            this.focusCell(nextNode.id, colIndex);
        } else if (colIndex === 0) {
            this.insertNodeAfter(currentNode);
        }
    }

    private focusPrevRowCell(currentNode: TreeGridNode, colIndex: number): void {
        const flat = this.getFlattenedVisibleNodes();
        const idx = flat.indexOf(currentNode);
        if (idx > 0) {
            const prevNode = flat[idx - 1];
            this.focusCell(prevNode.id, colIndex);
        }
    }

    private makeCellEditable(
        element: HTMLElement,
        onChange: (newVal: string) => void,
        node: TreeGridNode,
        colIndex: number
    ): void {
        element.addEventListener('click', (e) => {
            e.stopPropagation();
            this.enterInlineEdit(element, onChange, node, colIndex);
        });
    }

    private enterInlineEdit(
        element: HTMLElement,
        onSave: (val: string) => void,
        node: TreeGridNode,
        colIndex: number
    ): void {
        if (element.classList.contains('is-editing')) return;

        const originalText = element.textContent || '';
        element.contentEditable = 'true';
        element.addClass('is-editing');
        element.focus();

        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);

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
                e.stopPropagation();
                finish(true);

                if (e.shiftKey) {
                    this.focusPrevRowCell(node, colIndex);
                } else if (colIndex === 0) {
                    this.insertNodeAfter(node);
                } else {
                    this.focusNextRowCell(node, colIndex);
                }
            } else if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                finish(true);

                if (colIndex === 0) {
                    if (e.shiftKey) {
                        this.unindentNode(node);
                    } else {
                        this.indentNode(node);
                    }
                } else {
                    const targetCol = e.shiftKey
                        ? Math.max(0, colIndex - 1)
                        : Math.min(this.columns.length - 1, colIndex + 1);
                    this.focusCell(node.id, targetCol);
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                finish(true);
                this.focusNextRowCell(node, colIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                finish(true);
                this.focusPrevRowCell(node, colIndex);
            } else if (e.key === 'Backspace' && (element.textContent || '').trim() === '') {
                if (colIndex === 0) {
                    e.preventDefault();
                    finish(false);
                    this.deleteNode(node);
                }
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

            const col0WidthPx = this.columns[0]?.width || 200;
            const col0TargetChars = Math.max(10, Math.round((col0WidthPx - 24) / 8.6));

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
