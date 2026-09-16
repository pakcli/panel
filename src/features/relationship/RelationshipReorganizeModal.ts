import { App, Modal, Notice, Setting, TFile, TFolder, normalizePath } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DEFAULT_RELATIONSHIP_TIERS, RelationshipTierConfig } from '../../settings';

export interface FileMovePlan {
    file: TFile;
    currentPath: string;
    targetPath: string;
    targetFolder: string;
    score: number;
    tierName: string;
    tierColor: string;
}

export class RelationshipReorganizeModal extends Modal {
    private plugin: PakCLITablePlugin;
    private targetMode: '1dir' | 'subfolders';
    private onConfirm?: () => Promise<void> | void;
    private onCancel?: () => void;
    private isProcessing = false;

    constructor(
        app: App,
        plugin: PakCLITablePlugin,
        targetMode: '1dir' | 'subfolders',
        onConfirm?: () => Promise<void> | void,
        onCancel?: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.targetMode = targetMode;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    public onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
        if (!this.isProcessing && this.onCancel) {
            this.onCancel();
        }
    }

    public onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pakcli-reorganize-modal');

        const rootFolder = normalizePath(this.plugin.settings.familyCirclesRootFolder || 'Relationships');
        const tiers: RelationshipTierConfig[] = this.plugin.settings.relationshipTiers || DEFAULT_RELATIONSHIP_TIERS;
        const propKey = this.plugin.settings.relationshipPropertyKey || 'closeness';

        const plan = this.buildMovePlan(rootFolder, tiers, propKey);

        // Header
        const header = contentEl.createEl('h2', { text: '📁 Reorganize Relationship Files on Disk' });
        header.style.cssText = 'margin-top: 0; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;';

        // Mode Switch Banner
        const banner = contentEl.createDiv();
        banner.style.cssText = 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px 16px; margin-bottom: 14px;';

        const currentModeName = this.targetMode === 'subfolders' ? '1 Directory Mode (Flat Notes)' : 'Physical Subfolders Mode';
        const targetModeName = this.targetMode === 'subfolders' ? 'Physical Subfolders Mode (Categorized Folders)' : '1 Directory Mode (Flat Notes)';

        banner.innerHTML = `
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px;">Storage Structure Switcher</div>
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px;">
                <span>${currentModeName}</span>
                <span style="color: var(--text-accent); font-size: 16px;">➔</span>
                <span style="color: var(--text-accent);">${targetModeName}</span>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">Root folder: <code>${rootFolder}/</code></div>
        `;

        // Safety brief alert
        const safetyAlert = contentEl.createDiv();
        safetyAlert.style.cssText = 'background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 12px; color: var(--text-normal);';
        safetyAlert.innerHTML = `
            <strong>ℹ️ Brief & Safety Guarantee:</strong>
            <ul style="margin: 6px 0 0 16px; padding: 0;">
                <li>Obsidian will automatically update all internal wikilinks across your vault so <strong>no links will break</strong>.</li>
                <li>${this.targetMode === 'subfolders' ? 'Notes will be placed into physical subdirectories matching their closeness score (e.g. <code>1 - Household/</code>, <code>2 - Family/</code>).' : 'All relationship notes will be consolidated safely into the root folder.'}</li>
                <li>You can switch back at any time.</li>
            </ul>
        `;

        // Movement Plan Summary
        const summaryTitle = contentEl.createEl('h4', { text: `Files to Reorganize (${plan.length}):` });
        summaryTitle.style.cssText = 'margin: 0 0 8px 0; font-size: 13px;';

        const listContainer = contentEl.createDiv();
        listContainer.style.cssText = 'max-height: 220px; overflow-y: auto; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 8px 12px; margin-bottom: 18px; font-size: 12px;';

