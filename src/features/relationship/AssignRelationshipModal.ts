import { App, Modal, Notice, Setting, TFile, TFolder, normalizePath } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DEFAULT_RELATIONSHIP_TIERS, RelationshipTierConfig } from '../../settings';

interface DetectedNote {
    file: TFile;
    score: number;
    rawScoreStr: string;
    tier: RelationshipTierConfig | null;
    isInsideRelFolder: boolean;
    role?: string;
}

export class AssignRelationshipModal extends Modal {
    private plugin: PakCLITablePlugin;
    private targetFolder: string;
    private detectedNotes: DetectedNote[] = [];
    private selectedPaths: Set<string> = new Set();
    private onSuccess?: () => void;

    // Single note assigner fields
    private manualFile: TFile | null = null;
    private manualScore: number = 0.50;
    private manualRole: string = '';

    constructor(app: App, plugin: PakCLITablePlugin, targetFolder?: string, onSuccess?: () => void) {
        super(app);
        this.plugin = plugin;
        this.targetFolder = targetFolder || this.plugin.settings.familyCirclesRootFolder || 'Relationships';
        this.onSuccess = onSuccess;
    }

    public onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pakcli-assign-relationship-modal');

        const rootNorm = normalizePath(this.targetFolder || 'Relationships');
        const propKey = this.plugin.settings.relationshipPropertyKey || 'closeness';
        const tiers: RelationshipTierConfig[] = this.plugin.settings.relationshipTiers || DEFAULT_RELATIONSHIP_TIERS;

        this.scanDetectedNotes(rootNorm, propKey, tiers);

        // Header
        const header = contentEl.createEl('h2', { text: '👤 Assign Relationship' });
        header.style.cssText = 'margin-top: 0; margin-bottom: 6px;';

        const desc = contentEl.createEl('p', {
            text: `Automatically detects notes in your vault with frontmatter "${propKey}" and assigns them to your flat relationship folder (${rootNorm}/).`
        });
        desc.style.cssText = 'color: var(--text-muted); font-size: 13px; margin-bottom: 12px;';

        // Flat Folder Mode Banner
        const banner = contentEl.createDiv();
        banner.style.cssText = 'background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; font-size: 12px; display: flex; align-items: center; justify-content: space-between;';
        banner.innerHTML = `
            <div>
                <strong>Target Directory:</strong> <code>${rootNorm}/</code> 
                <span style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 1px 6px; border-radius: 4px; font-size: 11px; margin-left: 6px;">1 Directory (Flat Folder Mode)</span>
            </div>
        `;

        // ── SECTION 1: AUTO-DETECTED NOTES ACROSS VAULT ──
        const unassigned = this.detectedNotes.filter(n => !n.isInsideRelFolder);
        const alreadyIn = this.detectedNotes.filter(n => n.isInsideRelFolder);

        const autoSectionTitle = contentEl.createEl('h4', { 
            text: `🔍 Auto-Detected Notes (${unassigned.length} unassigned, ${alreadyIn.length} already in folder):` 
        });
        autoSectionTitle.style.cssText = 'margin: 0 0 8px 0; font-size: 13px;';

