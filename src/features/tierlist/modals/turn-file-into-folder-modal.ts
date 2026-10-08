import { App, Modal, Setting, TFile, Notice } from 'obsidian';

export class TurnFileIntoFolderModal extends Modal {
    private file: TFile;
    private folderName: string;
    private createIndex: boolean = true;
    private addFrontmatterTitle: boolean = true;
    private customTitle: string;

    constructor(app: App, file: TFile) {
        super(app);
        this.file = file;
        this.folderName = file.basename; // default 0: current file name
        this.customTitle = file.basename; // default 0: current file name
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('turn-file-into-folder-modal');

        this.setTitle('Turn Note into Folder Note');

        contentEl.createEl('p', {
            text: `Convert note "${this.file.name}" into a folder note structure.`,
            cls: 'setting-item-description'
        });

        // 1. Folder Name: 0 (default: current file name) or type manually
        new Setting(contentEl)
            .setName('Folder name')
            .setDesc('0 = use current note name, or type manually')
            .addText((text) => {
                text.setValue(this.folderName)
                    .setPlaceholder('0 or manual folder name')
                    .onChange((val) => {
                        const trimmed = val.trim();
                        this.folderName = (trimmed === '' || trimmed === '0') ? this.file.basename : trimmed;
                    });
            });

        // 2. Create also index.md inside folder (default true)
        new Setting(contentEl)
            .setName('Create also index.md inside folder')
            .setDesc('ON: creates <folder>/index.md. OFF: creates <folder>/<name>.md')
            .addToggle((toggle) => {
                toggle.setValue(this.createIndex)
                    .onChange((val) => {
                        this.createIndex = val;
                    });
            });

        // 3. Add / update frontmatter title: x
        const titleSetting = new Setting(contentEl)
            .setName('Frontmatter title (x)')
            .setDesc(`0 = use note name (${this.file.basename}), or type custom title`);

        new Setting(contentEl)
            .setName('Add frontmatter title: x')
            .setDesc('Add or update YAML frontmatter title property in the note')
            .addToggle((toggle) => {
                toggle.setValue(this.addFrontmatterTitle)
                    .onChange((val) => {
                        this.addFrontmatterTitle = val;
                        titleSetting.settingEl.style.display = val ? 'flex' : 'none';
                    });
            });

        titleSetting.addText((text) => {
            text.setValue(this.customTitle)
                .setPlaceholder('0 or custom title')
                .onChange((val) => {
                    const trimmed = val.trim();
                    this.customTitle = (trimmed === '' || trimmed === '0') ? this.file.basename : trimmed;
                });
        });

        // 4. Submit button
        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText('Convert to Folder Note')
                    .setCta()
                    .onClick(async () => {
                        await this.executeConversion();
                    });
            });
    }

    async executeConversion() {
        const { app, file, folderName, createIndex, addFrontmatterTitle, customTitle } = this;
        const parentPath = file.parent && file.parent.path !== '/' ? file.parent.path : '';
        const targetFolderPath = parentPath ? `${parentPath}/${folderName}` : folderName;

        try {
            // 1. Create target folder if not existing
            const existingFolder = app.vault.getAbstractFileByPath(targetFolderPath);
            if (!existingFolder) {
                await app.vault.createFolder(targetFolderPath);
            }

            // 2. Update frontmatter title if requested
            if (addFrontmatterTitle) {
                const titleVal = (customTitle && customTitle.trim() !== '0') ? customTitle.trim() : file.basename;
                let content = await app.vault.read(file);
                const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
                const match = content.match(frontmatterRegex);

                if (match) {
                    let fmBlock = match[1];
                    if (/^title\s*:/m.test(fmBlock)) {
                        fmBlock = fmBlock.replace(/^title\s*:.*$/m, `title: "${titleVal}"`);
                    } else {
                        fmBlock = `title: "${titleVal}"\n` + fmBlock;
                    }
                    content = content.replace(frontmatterRegex, `---\n${fmBlock}\n---`);
                } else {
                    content = `---\ntitle: "${titleVal}"\n---\n\n` + content;
                }
                await app.vault.modify(file, content);
            }

            // 3. Determine target file path
            const targetFileName = createIndex ? 'index.md' : `${folderName}.md`;
            const targetFilePath = `${targetFolderPath}/${targetFileName}`;

            // 4. Move/rename file via fileManager so links are updated across vault
            await app.fileManager.renameFile(file, targetFilePath);

            new Notice(`Converted note to folder note: ${targetFilePath}`);
            this.close();

            // 5. Open converted note
            const newFile = app.vault.getAbstractFileByPath(targetFilePath);
            if (newFile instanceof TFile) {
                app.workspace.getLeaf(false).openFile(newFile);
            }
        } catch (err: any) {
            new Notice(`Error converting to folder note: ${err?.message || err}`);
            console.error('Folder note conversion error:', err);
        }
    }
}