        if (plan.length === 0) {
            const emptyNotice = listContainer.createDiv();
            emptyNotice.style.cssText = 'color: var(--text-muted); padding: 10px 0; text-align: center; font-style: italic;';
            emptyNotice.setText('✨ All notes are already in their correct locations. No files need to be moved.');
        } else {
            plan.forEach((item) => {
                const row = listContainer.createDiv();
                row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--background-modifier-border); gap: 10px;';

                const left = row.createDiv();
                left.style.cssText = 'display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
                
                const dot = left.createSpan();
                dot.style.cssText = `width: 8px; height: 8px; border-radius: 50%; background-color: ${item.tierColor}; flex-shrink: 0;`;

                const name = left.createSpan({ text: item.file.name });
                name.style.cssText = 'font-weight: 500;';

                const badge = left.createSpan({ text: `${item.tierName} (${item.score.toFixed(2)})` });
                badge.style.cssText = 'font-size: 10px; color: var(--text-muted); background: var(--background-secondary); padding: 1px 6px; border-radius: 4px;';

                const right = row.createDiv();
                right.style.cssText = 'font-size: 11px; font-family: var(--font-monospace); color: var(--text-muted); flex-shrink: 0;';
                right.setText(`➔ ${item.targetFolder.split('/').pop() || rootFolder}/`);
            });
        }

        // Action Buttons Row
        const buttonsRow = contentEl.createDiv();
        buttonsRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';

        const cancelBtn = buttonsRow.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => {
            this.close();
        };

        const confirmBtn = buttonsRow.createEl('button', { 
            text: plan.length === 0 ? 'Close' : `Proceed & Move ${plan.length} File${plan.length === 1 ? '' : 's'}`, 
            cls: 'mod-cta' 
        });
        confirmBtn.style.cssText = 'font-weight: 600; padding: 6px 16px;';

        confirmBtn.onclick = async () => {
            if (plan.length === 0) {
                this.isProcessing = true;
                this.plugin.settings.relationshipMode = this.targetMode;
                await this.plugin.saveSettings();
                if (this.onConfirm) await this.onConfirm();
                this.close();
                return;
            }

            this.isProcessing = true;
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            confirmBtn.setText('Moving files...');

            try {
                let movedCount = 0;
                for (const item of plan) {
                    // 1. Ensure target folder exists
                    const existingTargetFolder = this.app.vault.getAbstractFileByPath(item.targetFolder);
                    if (!existingTargetFolder) {
                        try {
                            await this.app.vault.createFolder(item.targetFolder);
                        } catch {
                            // Folder might already exist
                        }
                    }

                    // 2. Safely rename/move file with automatic wikilink updating
                    const destinationFile = this.app.vault.getAbstractFileByPath(item.targetPath);
                    if (!destinationFile || destinationFile.path === item.file.path) {
                        await this.app.fileManager.renameFile(item.file, item.targetPath);
                        movedCount++;
                    }
                }

                // 3. If moving to 1dir, clean up empty subfolders
                if (this.targetMode === '1dir') {
                    const rootAbstract = this.app.vault.getAbstractFileByPath(rootFolder);
                    if (rootAbstract instanceof TFolder) {
                        for (const child of [...rootAbstract.children]) {
                            if (child instanceof TFolder && child.children.length === 0) {
                                try {
                                    await this.app.vault.delete(child, true);
                                } catch {
                                    // Ignore cleanup error
                                }
                            }
                        }
                    }
                }

                this.plugin.settings.relationshipMode = this.targetMode;
                await this.plugin.saveSettings();

                if (this.onConfirm) {
                    await this.onConfirm();
                }

                new Notice(`🎉 Successfully reorganized ${movedCount} relationship note${movedCount === 1 ? '' : 's'} on disk!`);
                this.close();
            } catch (err) {
                console.error('[PakCLI] Error reorganizing relationship files:', err);
                new Notice(`Error reorganizing files: ${String(err)}`);
                confirmBtn.disabled = false;
                cancelBtn.disabled = false;
                confirmBtn.setText('Retry');
            }
        };
    }

    private buildMovePlan(rootFolder: string, tiers: RelationshipTierConfig[], propKey: string): FileMovePlan[] {
        const plan: FileMovePlan[] = [];
        const rootAbstract = this.app.vault.getAbstractFileByPath(rootFolder);
        if (!rootAbstract || !(rootAbstract instanceof TFolder)) return plan;

        const allFiles: TFile[] = [];
        const collectFiles = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === 'md') {
                    allFiles.push(child);
                } else if (child instanceof TFolder) {
                    collectFiles(child);
                }
            }
        };
        collectFiles(rootAbstract);

        for (const file of allFiles) {
            const cache = this.app.metadataCache.getFileCache(file);
            let score = 0.25;

            const rawCloseness = cache?.frontmatter?.[propKey] ?? 
                                 cache?.frontmatter?.closeness ?? 
                                 cache?.frontmatter?.score ??
                                 cache?.frontmatter?.affinity;

            const lowerName = file.basename.toLowerCase();
            const lowerRole = String(cache?.frontmatter?.role || '').toLowerCase();
            const isMeNote = lowerName === 'me' || lowerRole.includes('self') || lowerRole.includes('me') || lowerName.includes('myself');

            if (rawCloseness !== undefined && rawCloseness !== null && !isNaN(Number(rawCloseness))) {
                score = Math.max(-1, Math.min(1, Number(rawCloseness)));
            } else if (isMeNote) {
                score = 1.0;
            }

            // Find matching tier
            let matchedTier = tiers.find(t => score >= Math.min(t.min, t.max) && score <= Math.max(t.min, t.max));
            if (!matchedTier && tiers.length > 0) {
                let minDiff = Infinity;
                for (const t of tiers) {
                    const mid = (t.min + t.max) / 2;
                    const diff = Math.abs(score - mid);
                    if (diff < minDiff) {
                        minDiff = diff;
                        matchedTier = t;
                    }
                }
            }
            if (!matchedTier && tiers.length > 0) matchedTier = tiers[0];

            let targetFolder: string;
            let targetPath: string;

            if (this.targetMode === 'subfolders') {
                const subfolderName = matchedTier ? matchedTier.folderName : 'Custom';
                targetFolder = `${rootFolder}/${subfolderName}`;
                targetPath = `${targetFolder}/${file.name}`;
            } else {
                targetFolder = rootFolder;
                targetPath = `${rootFolder}/${file.name}`;
            }

            if (file.path !== targetPath) {
                plan.push({
                    file,
                    currentPath: file.path,
                    targetPath,
                    targetFolder,
                    score,
                    tierName: matchedTier ? matchedTier.name : 'Unknown',
                    tierColor: matchedTier ? matchedTier.color : '#64748b'
                });
            }
        }

        return plan;
    }
}
