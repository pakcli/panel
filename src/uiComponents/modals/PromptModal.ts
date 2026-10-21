import { App } from 'obsidian';
import { BaseModal } from './BaseModal';

export interface PromptModalOptions {
    title: string;
    description?: string;
    initialValue?: string;
    placeholder?: string;
    submitText?: string;
    cancelText?: string;
    onSubmit: (value: string) => void;
    onCancel?: () => void;
}

export class PromptModal extends BaseModal {
    private promptOptions: PromptModalOptions;
    private inputEl!: HTMLInputElement;

    constructor(app: App, options: PromptModalOptions) {
        super(app, {
            title: options.title,
            cls: 'pakcli-prompt-modal',
        });
        this.promptOptions = options;
    }

    protected renderBody(bodyEl: HTMLElement): void {
        if (this.promptOptions.description) {
            bodyEl.createEl('p', {
                text: this.promptOptions.description,
                cls: 'pakcli-prompt-description',
            });
        }

        this.inputEl = bodyEl.createEl('input', {
            type: 'text',
            cls: 'pakcli-prompt-input',
            value: this.promptOptions.initialValue || '',
            attr: {
                placeholder: this.promptOptions.placeholder || '',
            },
        });

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
        });

        window.setTimeout(() => {
            this.inputEl.focus();
            this.inputEl.select();
        }, 50);
    }

    protected renderFooter(footerEl: HTMLElement): void {
        const cancelBtn = footerEl.createEl('button', {
            text: this.promptOptions.cancelText || 'Cancel',
            cls: 'pakcli-btn-secondary',
        });
        cancelBtn.addEventListener('click', () => {
            this.promptOptions.onCancel?.();
            this.close();
        });

        const submitBtn = footerEl.createEl('button', {
            text: this.promptOptions.submitText || 'Submit',
            cls: 'mod-cta pakcli-btn-accent',
        });
        submitBtn.addEventListener('click', () => this.submit());
    }

    private submit(): void {
        const val = this.inputEl.value.trim();
        this.promptOptions.onSubmit(val);
        this.close();
    }
}
