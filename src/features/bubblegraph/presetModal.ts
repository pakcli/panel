import { App, Modal, Notice, setIcon } from 'obsidian';
import type { BubbleGraphView } from './bubbleGraphView';
import type { BubbleViewScopePreset } from '../../settings';

/**
 * Format timestamp into friendly relative time: "2 days ago", "2 hours ago", "5 mins ago", etc.
 */
export function formatTimeAgo(timestamp: number): string {
    if (!timestamp || isNaN(timestamp)) return 'just now';
    const now = Date.now();
    const diff = Math.max(0, now - timestamp);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return min === 1 ? '1 min ago' : `${min} mins ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
    const days = Math.floor(hr / 24);
    if (days < 30) return days === 1 ? '1 day ago' : `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
    const years = Math.floor(days / 365);
    return years === 1 ? '1 year ago' : `${years} years ago`;
}

/**
 * Confirmation Modal with Cancel or Yes buttons.
 * Guarantees explicit user approval for Delete, Duplicate, and Overwrite actions.
 */
export class ConfirmationModal extends Modal {
    private message: string;
    private onConfirm: () => void;
    private confirmText: string;
    private isDestructive: boolean;

    constructor(
        app: App,
        title: string,
        message: string,
        onConfirm: () => void,
        confirmText: string = 'Yes',
        isDestructive: boolean = false
    ) {
        super(app);
        this.titleEl.setText(title);
        this.message = message;
        this.onConfirm = onConfirm;
        this.confirmText = confirmText;
        this.isDestructive = isDestructive;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pakcli-confirm-modal');

        const msgEl = contentEl.createEl('p', { cls: 'pakcli-confirm-message', text: this.message });
        msgEl.style.fontSize = '14px';
        msgEl.style.lineHeight = '1.5';
        msgEl.style.marginBottom = '20px';

        const btnRow = contentEl.createDiv({ cls: 'pakcli-confirm-btn-row' });
        btnRow.style.display = 'flex';
        btnRow.style.justifyContent = 'flex-end';
        btnRow.style.gap = '10px';

        const cancelBtn = btnRow.createEl('button', {
            text: 'Cancel',
            cls: 'pakcli-confirm-cancel-btn'
        });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = btnRow.createEl('button', {
            text: this.confirmText,
            cls: `pakcli-confirm-yes-btn mod-cta ${this.isDestructive ? 'mod-warning mod-destructive' : ''}`
        });
        confirmBtn.onclick = () => {
            this.close();
            this.onConfirm();
        };

        setTimeout(() => cancelBtn.focus(), 25);
    }

    onClose() {
        this.contentEl.empty();
    }
}

/**
 * Prompt modal to input a name when saving the current view & scope as a new preset.
 */
export class SavePresetPromptModal extends Modal {
    private defaultName: string;
    private onSave: (name: string) => void;

    constructor(app: App, defaultName: string, onSave: (name: string) => void) {
        super(app);
        this.defaultName = defaultName;
        this.onSave = onSave;
        this.titleEl.setText('Save View × Scope Preset');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pakcli-save-preset-modal');

        contentEl.createEl('p', {
            cls: 'pakcli-modal-desc',
            text: 'Enter a name for this preset to save current folder scope, view mode, lines, colors, text levels, and simulation state:'
        });

        const input = contentEl.createEl('input', {
            type: 'text',
            value: this.defaultName,
            cls: 'pakcli-modal-input'
        });
        input.style.width = '100%';
        input.style.marginBottom = '16px';
        input.style.boxSizing = 'border-box';

        const btnRow = contentEl.createDiv({ cls: 'pakcli-modal-buttons' });
        btnRow.style.display = 'flex';
        btnRow.style.justifyContent = 'flex-end';
        btnRow.style.gap = '10px';

        const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = btnRow.createEl('button', { text: 'Save Preset', cls: 'mod-cta' });
        const doSave = () => {
            const val = input.value.trim();
            if (!val) {
                new Notice('Preset name cannot be empty');
                return;
            }
            this.close();
            this.onSave(val);
        };

        saveBtn.onclick = doSave;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doSave();
            } else if (e.key === 'Escape') {
                this.close();
            }
        };

        setTimeout(() => {
            input.focus();
            input.select();
        }, 30);
    }

    onClose() {
        this.contentEl.empty();
    }
}

/**
 * Preset View × Scope Manager Modal.
 * Shows each preset row with:
 * scope , 2 days ago | 2 hour ago [delete btn], duplicate btn, overwrite btn
 * with confirmation popups on every action button.
 */
