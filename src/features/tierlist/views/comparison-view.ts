import { App, TFile, Notice } from 'obsidian';
import { TierListSettings } from '../settings';
import { resolveFrontmatterThumbnail } from '../utils/render-utils';
import Sortable from 'sortablejs';
import { computeVennSets, buildVennSVG, saveVennToFile, VennPage } from '../utils/venn-utils';

export interface TierListItem {
    id: string;
    name: string;
    tier: string;
    tierColor: string;
    linkPath?: string;
    rawText: string;
    frontmatter?: Record<string, any>;
    image?: string;
}

export function extractTierListItems(tierListEl: HTMLElement, app: App, sourcePath: string): TierListItem[] {
    const items: TierListItem[] = [];
    const tierRows = tierListEl.querySelectorAll<HTMLElement>(':scope > ul > li');

    tierRows.forEach((row) => {
        if (row.classList.contains('settings') || (row as any).hasClass?.('settings')) return;

        const tierHeader = row.querySelector<HTMLElement>('.tier-list-tier');
        const isUnordered = row.querySelector('ul.unordered') !== null;
        const tierName = isUnordered ? 'To Rank' : (tierHeader?.textContent?.trim() || 'Tier');
        const tierColor = tierHeader ? (tierHeader.style.backgroundColor || 'var(--interactive-accent)') : 'var(--text-muted)';

        const slots = row.querySelectorAll<HTMLElement>('ul > li');
        slots.forEach((slot, idx) => {
            const linkEl = slot.querySelector<HTMLAnchorElement>('a.internal-link, a');
            const imgEl = slot.querySelector<HTMLImageElement>('img');
            const titleEl = slot.querySelector<HTMLElement>('.tier-list-title, .tier-list-title-text, span');

            let rawText = '';
            if (linkEl) {
                rawText = linkEl.textContent?.trim() || linkEl.getAttribute('data-href') || linkEl.getAttribute('href') || '';
            } else if (titleEl) {
                rawText = titleEl.textContent?.trim() || '';
            } else if (imgEl) {
                rawText = imgEl.getAttribute('alt') || 'Item';
            } else {
                rawText = slot.textContent?.trim() || ('Item ' + (idx + 1));
            }

            rawText = rawText.replace(/^[!\[\]]+/g, '').replace(/[\]]+$/g, '').split('|')[0].trim();
            if (!rawText) return;

            const linkPath = linkEl ? (linkEl.getAttribute('data-href') || linkEl.getAttribute('href') || rawText) : rawText;

            let frontmatter: Record<string, any> | undefined = undefined;
            if (linkPath) {
                const cleanPath = linkPath.replace(/^[!\[\]]+/g, '').replace(/[\]]+$/g, '').split('|')[0].trim();
                const tfile = app.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath);
                if (tfile instanceof TFile) {
                    const cache = app.metadataCache.getFileCache(tfile);
                    frontmatter = cache?.frontmatter;
                }
            }

            const itemImage = resolveFrontmatterThumbnail(frontmatter) || (imgEl ? imgEl.getAttribute('src') || '' : '');

            items.push({
                id: tierName + '-' + idx + '-' + rawText,
                name: rawText,
                tier: tierName,
                tierColor,
                linkPath,
                rawText,
                frontmatter,
                image: itemImage
            });
        });
    });

    return items;
}