        if (unassigned.length === 0) {
            const noUnassigned = contentEl.createDiv();
            noUnassigned.style.cssText = 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 12px; margin-bottom: 18px; font-size: 12px; color: var(--text-muted); font-style: italic;';
            noUnassigned.setText(
                alreadyIn.length > 0 
                    ? `✨ All ${alreadyIn.length} notes with "${propKey}" are already located inside "${rootNorm}/".` 
                    : `No notes outside "${rootNorm}/" currently have frontmatter "${propKey}". You can assign a specific note below.`
            );
        } else {
            // Select all controls
            const controlsRow = contentEl.createDiv();
            controlsRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px;';
            
            const selectAllLabel = controlsRow.createEl('label');
            selectAllLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;';
            const selectAllCheckbox = selectAllLabel.createEl('input', { type: 'checkbox' });
            selectAllCheckbox.checked = this.selectedPaths.size === unassigned.length && unassigned.length > 0;
            selectAllLabel.createSpan({ text: 'Select All Unassigned Notes' });

            const countSpan = controlsRow.createSpan({ text: `${this.selectedPaths.size} of ${unassigned.length} selected` });
            countSpan.style.cssText = 'color: var(--text-muted); font-size: 11px;';

            // Scrollable list
            const listEl = contentEl.createDiv();
            listEl.style.cssText = 'max-height: 180px; overflow-y: auto; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 10px; margin-bottom: 12px; font-size: 12px;';

            const checkboxes: HTMLInputElement[] = [];

            unassigned.forEach((item) => {
                const row = listEl.createDiv();
                row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid var(--background-modifier-border); gap: 8px;';

                const left = row.createDiv();
                left.style.cssText = 'display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

                const cb = left.createEl('input', { type: 'checkbox' });
                cb.checked = this.selectedPaths.has(item.file.path);
                checkboxes.push(cb);
                cb.onchange = () => {
                    if (cb.checked) {
                        this.selectedPaths.add(item.file.path);
                    } else {
                        this.selectedPaths.delete(item.file.path);
                    }
                    selectAllCheckbox.checked = this.selectedPaths.size === unassigned.length;
                    countSpan.setText(`${this.selectedPaths.size} of ${unassigned.length} selected`);
                    bulkAssignBtn.setText(`Assign & Move ${this.selectedPaths.size} Note${this.selectedPaths.size === 1 ? '' : 's'} to ${rootNorm}/`);
                    bulkAssignBtn.disabled = this.selectedPaths.size === 0;
                };

                const dot = left.createSpan();
                dot.style.cssText = `width: 7px; height: 7px; border-radius: 50%; background-color: ${item.tier?.color || '#64748b'}; flex-shrink: 0;`;

                const name = left.createSpan({ text: item.file.name });
                name.style.cssText = 'font-weight: 500;';

                const badge = left.createSpan({ 
                    text: `${item.tier ? item.tier.name : 'Score'}: ${item.score.toFixed(2)}` 
                });
                badge.style.cssText = 'font-size: 10px; color: var(--text-muted); background: var(--background-secondary); padding: 1px 6px; border-radius: 4px;';

                const right = row.createDiv();
                right.style.cssText = 'font-size: 11px; font-family: var(--font-monospace); color: var(--text-muted); flex-shrink: 0;';
                right.setText(`from ${item.file.parent?.path || '/'}`);
            });

            selectAllCheckbox.onchange = () => {
                if (selectAllCheckbox.checked) {
                    unassigned.forEach(i => this.selectedPaths.add(i.file.path));
                    checkboxes.forEach(c => c.checked = true);
                } else {
                    this.selectedPaths.clear();
                    checkboxes.forEach(c => c.checked = false);
                }
                countSpan.setText(`${this.selectedPaths.size} of ${unassigned.length} selected`);
                bulkAssignBtn.setText(`Assign & Move ${this.selectedPaths.size} Note${this.selectedPaths.size === 1 ? '' : 's'} to ${rootNorm}/`);
                bulkAssignBtn.disabled = this.selectedPaths.size === 0;
            };

            // Bulk Move Button
            const bulkAssignBtn = contentEl.createEl('button', { 
                text: `Assign & Move ${this.selectedPaths.size} Note${this.selectedPaths.size === 1 ? '' : 's'} to ${rootNorm}/`,
                cls: 'mod-cta'
            });
            bulkAssignBtn.style.cssText = 'font-size: 12px; font-weight: 600; padding: 5px 14px; margin-bottom: 20px;';
            bulkAssignBtn.disabled = this.selectedPaths.size === 0;

            bulkAssignBtn.onclick = async () => {
                bulkAssignBtn.disabled = true;
                bulkAssignBtn.setText('Moving notes...');
                try {
                    // Ensure root exists
                    if (!this.app.vault.getAbstractFileByPath(rootNorm)) {
                        await this.app.vault.createFolder(rootNorm);
                    }

                    let movedCount = 0;
                    for (const path of this.selectedPaths) {
                        const file = this.app.vault.getAbstractFileByPath(path);
                        if (file instanceof TFile) {
                            const targetPath = normalizePath(`${rootNorm}/${file.name}`);
                            if (!this.app.vault.getAbstractFileByPath(targetPath)) {
                                await this.app.fileManager.renameFile(file, targetPath);
                                movedCount++;
                            }
                        }
                    }

                    new Notice(`🎉 Successfully assigned & moved ${movedCount} note${movedCount === 1 ? '' : 's'} into "${rootNorm}/"!`);
                    if (this.onSuccess) this.onSuccess();
                    this.close();
                } catch (err) {
                    console.error('[PakCLI] Error assigning relationship notes:', err);
                    new Notice(`Error assigning notes: ${String(err)}`);
                    bulkAssignBtn.disabled = false;
                    bulkAssignBtn.setText('Retry');
                }
            };
        }

