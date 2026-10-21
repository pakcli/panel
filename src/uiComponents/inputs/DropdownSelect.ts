export interface DropdownOption {
    value: string;
    label: string;
}

export interface DropdownSelectOptions {
    containerEl: HTMLElement;
    options: DropdownOption[];
    value: string;
    label?: string;
    tooltip?: string;
    cls?: string;
    onChange: (selectedValue: string) => void;
}

export class DropdownSelect {
    public containerEl: HTMLElement;
    public selectEl: HTMLSelectElement;
    private options: DropdownSelectOptions;

    constructor(options: DropdownSelectOptions) {
        this.options = options;

        this.containerEl = options.containerEl.createDiv({
            cls: `pakcli-dropdown-wrap ${options.cls || ''}`,
            attr: options.tooltip ? { title: options.tooltip, 'aria-label': options.tooltip } : undefined,
        });

        if (options.label) {
            this.containerEl.createSpan({
                cls: 'pakcli-dropdown-label',
                text: options.label,
            });
        }

        this.selectEl = this.containerEl.createEl('select', {
            cls: 'dropdown pakcli-select',
        });

        for (const opt of options.options) {
            const optEl = this.selectEl.createEl('option', {
                value: opt.value,
                text: opt.label,
            });
            if (opt.value === options.value) {
                optEl.selected = true;
            }
        }

        this.selectEl.addEventListener('change', () => {
            this.options.onChange(this.selectEl.value);
        });
    }

    public setValue(val: string): void {
        this.selectEl.value = val;
    }

    public getValue(): string {
        return this.selectEl.value;
    }
}
