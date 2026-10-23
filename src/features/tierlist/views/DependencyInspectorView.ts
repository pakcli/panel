import { ItemView, WorkspaceLeaf, TFile, Menu, Notice, debounce, MarkdownView } from 'obsidian';
import Sortable from 'sortablejs';
import {
    triageDependencies,
    filterAndSortDependencies,
    TriagedDependencyItem,
    TriageResult,
    TriageFilterOptions,
    DependencyTier
} from '../utils/dependency-triage';
import { TriageHistoryManager } from '../utils/triage-history';

export const DEPENDENCY_INSPECTOR_VIEW_TYPE = 'pakcli-dependency-inspector';

export class DependencyInspectorView extends ItemView {
    private activeFile: TFile | null = null;
    private historyManager: TriageHistoryManager;
    private sortableInstances: Sortable[] = [];

    // State Kontrol
    private viewMode: 'grouped' | 'ungrouped' = 'grouped';
    private expandedItems: Set<string> = new Set();
    private filterOptions: TriageFilterOptions = {
        scope: 'all',
        sortBy: 'firstMention',
        collapseRepetitive: true,
        searchQuery: ''
    };

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.historyManager = new TriageHistoryManager();
    }

    getViewType(): string {
        return DEPENDENCY_INSPECTOR_VIEW_TYPE;
    }

    getDisplayText(): string {
        return '🧭 Dependency Inspector';
    }

    getIcon(): string {
        return 'git-fork';
    }

    async onOpen(): Promise<void> {
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                const file = this.app.workspace.getActiveFile();
                if (file && file !== this.activeFile) {
                    this.activeFile = file;
                    this.renderUI();
                }
            })
        );

        const debouncedRefresh = debounce(() => {
            if (this.activeFile) this.renderUI();
        }, 300);

        this.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                if (this.activeFile && file.path === this.activeFile.path) {
                    debouncedRefresh();
                }
            })
        );

        this.activeFile = this.app.workspace.getActiveFile();
        this.renderUI();
    }

    async onClose(): Promise<void> {
        this.destroySortables();
        this.containerEl.empty();
    }

    private destroySortables(): void {
        this.sortableInstances.forEach((s) => s.destroy());
        this.sortableInstances = [];
    }

    public renderUI(): void {
        this.destroySortables();
        const container = this.containerEl;
        container.empty();
        container.addClass('dependency-inspector-container');

        if (!this.activeFile) {
            container.createEl('div', {
                cls: 'dep-inspector-empty',
                text: 'Buka sebuah catatan Markdown untuk melihat analisis dependensi.'
            });
            return;
        }

        const triageData = triageDependencies(this.app, this.activeFile);

        this.renderHeader(container, triageData);
        this.renderControls(container);

        const contentBody = container.createEl('div', { cls: 'dep-inspector-content' });
        if (this.viewMode === 'grouped') {
            this.renderGroupedView(contentBody, triageData);
        } else {
            this.renderUngroupedView(contentBody, triageData);
        }

        this.renderFooter(container, triageData);
    }

    private renderHeader(container: HTMLElement, data: TriageResult): void {
        const header = container.createEl('div', { cls: 'dep-header' });

        const titleArea = header.createEl('div', { cls: 'dep-title-area' });
        titleArea.createEl('span', { cls: 'dep-title-icon', text: '🧭' });
        const titleText = titleArea.createEl('div', { cls: 'dep-title-text' });
        titleText.createEl('h4', { text: this.activeFile?.basename || 'Catatan' });
        titleText.createEl('small', { text: `Total: ${data.stats.total} Link Terdeteksi` });

        const historyBtns = header.createEl('div', { cls: 'dep-history-btns' });
        const undoBtn = historyBtns.createEl('button', {
            cls: 'dep-icon-btn',
            text: '↩️',
            attr: { title: 'Undo (Ctrl+Z)' }
        });
        undoBtn.onclick = async () => {
            await this.historyManager.undo(this.app);
            this.renderUI();
        };

        const redoBtn = historyBtns.createEl('button', {
            cls: 'dep-icon-btn',
            text: '↪️',
            attr: { title: 'Redo (Ctrl+Y)' }
        });
        redoBtn.onclick = async () => {
            await this.historyManager.redo(this.app);
            this.renderUI();
        };
    }

    private renderControls(container: HTMLElement): void {
        const ctrl = container.createEl('div', { cls: 'dep-controls' });

        const row1 = ctrl.createEl('div', { cls: 'dep-ctrl-row-top' });

        const modeSwitcher = row1.createEl('div', { cls: 'dep-segmented-pill' });
        const btnGrouped = modeSwitcher.createEl('button', {
            cls: `dep-pill-btn ${this.viewMode === 'grouped' ? 'active' : ''}`,
            text: '🗂️ Grouped'
        });
        btnGrouped.onclick = () => {
            this.viewMode = 'grouped';
            this.renderUI();
        };

        const btnUngrouped = modeSwitcher.createEl('button', {
            cls: `dep-pill-btn ${this.viewMode === 'ungrouped' ? 'active' : ''}`,
            text: '📜 Ungrouped'
        });
        btnUngrouped.onclick = () => {
            this.viewMode = 'ungrouped';
            this.renderUI();
        };

        const collapseBtn = row1.createEl('button', {
            cls: `dep-collapse-toggle ${this.filterOptions.collapseRepetitive ? 'is-collapsed' : ''}`,
            text: this.filterOptions.collapseRepetitive ? '🔁 Repetitive: ON' : '🔁 Repetitive: OFF',
            attr: { title: 'Satukan link yang disebut berulang dengan multiplier [x3]' }
        });
        collapseBtn.onclick = () => {
            this.filterOptions.collapseRepetitive = !this.filterOptions.collapseRepetitive;
            this.renderUI();
        };

        const row2 = ctrl.createEl('div', { cls: 'dep-ctrl-row-sorter' });
        row2.createEl('label', { text: 'Urutkan:', cls: 'dep-sorter-label' });
        const selectSort = row2.createEl('select', { cls: 'dep-sorter-select' });

        const sortOptions = [
            { value: 'firstMention', text: '⏳ Pertama Kali Disebut' },
            { value: 'lastMention', text: '⌛ Terakhir Kali Disebut' },
            { value: 'popular', text: '🔥 Paling Sering Disebut' },
            { value: 'alphaAsc', text: '🔤 Nama (A - Z)' },
            { value: 'alphaDesc', text: '🔤 Nama (Z - A)' }
        ];

        sortOptions.forEach((opt) => {
            const el = selectSort.createEl('option', { value: opt.value, text: opt.text });
            if (this.filterOptions.sortBy === opt.value) el.selected = true;
        });

        selectSort.onchange = () => {
            this.filterOptions.sortBy = selectSort.value as any;
            this.renderUI();
        };
    }

    private renderGroupedView(container: HTMLElement, data: TriageResult): void {
        const zones = [
            { key: 'hard', title: '🔴 HARD DEPENDENCIES (Frontmatter)', items: data.hard, zoneCls: 'zone-hard' },
            { key: 'contextual', title: '🟡 CONTEXTUAL (Tools, Rules & Specs)', items: data.contextual, zoneCls: 'zone-contextual' },
            { key: 'soft', title: '⚪ SOFT MENTIONS (Konteks Narasi)', items: data.soft, zoneCls: 'zone-soft' },
            { key: 'unresolved', title: '🟠 UNRESOLVED PHANTOM LINKS', items: data.unresolved, zoneCls: 'zone-unresolved' }
        ];

        zones.forEach((zone) => {
            const box = container.createEl('div', { cls: `dep-zone-box ${zone.zoneCls}` });
            const head = box.createEl('div', { cls: 'dep-zone-header' });
            head.createEl('span', { text: zone.title });
            head.createEl('span', { cls: 'dep-zone-badge', text: String(zone.items.length) });

            const listEl = box.createEl('div', { cls: 'dep-card-list' });
            listEl.setAttribute('data-zone', zone.key);

            const sortedItems = filterAndSortDependencies(zone.items, this.filterOptions);
            sortedItems.forEach((item) => {
                this.renderRowItem(listEl, item, true);
            });

            const sortable = new Sortable(listEl, {
                group: 'dependency-triage',
                animation: 150,
                handle: '.dep-drag-handle',
                onAdd: async (evt) => {
                    const cleanName = evt.item.getAttribute('data-clean-name');
                    const toZone = evt.to.getAttribute('data-zone');
                    if (!cleanName || !toZone || !this.activeFile) return;

                    if (toZone === 'hard') {
                        await this.historyManager.pinToFrontmatter(this.app, this.activeFile, cleanName);
                    } else if (evt.from.getAttribute('data-zone') === 'hard') {
                        await this.historyManager.unpinFromFrontmatter(this.app, this.activeFile, cleanName);
                    }
                    this.renderUI();
                }
            });
            this.sortableInstances.push(sortable);
        });
    }

    private renderUngroupedView(container: HTMLElement, data: TriageResult): void {
        const streamWrap = container.createEl('div', { cls: 'dep-ungrouped-stream' });
        const items = filterAndSortDependencies(data.all, this.filterOptions);

        if (items.length === 0) {
            streamWrap.createEl('div', { cls: 'dep-empty-notice', text: 'Tidak ada link yang sesuai filter.' });
            return;
        }

        items.forEach((item) => {
            this.renderRowItem(streamWrap, item, false);
        });
    }

    /**
     * Render Baris Universal:
     * DragHandle | Nama Link | 3 Radio (Red, Yellow, White) | xCount Badge | Click Row to Jump
     */
    private renderRowItem(parent: HTMLElement, item: TriagedDependencyItem, isGrouped: boolean): void {
        const rowWrapper = parent.createEl('div', { cls: `dep-row-wrapper tier-${item.tier}` });
        rowWrapper.setAttribute('data-clean-name', item.cleanName);

        const row = rowWrapper.createEl('div', { cls: `dep-item-row tier-${item.tier}` });

        if (isGrouped) {
            row.createEl('span', {
                cls: 'dep-drag-handle',
                text: '⋮⋮',
                attr: { title: 'Seret untuk memindahkan zona' }
            });
        }

        // Title Column (Klik baris langsung scroll ke line di editor aktif)
        const titleArea = row.createEl('div', { cls: 'dep-row-title-area' });
        const titleText = titleArea.createEl('span', {
            cls: 'dep-row-title',
            text: `[[${item.cleanName}]]`,
            attr: { title: `Klik untuk loncat ke Baris ${item.lines[0] || 1}` }
        });
        titleText.onclick = (e) => {
            e.stopPropagation();
            this.jumpToLine(item.lines[0] || 1);
        };

        // 3 Radio Buttons: Red (Hard), Yellow (Contextual), White (Soft)
        const radioGroup = row.createEl('div', { cls: 'dep-row-radio-group' });

        const radioTiers: { tier: DependencyTier; colorCls: string; label: string }[] = [
            { tier: 'hard', colorCls: 'radio-row-red', label: 'Hard' },
            { tier: 'contextual', colorCls: 'radio-row-yellow', label: 'Contextual' },
            { tier: 'soft', colorCls: 'radio-row-white', label: 'Soft' }
        ];

        radioTiers.forEach((rt) => {
            const rLabel = radioGroup.createEl('label', {
                cls: `dep-row-radio-dot ${rt.colorCls} ${item.tier === rt.tier ? 'is-active' : ''}`,
                attr: { title: `Pindahkan status ke ${rt.label}` }
            });
            const rInput = rLabel.createEl('input', {
                type: 'radio',
                name: `tier-radio-${item.cleanName}`
            });
            rInput.checked = item.tier === rt.tier;

            rInput.onchange = async (e) => {
                e.stopPropagation();
                await this.changeItemTier(item, rt.tier);
            };
        });

        // Multiplier Count Badge (Bisa diklik untuk toggle expand details)
        if (this.filterOptions.collapseRepetitive && item.count > 1) {
            const countBadge = row.createEl('span', {
                cls: 'dep-badge-multiplier is-clickable',
                text: `x${item.count}`,
                attr: { title: `Disebut ${item.count}x di baris: ${item.lines.join(', ')}. Klik untuk expand/collapse` }
            });
            countBadge.onclick = (e) => {
                e.stopPropagation();
                if (this.expandedItems.has(item.cleanName)) {
                    this.expandedItems.delete(item.cleanName);
                } else {
                    this.expandedItems.add(item.cleanName);
                }
                this.renderUI();
            };
        }

        // Baris status kecil di ujung kanan
        const lineTag = row.createEl('span', {
            cls: 'dep-row-linetag',
            text: `Line ${item.lines[0] || 1}`,
            attr: { title: `Loncat ke Baris ${item.lines[0] || 1}` }
        });
        lineTag.onclick = (e) => {
            e.stopPropagation();
            this.jumpToLine(item.lines[0] || 1);
        };

        // Jika Unresolved / Phantom Link, tampilkan aksi cepat
        if (item.tier === 'unresolved') {
            const phantomBadge = row.createEl('span', {
                cls: 'dep-btn-resolve',
                text: '+ Create',
                attr: { title: 'File belum ada. Klik untuk membuat catatan baru' }
            });
            phantomBadge.onclick = (e) => {
                e.stopPropagation();
                this.createPhantomNote(item.cleanName);
            };
        }

        // Expanded Panel (Jika di-expand klik badge xCount)
        if (this.expandedItems.has(item.cleanName)) {
            const expPanel = rowWrapper.createEl('div', { cls: 'dep-row-expanded-panel' });
            expPanel.createEl('div', {
                cls: 'dep-expanded-title',
                text: `📍 Lokasi Kemunculan di Dokumen (${item.count} kali):`
            });
            const lineChips = expPanel.createEl('div', { cls: 'dep-expanded-lines' });

            item.lines.forEach((l) => {
                const chip = lineChips.createEl('span', {
                    cls: 'dep-line-jump-chip',
                    text: `Baris ${l}`
                });
                chip.onclick = (e) => {
                    e.stopPropagation();
                    this.jumpToLine(l);
                };
            });

            if (item.targetSpecs && Object.keys(item.targetSpecs).length > 0) {
                const specWrap = expPanel.createEl('div', { cls: 'dep-expanded-specs' });
                Object.entries(item.targetSpecs).forEach(([k, v]) => {
                    specWrap.createEl('div', { text: `• ${k}: ${v}` });
                });
            }
        }

        row.addEventListener('contextmenu', (evt) => this.showContextMenu(evt, item));
    }

    /**
     * Otomatis sinkronisasi saat radio button diklik
     */
    private async changeItemTier(item: TriagedDependencyItem, targetTier: DependencyTier): Promise<void> {
        if (!this.activeFile || item.tier === targetTier) return;

        if (targetTier === 'hard') {
            await this.historyManager.pinToFrontmatter(this.app, this.activeFile, item.cleanName);
        } else if (item.tier === 'hard') {
            await this.historyManager.unpinFromFrontmatter(this.app, this.activeFile, item.cleanName);
        } else {
            new Notice(`Status [[${item.cleanName}]] diubah ke ${targetTier}.`);
        }
        this.renderUI();
    }

    /**
     * Loncat langsung ke nomor baris di editor Markdown aktif
     */
    private jumpToLine(lineNumber: number): void {
        const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeLeaf && activeLeaf.editor) {
            const line = Math.max(0, lineNumber - 1);
            activeLeaf.editor.setCursor({ line, ch: 0 });
            activeLeaf.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
            new Notice(`📍 Loncat ke baris ${lineNumber}`);
        } else {
            new Notice(`Buka dokumen di mode edit untuk melompat ke baris ${lineNumber}.`);
        }
    }

    private showContextMenu(evt: MouseEvent, item: TriagedDependencyItem): void {
        evt.preventDefault();
        const menu = new Menu();

        menu.addItem((i) =>
            i
                .setTitle('🔴 Set as Hard Dependency (Write YAML)')
                .setIcon('pin')
                .onClick(async () => {
                    await this.changeItemTier(item, 'hard');
                })
        );

        menu.addItem((i) =>
            i
                .setTitle('🟡 Set as Contextual Tool/Rule')
                .setIcon('wrench')
                .onClick(async () => {
                    await this.changeItemTier(item, 'contextual');
                })
        );

        menu.addItem((i) =>
            i
                .setTitle('⚪ Set as Soft Mention')
                .setIcon('file-text')
                .onClick(async () => {
                    await this.changeItemTier(item, 'soft');
                })
        );

        if (item.tier === 'unresolved') {
            menu.addItem((i) =>
                i
                    .setTitle('📄 Create Note File')
                    .setIcon('file-plus')
                    .onClick(() => this.createPhantomNote(item.cleanName))
            );
        }

        menu.showAtMouseEvent(evt);
    }

    private async createPhantomNote(cleanName: string): Promise<void> {
        try {
            const folder = 'tools/hardware';
            const targetPath = `${folder}/${cleanName}.md`;
            const template = `---\ntitle: ${cleanName}\ncategory: tool\n---\n\n# ${cleanName}\n`;
            await this.app.vault.create(targetPath, template);
            new Notice(`✅ Catatan baru berhasil dibuat: ${targetPath}`);
            this.renderUI();
        } catch (e: any) {
            new Notice(`Gagal membuat catatan: ${e.message}`);
        }
    }

    private renderFooter(container: HTMLElement, data: TriageResult): void {
        const footer = container.createEl('div', { cls: 'dep-inspector-footer' });
        const compareBtn = footer.createEl('button', {
            cls: 'dep-compare-submit-btn',
            text: '⚖️ Send Clean Data to Compare Hub'
        });
        compareBtn.onclick = () => {
            new Notice(`Mengirim ${data.hard.length + data.contextual.length} dependensi terverifikasi ke Compare Hub.`);
        };
    }
}