export function renderViewSwitcher(
    currentMode: string,
    onSelectMode: (mode: string) => void,
    onToggleSidebar?: () => void,
    options?: {
        showText?: boolean;
        onToggleText?: () => void;
        onOpenSettings?: () => void;
    }
): HTMLElement {
    const switcher = document.createElement('div');
    switcher.className = 'tier-view-switcher';

    // Left spacer to ensure center group stays truly centered
    switcher.createEl('div', { cls: 'switcher-left-spacer' });

    // Center Group: Middle-aligned 3 modes
    const centerGroup = switcher.createEl('div', { cls: 'switcher-center-group' });

    const modes = [
        { id: '0', label: '🏆 Tierlist', aliases: ['0', 'tier', 'tierlist'] },
        { id: '2', label: '⚖️ Compare', aliases: ['2', 'compare', 'different', 'versus', 'vs', 'couple'] },
        { id: '3', label: '📊 Tableview', aliases: ['3', 'tableview', 'table', 'matrix'] },
        { id: '4', label: '🌀 Venn', aliases: ['4', 'venn'] }
    ];

    modes.forEach((m) => {
        const cur = String(currentMode || '0').trim().toLowerCase();
        const isActive = m.aliases.includes(cur);
        const btn = centerGroup.createEl('button', {
            cls: 'tier-tab-btn' + (isActive ? ' active' : ''),
            text: m.label
        });
        btn.type = 'button';
        btn.setAttribute('data-mode', m.id);
        btn.addEventListener('click', () => {
            switcher.querySelectorAll('.tier-tab-btn[data-mode]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            onSelectMode(m.id);
        });
    });

    // Right Actions: Small icon-only buttons in the corner
    const rightActions = switcher.createEl('div', { cls: 'switcher-right-actions' });

    if (options?.onToggleText) {
        const textBtn = rightActions.createEl('button', {
            cls: 'tier-tab-icon-btn tier-tab-text-btn' + (options.showText ? ' active' : ''),
            text: '🔤'
        });
        textBtn.type = 'button';
        textBtn.title = 'Toggle card text labels on/off (Quartz 5 style)';
        textBtn.addEventListener('click', () => {
            options.onToggleText?.();
        });
    }

    if (onToggleSidebar) {
        const radarBtn = rightActions.createEl('button', {
            cls: 'tier-tab-icon-btn tier-tab-radar-btn',
            text: '🎯'
        });
        radarBtn.type = 'button';
        radarBtn.title = 'Open/Close Sidebar with Radar View & Sliders';
        radarBtn.addEventListener('click', () => {
            onToggleSidebar();
        });
    }

    if (options?.onOpenSettings) {
        const settingsBtn = rightActions.createEl('button', {
            cls: 'tier-tab-icon-btn tier-tab-settings-btn',
            text: '⚙️'
        });
        settingsBtn.type = 'button';
        settingsBtn.title = 'Open Tier List Settings';
        settingsBtn.addEventListener('click', () => {
            options.onOpenSettings?.();
        });
    }

    return switcher;
}

function toArray(val: any): string[] {
    if (!val) return [];
    if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
    if (typeof val === 'string') return val.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
    return [String(val).trim()];
}

function getDependencies(frontmatter?: Record<string, any>): string[] {
    if (!frontmatter) return [];
    return toArray(frontmatter.dependencies || frontmatter.dependency || frontmatter.deps || frontmatter.requires);
}

function getSpecs(frontmatter?: Record<string, any>): Record<string, string> {
    if (!frontmatter) return {};
    const specs: Record<string, string> = {};
    if (typeof frontmatter.specs === 'object' && !Array.isArray(frontmatter.specs)) {
        Object.entries(frontmatter.specs).forEach(([k, v]) => {
            specs[k] = String(v);
        });
    }
    const knownKeys = ['weight', 'dimensions', 'dimension', 'material', 'price', 'volume', 'capacity', 'resistance', 'max_load'];
    knownKeys.forEach((k) => {
        if (frontmatter[k] !== undefined && !specs[k]) {
            specs[k] = String(frontmatter[k]);
        }
    });
    return specs;
}

function getFunctions(frontmatter?: Record<string, any>): string[] {
    if (!frontmatter) return [];
    return toArray(frontmatter.functions || frontmatter.function || frontmatter.techniques || frontmatter.uses);
}

function getScore(frontmatter?: Record<string, any>): number | null {
    if (!frontmatter) return null;
    const scoreVal = frontmatter.score ?? frontmatter.rating ?? frontmatter.points;
    if (scoreVal !== undefined && scoreVal !== null) {
        const num = Number(scoreVal);
        if (!isNaN(num)) return num;
    }
    return null;
}

/**
 * Mode 2: Compare View with 3 Sub-views:
 * 1. 📄 Card (Current horizontal drag-scroll columns)
 * 2. 🌀 Diagram Venn (Interactive SVG Venn diagram with selectable zones)
 * 3. 📰 Multipage Split (Multi-page split cards in one tab)
 * + 💾 Save to File button in top bar
 */
export function renderCompareView(
    container: HTMLElement,
    items: TierListItem[],
    app: App,
    sourcePath: string,
    localSettings: TierListSettings,
    overrideItems?: TierListItem[],
    onBackToTier?: () => void,
    initialSubView: 'card' | 'venn' | 'multipage' = 'card'
) {
    container.empty();
    container.addClass('tier-compare-container');

    if (items.length < 2) {
        container.createEl('div', {
            text: 'Need at least 2 items to compare. Add more items to your tier list.',
            cls: 'tier-empty-notice'
        });
        return;
    }

    let selectedIndices: number[] = [];

    if (overrideItems && overrideItems.length >= 2) {
        overrideItems.forEach((target) => {
            let idx = items.findIndex(
                (it) => it.id === target.id || it.name.toLowerCase() === target.name.toLowerCase() || (it.linkPath && target.linkPath && it.linkPath === target.linkPath)
            );
            if (idx === -1) {
                items.push(target);
                idx = items.length - 1;
            }
            if (!selectedIndices.includes(idx)) selectedIndices.push(idx);
        });
    } else if (localSettings.compare || localSettings.versus) {
        const targets = (localSettings.compare || localSettings.versus)
            .split(/[,vs\+]/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
        targets.forEach((target) => {
            const idx = items.findIndex(
                (it) => it.name.toLowerCase().includes(target) || (it.linkPath && it.linkPath.toLowerCase().includes(target))
            );
            if (idx !== -1 && !selectedIndices.includes(idx)) selectedIndices.push(idx);
        });
    }

    if (selectedIndices.length < 2) {
        if (items.length <= 6) {
            selectedIndices = items.map((_, i) => i);
        } else {
            selectedIndices = [0, 1];
        }
    }

    // Sub-view State
    let currentSubView: 'card' | 'venn' | 'multipage' = initialSubView;

    // Venn Diagram State
    const activeVennPair = {
        leftIdx: selectedIndices[0] ?? 0,
        rightIdx: selectedIndices[1] ?? 1
    };
    let activeVennZone: 'all' | 'left' | 'center' | 'right' = 'all';

    // Multipage Split State
    let vennPages: VennPage[] = [];
    if (selectedIndices.length >= 2) {
        for (let i = 0; i < selectedIndices.length - 1; i++) {
            vennPages.push({ leftIdx: selectedIndices[i], rightIdx: selectedIndices[i + 1] });
        }
    } else {
        vennPages = [{ leftIdx: 0, rightIdx: 1 }];
    }

    // ─────────────────────────────────────────────────────────────
    // Top Bar (Controls, View Switcher Dropdown/Tabs, Save to File)
    // ─────────────────────────────────────────────────────────────
    const topBar = container.createEl('div', { cls: 'compare-top-bar' });
    const topBarLeft = topBar.createEl('div', { cls: 'compare-top-left' });
    const topBarRight = topBar.createEl('div', { cls: 'compare-top-right' });

    if (onBackToTier) {
        const backBtn = topBarLeft.createEl('button', {
            cls: 'compare-back-btn',
            text: '← Back to Tier Board'
        });
        backBtn.type = 'button';
        backBtn.addEventListener('click', () => {
            onBackToTier();
        });
    }

    topBarLeft.createEl('span', { text: 'Comparing Items:', cls: 'compare-bar-label' });

    const addSelector = topBarLeft.createEl('select', { cls: 'compare-add-select' });

    function refreshAddSelect() {
        addSelector.empty();
        const placeholder = addSelector.createEl('option', { text: '+ Add another item to compare...' });
        placeholder.value = '';

        items.forEach((it, idx) => {
            if (!selectedIndices.includes(idx)) {
                const opt = addSelector.createEl('option', { text: '[' + it.tier + '] ' + it.name });
                opt.value = String(idx);
            }
        });
    }

    addSelector.addEventListener('change', () => {
        const val = addSelector.value;
        if (val !== '') {
            const idx = parseInt(val, 10);
            if (!selectedIndices.includes(idx)) {
                selectedIndices.push(idx);
                if (currentSubView === 'card') {
                    renderCardColumns();
                } else if (currentSubView === 'venn') {
                    activeVennPair.rightIdx = idx;
                    renderVennSubView();
                } else {
                    const last = selectedIndices[selectedIndices.length - 2];
                    vennPages.push({ leftIdx: last, rightIdx: idx });
                    renderMultipageSubView();
                }
                refreshAddSelect();
            }
        }
    });

    // ── View Switcher in Top Bar Right ──
    const switcherWrap = topBarRight.createEl('div', { cls: 'compare-view-switcher-wrap' });

    // Dropdown Select for switching sub-views
    const subviewDropdown = switcherWrap.createEl('select', { cls: 'compare-subview-dropdown' });
    const optCard = subviewDropdown.createEl('option', { text: '📄 Card (Current)' });
    optCard.value = 'card';
    const optVenn = subviewDropdown.createEl('option', { text: '🌀 Diagram Venn' });
    optVenn.value = 'venn';
    const optSplit = subviewDropdown.createEl('option', { text: '📰 Multipage Split' });
    optSplit.value = 'multipage';
    subviewDropdown.value = currentSubView;

    subviewDropdown.addEventListener('change', () => {
        switchSubView(subviewDropdown.value as 'card' | 'venn' | 'multipage');
    });

    // Segmented tab buttons for quick toggle
    const tabsWrap = switcherWrap.createEl('div', { cls: 'compare-subview-tabs' });
    const subviewModes = [
        { id: 'card', label: '📄 Card' },
        { id: 'venn', label: '🌀 Diagram Venn' },
        { id: 'multipage', label: '📰 Multipage Split' }
    ];

    subviewModes.forEach((m) => {
        const tabBtn = tabsWrap.createEl('button', {
            cls: 'compare-subview-tab-btn' + (currentSubView === m.id ? ' active' : ''),
            text: m.label
        });
        tabBtn.type = 'button';
        tabBtn.setAttribute('data-subview', m.id);
        tabBtn.addEventListener('click', () => {
            switchSubView(m.id as 'card' | 'venn' | 'multipage');
        });
    });

    // ── Save to File Button in Top Bar Right ──
    const saveBtn = topBarRight.createEl('button', {
        cls: 'compare-save-file-btn',
        text: '💾 Save to File'
    });
    saveBtn.type = 'button';
    saveBtn.title = 'Save comparison note to vault with YAML frontmatter';
    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.setText('⏳ Saving...');
        try {
            let pagesToSave: VennPage[] = [];
            if (currentSubView === 'venn') {
                pagesToSave = [{ leftIdx: activeVennPair.leftIdx, rightIdx: activeVennPair.rightIdx }];
            } else if (currentSubView === 'multipage') {
                pagesToSave = [...vennPages];
            } else {
                for (let i = 0; i < selectedIndices.length - 1; i++) {
                    pagesToSave.push({ leftIdx: selectedIndices[i], rightIdx: selectedIndices[i + 1] });
                }
                if (pagesToSave.length === 0 && selectedIndices.length >= 2) {
                    pagesToSave.push({ leftIdx: selectedIndices[0], rightIdx: selectedIndices[1] });
                }
            }
            await saveVennToFile(app, pagesToSave, items, sourcePath);
        } catch (e) {
            console.error('Save failed:', e);
            new Notice('❌ Failed to save comparison: ' + String(e));
        } finally {
            saveBtn.disabled = false;
            saveBtn.setText('💾 Save to File');
        }
    });

    // ─────────────────────────────────────────────────────────────
    // Sub-view Containers
    // ─────────────────────────────────────────────────────────────
    const cardViewEl = container.createEl('div', { cls: 'compare-subview-container compare-card-view-container' });
    const vennViewEl = container.createEl('div', { cls: 'compare-subview-container compare-venn-view-container' });
    const multipageViewEl = container.createEl('div', { cls: 'compare-subview-container compare-multipage-view-container' });

    function switchSubView(mode: 'card' | 'venn' | 'multipage') {
        currentSubView = mode;
        subviewDropdown.value = mode;
        tabsWrap.querySelectorAll('.compare-subview-tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-subview') === mode);
        });

        if (mode === 'card') {
            cardViewEl.style.display = 'block';
            vennViewEl.style.display = 'none';
            multipageViewEl.style.display = 'none';
            renderCardColumns();
        } else if (mode === 'venn') {
            cardViewEl.style.display = 'none';
            vennViewEl.style.display = 'block';
            multipageViewEl.style.display = 'none';
            renderVennSubView();
        } else {
            cardViewEl.style.display = 'none';
            vennViewEl.style.display = 'none';
            multipageViewEl.style.display = 'block';
            renderMultipageSubView();
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Sub-View 1: 📄 Card (Current Multi-column Drag-Scrollable)
    // ─────────────────────────────────────────────────────────────
    const scrollContainer = cardViewEl.createEl('div', { cls: 'compare-cards-scrollable compare-scroll-wrapper' });
    let sortableInstance: Sortable | null = null;
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    scrollContainer.addEventListener('mousedown', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, select, a, input, .compare-drag-handle, .card-top-row')) return;
        isDown = true;
        scrollContainer.addClass('is-dragging');
        startX = e.pageX - scrollContainer.offsetLeft;
        scrollLeft = scrollContainer.scrollLeft;
    });

    scrollContainer.addEventListener('mouseleave', () => {
        isDown = false;
        scrollContainer.removeClass('is-dragging');
    });

    scrollContainer.addEventListener('mouseup', () => {
        isDown = false;
        scrollContainer.removeClass('is-dragging');
    });

    scrollContainer.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - scrollContainer.offsetLeft;
        const walk = (x - startX) * 1.5;
        scrollContainer.scrollLeft = scrollLeft - walk;
    });

    function renderCardColumns() {
        if (sortableInstance) {
            sortableInstance.destroy();
            sortableInstance = null;
        }

        scrollContainer.empty();

        const comparedList = selectedIndices.map((i) => items[i]).filter(Boolean);

        const depFrequency: Record<string, number> = {};
        comparedList.forEach((it) => {
            const deps = getDependencies(it.frontmatter);
            deps.forEach((d) => {
                depFrequency[d] = (depFrequency[d] || 0) + 1;
            });
        });

        comparedList.forEach((item, colIdx) => {
            const card = scrollContainer.createEl('div', { cls: 'compare-item-card' });
            card.setAttribute('data-col-idx', String(colIdx));

            const cardHeader = card.createEl('div', { cls: 'compare-card-header' });

            const topRow = cardHeader.createEl('div', { cls: 'card-top-row' });
            const leftGroup = topRow.createEl('div', { cls: 'compare-header-left' });

            const dragHandle = leftGroup.createEl('span', {
                text: '⠿',
                cls: 'compare-drag-handle',
                attr: { title: 'Drag column to reorder' }
            });

            const tierBadge = leftGroup.createEl('span', {
                text: item.tier,
                cls: 'compare-tier-badge',
                attr: { style: 'background: ' + (item.tierColor || 'var(--interactive-accent)') }
            });

            const title = cardHeader.createEl('h3', { text: item.name, cls: 'compare-card-title' });
            title.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.linkPath) app.workspace.openLinkText(item.linkPath, sourcePath, false);
            });

            if (comparedList.length > 2) {
                const removeBtn = topRow.createEl('button', {
                    text: '✕',
                    cls: 'compare-remove-col-btn'
                });
                removeBtn.title = 'Remove this item from compare';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectedIndices.splice(colIdx, 1);
                    renderCardColumns();
                    refreshAddSelect();
                });
            }

            const imageSrc = item.image || resolveFrontmatterThumbnail(item.frontmatter);
            if (imageSrc) {
                const imgWrap = card.createEl('div', { cls: 'compare-card-img-wrap' });
                imgWrap.createEl('img', {
                    attr: { src: imageSrc, alt: item.name, draggable: 'false' },
                    cls: 'compare-card-img'
                });
            }

            const score = getScore(item.frontmatter);
            if (score !== null) {
                const scoreBox = card.createEl('div', { cls: 'compare-score-box' });
                scoreBox.createEl('div', { text: 'Score: ' + score + '/100', cls: 'compare-score-text' });
                const meter = scoreBox.createEl('div', { cls: 'compare-meter' });
                meter.createEl('div', {
                    cls: 'compare-meter-fill',
                    attr: { style: 'width: ' + Math.min(100, Math.max(0, score)) + '%' }
                });
            }

            const deps = getDependencies(item.frontmatter);
            const depSection = card.createEl('div', { cls: 'card-section' });
            depSection.createEl('div', { text: '🔗 Dependencies & Accessories', cls: 'card-section-title' });

            if (deps.length > 0) {
                const chipsWrap = depSection.createEl('div', { cls: 'compare-chips-wrap' });
                deps.forEach((dep) => {
                    const freq = depFrequency[dep] || 1;
                    let chipClass = 'chip-unique';
                    let chipLabel = '★ ' + dep;
                    if (freq === comparedList.length && comparedList.length > 1) {
                        chipClass = 'chip-shared-all';
                        chipLabel = '✓ ' + dep;
                    } else if (freq > 1) {
                        chipClass = 'chip-shared-some';
                        chipLabel = '≈ ' + dep;
                    }
                    chipsWrap.createEl('span', {
                        text: chipLabel,
                        cls: 'chip ' + chipClass
                    });
                });
            } else {
                depSection.createEl('div', { text: 'No dependencies listed', cls: 'chip-muted' });
            }

            const specs = getSpecs(item.frontmatter);
            const specEntries = Object.entries(specs);
            if (specEntries.length > 0) {
                const specSection = card.createEl('div', { cls: 'card-section' });
                specSection.createEl('div', { text: '⚙️ Specifications', cls: 'card-section-title' });
                const specTable = specSection.createEl('div', { cls: 'compare-specs-table' });
                specEntries.forEach(([k, v]) => {
                    const row = specTable.createEl('div', { cls: 'compare-spec-row' });
                    row.createEl('span', { text: k + ':', cls: 'spec-label' });
                    row.createEl('span', { text: v, cls: 'spec-val' });
                });
            }

            const funcs = getFunctions(item.frontmatter);
            if (funcs.length > 0) {
                const funcSection = card.createEl('div', { cls: 'card-section' });
                funcSection.createEl('div', { text: '⚡ Functions & Techniques', cls: 'card-section-title' });
                const funcList = funcSection.createEl('ul', { cls: 'compare-func-list' });
                funcs.forEach((f) => funcList.createEl('li', { text: f }));
            }
        });

        const addCard = scrollContainer.createEl('div', { cls: 'compare-add-card' });
        const addCardBtn = addCard.createEl('div', { cls: 'add-card-inner' });
        addCardBtn.createEl('div', { text: '+', cls: 'add-plus-icon' });
        addCardBtn.createEl('div', { text: 'Add Column', cls: 'add-card-label' });
        addCard.addEventListener('click', () => {
            const nextIdx = items.findIndex((_, i) => !selectedIndices.includes(i));
            if (nextIdx !== -1) {
                selectedIndices.push(nextIdx);
                renderCardColumns();
                refreshAddSelect();
            }
        });

        sortableInstance = Sortable.create(scrollContainer, {
            draggable: '.compare-item-card',
            handle: '.compare-drag-handle, .compare-card-header, .card-top-row',
            filter: '.compare-remove-col-btn, .compare-card-title, a, button, input, select, .compare-add-card',
            preventOnFilter: false,
            animation: 200,
            direction: 'horizontal',
            ghostClass: 'compare-card-ghost',
            chosenClass: 'compare-card-chosen',
            dragClass: 'compare-card-dragging',
            onEnd: (evt) => {
                if (evt.oldIndex !== undefined && evt.newIndex !== undefined && evt.oldIndex !== evt.newIndex) {
                    const moved = selectedIndices.splice(evt.oldIndex, 1)[0];
                    selectedIndices.splice(evt.newIndex, 0, moved);
                    setTimeout(() => {
                        renderCardColumns();
                        refreshAddSelect();
                    }, 10);
                }
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Sub-View 2: 🌀 Diagram Venn (Interactive SVG with Selectable Zones)
    // ─────────────────────────────────────────────────────────────
    function renderVennSubView() {
        vennViewEl.empty();

        const itemA = items[activeVennPair.leftIdx] || items[0];
        const itemB = items[activeVennPair.rightIdx] || items[1] || items[0];
        if (!itemA || !itemB) return;

        const { onlyA, shared, onlyB } = computeVennSets(itemA, itemB);

        // Control header: Item A selector vs Item B selector + Swap
        const controls = vennViewEl.createEl('div', { cls: 'venn-subview-controls' });

        const leftSelect = controls.createEl('select', { cls: 'venn-item-select' });
        items.forEach((it, idx) => {
            const opt = leftSelect.createEl('option', { text: '[' + it.tier + '] ' + it.name });
            opt.value = String(idx);
        });
        leftSelect.value = String(activeVennPair.leftIdx);
        leftSelect.addEventListener('change', () => {
            activeVennPair.leftIdx = parseInt(leftSelect.value, 10);
            renderVennSubView();
        });

        const swapBtn = controls.createEl('button', { cls: 'venn-swap-btn', text: '⇄ Swap' });
        swapBtn.type = 'button';
        swapBtn.title = 'Swap items';
        swapBtn.addEventListener('click', () => {
            const temp = activeVennPair.leftIdx;
            activeVennPair.leftIdx = activeVennPair.rightIdx;
            activeVennPair.rightIdx = temp;
            renderVennSubView();
        });

        const rightSelect = controls.createEl('select', { cls: 'venn-item-select' });
        items.forEach((it, idx) => {
            const opt = rightSelect.createEl('option', { text: '[' + it.tier + '] ' + it.name });
            opt.value = String(idx);
        });
        rightSelect.value = String(activeVennPair.rightIdx);
        rightSelect.addEventListener('change', () => {
            activeVennPair.rightIdx = parseInt(rightSelect.value, 10);
            renderVennSubView();
        });

        // Interactive SVG Diagram Box
        const svgBox = vennViewEl.createEl('div', { cls: 'venn-svg-container' });
        svgBox.innerHTML = buildVennSVG({
            width: 520,
            height: 220,
            labelA: itemA.name,
            labelB: itemB.name,
            onlyACount: onlyA.length,
            sharedCount: shared.length,
            onlyBCount: onlyB.length,
            highlightLeft: activeVennZone === 'left',
            highlightCenter: activeVennZone === 'center',
            highlightRight: activeVennZone === 'right'
        });

        // Zone Click Listeners
        const svgEl = svgBox.querySelector('svg');
        if (svgEl) {
            const leftZone = svgEl.querySelector('.venn-zone-left');
            const centerZone = svgEl.querySelector('.venn-zone-center');
            const rightZone = svgEl.querySelector('.venn-zone-right');

            leftZone?.addEventListener('click', () => {
                activeVennZone = activeVennZone === 'left' ? 'all' : 'left';
                renderVennSubView();
            });
            centerZone?.addEventListener('click', () => {
                activeVennZone = activeVennZone === 'center' ? 'all' : 'center';
                renderVennSubView();
            });
            rightZone?.addEventListener('click', () => {
                activeVennZone = activeVennZone === 'right' ? 'all' : 'right';
                renderVennSubView();
            });
        }

        // Zone Filter Chips
        const chipsBar = vennViewEl.createEl('div', { cls: 'venn-filter-chips-bar' });

        const chipA = chipsBar.createEl('button', {
            cls: 'venn-filter-chip chip-left' + (activeVennZone === 'left' ? ' active' : ''),
            text: `🟣 Only ${itemA.name} (${onlyA.length})`
        });
        chipA.addEventListener('click', () => {
            activeVennZone = activeVennZone === 'left' ? 'all' : 'left';
            renderVennSubView();
        });

        const chipShared = chipsBar.createEl('button', {
            cls: 'venn-filter-chip chip-center' + (activeVennZone === 'center' ? ' active' : ''),
            text: `🔵 Shared (${shared.length})`
        });
        chipShared.addEventListener('click', () => {
            activeVennZone = activeVennZone === 'center' ? 'all' : 'center';
            renderVennSubView();
        });

        const chipB = chipsBar.createEl('button', {
            cls: 'venn-filter-chip chip-right' + (activeVennZone === 'right' ? ' active' : ''),
            text: `🌸 Only ${itemB.name} (${onlyB.length})`
        });
        chipB.addEventListener('click', () => {
            activeVennZone = activeVennZone === 'right' ? 'all' : 'right';
            renderVennSubView();
        });

        const chipAll = chipsBar.createEl('button', {
            cls: 'venn-filter-chip chip-all' + (activeVennZone === 'all' ? ' active' : ''),
            text: `👁️ Show All`
        });
        chipAll.addEventListener('click', () => {
            activeVennZone = 'all';
            renderVennSubView();
        });

        // Detail Panel
        const detailPanel = vennViewEl.createEl('div', { cls: 'venn-detail-panel' });

        function renderZoneSection(title: string, list: string[], zoneCls: string, linkPath?: string) {
            const sec = detailPanel.createEl('div', { cls: 'venn-zone-section ' + zoneCls });
            const secHeader = sec.createEl('div', { cls: 'venn-section-title' });
            secHeader.createEl('span', { text: title });
            secHeader.createEl('span', { cls: 'venn-section-count', text: `${list.length} item(s)` });

            if (list.length === 0) {
                sec.createEl('div', { cls: 'venn-empty-list', text: 'No unique or shared attributes found.' });
            } else {
                const listEl = sec.createEl('div', { cls: 'venn-pills-wrap' });
                list.forEach((attr) => {
                    const pill = listEl.createEl('span', { cls: 'venn-attr-pill ' + zoneCls, text: attr });
                    pill.addEventListener('click', () => {
                        app.workspace.openLinkText(attr, sourcePath, false);
                    });
                });
            }
        }

        if (activeVennZone === 'all' || activeVennZone === 'left') {
            renderZoneSection(`Only in [[${itemA.name}]]`, onlyA, 'zone-left', itemA.linkPath);
        }
        if (activeVennZone === 'all' || activeVennZone === 'center') {
            renderZoneSection(`Shared Attributes`, shared, 'zone-center');
        }
        if (activeVennZone === 'all' || activeVennZone === 'right') {
            renderZoneSection(`Only in [[${itemB.name}]]`, onlyB, 'zone-right', itemB.linkPath);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Sub-View 3: 📰 Multipage Split (Grid of Pairs in 1 Tab)
    // ─────────────────────────────────────────────────────────────
    function renderMultipageSubView() {
        multipageViewEl.empty();

        const topActions = multipageViewEl.createEl('div', { cls: 'multipage-top-actions' });
        topActions.createEl('h4', { text: `📰 Split Comparison Pages (${vennPages.length})`, cls: 'multipage-title' });

        const addPageBtn = topActions.createEl('button', {
            cls: 'multipage-add-btn',
            text: '+ Add Comparison Page'
        });
        addPageBtn.type = 'button';
        addPageBtn.addEventListener('click', () => {
            let l = 0;
            let r = 1;
            if (items.length >= 2) {
                const last = vennPages[vennPages.length - 1];
                if (last) {
                    l = last.rightIdx % items.length;
                    r = (last.rightIdx + 1) % items.length;
                    if (l === r) r = (r + 1) % items.length;
                }
            }
            vennPages.push({ leftIdx: l, rightIdx: r });
            renderMultipageSubView();
        });

        const grid = multipageViewEl.createEl('div', { cls: 'compare-multipage-grid' });

        vennPages.forEach((page, pIdx) => {
            const card = grid.createEl('div', { cls: 'multipage-page-card' });

            const cardHeader = card.createEl('div', { cls: 'multipage-card-header' });

            const selA = cardHeader.createEl('select', { cls: 'multipage-select' });
            items.forEach((it, idx) => {
                const opt = selA.createEl('option', { text: it.name });
                opt.value = String(idx);
            });
            selA.value = String(page.leftIdx);
            selA.addEventListener('change', () => {
                page.leftIdx = parseInt(selA.value, 10);
                renderMultipageSubView();
            });

            cardHeader.createEl('span', { text: 'vs', cls: 'multipage-vs-label' });

            const selB = cardHeader.createEl('select', { cls: 'multipage-select' });
            items.forEach((it, idx) => {
                const opt = selB.createEl('option', { text: it.name });
                opt.value = String(idx);
            });
            selB.value = String(page.rightIdx);
            selB.addEventListener('change', () => {
                page.rightIdx = parseInt(selB.value, 10);
                renderMultipageSubView();
            });

            if (vennPages.length > 1) {
                const delBtn = cardHeader.createEl('button', { cls: 'multipage-remove-btn', text: '✕' });
                delBtn.title = 'Remove this comparison page';
                delBtn.addEventListener('click', () => {
                    vennPages.splice(pIdx, 1);
                    renderMultipageSubView();
                });
            }

            const itA = items[page.leftIdx];
            const itB = items[page.rightIdx];
            if (!itA || !itB) return;

            const { onlyA, shared, onlyB } = computeVennSets(itA, itB);

            // Mini Venn SVG Preview
            const miniSvgWrap = card.createEl('div', { cls: 'multipage-mini-svg' });
            miniSvgWrap.innerHTML = buildVennSVG({
                width: 300,
                height: 120,
                labelA: itA.name,
                labelB: itB.name,
                onlyACount: onlyA.length,
                sharedCount: shared.length,
                onlyBCount: onlyB.length
            });

            // 3-Way Split Breakdown
            const splitRow = card.createEl('div', { cls: 'multipage-split-row' });

            const colA = splitRow.createEl('div', { cls: 'multipage-col col-left' });
            colA.createEl('div', { cls: 'multipage-col-header', text: `Only ${itA.name} (${onlyA.length})` });
            if (onlyA.length) {
                onlyA.slice(0, 4).forEach((a) => colA.createEl('div', { cls: 'multipage-attr-item', text: '• ' + a }));
                if (onlyA.length > 4) colA.createEl('div', { cls: 'multipage-attr-more', text: `+${onlyA.length - 4} more` });
            } else {
                colA.createEl('div', { cls: 'multipage-attr-empty', text: '—' });
            }

            const colShared = splitRow.createEl('div', { cls: 'multipage-col col-center' });
            colShared.createEl('div', { cls: 'multipage-col-header', text: `Shared (${shared.length})` });
            if (shared.length) {
                shared.slice(0, 4).forEach((s) => colShared.createEl('div', { cls: 'multipage-attr-item', text: '• ' + s }));
                if (shared.length > 4) colShared.createEl('div', { cls: 'multipage-attr-more', text: `+${shared.length - 4} more` });
            } else {
                colShared.createEl('div', { cls: 'multipage-attr-empty', text: '—' });
            }

            const colB = splitRow.createEl('div', { cls: 'multipage-col col-right' });
            colB.createEl('div', { cls: 'multipage-col-header', text: `Only ${itB.name} (${onlyB.length})` });
            if (onlyB.length) {
                onlyB.slice(0, 4).forEach((b) => colB.createEl('div', { cls: 'multipage-attr-item', text: '• ' + b }));
                if (onlyB.length > 4) colB.createEl('div', { cls: 'multipage-attr-more', text: `+${onlyB.length - 4} more` });
            } else {
                colB.createEl('div', { cls: 'multipage-attr-empty', text: '—' });
            }

            // Footer Note Links
            const foot = card.createEl('div', { cls: 'multipage-card-footer' });
            const linkA = foot.createEl('a', { text: `Open ${itA.name} ↗`, cls: 'multipage-open-link' });
            linkA.addEventListener('click', () => {
                if (itA.linkPath) app.workspace.openLinkText(itA.linkPath, sourcePath, false);
            });
            const linkB = foot.createEl('a', { text: `Open ${itB.name} ↗`, cls: 'multipage-open-link' });
            linkB.addEventListener('click', () => {
                if (itB.linkPath) app.workspace.openLinkText(itB.linkPath, sourcePath, false);
            });
        });
    }

    refreshAddSelect();
    switchSubView(currentSubView);
}

export const renderVersusView = renderCompareView;

export function renderVennView(
    container: HTMLElement,
    items: TierListItem[],
    app: App,
    sourcePath: string,
    localSettings: TierListSettings,
    overrideItems?: TierListItem[],
    onBackToTier?: () => void
) {
    return renderCompareView(container, items, app, sourcePath, localSettings, overrideItems, onBackToTier, 'venn');
}

/**
 * Mode 3: Table View
 */
export function renderTableView(
    container: HTMLElement,
    items: TierListItem[],
    app: App,
    sourcePath: string,
    localSettings: TierListSettings
) {
    container.empty();
    container.addClass('tier-tableview-container');

    if (items.length === 0) {
        container.createEl('div', { text: 'No items available in this tier list.', cls: 'tier-empty-notice' });
        return;
    }

    const filterBar = container.createEl('div', { cls: 'tableview-filter-bar' });
    const searchInput = filterBar.createEl('input', {
        type: 'text',
        placeholder: '🔍 Filter items, tiers, or dependencies...',
        cls: 'tableview-search-input'
    });

    const countBadge = filterBar.createEl('span', {
        text: 'Showing ' + items.length + ' items',
        cls: 'tableview-count-badge'
    });

    const tableWrapper = container.createEl('div', { cls: 'tableview-table-wrapper' });
    const table = tableWrapper.createEl('table', { cls: 'tier-tableview-table' });

    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    headRow.createEl('th', { text: 'Tier', cls: 'col-tier' });
    headRow.createEl('th', { text: 'Item Name', cls: 'col-name' });
    headRow.createEl('th', { text: 'Score', cls: 'col-score' });
    headRow.createEl('th', { text: 'Dependencies', cls: 'col-deps' });
    headRow.createEl('th', { text: 'Specs & Functions', cls: 'col-specs' });
    headRow.createEl('th', { text: 'Action', cls: 'col-action' });

    const tbody = table.createEl('tbody');

    function renderRows(filteredItems: TierListItem[]) {
        tbody.empty();
        countBadge.textContent = 'Showing ' + filteredItems.length + ' of ' + items.length + ' items';

        filteredItems.forEach((item) => {
            const tr = tbody.createEl('tr', { cls: 'tableview-row' });

            const tdTier = tr.createEl('td', { cls: 'tableview-td-tier' });
            tdTier.createEl('span', {
                text: item.tier,
                cls: 'tableview-tier-badge',
                attr: { style: 'background: ' + (item.tierColor || 'var(--interactive-accent)') }
            });

            const tdName = tr.createEl('td', { cls: 'tableview-td-name' });
            const link = tdName.createEl('a', {
                text: item.name,
                cls: 'internal-link tableview-item-link'
            });
            link.addEventListener('click', () => {
                if (item.linkPath) app.workspace.openLinkText(item.linkPath, sourcePath, false);
            });

            const tdScore = tr.createEl('td', { cls: 'tableview-td-score' });
            const score = getScore(item.frontmatter);
            if (score !== null) {
                tdScore.createEl('span', { text: String(score), cls: 'tableview-score-num' });
                const meter = tdScore.createEl('div', { cls: 'tableview-score-bar' });
                meter.createEl('div', {
                    cls: 'tableview-score-bar-fill',
                    attr: { style: 'width: ' + Math.min(100, Math.max(0, score)) + '%' }
                });
            } else {
                tdScore.createEl('span', { text: '—', cls: 'tableview-score-empty' });
            }

            const tdDeps = tr.createEl('td', { cls: 'tableview-td-deps' });
            const deps = getDependencies(item.frontmatter);
            if (deps.length > 0) {
                const chips = tdDeps.createEl('div', { cls: 'tableview-chips-wrap' });
                deps.forEach((d) => chips.createEl('span', { text: d, cls: 'chip chip-dep' }));
            } else {
                tdDeps.createEl('span', { text: '—', cls: 'chip-muted' });
            }

            const tdSpecs = tr.createEl('td', { cls: 'tableview-td-specs' });
            const specs = getSpecs(item.frontmatter);
            const funcs = getFunctions(item.frontmatter);
            const specEntries = Object.entries(specs);

            if (specEntries.length > 0 || funcs.length > 0) {
                const summaryWrap = tdSpecs.createEl('div', { cls: 'tableview-specs-summary' });
                specEntries.slice(0, 3).forEach(([k, v]) => {
                    summaryWrap.createEl('div', {
                        text: k + ': ' + v,
                        cls: 'tableview-spec-pill'
                    });
                });
                if (funcs.length > 0) {
                    funcs.slice(0, 2).forEach((f) => {
                        summaryWrap.createEl('div', {
                            text: '⚡ ' + f,
                            cls: 'tableview-func-pill'
                        });
                    });
                }
            } else {
                tdSpecs.createEl('span', { text: '—', cls: 'chip-muted' });
            }

            const tdAction = tr.createEl('td', { cls: 'tableview-td-action' });
            const openBtn = tdAction.createEl('button', { text: 'Open ↗', cls: 'tableview-open-btn' });
            openBtn.addEventListener('click', () => {
                if (item.linkPath) app.workspace.openLinkText(item.linkPath, sourcePath, false);
            });
        });
    }

    searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) {
            renderRows(items);
            return;
        }
        const filtered = items.filter((item) => {
            if (item.name.toLowerCase().includes(q)) return true;
            if (item.tier.toLowerCase().includes(q)) return true;
            const deps = getDependencies(item.frontmatter);
            if (deps.some((d) => d.toLowerCase().includes(q))) return true;
            const funcs = getFunctions(item.frontmatter);
            if (funcs.some((f) => f.toLowerCase().includes(q))) return true;
            return false;
        });
        renderRows(filtered);
    });

    renderRows(items);
}

export const renderMatrixView = renderTableView;
