export interface PillItem {
    id: string;
    label: string;
    tooltip?: string;
    disabled?: boolean;
    isHandle?: boolean;
    onClick?: (e: MouseEvent) => void;
}

export interface PillGroupOptions {
    containerEl: HTMLElement;
    items: PillItem[];
    cls?: string;
}

export class PillGroup {
    public containerEl: HTMLElement;
    private itemElements: Map<string, HTMLElement> = new Map();

    constructor(options: PillGroupOptions) {
        this.containerEl = options.containerEl.createDiv({
            cls: `pakcli-pill-group ${options.cls || ''}`,
        });

        for (const item of options.items) {
            const handleCls = item.isHandle ? ' pakcli-drag-handle' : '';
            const btn = this.containerEl.createSpan({
                cls: `pakcli-pill-btn${handleCls}`,
                text: item.label,
                attr: item.tooltip ? { title: item.tooltip, 'aria-label': item.tooltip } : undefined,
            });

            if (item.disabled) {
                btn.addClass('is-disabled');
            }

            if (item.onClick) {
                btn.addEventListener('click', (e) => {
                    if (btn.hasClass('is-disabled')) {
                        e.stopPropagation();
                        return;
                    }
                    item.onClick?.(e);
                });
            }

            this.itemElements.set(item.id, btn);
        }
    }

    public setItemDisabled(id: string, disabled: boolean): void {
        const btn = this.itemElements.get(id);
        if (btn) {
            if (disabled) btn.addClass('is-disabled');
            else btn.removeClass('is-disabled');
        }
    }

    public getItem(id: string): HTMLElement | undefined {
        return this.itemElements.get(id);
    }
}