        // ── SECTION 2: MANUAL NOTE ASSIGNER ──
        const manualSection = contentEl.createDiv();
        manualSection.style.cssText = 'border-top: 1px dashed var(--background-modifier-border); padding-top: 14px; margin-top: 10px;';

        const manualTitle = manualSection.createEl('h4', { text: '✍️ Assign Specific Note (Manual or Active Note):' });
        manualTitle.style.cssText = 'margin: 0 0 10px 0; font-size: 13px;';

        // Auto-select active file if present
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === 'md' && !this.manualFile) {
            this.manualFile = activeFile;
            const cache = this.app.metadataCache.getFileCache(activeFile);
            const rawCloseness = cache?.frontmatter?.[propKey] ?? cache?.frontmatter?.closeness;
            if (rawCloseness !== undefined && !isNaN(Number(rawCloseness))) {
                this.manualScore = Number(rawCloseness);
            }
            if (cache?.frontmatter?.role) {
                this.manualRole = String(cache.frontmatter.role);
            }
        }

        // File Selector Dropdown / Text
        const markdownFiles = this.app.vault.getMarkdownFiles();
        new Setting(manualSection)
            .setName('Select Note to Assign')
            .setDesc('Pick any markdown note from your vault (default is currently active note).')
            .addDropdown((dd) => {
                dd.addOption('', '-- Select Note --');
                markdownFiles.slice(0, 500).forEach((f) => {
                    dd.addOption(f.path, `${f.basename} (${f.path})`);
                });
                if (this.manualFile) {
                    dd.setValue(this.manualFile.path);
                }
                dd.onChange((val) => {
                    const found = this.app.vault.getAbstractFileByPath(val);
                    if (found instanceof TFile) {
                        this.manualFile = found;
                        const cache = this.app.metadataCache.getFileCache(found);
                        const rawCloseness = cache?.frontmatter?.[propKey] ?? cache?.frontmatter?.closeness;
                        if (rawCloseness !== undefined && !isNaN(Number(rawCloseness))) {
                            this.manualScore = Number(rawCloseness);
                            if (scoreSlider) scoreSlider.setValue(this.manualScore);
                            if (scoreDisplay) scoreDisplay.setText(this.manualScore.toFixed(2));
                        }
                        if (cache?.frontmatter?.role) {
                            this.manualRole = String(cache.frontmatter.role);
                            if (roleInput) roleInput.setValue(this.manualRole);
                        }
                    } else {
                        this.manualFile = null;
                    }
                });
            });

        // Closeness Tier Preset Dropdown
        new Setting(manualSection)
            .setName('Closeness Tier Preset')
            .setDesc('Select a relationship tier to automatically set recommended score.')
            .addDropdown((dd) => {
                tiers.forEach((t) => {
                    const mid = ((t.min + t.max) / 2).toFixed(2);
                    dd.addOption(String(mid), `${t.name} (${t.min.toFixed(2)} - ${t.max.toFixed(2)})`);
                });
                dd.onChange((val) => {
                    this.manualScore = parseFloat(val);
                    if (scoreSlider) scoreSlider.setValue(this.manualScore);
                    if (scoreDisplay) scoreDisplay.setText(this.manualScore.toFixed(2));
                });
            });

        // Closeness Score Slider
        let scoreSlider: any = null;
        let scoreDisplay: HTMLElement | null = null;
        const scoreSetting = new Setting(manualSection)
            .setName('Closeness Score (-1.00 - 1.00)')
            .setDesc('Fine-tune the closeness value to be stored in frontmatter.');

        scoreSetting.addSlider((slider) => {
            scoreSlider = slider;
            slider.setLimits(-1.00, 1.00, 0.01)
                .setValue(this.manualScore)
                .onChange((val) => {
                    this.manualScore = val;
                    if (scoreDisplay) scoreDisplay.setText(val.toFixed(2));
                });
        });
        scoreDisplay = scoreSetting.controlEl.createSpan({ text: this.manualScore.toFixed(2) });
        scoreDisplay.style.cssText = 'font-family: var(--font-monospace); font-weight: 600; margin-left: 8px; width: 36px; display: inline-block;';

        // Optional Role
        let roleInput: any = null;
        new Setting(manualSection)
            .setName('Role / Affinity (Optional)')
            .setDesc('Example: Partner, Best Friend, Coworker, Mentor.')
            .addText((text) => {
                roleInput = text;
                text.setPlaceholder('e.g. Partner, Friend')
                    .setValue(this.manualRole)
                    .onChange((val) => {
                        this.manualRole = val.trim();
                    });
            });

        // Assign Specific Note Button
        const manualBtnRow = manualSection.createDiv();
        manualBtnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px;';

        const cancelBtn = manualBtnRow.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => {
            this.close();
        };

        const assignSingleBtn = manualBtnRow.createEl('button', { 
            text: 'Assign & Move to Flat Folder', 
            cls: 'mod-cta' 
        });
        assignSingleBtn.style.cssText = 'font-weight: 600; padding: 5px 16px;';

        assignSingleBtn.onclick = async () => {
            if (!this.manualFile) {
                new Notice('Please select a markdown note to assign.');
                return;
            }

            assignSingleBtn.disabled = true;
            assignSingleBtn.setText('Assigning...');

            try {
                // 1. Ensure target flat folder exists
                if (!this.app.vault.getAbstractFileByPath(rootNorm)) {
                    await this.app.vault.createFolder(rootNorm);
                }

                // 2. Set frontmatter property
                await this.app.fileManager.processFrontMatter(this.manualFile, (fm) => {
                    fm[propKey] = parseFloat(this.manualScore.toFixed(2));
                    if (this.manualRole) {
                        fm.role = this.manualRole;
                    }
                });

                // 3. Move file into flat relationship folder if outside
                const targetPath = normalizePath(`${rootNorm}/${this.manualFile.name}`);
                if (this.manualFile.path !== targetPath) {
                    if (!this.app.vault.getAbstractFileByPath(targetPath)) {
                        await this.app.fileManager.renameFile(this.manualFile, targetPath);
                    }
                }

                new Notice(`🎉 Assigned "${this.manualFile.basename}" to relationship (${this.manualScore.toFixed(2)}) in "${rootNorm}/"!`);
                if (this.onSuccess) this.onSuccess();
                this.close();
            } catch (err) {
                console.error('[PakCLI] Error assigning single note:', err);
                new Notice(`Failed: ${String(err)}`);
                assignSingleBtn.disabled = false;
                assignSingleBtn.setText('Retry');
            }
        };
    }

    private scanDetectedNotes(rootNorm: string, propKey: string, tiers: RelationshipTierConfig[]) {
        this.detectedNotes = [];
        this.selectedPaths.clear();

        const allFiles = this.app.vault.getMarkdownFiles();
        for (const file of allFiles) {
            const cache = this.app.metadataCache.getFileCache(file);
            const raw = cache?.frontmatter?.[propKey] ?? 
                        cache?.frontmatter?.closeness ?? 
                        cache?.frontmatter?.score ?? 
                        cache?.frontmatter?.affinity;

            if (raw !== undefined && raw !== null && !isNaN(Number(raw))) {
                const score = Math.max(-1, Math.min(1, Number(raw)));
                let matchedTier = tiers.find(t => score >= Math.min(t.min, t.max) && score <= Math.max(t.min, t.max)) || null;

                const isInside = file.path.startsWith(rootNorm + '/') || file.parent?.path === rootNorm;

                this.detectedNotes.push({
                    file,
                    score,
                    rawScoreStr: String(raw),
                    tier: matchedTier,
                    isInsideRelFolder: isInside,
                    role: cache?.frontmatter?.role
                });

                // Pre-select unassigned notes
                if (!isInside) {
                    this.selectedPaths.add(file.path);
                }
            }
        }
    }
}
