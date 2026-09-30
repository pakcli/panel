import { App, Modal, Notice, setIcon, TFile } from 'obsidian';
import { ReplacementMatchItem, StringSanitizerRule } from './types';
import { SanitizerEngine } from './SanitizerEngine';

export class PreFlightDiffModal extends Modal {
    private targetMode: 'active' | 'vault';
    private rules: StringSanitizerRule[];
    private matches: ReplacementMatchItem[] = [];
    private onComplete?: () => void;

    // DOM references
    private summaryEl: HTMLElement | null = null;
    private tableContainerEl: HTMLElement | null = null;
    private applyBtnEl: HTMLButtonElement | null = null;

    constructor(
        app: App,
        targetMode: 'active' | 'vault',
        rules: StringSanitizerRule[],
        onComplete?: () => void
    ) {
        super(app);
        this.targetMode = targetMode;
        this.rules = rules.filter(r => r.enabled);
        this.onComplete = onComplete;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pakcli-sanitizer-modal');

        // Header Title
        const header = contentEl.createDiv({ cls: 'sanitizer-modal-header' });
        const titleSpan = header.createEl('h2', { 
            text: `🛡️ Pre-Flight Review: ${this.targetMode === 'active' ? 'Active Note' : 'Entire Vault'}` 
        });

        // Loading Indicator
        const loadingEl = contentEl.createDiv({ cls: 'sanitizer-loading-bar', text: 'Scanning notes for matching patterns...' });

        // Perform scan
        await this.scanTargetFiles();
        loadingEl.remove();

        // Summary Bar
        this.summaryEl = contentEl.createDiv({ cls: 'sanitizer-summary-bar' });
        this.updateSummaryText();

        if (this.matches.length === 0) {
            const emptyEl = contentEl.createDiv({ cls: 'sanitizer-empty-state' });
            setIcon(emptyEl.createSpan({ cls: 'sanitizer-empty-icon' }), 'check-circle-2');
            emptyEl.createSpan({ text: 'No matching strings found! All scanned notes are clean.' });
            
            const footer = contentEl.createDiv({ cls: 'sanitizer-modal-footer' });
            const closeBtn = footer.createEl('button', { text: 'Close', cls: 'mod-cta' });
            closeBtn.onclick = () => this.close();
            return;
        }

        // Toolbar (Select All / Deselect All)
        const toolbar = contentEl.createDiv({ cls: 'sanitizer-modal-toolbar' });
        const selectAllBtn = toolbar.createEl('button', { text: 'Select All', cls: 'sanitizer-btn' });
        selectAllBtn.onclick = () => {
            this.matches.forEach(m => m.selected = true);
            this.renderTableRows();
            this.updateActionButtons();
        };

        const deselectAllBtn = toolbar.createEl('button', { text: 'Deselect All', cls: 'sanitizer-btn' });
        deselectAllBtn.onclick = () => {
            this.matches.forEach(m => m.selected = false);
            this.renderTableRows();
            this.updateActionButtons();
        };

        // Scrollable Table Container
        this.tableContainerEl = contentEl.createDiv({ cls: 'sanitizer-table-wrapper' });
        this.renderTableStructure();

        // Modal Action Footer
        const footer = contentEl.createDiv({ cls: 'sanitizer-modal-footer' });
        
        const cancelBtn = footer.createEl('button', { text: 'Cancel', cls: 'sanitizer-btn' });
        cancelBtn.onclick = () => this.close();

        this.applyBtnEl = footer.createEl('button', { cls: 'mod-cta sanitizer-apply-btn' });
        this.applyBtnEl.onclick = async () => {
            await this.applySelectedChanges();
        };
        this.updateActionButtons();
    }

