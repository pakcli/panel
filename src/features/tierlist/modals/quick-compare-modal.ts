import { App, FuzzySuggestModal, FuzzyMatch, renderResults, Modal, TFile } from 'obsidian';
import { TierListItem, renderCompareView } from '../views/comparison-view';
import { resolveFrontmatterThumbnail } from '../utils/render-utils';
import { DEFAULT_SETTINGS } from '../settings';

export function fileToTierListItem(app: App, file: TFile): TierListItem {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    const image = resolveFrontmatterThumbnail(frontmatter) || '';
    const parentFolder = file.parent && file.parent.name ? file.parent.name : 'Vault';
    return {
        id: file.path,
        name: file.basename,
        tier: parentFolder,
        tierColor: 'var(--interactive-accent)',
        linkPath: file.path,
        rawText: file.basename,
        frontmatter,
        image
    };
}

export class CompareModal extends Modal {
    private items: TierListItem[];
    private overrideItems?: TierListItem[];
    private sourcePath: string;

    constructor(app: App, items: TierListItem[], overrideItems?: TierListItem[], sourcePath: string = '') {
        super(app);
        this.items = items;
        this.overrideItems = overrideItems;
        this.sourcePath = sourcePath;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass('tier-compare-modal-window');
        contentEl.addClass('tier-compare-modal-content');

        this.setTitle('⚖️ Compare Notes');

        const container = contentEl.createEl('div', { cls: 'tier-compare-modal-container' });
        renderCompareView(
            container,
            this.items,
            this.app,
            this.sourcePath,
            DEFAULT_SETTINGS,
            this.overrideItems
        );
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class FileCompareSelectModal extends FuzzySuggestModal<TFile> {
    private sourceFile: TFile;

    constructor(app: App, sourceFile: TFile) {
        super(app);
        this.sourceFile = sourceFile;
        this.setPlaceholder(`Compare "${sourceFile.basename}" with...`);
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles().filter((f) => f.path !== this.sourceFile.path);
    }

    getItemText(file: TFile): string {
        return `${file.basename} ${file.path}`;
    }

    renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
        el.empty();
        el.addClass('quick-compare-suggestion-item');

        const file = match.item;
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        const imgUrl = resolveFrontmatterThumbnail(frontmatter);

        // 1. Thumbnail / Icon preview
        const thumbContainer = el.createEl('div', { cls: 'quick-compare-thumb-container' });
        if (imgUrl) {
            const img = thumbContainer.createEl('img', { cls: 'quick-compare-thumb' });
            img.src = imgUrl;
        } else {
            const placeholder = thumbContainer.createEl('div', { cls: 'quick-compare-thumb-placeholder' });
            placeholder.setText('📄');
        }

        // 2. Item Name & Details
        const detailsContainer = el.createEl('div', { cls: 'quick-compare-details' });
        const nameEl = detailsContainer.createEl('div', { cls: 'quick-compare-name' });

        if (match.match) {
            renderResults(nameEl, file.basename, match.match);
        } else {
            nameEl.setText(file.basename);
        }

        const pathEl = detailsContainer.createEl('div', { cls: 'quick-compare-subpath' });
        pathEl.setText(file.parent?.path || '/');

        // 3. Folder badge
        if (file.parent && file.parent.name) {
            const folderBadge = el.createEl('div', { cls: 'quick-compare-tier-badge' });
            folderBadge.setText(file.parent.name);
            folderBadge.style.backgroundColor = 'var(--interactive-accent)';
        }
    }

    onChooseItem(targetFile: TFile, evt: MouseEvent | KeyboardEvent): void {
        const sourceItem = fileToTierListItem(this.app, this.sourceFile);
        const targetItem = fileToTierListItem(this.app, targetFile);

        new CompareModal(this.app, [sourceItem, targetItem], undefined, this.sourceFile.path).open();
    }
}

export class QuickCompareModal extends FuzzySuggestModal<TierListItem> {
    private sourceItem: TierListItem;
    private items: TierListItem[];
    private onChoose: (target: TierListItem) => void;

    constructor(
        app: App,
        sourceItem: TierListItem,
        allItems: TierListItem[],
        onChoose: (target: TierListItem) => void
    ) {
        super(app);
        this.sourceItem = sourceItem;
        // Filter out the source item and any direct duplicates
        this.items = allItems.filter(
            (item) => item.id !== sourceItem.id && item.name.toLowerCase() !== sourceItem.name.toLowerCase()
        );
        this.onChoose = onChoose;

        this.setPlaceholder(`Compare "${sourceItem.name}" with...`);
    }

    getItems(): TierListItem[] {
        return this.items;
    }

    getItemText(item: TierListItem): string {
        return `${item.name} ${item.tier}`;
    }

    renderSuggestion(match: FuzzyMatch<TierListItem>, el: HTMLElement): void {
        el.empty();
        el.addClass('quick-compare-suggestion-item');

        const item = match.item;

        // 1. Thumbnail / Icon preview
        const thumbContainer = el.createEl('div', { cls: 'quick-compare-thumb-container' });
        if (item.image) {
            const img = thumbContainer.createEl('img', { cls: 'quick-compare-thumb' });
            img.src = item.image;
        } else {
            const placeholder = thumbContainer.createEl('div', { cls: 'quick-compare-thumb-placeholder' });
            placeholder.setText('📄');
        }

        // 2. Item Name & Details
        const detailsContainer = el.createEl('div', { cls: 'quick-compare-details' });
        const nameEl = detailsContainer.createEl('div', { cls: 'quick-compare-name' });

        if (match.match) {
            renderResults(nameEl, item.name, match.match);
        } else {
            nameEl.setText(item.name);
        }

        // 3. Tier Tag / Badge
        const tierBadge = el.createEl('div', { cls: 'quick-compare-tier-badge' });
        tierBadge.setText(item.tier);
        if (item.tierColor) {
            tierBadge.style.backgroundColor = item.tierColor;
        }
    }

    onChooseItem(item: TierListItem, evt: MouseEvent | KeyboardEvent): void {
        this.onChoose(item);
    }
}
