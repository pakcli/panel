export interface RulerColumn {
    id: number | string;
    title: string;
    width: number;
    canDelete?: boolean;
    canShiftLeft?: boolean;
    canShiftRight?: boolean;
}

export interface TableRulerOptions {
    containerEl: HTMLElement;
    columns: RulerColumn[];
    cls?: string;
    onColumnClick?: (colId: number | string) => void;
    onAddColumn?: (afterColId: number | string, duplicate?: boolean) => void;
    onDeleteColumn?: (colId: number | string) => void;
    onShiftColumn?: (colId: number | string, direction: 'left' | 'right') => void;
    onReorderColumn?: (fromId: number | string, toId: number | string) => void;
}

export class TableRuler {
    public element: HTMLElement;
    private options: TableRulerOptions;

    constructor(options: TableRulerOptions) {
        this.options = options;
        this.element = options.containerEl.createDiv({
            cls: `pakcli-table-ruler ${options.cls || ''}`,
        });

        this.render();
    }

    public render(): void {
        this.element.empty();

        for (let i = 0; i < this.options.columns.length; i++) {
            const col = this.options.columns[i];
            const colEl = this.element.createDiv({
                cls: 'pakcli-ruler-col',
            });
            colEl.style.width = `${col.width}px`;

            const titleEl = colEl.createSpan({
                cls: 'pakcli-ruler-title',
                text: col.title,
            });

            if (this.options.onColumnClick) {
                titleEl.addEventListener('click', () => {
                    this.options.onColumnClick?.(col.id);
                });
            }

            // Controls
            const ctrlBar = colEl.createDiv({ cls: 'pakcli-ruler-controls' });

            if (col.canDelete !== false && this.options.onDeleteColumn) {
                const delBtn = ctrlBar.createSpan({ cls: 'pakcli-ruler-btn pakcli-ruler-del', text: '-' });
                delBtn.title = 'Delete column';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.options.onDeleteColumn?.(col.id);
                });
            }

            if (this.options.onShiftColumn) {
                const leftBtn = ctrlBar.createSpan({ cls: 'pakcli-ruler-btn', text: '<' });
                leftBtn.title = 'Shift left';
                if (!col.canShiftLeft) leftBtn.addClass('is-disabled');
                leftBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (col.canShiftLeft) this.options.onShiftColumn?.(col.id, 'left');
                });

                const rightBtn = ctrlBar.createSpan({ cls: 'pakcli-ruler-btn', text: '>' });
                rightBtn.title = 'Shift right';
                if (!col.canShiftRight) rightBtn.addClass('is-disabled');
                rightBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (col.canShiftRight) this.options.onShiftColumn?.(col.id, 'right');
                });
            }

            if (this.options.onAddColumn) {
                const addBtn = ctrlBar.createSpan({ cls: 'pakcli-ruler-btn pakcli-ruler-add', text: '+' });
                addBtn.title = 'Add column (Alt+click to duplicate)';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.options.onAddColumn?.(col.id, e.altKey);
                });
            }
        }
    }

    public updateColumns(cols: RulerColumn[]): void {
        this.options.columns = cols;
        this.render();
    }
}
