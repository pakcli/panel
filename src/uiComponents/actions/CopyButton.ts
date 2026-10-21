import { Notice } from 'obsidian';

export interface CopyButtonOptions {
    containerEl: HTMLElement;
    textGetter: () => string;
    label?: string;
    tooltip?: string;
    successMessage?: string;
    cls?: string;
    onCopySuccess?: (copiedText: string) => void;
}

export class CopyButton {
    public buttonEl: HTMLElement;

    constructor(options: CopyButtonOptions) {
        this.buttonEl = options.containerEl.createEl('button', {
            cls: `pakcli-copy-btn ${options.cls || ''}`,
            text: options.label || '📋',
            attr: {
                title: options.tooltip || 'Copy to clipboard',
                'aria-label': options.tooltip || 'Copy to clipboard',
            },
        });

        this.buttonEl.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const text = options.textGetter();
                await navigator.clipboard.writeText(text);
                new Notice(options.successMessage || '✓ Copied to clipboard');
                this.flashSuccess();
                options.onCopySuccess?.(text);
            } catch (err) {
                console.warn('[CopyButton] Clipboard copy failed:', err);
                new Notice('❌ Failed to copy to clipboard');
            }
        });
    }

    private flashSuccess(): void {
        this.buttonEl.addClass('is-copied');
        window.setTimeout(() => {
            this.buttonEl.removeClass('is-copied');
        }, 1200);
    }
}
