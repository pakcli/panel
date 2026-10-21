import { setIcon } from 'obsidian';

export interface ActionBtnOptions {
    containerEl: HTMLElement;
    text?: string;
    icon?: string;
    tooltip?: string;
    cls?: string;
    disabled?: boolean;
    variant?: 'default' | 'accent' | 'destructive' | 'pill';
    onClick: (e: MouseEvent) => void;
}

export class ActionBtn {
    public buttonEl: HTMLElement;
    private options: ActionBtnOptions;

    constructor(options: ActionBtnOptions) {
        this.options = options;
        const variantCls = options.variant ? `pakcli-btn-${options.variant}` : 'pakcli-btn-default';
        const extraCls = options.cls ? ` ${options.cls}` : '';

        this.buttonEl = options.containerEl.createEl('button', {
            cls: `pakcli-action-btn ${variantCls}${extraCls}`,
            text: options.text,
            attr: options.tooltip ? { 'aria-label': options.tooltip, title: options.tooltip } : undefined,
        });

        if (options.icon) {
            const iconWrap = this.buttonEl.createSpan({ cls: 'pakcli-btn-icon' });
            setIcon(iconWrap, options.icon);
        }

        if (options.disabled) {
            this.setDisabled(true);
        }

        this.buttonEl.addEventListener('click', (e) => {
            if (this.buttonEl.hasClass('is-disabled') || (this.buttonEl as HTMLButtonElement).disabled) {
                e.stopPropagation();
                return;
            }
            options.onClick(e);
        });
    }

    public setDisabled(disabled: boolean): void {
        if (disabled) {
            this.buttonEl.addClass('is-disabled');
            (this.buttonEl as HTMLButtonElement).disabled = true;
        } else {
            this.buttonEl.removeClass('is-disabled');
            (this.buttonEl as HTMLButtonElement).disabled = false;
        }
    }

    public setText(text: string): void {
        this.buttonEl.textContent = text;
    }

    public setTooltip(tooltip: string): void {
        this.buttonEl.setAttribute('aria-label', tooltip);
        this.buttonEl.setAttribute('title', tooltip);
    }
}
