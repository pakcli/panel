import { App } from 'obsidian';
import { BaseModal } from './BaseModal';

export interface ConfirmModalOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
}

export class ConfirmModal extends BaseModal {
    private confirmOptions: ConfirmModalOptions;

    constructor(app: App, options: ConfirmModalOptions) {
        super(app, {
            title: options.title || 'Confirm Action',
            cls: 'pakcli-confirm-modal',
        });
        this.confirmOptions = options;
    }

    protected renderBody(bodyEl: HTMLElement): void {
        bodyEl.createEl('p', {
            text: this.confirmOptions.message,
            cls: 'pakcli-confirm-message',
        });
    }

    protected renderFooter(footerEl: HTMLElement): void {
        const cancelBtn = footerEl.createEl('button', {
            text: this.confirmOptions.cancelText || 'Cancel',
            cls: 'pakcli-btn-secondary',
        });
        cancelBtn.addEventListener('click', () => {
            this.confirmOptions.onCancel?.();
            this.close();
        });

        const confirmBtnCls = this.confirmOptions.isDestructive
            ? 'mod-warning pakcli-btn-destructive'
            : 'mod-cta pakcli-btn-accent';

        const confirmBtn = footerEl.createEl('button', {
            text: this.confirmOptions.confirmText || 'Confirm',
            cls: confirmBtnCls,
        });
        confirmBtn.addEventListener('click', () => {
            this.confirmOptions.onConfirm();
            this.close();
        });

        confirmBtn.focus();
    }
}