    private async scanTargetFiles(): Promise<void> {
        let files: TFile[] = [];
        if (this.targetMode === 'active') {
            const active = this.app.workspace.getActiveFile();
            if (active && active.extension === 'md') {
                files = [active];
            }
        } else {
            files = this.app.vault.getMarkdownFiles();
        }

        this.matches = [];

        for (const file of files) {
            try {
                const content = await this.app.vault.cachedRead(file);
                const lines = content.split(/\r?\n/);

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const proc = SanitizerEngine.processLine(line, this.rules);
                    if (proc.changed) {
                        this.matches.push({
                            id: `${file.path}:${i}`,
                            file,
                            filePath: file.path,
                            fileName: file.basename,
                            lineIndex: i,
                            lineNumber: i + 1,
                            originalLine: line,
                            replacedLine: proc.newLine,
                            ruleLabel: proc.matchedRules.join(', '),
                            selected: true
                        });
                    }
                }
            } catch (err) {
                console.warn(`[PreFlightDiffModal] Error scanning ${file.path}:`, err);
            }
        }
    }

    private updateSummaryText(): void {
        if (!this.summaryEl) return;
        const total = this.matches.length;
        const uniqueFiles = new Set(this.matches.map(m => m.filePath)).size;
        const selected = this.matches.filter(m => m.selected).length;

        this.summaryEl.setText(
            `Found ${total} replacement occurrence(s) across ${uniqueFiles} file(s). Selected for replacement: ${selected}`
        );
    }

    private renderTableStructure(): void {
        if (!this.tableContainerEl) return;
        this.tableContainerEl.empty();

        const table = this.tableContainerEl.createEl('table', { cls: 'sanitizer-diff-table' });
        
        // Table Head
        const thead = table.createEl('thead');
        const headerRow = thead.createEl('tr');
        headerRow.createEl('th', { text: '✓', cls: 'col-check' });
        headerRow.createEl('th', { text: 'File & Line', cls: 'col-file' });
        headerRow.createEl('th', { text: 'Original (Before)', cls: 'col-diff' });
        headerRow.createEl('th', { text: 'Replaced (After)', cls: 'col-diff' });
        headerRow.createEl('th', { text: 'Rule', cls: 'col-rule' });

        // Table Body
        const tbody = table.createEl('tbody');
        this.renderTableRowsInto(tbody);
    }

    private renderTableRows(): void {
        if (!this.tableContainerEl) return;
        const tbody = this.tableContainerEl.querySelector('tbody') as HTMLElement | null;
        if (tbody) {
            tbody.empty();
            this.renderTableRowsInto(tbody);
        }
    }

    private renderTableRowsInto(tbody: HTMLElement): void {
        for (const item of this.matches) {
            const tr = tbody.createEl('tr', { cls: item.selected ? 'is-selected' : '' });

            // Checkbox
            const checkTd = tr.createEl('td', { cls: 'col-check' });
            const chk = checkTd.createEl('input', { type: 'checkbox' });
            chk.checked = item.selected;
            chk.onchange = () => {
                item.selected = chk.checked;
                tr.classList.toggle('is-selected', item.selected);
                this.updateSummaryText();
                this.updateActionButtons();
            };

            // File & Line
            const fileTd = tr.createEl('td', { cls: 'col-file' });
            fileTd.createDiv({ text: item.fileName, cls: 'sanitizer-file-title', title: item.filePath });
            fileTd.createDiv({ text: `Line ${item.lineNumber}`, cls: 'sanitizer-line-no' });

            // Original Line
            const origTd = tr.createEl('td', { cls: 'col-diff col-before' });
            origTd.createEl('code', { text: item.originalLine.trim() || '(blank)' });

            // Replaced Line
            const replTd = tr.createEl('td', { cls: 'col-diff col-after' });
            replTd.createEl('code', { text: item.replacedLine.trim() || '(blank)' });

            // Rule Label
            const ruleTd = tr.createEl('td', { cls: 'col-rule' });
            ruleTd.createSpan({ text: item.ruleLabel, cls: 'sanitizer-rule-badge' });
        }
    }

    private updateActionButtons(): void {
        if (!this.applyBtnEl) return;
        const selectedCount = this.matches.filter(m => m.selected).length;
        this.applyBtnEl.setText(`🚀 Confirm & Apply Changes (${selectedCount})`);
        this.applyBtnEl.disabled = selectedCount === 0;
    }

    private async applySelectedChanges(): Promise<void> {
        const selected = this.matches.filter(m => m.selected);
        if (selected.length === 0) return;

        if (this.applyBtnEl) {
            this.applyBtnEl.disabled = true;
            this.applyBtnEl.setText('Applying changes...');
        }

        // Group by file
        const fileMap = new Map<TFile, ReplacementMatchItem[]>();
        for (const item of selected) {
            if (!fileMap.has(item.file)) {
                fileMap.set(item.file, []);
            }
            fileMap.get(item.file)!.push(item);
        }

        let appliedReplacements = 0;
        let appliedFiles = 0;

        for (const [file, items] of fileMap.entries()) {
            try {
                // Map of lineIndex -> replacement
                const lineMap = new Map<number, string>();
                items.forEach(it => lineMap.set(it.lineIndex, it.replacedLine));

                await this.app.vault.process(file, (data) => {
                    const lines = data.split(/\r?\n/);
                    for (const [idx, newLine] of lineMap.entries()) {
                        if (idx >= 0 && idx < lines.length) {
                            lines[idx] = newLine;
                        }
                    }
                    return lines.join('\n');
                });

                appliedFiles++;
                appliedReplacements += items.length;
            } catch (err) {
                console.error(`[PreFlightDiffModal] Error updating file ${file.path}:`, err);
            }
        }

        new Notice(`✅ Successfully applied ${appliedReplacements} string replacement(s) across ${appliedFiles} file(s)!`, 6000);

        if (this.onComplete) {
            this.onComplete();
        }

        this.close();
    }
}
