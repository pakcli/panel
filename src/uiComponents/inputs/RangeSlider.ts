export interface RangeSliderOptions {
    containerEl: HTMLElement;
    min: number;
    max: number;
    step?: number;
    value: number;
    label?: string;
    unit?: string;
    tooltip?: string;
    cls?: string;
    onChange: (val: number) => void;
}

export class RangeSlider {
    public containerEl: HTMLElement;
    public sliderEl: HTMLInputElement;
    public badgeEl: HTMLElement;
    private options: RangeSliderOptions;

    constructor(options: RangeSliderOptions) {
        this.options = options;

        this.containerEl = options.containerEl.createDiv({
            cls: `pakcli-range-slider-wrap ${options.cls || ''}`,
            attr: options.tooltip ? { title: options.tooltip, 'aria-label': options.tooltip } : undefined,
        });

        if (options.label) {
            this.containerEl.createSpan({
                cls: 'pakcli-slider-label',
                text: options.label,
            });
        }

        this.sliderEl = this.containerEl.createEl('input', {
            type: 'range',
            cls: 'pakcli-range-slider',
            attr: {
                min: options.min.toString(),
                max: options.max.toString(),
                step: (options.step || 1).toString(),
                value: options.value.toString(),
            },
        });

        this.badgeEl = this.containerEl.createSpan({
            cls: 'pakcli-slider-badge',
            text: `${options.value}${options.unit || ''}`,
        });

        this.sliderEl.addEventListener('input', () => {
            const num = parseFloat(this.sliderEl.value);
            this.badgeEl.textContent = `${num}${this.options.unit || ''}`;
            this.options.onChange(num);
        });
    }

    public setValue(val: number): void {
        this.sliderEl.value = val.toString();
        this.badgeEl.textContent = `${val}${this.options.unit || ''}`;
    }

    public getValue(): number {
        return parseFloat(this.sliderEl.value);
    }
}
