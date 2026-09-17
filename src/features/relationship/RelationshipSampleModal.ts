import { App, Modal, Notice, Setting, TFile, TFolder, normalizePath } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DEFAULT_RELATIONSHIP_TIERS, RelationshipTierConfig, RelationshipMode, RelationshipFolderEntry } from '../../settings';

export class RelationshipSampleModal extends Modal {
    private plugin: PakCLITablePlugin;
    private targetPath: string;
    private overwrite: boolean = false;
    private mode: RelationshipMode = '1dir';
    private applyCaptainColors: boolean = true;
    private onSuccess?: () => void;

    constructor(app: App, plugin: PakCLITablePlugin, defaultPath?: string, onSuccess?: () => void) {
        super(app);
        this.plugin = plugin;
        this.targetPath = defaultPath || this.plugin.settings.familyCirclesRootFolder || 'Relationships';
        this.mode = this.plugin.settings.relationshipMode || '1dir';
        this.onSuccess = onSuccess;
    }

    public onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pakcli-sample-modal');

        const header = contentEl.createEl('h2', { text: '✨ Create Relationship Sample Preset' });
        header.style.cssText = 'margin-top: 0; margin-bottom: 6px;';

        const desc = contentEl.createEl('p', { 
            text: 'Generate starter notes with closeness metadata, wikilink connections, and optional folder colors.' 
        });
        desc.style.cssText = 'color: var(--text-muted); font-size: 13px; margin-bottom: 16px;';

        // 1. Target Folder Path (Customizable / Redirectable)
        new Setting(contentEl)
            .setName('Target Directory Path')
            .setDesc('Folder where relationship notes will be created. Default is "Relationships" (or redirect to any custom path).')
            .addText((text) => {
                text.setPlaceholder('Relationships')
                    .setValue(this.targetPath)
                    .onChange((val) => {
                        this.targetPath = val.trim() || 'Relationships';
                    });
            });

        // 2. Overwrite Existing Notes Toggle
        new Setting(contentEl)
            .setName('Overwrite Existing Notes?')
            .setDesc('If enabled, replaces existing notes with fresh sample templates. If disabled, existing files are safely skipped.')
            .addToggle((toggle) => {
                toggle.setValue(this.overwrite)
                    .onChange((val) => {
                        this.overwrite = val;
                    });
            });

        // 3. Storage Structure Mode
        new Setting(contentEl)
            .setName('Storage Structure Mode')
            .setDesc('Choose whether to store notes flat in 1 directory or partitioned into physical tier subfolders.')
            .addDropdown((dd) => {
                dd.addOption('1dir', '1 Directory Mode (Flat Notes + Closeness Metadata)')
                  .addOption('subfolders', 'Physical Subfolders (1 - Household, 2 - Family, etc.)')
                  .setValue(this.mode)
                  .onChange((val) => {
                      this.mode = val as RelationshipMode;
                  });
            });

        // 4. Apply Captain Colors
        new Setting(contentEl)
            .setName('Apply Captain Folder Colors')
            .setDesc('Automatically register theme colors for relationship tiers in Captain Colors.')
            .addToggle((toggle) => {
                toggle.setValue(this.applyCaptainColors)
                    .onChange((val) => {
                        this.applyCaptainColors = val;
                    });
            });

        // 5. Preview of Sample Notes
        const previewBox = contentEl.createDiv();
        previewBox.style.cssText = 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 12px;';
        previewBox.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-normal);">Starter Notes Included:</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; color: var(--text-muted);">
                <div>🟢 <b>Me.md</b> (Closeness: 1.00)</div>
                <div>🟢 <b>Sample - Partner.md</b> (0.90)</div>
                <div>🟡 <b>Sample - Mom.md</b> (0.70)</div>
                <div>🟣 <b>Sample - Best Friend.md</b> (0.50)</div>
                <div>🔵 <b>Sample - Friend.md</b> (0.30)</div>
                <div>⚪ <b>Sample - Know.md</b> (0.15)</div>
                <div>🔴 <b>Sample - Rival.md</b> (0.00)</div>
            </div>
        `;

        // Buttons
        const buttonsRow = contentEl.createDiv();
        buttonsRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px;';

        const cancelBtn = buttonsRow.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => {
            this.close();
        };

        const createBtn = buttonsRow.createEl('button', { text: '✨ Create Sample Notes', cls: 'mod-cta' });
        createBtn.style.cssText = 'font-weight: 600; padding: 6px 16px;';

        createBtn.onclick = async () => {
            createBtn.disabled = true;
            cancelBtn.disabled = true;
            createBtn.setText('Creating...');

            try {
                const root = normalizePath(this.targetPath || 'Relationships');
                const tiers: RelationshipTierConfig[] = this.plugin.settings.relationshipTiers || DEFAULT_RELATIONSHIP_TIERS;
                const propKey = this.plugin.settings.relationshipPropertyKey || 'closeness';
                const is1Dir = this.mode === '1dir';

                const ensureDir = async (dirPath: string) => {
                    const norm = normalizePath(dirPath);
                    if (!this.app.vault.getAbstractFileByPath(norm)) {
                        await this.app.vault.createFolder(norm);
                    }
                };

                await ensureDir(root);

                if (!is1Dir) {
                    for (const tier of tiers) {
                        await ensureDir(`${root}/${tier.folderName}`);
                    }
                }

                const writeNote = async (relPath: string, content: string) => {
                    const fullPath = normalizePath(relPath);
                    const existing = this.app.vault.getAbstractFileByPath(fullPath);
                    if (existing instanceof TFile) {
                        if (this.overwrite) {
                            await this.app.vault.modify(existing, content);
                        }
                    } else if (!existing) {
                        await this.app.vault.create(fullPath, content);
                    }
                };

                const getDir = (tierIdx: number) => {
                    if (is1Dir) return root;
                    const tier = tiers[tierIdx] || tiers[0];
                    return `${root}/${tier.folderName}`;
                };

                // 1. Me (Core)
                await writeNote(`${getDir(0)}/Me.md`, `---
