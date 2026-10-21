export interface InlineEditableTextOptions {
    containerEl: HTMLElement;
    value: string;
    placeholder?: string;
    tooltip?: string;
    cls?: string;
    trigger?: 'click' | 'dblclick';
    onCommit: (newValue: string) => void;
}

export class InlineEditableText {
    public element: HTMLElement;
    private currentValue: string;
    private options: InlineEditableTextOptions;
    private isEditing = false;

    constructor(options: InlineEditableTextOptions) {
        this.options = options;
        this.currentValue = options.value;

        this.element = options.containerEl.createSpan({
            cls: `pakcli-inline-editable ${options.cls || ''}`,
            text: options.value || options.placeholder || '',
            attr: {
                title: options.tooltip || 'Double-click to edit',
                tabindex: '0',
            },
        });

        const triggerEvent = options.trigger || 'dblclick';
        this.element.addEventListener(triggerEvent, (e) => {
            e.stopPropagation();
            this.startEditing();
        });

        this.element.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !this.isEditing) {
                e.preventDefault();
                e.stopPropagation();
                this.startEditing();
            }
        });
    }

    public startEditing(): void {
        if (this.isEditing) return;
        this.isEditing = true;

        const originalText = this.currentValue;
        this.element.empty();
        this.element.addClass('is-editing');

        const input = this.element.createEl('input', {
            type: 'text',
            cls: 'pakcli-inline-input',
            value: originalText,
        });

        input.focus();
        input.select();

        const commit = () => {
            if (!this.isEditing) return;
            this.isEditing = false;
            this.element.removeClass('is-editing');
            const newVal = input.value.trim();
            this.currentValue = newVal;
            this.element.textContent = newVal || this.options.placeholder || '';
            this.options.onCommit(newVal);
        };

        const cancel = () => {
            if (!this.isEditing) return;
            this.isEditing = false;
            this.element.removeClass('is-editing');
            this.element.textContent = originalText || this.options.placeholder || '';
        };

        input.addEventListener('blur', () => commit());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                commit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancel();
            }
        });
    }

    public setValue(val: string): void {
        this.currentValue = val;
        if (!this.isEditing) {
            this.element.textContent = val || this.options.placeholder || '';
        }
    }

    public getValue(): string {
        return this.currentValue;
    }
}