export class PresetViewScopeModal extends Modal {
    private view: BubbleGraphView;

    constructor(app: App, view: BubbleGraphView) {
        super(app);
        this.view = view;
        this.titleEl.setText('View × Scope Presets');
    }

    onOpen() {
        this.render();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pakcli-presets-modal');

        // Header Action Bar
        const topBar = contentEl.createDiv({ cls: 'pakcli-presets-top-bar' });
        topBar.createEl('span', {
            cls: 'pakcli-presets-tagline',
            text: 'Saved configurations of folder scope, layout mode, label layers, text levels, and camera.'
        });

        const saveCurrentBtn = topBar.createEl('button', {
            text: '+ Save Current View × Scope',
            cls: 'mod-cta pakcli-save-current-preset-btn'
        });
        saveCurrentBtn.onclick = () => {
            const currentScopeName = this.view.getCurrentScopeName();
            const defaultName = `${currentScopeName} View`;
            new SavePresetPromptModal(this.app, defaultName, (name) => {
                this.view.saveCurrentAsPreset(name);
                this.render();
            }).open();
        };

        // Presets List Container
        const listContainer = contentEl.createDiv({ cls: 'pakcli-presets-list' });
        const presets = this.view.getPresets();
        const activeId = this.view.getActivePresetId();

        // ========================================================
        // ON TOP OF THE LIST: Dedicated row to Save New Preset
        // ========================================================
        const currentScopeName = this.view.getCurrentScopeName();
        const saveNewRow = listContainer.createDiv({
            cls: 'pakcli-preset-row pakcli-preset-save-new-row'
        });
        saveNewRow.title = 'Click to save current view and scope as a new preset';

        const saveNewInfo = saveNewRow.createDiv({ cls: 'pakcli-preset-info' });
        const saveNewTitle = saveNewInfo.createDiv({ cls: 'pakcli-preset-title-line' });
        saveNewTitle.createSpan({
            cls: 'pakcli-preset-scope-badge pakcli-save-new-badge',
            text: currentScopeName ? `📁 ${currentScopeName}` : '🌐 Vault'
        });
        saveNewTitle.createSpan({
            cls: 'pakcli-preset-name pakcli-save-new-name',
            text: '➕ Save New Preset'
        });
        saveNewTitle.createSpan({
            cls: 'pakcli-preset-chip pakcli-save-new-chip',
            text: 'Current View × Scope'
        });

        const saveNewSub = saveNewInfo.createDiv({ cls: 'pakcli-preset-subtitle' });
        saveNewSub.setText(`Click here to save active folder scope (${currentScopeName}) & view layers as a new preset`);

        const saveNewActions = saveNewRow.createDiv({ cls: 'pakcli-preset-actions' });
        const saveNewBtn = saveNewActions.createEl('button', {
            text: 'Save New',
            cls: 'pakcli-preset-btn mod-cta pakcli-preset-save-new-btn',
            title: 'Save current View × Scope as preset'
        });

        const triggerSaveNew = (e: MouseEvent) => {
            e.stopPropagation();
            const defaultName = `${currentScopeName} View`;
            new SavePresetPromptModal(this.app, defaultName, (name) => {
                this.view.saveCurrentAsPreset(name);
                this.render();
            }).open();
        };

        saveNewRow.onclick = triggerSaveNew;
        saveNewBtn.onclick = triggerSaveNew;

        if (presets.length === 0) {
            const emptyEl = listContainer.createDiv({ cls: 'pakcli-presets-empty' });
            emptyEl.createEl('p', {
                text: 'No saved presets yet. Click the "+ Save New Preset" row above to save your first preset!'
            });
            return;
        }

        presets.forEach((preset) => {
            const isActive = preset.id === activeId;
            const row = listContainer.createDiv({
                cls: `pakcli-preset-row ${isActive ? 'is-active' : ''}`
            });

            // 1. Info Area (Clickable to Apply)
            const infoArea = row.createDiv({ cls: 'pakcli-preset-info' });
            infoArea.title = `Click to apply preset "${preset.name}"`;

            const titleLine = infoArea.createDiv({ cls: 'pakcli-preset-title-line' });
            const scopeBadge = titleLine.createSpan({
                cls: 'pakcli-preset-scope-badge',
                text: preset.scopedFolder ? `📁 ${preset.scopedFolder}` : '🌐 Vault (All)'
            });
            const nameEl = titleLine.createSpan({ cls: 'pakcli-preset-name', text: preset.name });
            if (isActive) {
                titleLine.createSpan({ cls: 'pakcli-preset-active-pill', text: 'Active' });
            }

            // Subtitle exactly formatted:
            // "scope , 2 days ago | 2 hour ago"
            const scopeLabel = preset.scopedFolder || 'Vault (All)';
            const createdAgo = formatTimeAgo(preset.createdAt);
            const updatedAgo = formatTimeAgo(preset.updatedAt);
            const timeAgoText = createdAgo === updatedAgo ? updatedAgo : `${createdAgo} | ${updatedAgo}`;

            const subtitle = infoArea.createDiv({ cls: 'pakcli-preset-subtitle' });
            subtitle.setText(`${scopeLabel} , ${timeAgoText}`);

            // Details tag chips
            const tagsLine = infoArea.createDiv({ cls: 'pakcli-preset-tags-line' });
            tagsLine.createSpan({ cls: 'pakcli-preset-chip', text: `Layout: ${preset.layoutMode}` });
            const gText = `G${preset.labelGlobalMinLevel ?? preset.labelMinLevel}-${preset.labelGlobalMaxLevel ?? preset.labelMaxLevel}`;
            const sText = `S${preset.labelScopeMinLevel ?? 1}-${preset.labelScopeMaxLevel ?? 2}`;
            tagsLine.createSpan({ cls: 'pakcli-preset-chip', text: `Text: ${gText} · ${sText}` });
            tagsLine.createSpan({ cls: 'pakcli-preset-chip', text: `Lines: ${preset.showLines ? 'on' : 'off'}` });
            tagsLine.createSpan({ cls: 'pakcli-preset-chip', text: `Colors: ${preset.useCaptainColors ? 'captain' : 'theme'}` });

            infoArea.onclick = () => {
                this.view.applyPreset(preset);
                this.render();
            };

            // 2. Actions Button Group: [Apply] [Overwrite] [Duplicate] [Delete]
            const actions = row.createDiv({ cls: 'pakcli-preset-actions' });

            // Apply Button
            const applyBtn = actions.createEl('button', {
                text: 'Apply',
                cls: `pakcli-preset-btn pakcli-preset-apply-btn ${isActive ? 'is-active mod-cta' : ''}`,
                title: `Apply preset "${preset.name}"`
            });
            applyBtn.onclick = (e) => {
                e.stopPropagation();
                this.view.applyPreset(preset);
                this.render();
            };

            // Overwrite Button (with confirmation popup Cancel or Yes)
            const overwriteBtn = actions.createEl('button', {
                text: 'Overwrite',
                cls: 'pakcli-preset-btn pakcli-preset-overwrite-btn',
                title: `Overwrite preset "${preset.name}" with current view & scope settings`
            });
            overwriteBtn.onclick = (e) => {
                e.stopPropagation();
                new ConfirmationModal(
                    this.app,
                    'Overwrite Preset',
                    `Are you sure you want to overwrite preset "${preset.name}" with the currently active view and scope settings?`,
                    () => {
                        this.view.overwritePreset(preset.id);
                        new Notice(`Preset "${preset.name}" updated with current view & scope`);
                        this.render();
                    },
                    'Yes, Overwrite',
                    false
                ).open();
            };

            // Duplicate Button (with confirmation popup Cancel or Yes)
            const duplicateBtn = actions.createEl('button', {
                text: 'Duplicate',
                cls: 'pakcli-preset-btn pakcli-preset-duplicate-btn',
                title: `Duplicate preset "${preset.name}"`
            });
            duplicateBtn.onclick = (e) => {
                e.stopPropagation();
                new ConfirmationModal(
                    this.app,
                    'Duplicate Preset',
                    `Are you sure you want to duplicate preset "${preset.name}"?`,
                    () => {
                        this.view.duplicatePreset(preset.id);
                        new Notice(`Preset duplicated: "${preset.name} (Copy)"`);
                        this.render();
                    },
                    'Yes, Duplicate',
                    false
                ).open();
            };

            // Delete Button (with confirmation popup Cancel or Yes)
            const deleteBtn = actions.createEl('button', {
                text: 'Delete',
                cls: 'pakcli-preset-btn pakcli-preset-delete-btn mod-warning',
                title: `Delete preset "${preset.name}"`
            });
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                new ConfirmationModal(
                    this.app,
                    'Delete Preset',
                    `Are you sure you want to delete preset "${preset.name}"? This action cannot be undone.`,
                    () => {
                        this.view.deletePreset(preset.id);
                        new Notice(`Preset "${preset.name}" deleted`);
                        this.render();
                    },
                    'Yes, Delete',
                    true
                ).open();
            };
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