img: ""
${propKey}: 1.00
role: Self / Me
tags:
  - me
  - core
---
# Me

Pusat orbit hubungan personal dan keluarga.
`);

                // 2. Partner (Household)
                await writeNote(`${getDir(0)}/Sample - Partner.md`, `---
img: ""
${propKey}: 0.90
role: Partner / Housemate
birthday: 1995-01-01
tags:
  - household
  - core
---
# Sample - Partner

Orang yang tinggal bersama dalam satu rumah (keluarga inti / pasangan / roommate).

## Connections
- [[Me]]
- [[Sample - Mom]]
`);

                // 3. Mom (Family)
                await writeNote(`${getDir(1)}/Sample - Mom.md`, `---
img: ""
${propKey}: 0.70
role: Mother / Family
birthday: 1970-05-15
tags:
  - family
  - relatives
---
# Sample - Mom

Keluarga besar, orang tua, mertua, kerabat, saudara.

## Connections
- [[Me]]
- [[Sample - Partner]]
- [[Sample - Best Friend]]
`);

                // 4. Best Friend (Close Friends)
                await writeNote(`${getDir(2)}/Sample - Best Friend.md`, `---
img: ""
${propKey}: 0.50
role: Best Friend / Confidant
tags:
  - close-friends
  - inner-circle
---
# Sample - Best Friend

Sahabat terdekat, teman curhat, inner circle.

## Connections
- [[Me]]
- [[Sample - Friend]]
`);

                // 5. Friend (Friends)
                await writeNote(`${getDir(3)}/Sample - Friend.md`, `---
img: ""
${propKey}: 0.30
role: Colleague / Friend
tags:
  - friends
  - social
---
# Sample - Friend

Teman kantor, teman nongkrong, teman komunitas.

## Connections
- [[Me]]
- [[Sample - Best Friend]]
`);

                // 6. Unsure (0.00)
                await writeNote(`${getDir(4)}/Sample - Unsure.md`, `---
img: ""
${propKey}: 0.00
role: Unsure / Observing
tags:
  - unsure
  - neutral
---
# Sample - Unsure

Kontak atau relasi baru yang belum ditentukan posisinya (skor 0.00).

## Connections
- [[Me]]
`);

                // 7. Devil (Bad / -1.00)
                await writeNote(`${getDir(5)}/Sample - Devil.md`, `---
img: ""
${propKey}: -1.00
role: Devil / Nemesis
tags:
  - bad
  - devil
  - nemesis
---
# Sample - Devil

Relasi toksik, lawan berbahaya, atau musuh (skor -1.00 / bad).

## Connections
- [[Me]]
`);

                // Register folder into relationshipFolders if not present
                let folders = this.plugin.settings.relationshipFolders || [];
                const existingIdx = folders.findIndex(f => normalizePath(f.path) === root);
                if (existingIdx === -1) {
                    folders.push({
                        id: `rel_${Date.now()}`,
                        path: root,
                        mode: this.mode,
                        viewStructure: 'flat',
                        label: root.split('/').pop() || 'Relationships',
                        createdAt: Date.now()
                    });
                } else {
                    folders[existingIdx].mode = this.mode;
                }
                this.plugin.settings.relationshipFolders = folders;
                this.plugin.settings.familyCirclesRootFolder = root;
                this.plugin.settings.relationshipMode = this.mode;

                // Apply Captain colors if selected
                if (this.applyCaptainColors) {
                    this.plugin.settings.bubbleUseCaptainColors = true;
                    const folderConfigs = (this.plugin.settings.fileConfigs as Record<string, any>) || {};
                    folderConfigs[root] = { color: '#6366f1' };
                    tiers.forEach(t => {
                        folderConfigs[`${root}/${t.folderName}`] = { color: t.color };
                    });
                    this.plugin.settings.fileConfigs = folderConfigs;

                    if (!this.plugin.settings.rules) this.plugin.settings.rules = [];
                    const existingRule = this.plugin.settings.rules.find(r => normalizePath(r.path || '').toLowerCase() === root.toLowerCase());
                    if (existingRule) {
                        existingRule.color = '#6366f1';
                        existingRule.enabled = true;
                        existingRule.includeChildren = true;
                    } else {
                        this.plugin.settings.rules.push({
                            path: root,
                            isNested: true,
                            includeChildren: true,
                            useNoteTitle: 'inherit',
                            enabled: true,
                            color: '#6366f1'
                        });
                    }
                }

                await this.plugin.saveSettings();

                if (this.onSuccess) {
                    this.onSuccess();
                }

                new Notice(`🎉 Successfully created sample relationship notes in "${root}"!`);
                this.close();
            } catch (err) {
                console.error('[PakCLI] Failed to create sample preset notes:', err);
                new Notice(`Error creating sample notes: ${String(err)}`);
                createBtn.disabled = false;
                cancelBtn.disabled = false;
                createBtn.setText('Retry');
            }
        };
    }
}
