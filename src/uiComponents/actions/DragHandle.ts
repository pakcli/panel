export interface DragHandleOptions {
    containerEl: HTMLElement;
    tooltip?: string;
    label?: string;
    cls?: string;
    onDragStart?: (e: MouseEvent) => void;
}

export class DragHandle {
    public element: HTMLElement;

    constructor(options: DragHandleOptions) {
        this.element = options.containerEl.createSpan({
            cls: `pakcli-drag-handle ${options.cls || ''}`,
            text: options.label || '::',
            attr: {
                title: options.tooltip || 'Drag to reorder',
                'aria-label': options.tooltip || 'Drag to reorder',
            },
        });

        if (options.onDragStart) {
            this.element.addEventListener('mousedown', options.onDragStart);
        }
    }
}
