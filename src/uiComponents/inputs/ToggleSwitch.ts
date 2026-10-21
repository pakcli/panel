export interface ToggleSwitchOptions {
    containerEl: HTMLElement;
    label?: string;
    value: boolean;
    tooltip?: string;
    cls?: string;
    onChange: (checked: boolean) => void;
}

export class ToggleSwitch {
    public containerEl: HTMLElement;
    public switchEl: HTMLElement;
    private isChecked: boolean;
    private options: ToggleSwitchOptions;

    constructor(options: ToggleSwitchOptions) {
        this.options = options;
        this.isChecked = options.value;

        this.containerEl = options.containerEl.createDiv({
            cls: `pakcli-toggle-wrap ${options.cls || ''}`,
            attr: options.tooltip ? { title: options.tooltip, 'aria-label': options.tooltip } : undefined,
        });

        if (options.label) {
            this.containerEl.createSpan({
                cls: 'pakcli-toggle-label',
                text: options.label,
            });
        }

        this.switchEl = this.containerEl.createDiv({
            cls: `checkbox-container pakcli-toggle-switch ${this.isChecked ? 'is-enabled' : ''}`,
            attr: {
                role: 'switch',
                'aria-checked': this.isChecked ? 'true' : 'false',
                tabindex: '0',
            },
        });

        this.switchEl.createDiv({ cls: 'checkbox-thumb' });

        this.containerEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        this.switchEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                this.toggle();
            }
        });
    }

    public toggle(): void {
        this.setValue(!this.isChecked);
        this.options.onChange(this.isChecked);
    }

    public setValue(val: boolean): void {
        this.isChecked = val;
        if (this.isChecked) {
            this.switchEl.addClass('is-enabled');
            this.switchEl.setAttribute('aria-checked', 'true');
        } else {
            this.switchEl.removeClass('is-enabled');
            this.switchEl.setAttribute('aria-checked', 'false');
        }
    }

    public getValue(): boolean {
        return this.isChecked;
    }
}
