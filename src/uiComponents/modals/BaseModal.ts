import { App, Modal } from 'obsidian';

export interface BaseModalOptions {
    title: string;
    cls?: string;
}

export class BaseModal extends Modal {
    protected titleText: string;
    protected modalBodyEl!: HTMLElement;
    protected modalFooterEl!: HTMLElement;
    protected customCls?: string;

    constructor(app: App, options: BaseModalOptions) {
        super(app);
        this.titleText = options.title;
        this.customCls = options.cls;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pakcli-base-modal');
        if (this.customCls) {
            contentEl.addClass(this.customCls);
        }

        // Header
        const headerEl = contentEl.createDiv({ cls: 'pakcli-modal-header' });
        headerEl.createEl('h3', { text: this.titleText, cls: 'pakcli-modal-title' });

        // Body
        this.modalBodyEl = contentEl.createDiv({ cls: 'pakcli-modal-body' });

        // Footer
        this.modalFooterEl = contentEl.createDiv({ cls: 'pakcli-modal-footer' });

        this.renderBody(this.modalBodyEl);
        this.renderFooter(this.modalFooterEl);
    }

    protected renderBody(bodyEl: HTMLElement): void {
        // Override in subclasses
    }

    protected renderFooter(footerEl: HTMLElement): void {
        // Override in subclasses
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
