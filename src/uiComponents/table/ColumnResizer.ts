export interface ColumnResizerOptions {
    containerEl: HTMLElement;
    colIndex: number;
    initialWidth: number;
    minWidth?: number;
    leftPx: number;
    topPx?: number;
    heightPx?: number;
    tooltip?: string;
    onResize: (newWidth: number) => void;
    onResizeEnd?: (finalWidth: number) => void;
    onAutoFit?: (colIndex: number) => void;
}

export class ColumnResizer {
    public element: HTMLElement;
    private options: ColumnResizerOptions;
    private currentWidth: number;

    constructor(options: ColumnResizerOptions) {
        this.options = options;
        this.currentWidth = options.initialWidth;

        this.element = options.containerEl.createDiv({
            cls: 'pakcli-col-resizer-wire',
            attr: {
                title: options.tooltip || 'Drag to resize column • Double-click to auto-fit',
            },
        });

        this.updatePosition(options.leftPx, options.topPx, options.heightPx);

        this.element.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startWidth = this.currentWidth;
            const minWidth = this.options.minWidth || 40;

            document.body.addClass('pakcli-is-col-resizing');

            const onMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = moveEvent.clientX - startX;
                const newWidth = Math.max(minWidth, startWidth + deltaX);
                this.currentWidth = newWidth;
                this.options.onResize(newWidth);
            };

            const onMouseUp = () => {
                document.body.removeClass('pakcli-is-col-resizing');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                this.options.onResizeEnd?.(this.currentWidth);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        if (options.onAutoFit) {
            this.element.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                options.onAutoFit?.(this.options.colIndex);
            });
        }
    }

    public updatePosition(leftPx: number, topPx = 0, heightPx?: number): void {
        this.element.style.left = `${leftPx - 6}px`;
        this.element.style.top = `${topPx}px`;
        if (heightPx !== undefined) {
            this.element.style.height = `${heightPx}px`;
        }
    }
}
