import { App, TFile, Notice } from 'obsidian';
import { TierListItem } from './comparison-view';
import { resolveFrontmatterThumbnail } from '../utils/render-utils';

export interface RadarItem {
    slug: string;
    name: string;
    image: string;
    tier: string;
    axes: Record<string, number>;
    linkPath?: string;
    tfile?: TFile;
    rawText?: string;
    body?: string;
}

export interface BoardConfig {
    axes: string[];
}

export const GRAPH_COLORS = [
    '#06b6d4', // Cyan
    '#f59e0b', // Amber
    '#ec4899', // Rose
    '#10b981', // Emerald
    '#6366f1', // Indigo
    '#8b5cf6', // Purple
    '#f97316', // Orange
    '#14b8a6', // Teal
    '#3b82f6', // Blue
    '#e11d48'  // Crimson
];

export type SidebarDock = 'EMBED' | 'RIGHT' | 'DEFAULT' | 'TL' | 'TR' | 'BL' | 'CENTER';

/**
 * Extract radar items and determine board axes from TierListItem array
 */
export function extractRadarItems(
    rawItems: TierListItem[],
    app: App,
    sourcePath: string
): { items: RadarItem[]; boardConfig: BoardConfig } {
    const discoveredAxes = new Set<string>();

    const items: RadarItem[] = rawItems.map((ri) => {
        const slug = (ri.linkPath || ri.name || ri.id)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        let image = '';
        const axes: Record<string, number> = {};
        let tfile: TFile | undefined;

        if (ri.linkPath) {
            const clean = ri.linkPath.replace(/^[!\[\]]+/g, '').replace(/[\]]+$/g, '').split('|')[0].trim();
            const f = app.metadataCache.getFirstLinkpathDest(clean, sourcePath);
            if (f instanceof TFile) {
                tfile = f;
                const cache = app.metadataCache.getFileCache(f);
                if (cache && cache.frontmatter) {
                    const fm = cache.frontmatter;
                    const resolvedImg = resolveFrontmatterThumbnail(fm);
                    if (resolvedImg) image = resolvedImg;

                    // Check explicit axes object
                    if (fm.axes && typeof fm.axes === 'object') {
                        Object.entries(fm.axes).forEach(([k, v]) => {
                            if (typeof v === 'number') {
                                axes[k.toLowerCase()] = v;
                                discoveredAxes.add(k.toLowerCase());
                            }
                        });
                    }

                    // Check top-level numeric properties (excluding non-metric metadata)
                    const ignored = new Set(['position', 'line', 'score', 'width', 'height', 'slots']);
                    Object.entries(fm).forEach(([k, v]) => {
                        const lk = k.toLowerCase();
                        if (!ignored.has(lk) && typeof v === 'number') {
                            axes[lk] = v;
                            discoveredAxes.add(lk);
                        }
                    });
                }
            }
        }

        return {
            slug,
            name: ri.name,
            image,
            tier: ri.tier,
            axes,
            linkPath: ri.linkPath,
            tfile,
            rawText: ri.rawText
        };
    });

    let axesList = Array.from(discoveredAxes);
    if (axesList.length < 3) {
        const defaultAxes = ['price', 'durability', 'versatility', 'aesthetic'];
        defaultAxes.forEach((a) => {
            if (!axesList.includes(a)) axesList.push(a);
        });
    }

    // Ensure all items have numbers for configured axes (defaulting to 5 if unassigned)
    items.forEach((it) => {
        axesList.forEach((ax) => {
            if (it.axes[ax] === undefined) {
                it.axes[ax] = 5;
            }
        });
    });

    return {
        items,
        boardConfig: { axes: axesList }
    };
}

/**
 * Compute axis ranges relative to all items on board
 */
export function getAxesRanges(
    itemsList: RadarItem[],
    boardConfig: BoardConfig,
    temporaryItem?: RadarItem | null
): Record<string, { min: number; max: number; isSingle: boolean }> {
    const ranges: Record<string, { min: number; max: number; isSingle: boolean }> = {};

    boardConfig.axes.forEach((axis) => {
        const allValues: number[] = [];

        itemsList.forEach((item) => {
            if (temporaryItem && item.slug === temporaryItem.slug) {
                allValues.push(temporaryItem.axes[axis] ?? 5);
            } else if (item.axes[axis] !== undefined) {
                allValues.push(item.axes[axis]);
            }
        });

        if (temporaryItem && !itemsList.some((i) => i.slug === temporaryItem.slug)) {
            allValues.push(temporaryItem.axes[axis] ?? 5);
        }

        if (allValues.length === 0) {
            ranges[axis] = { min: 0, max: 10, isSingle: false };
            return;
        }

        const min = Math.min(...allValues);
        const max = Math.max(...allValues);

        if (min === max) {
            ranges[axis] = { min: Math.max(0, min - 5), max: min + 5, isSingle: true };
        } else {
            ranges[axis] = { min, max, isSingle: false };
        }
    });

    return ranges;
}

/**
 * Draw SVG Radar Chart with Multi-Item Overlay & Interactive Legend
 */
export function drawRadarChart(
    svg: SVGSVGElement,
    boardConfig: BoardConfig,
    itemsList: RadarItem[],
    selectedSlugs: Set<string>,
    focusedSlug: string | null,
    temporaryItem: RadarItem | null,
    legendContainer: HTMLElement | null,
    onFocusSlug: (slug: string) => void,
    onRemoveSlug: (slug: string) => void
): void {
    svg.innerHTML = '';
    if (legendContainer) legendContainer.innerHTML = '';

    const N = boardConfig.axes.length;
    if (N < 3) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '120');
        text.setAttribute('y', '120');
        text.setAttribute('fill', 'var(--text-muted)');
        text.setAttribute('font-size', '11px');
        text.setAttribute('font-weight', '600');
        text.setAttribute('text-anchor', 'middle');
        text.textContent = 'Requires at least 3 axes';
        svg.appendChild(text);
        return;
    }

    const cx = 120;
    const cy = 120;
    const R = 85;
    const ranges = getAxesRanges(itemsList, boardConfig, temporaryItem);

    // 1. Concentric grid polygons
    for (let layer = 1; layer <= 3; layer++) {
        const factor = layer / 3;
        const points: string[] = [];
        for (let i = 0; i < N; i++) {
            const angle = -Math.PI / 2 + (2 * Math.PI * i) / N;
            const x = cx + R * factor * Math.cos(angle);
            const y = cy + R * factor * Math.sin(angle);
            points.push(x.toFixed(1) + ',' + y.toFixed(1));
        }
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', points.join(' '));
        poly.setAttribute('class', 'radar-grid');
        poly.style.stroke = 'var(--background-modifier-border)';
        poly.style.strokeWidth = '1px';
        poly.style.fill = 'none';
        svg.appendChild(poly);
    }

    // 2. Axes lines and labels
    for (let i = 0; i < N; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / N;
        const axisX = cx + R * Math.cos(angle);
        const axisY = cy + R * Math.sin(angle);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(cx));
        line.setAttribute('y1', String(cy));
        line.setAttribute('x2', String(axisX.toFixed(1)));
        line.setAttribute('y2', String(axisY.toFixed(1)));
        line.setAttribute('class', 'radar-axis');
        line.style.stroke = 'var(--background-modifier-border)';
        line.style.strokeWidth = '1px';
        line.style.strokeDasharray = '2,2';
        svg.appendChild(line);

        const labelX = cx + (R + 15) * Math.cos(angle);
        const labelY = cy + (R + 15) * Math.sin(angle);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(labelX.toFixed(1)));
        text.setAttribute('y', String((labelY + 3).toFixed(1)));
        text.setAttribute('class', 'radar-axis-label');
        text.setAttribute('fill', 'var(--text-normal)');
        text.setAttribute('font-size', '9px');
        text.setAttribute('font-weight', '700');
        text.setAttribute('text-anchor', 'middle');
        text.textContent = boardConfig.axes[i].replace(/_/g, ' ');
        svg.appendChild(text);
    }

    // 3. Target items
    let targetItems: RadarItem[] = [];
    if (selectedSlugs.size > 0) {
        targetItems = itemsList.filter((it) => selectedSlugs.has(it.slug));
        if (temporaryItem && !selectedSlugs.has(temporaryItem.slug)) {
            targetItems.push(temporaryItem);
        }
    } else if (temporaryItem) {
        targetItems = [temporaryItem];
    } else if (itemsList.length > 0) {
        targetItems = [itemsList[0]];
    }

    // Sort so focused item renders last (on top layer)
    if (focusedSlug) {
        targetItems.sort((a, b) => {
            if (a.slug === focusedSlug) return 1;
            if (b.slug === focusedSlug) return -1;
            return 0;
        });
    }

    // 4. Render item polygons and nodes
    targetItems.forEach((it, idx) => {
        const isFocused = focusedSlug ? it.slug === focusedSlug : idx === targetItems.length - 1;
        const color = GRAPH_COLORS[idx % GRAPH_COLORS.length];

        const points: string[] = [];
        const nodes: { x: number; y: number }[] = [];

        for (let i = 0; i < N; i++) {
            const axis = boardConfig.axes[i];
            const val =
                temporaryItem && temporaryItem.slug === it.slug
                    ? (temporaryItem.axes[axis] ?? 5)
                    : (it.axes[axis] ?? 5);
            const { min, max } = ranges[axis];

            let pct = (val - min) / (max - min);
            if (isNaN(pct)) pct = 0.5;
            pct = Math.max(0, Math.min(1, pct));

            const radius = R * (0.15 + 0.85 * pct);
            const angle = -Math.PI / 2 + (2 * Math.PI * i) / N;
            const x = cx + radius * Math.cos(angle);
            const y = cy + radius * Math.sin(angle);

            points.push(x.toFixed(1) + ',' + y.toFixed(1));
            nodes.push({ x, y });
        }

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', points.join(' '));
        poly.setAttribute('class', 'radar-poly-fill');
        poly.style.fill = color;
        poly.style.fillOpacity = isFocused ? '0.25' : '0.08';
        poly.style.stroke = color;
        poly.style.strokeWidth = isFocused ? '3px' : '1.5px';
        poly.style.transition = 'all 0.2s ease';
        svg.appendChild(poly);

        nodes.forEach((n) => {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(n.x.toFixed(1)));
            circle.setAttribute('cy', String(n.y.toFixed(1)));
            circle.setAttribute('r', isFocused ? '3.5' : '2');
            circle.setAttribute('class', 'radar-poly-node');
            circle.style.fill = color;
            circle.style.stroke = 'var(--background-primary, #ffffff)';
            circle.style.strokeWidth = '1px';
            svg.appendChild(circle);
        });

        // 5. Interactive Legend Chip
        if (legendContainer && (selectedSlugs.size > 1 || (selectedSlugs.size === 1 && targetItems.length > 1))) {
            const chip = document.createElement('div');
            chip.className = 'legend-chip' + (isFocused ? ' focused' : '');
            chip.setAttribute('data-slug', it.slug);

            const dot = document.createElement('span');
            dot.className = 'legend-dot';
            dot.style.backgroundColor = color;
            chip.appendChild(dot);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'legend-name';
            nameSpan.textContent = it.name;
            chip.appendChild(nameSpan);

            const removeBtn = document.createElement('span');
            removeBtn.className = 'legend-remove';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove from graph';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                onRemoveSlug(it.slug);
            };
            chip.appendChild(removeBtn);

            chip.onclick = () => {
                onFocusSlug(it.slug);
            };

            legendContainer.appendChild(chip);
        }
    });
}

export const DOCK_ARTIFACT_PATH = 'artifacts/tierlist_dock.json';

export async function saveDockStateToArtifacts(app: App, dock: SidebarDock): Promise<void> {
    try {
        localStorage.setItem('tierlist_sidebar_dock', dock);
        if (app?.vault?.adapter) {
            const exists = await app.vault.adapter.exists('artifacts');
            if (!exists) {
                await app.vault.adapter.mkdir('artifacts').catch(() => {});
            }
            const data = JSON.stringify(
                {
                    dock,
                    isEmbed: dock === 'EMBED',
                    updatedAt: new Date().toISOString()
                },
                null,
                2
            );
            await app.vault.adapter.write(DOCK_ARTIFACT_PATH, data);
        }
    } catch (err) {
        console.error('Failed to save dock state to artifacts folder:', err);
    }
}

export async function loadDockStateFromArtifacts(app: App): Promise<SidebarDock> {
    try {
        if (app?.vault?.adapter) {
            const exists = await app.vault.adapter.exists(DOCK_ARTIFACT_PATH);
            if (exists) {
                const content = await app.vault.adapter.read(DOCK_ARTIFACT_PATH);
                const parsed = JSON.parse(content);
                if (parsed && parsed.dock) {
                    localStorage.setItem('tierlist_sidebar_dock', parsed.dock);
                    return parsed.dock as SidebarDock;
                }
            }
        }
    } catch (err) {
        console.error('Failed to load dock state from artifacts folder:', err);
    }
    return (localStorage.getItem('tierlist_sidebar_dock') as SidebarDock) || 'EMBED';
}

/**
 * Apply dock position to side panel
 */
export function applyPanelDock(
    panel: HTMLElement,
    dock: SidebarDock,
    mountContainer: HTMLElement
): void {
    panel.classList.remove(
        'dock-embed',
        'dock-right',
        'dock-default',
        'dock-tl',
        'dock-tr',
        'dock-bl',
        'dock-center'
    );

    const normalizedDock = dock === 'DEFAULT' || dock === 'RIGHT' ? 'RIGHT' : dock;
    panel.classList.add('dock-' + normalizedDock.toLowerCase());

    panel.querySelectorAll<HTMLElement>('.inline-dock-btn').forEach((btn) => {
        const btnDock = btn.getAttribute('data-dock');
        if (btnDock === dock || (normalizedDock === 'RIGHT' && (btnDock === 'RIGHT' || btnDock === 'DEFAULT'))) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    let backdrop = document.getElementById('inline-panel-backdrop');
    if (normalizedDock === 'CENTER') {
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'inline-panel-backdrop';
            document.body.appendChild(backdrop);
        }
        setTimeout(() => backdrop?.classList.add('show'), 10);
    } else {
        if (backdrop) {
            backdrop.classList.remove('show');
            setTimeout(() => backdrop?.remove(), 250);
        }
    }

    if (normalizedDock === 'EMBED') {
        if (panel.parentElement !== mountContainer) {
            mountContainer.appendChild(panel);
        }
        mountContainer.classList.add('dock-is-embed');
        // Apply EMBED layout to all active tier lists
        document.querySelectorAll<HTMLElement>('.tier-list').forEach((tl) => {
            tl.classList.add('dock-is-embed');
        });
    } else {
        if (panel.parentElement !== document.body) {
            document.body.appendChild(panel);
        }
        mountContainer.classList.remove('dock-is-embed');
        // Remove EMBED layout from all active tier lists
        document.querySelectorAll<HTMLElement>('.tier-list').forEach((tl) => {
            tl.classList.remove('dock-is-embed');
        });
    }
}

/**
 * Side Panel Manager Class for Tierboard
 */
export class TierListSidePanel {
    private app: App;
    private tierListEl: HTMLElement;
    private mountWrapper: HTMLElement;
    private boardConfig: BoardConfig;
    private itemsList: RadarItem[];

    public panelEl: HTMLElement | null = null;
    public selectedItem: RadarItem | null = null;
    public temporaryItem: RadarItem | null = null;
    public selectedSlugs: Set<string> = new Set();
    public focusedSlug: string | null = null;
    private activeTab: 'general' | 'scores' | 'radar' = 'general';

    constructor(
        app: App,
        tierListEl: HTMLElement,
        mountWrapper: HTMLElement,
        boardConfig: BoardConfig,
        itemsList: RadarItem[]
    ) {
        this.app = app;
        this.tierListEl = tierListEl;
        this.mountWrapper = mountWrapper;
        this.boardConfig = boardConfig;
        this.itemsList = itemsList;
    }

    public updateItems(itemsList: RadarItem[]): void {
        this.itemsList = itemsList;
        if (this.temporaryItem) {
            const found = itemsList.find((i) => i.slug === this.temporaryItem?.slug);
            if (found) {
                this.selectedItem = found;
            }
        }
        this.refreshRadar();
    }

    public init(): void {
        let panel = document.getElementById('inline-side-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'inline-side-panel';
            panel.className = 'inline-side-panel';
        }
        this.panelEl = panel;
        this.buildPanelDom();

        // Default dock to EMBED or saved dock
        const savedDock =
            (localStorage.getItem('tierlist_sidebar_dock') as SidebarDock) || 'EMBED';
        applyPanelDock(this.panelEl, savedDock, this.mountWrapper);

        // Asynchronously load dock state from artifacts root and synchronize
        loadDockStateFromArtifacts(this.app).then((artifactDock) => {
            if (artifactDock && artifactDock !== savedDock && this.panelEl) {
                applyPanelDock(this.panelEl, artifactDock, this.mountWrapper);
            }
        });

        const backdrop = document.getElementById('inline-panel-backdrop');
        if (backdrop) {
            backdrop.onclick = () => this.close();
        }

        // Open with first item by default so embedded sidepanel is immediately active
        if (this.itemsList.length > 0 && !this.selectedItem) {
            this.open(this.itemsList[0], 'general');
        }
    }

    private buildPanelDom(): void {
        if (!this.panelEl) return;
        this.panelEl.innerHTML = '';

        // 1. Dock Toolbar (compact / allows EMBED, RIGHT, etc.)
        const dockToolbar = document.createElement('div');
        dockToolbar.className = 'inline-dock-toolbar';
        dockToolbar.innerHTML = `
            <span class="inline-dock-title">Dock:</span>
            <button type="button" class="inline-dock-btn" data-dock="EMBED" title="Embed beside tierboard">EMBED</button>
            <button type="button" class="inline-dock-btn" data-dock="RIGHT" title="Right Drawer">RIGHT</button>
            <button type="button" class="inline-dock-btn" data-dock="TL" title="Top-Left Card">TL</button>
            <button type="button" class="inline-dock-btn" data-dock="TR" title="Top-Right Card">TR</button>
            <button type="button" class="inline-dock-btn" data-dock="BL" title="Bottom-Left Card">BL</button>
            <button type="button" class="inline-dock-btn" data-dock="CENTER" title="Center Modal">CENTER</button>
        `;

        dockToolbar.querySelectorAll<HTMLElement>('.inline-dock-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const targetDock = btn.getAttribute('data-dock') as SidebarDock;
                if (targetDock && this.panelEl) {
                    await saveDockStateToArtifacts(this.app, targetDock);
                    applyPanelDock(this.panelEl, targetDock, this.mountWrapper);
                }
            });
        });
        this.panelEl.appendChild(dockToolbar);

        // 2. Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'inline-close-btn';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Close panel';
        closeBtn.addEventListener('click', () => this.close());
        this.panelEl.appendChild(closeBtn);

        // 3. Scroll container
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'panel-scroll-container';

        // 4. Tab switcher (General, Scores, Graph)
        const tabContainer = document.createElement('div');
        tabContainer.className = 'inline-panel-tabs';
        tabContainer.innerHTML = `
            <button type="button" class="inline-panel-tab-btn active" data-tab="general">General</button>
            <button type="button" class="inline-panel-tab-btn" data-tab="scores">Scores</button>
            <button type="button" class="inline-panel-tab-btn" data-tab="radar">Graph</button>
        `;
        scrollContainer.appendChild(tabContainer);

        // 5. Slider Carousel Container
        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'inline-panel-slider-container';

        const sliderEl = document.createElement('div');
        sliderEl.id = 'inline-panel-slider-el';
        sliderEl.className = 'inline-panel-slider';

        // Slide 1: General Info (Exact match to screenshot)
        const slideGeneral = document.createElement('div');
        slideGeneral.className = 'inline-panel-slide';
        slideGeneral.setAttribute('data-slide', 'general');
        slideGeneral.innerHTML = `
            <div class="inline-form">
                <div class="inline-form-group">
                    <label>NAME</label>
                    <input type="text" id="inline-item-name" placeholder="Item Name">
                </div>
                <div class="inline-form-group">
                    <label>IMAGE URL</label>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <input type="text" id="inline-item-image" placeholder="Image URL" style="flex: 1;">
                        <button type="button" id="inline-btn-view-image" class="inline-btn-view-image" title="Preview Image">⛶</button>
                    </div>
                </div>
                <div class="inline-form-group">
                    <label>TIER</label>
                    <div class="inline-segmented" id="inline-tier-selector"></div>
                </div>
                <div class="inline-form-actions">
                    <button type="button" id="inline-btn-save" class="inline-btn-save">Save Note</button>
                </div>
            </div>
        `;
        sliderEl.appendChild(slideGeneral);

        // Slide 2: Scores
        const slideScores = document.createElement('div');
        slideScores.className = 'inline-panel-slide';
        slideScores.setAttribute('data-slide', 'scores');
        slideScores.innerHTML = `
            <div class="inline-sliders-section">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h4 style="margin: 0; font-size: 13px; font-weight: 700;">Score Dimensions</h4>
                    <span style="font-size: 11px; color: var(--text-muted);">Syncs live to graph</span>
                </div>
                <div id="inline-sliders-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
                <div style="margin-top: 10px;">
                    <button type="button" id="inline-add-axis-btn" style="background: transparent; border: 1.5px dashed var(--background-modifier-border); color: var(--text-normal); padding: 7px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; width: 100%;">+ Add Axis</button>
                </div>
            </div>
        `;
        sliderEl.appendChild(slideScores);

        // Slide 3: Radar Chart
        const slideRadar = document.createElement('div');
        slideRadar.className = 'inline-panel-slide';
        slideRadar.setAttribute('data-slide', 'radar');
        slideRadar.innerHTML = `
            <div id="inline-radar-mount">
                <div class="inline-radar-wrapper">
                    <svg id="inline-radar-chart" viewBox="0 0 240 240" style="width: 100%; height: 100%;"></svg>
                </div>
                <div id="inline-radar-legend" class="inline-radar-legend"></div>
            </div>
        `;
        sliderEl.appendChild(slideRadar);

        sliderContainer.appendChild(sliderEl);
        scrollContainer.appendChild(sliderContainer);
        this.panelEl.appendChild(scrollContainer);

        // Setup tab click handling
        const tabBtns = tabContainer.querySelectorAll<HTMLElement>('.inline-panel-tab-btn');
        tabBtns.forEach((tab) => {
            tab.addEventListener('click', () => {
                tabBtns.forEach((t) => t.classList.remove('active'));
                tab.classList.add('active');
                const targetTab = tab.getAttribute('data-tab');
                if (targetTab === 'scores') {
                    sliderEl.style.transform = 'translateX(-33.333%)';
                    this.activeTab = 'scores';
                } else if (targetTab === 'radar') {
                    sliderEl.style.transform = 'translateX(-66.666%)';
                    this.activeTab = 'radar';
                } else {
                    sliderEl.style.transform = 'translateX(0%)';
                    this.activeTab = 'general';
                }
            });
        });

        // Setup save action
        const saveBtn = slideGeneral.querySelector<HTMLButtonElement>('#inline-btn-save');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                await this.saveCurrentItemChanges();
            };
        }

        // Setup Add Axis
        const addAxisBtn = slideScores.querySelector<HTMLButtonElement>('#inline-add-axis-btn');
        if (addAxisBtn) {
            addAxisBtn.onclick = () => {
                this.promptAddAxis(addAxisBtn);
            };
        }
    }

    public open(item: RadarItem, targetTab: 'general' | 'scores' | 'radar' = 'general'): void {
        if (!this.panelEl) this.init();
        if (!this.panelEl) return;

        // Ensure visible and container has sidepanel open state
        this.panelEl.style.removeProperty('display');
        this.panelEl.classList.add('show');
        this.tierListEl.classList.add('has-sidepanel-open');

        this.selectedItem = item;
        this.temporaryItem = JSON.parse(JSON.stringify(item));
        this.focusedSlug = item.slug;

        const temp = this.temporaryItem;
        if (!temp) return;

        // Highlight card on board
        document.querySelectorAll('.tier-list-slot').forEach((c) => c.classList.remove('selected'));
        const cardEl = this.tierListEl.querySelector(`[data-slug="${item.slug}"]`);
        if (cardEl) cardEl.classList.add('selected');

        // Populate general inputs
        const nameInput = this.panelEl.querySelector<HTMLInputElement>('#inline-item-name');
        const imageInput = this.panelEl.querySelector<HTMLInputElement>('#inline-item-image');
        if (nameInput) {
            nameInput.value = temp.name;
            nameInput.oninput = (e: any) => {
                if (this.temporaryItem) this.temporaryItem.name = e.target.value;
            };
        }
        if (imageInput) {
            imageInput.value = temp.image;
            imageInput.oninput = (e: any) => {
                if (this.temporaryItem) this.temporaryItem.image = e.target.value;
            };
        }

        // Image view button
        const viewBtn = this.panelEl.querySelector<HTMLButtonElement>('#inline-btn-view-image');
        if (viewBtn) {
            viewBtn.onclick = () => {
                const url = imageInput?.value.trim();
                if (url) {
                    window.open(url, '_blank');
                } else {
                    new Notice('No image URL specified.');
                }
            };
        }

        // Tier segmented buttons (Dynamic board tiers + unranked '—')
        const tierContainer = this.panelEl.querySelector<HTMLElement>('#inline-tier-selector');
        if (tierContainer) {
            tierContainer.innerHTML = '';
            const boardTiers = Array.from(this.tierListEl.querySelectorAll('.tier-list-tier'))
                .map((el) => el.textContent?.trim() || '')
                .filter((t) => {
                    if (!t || t.length > 15) return false;
                    const l = t.toLowerCase();
                    return l !== 'settings' && !l.startsWith('settings') && l !== 'to rank' && l !== 'unranked';
                });
            const tiers = boardTiers.length > 0 ? Array.from(new Set([...boardTiers, '—'])) : ['S', 'A', 'B', 'C', 'D', '—'];

            const currentTier = temp.tier || '';
            const isUnranked = !currentTier || currentTier === '—' || currentTier.toLowerCase() === 'to rank' || currentTier.toLowerCase() === 'unordered';

            tiers.forEach((t) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const isActive = (t === '—' && isUnranked) || (t.toLowerCase() === currentTier.toLowerCase());
                btn.className = 'inline-segment-btn' + (isActive ? ' active' : '');
                btn.textContent = t;
                btn.onclick = () => {
                    tierContainer.querySelectorAll('.inline-segment-btn').forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    if (this.temporaryItem) this.temporaryItem.tier = t === '—' ? 'To Rank' : t;
                };
                tierContainer.appendChild(btn);
            });
        }

        // Populate sliders and radar
        this.renderSliders();
        this.refreshRadar();

        // Switch tab if requested
        if (targetTab !== 'general') {
            const tabBtn = this.panelEl.querySelector<HTMLElement>(`.inline-panel-tab-btn[data-tab="${targetTab}"]`);
            if (tabBtn) tabBtn.click();
        }
    }

    public close(): void {
        if (this.panelEl) {
            this.panelEl.classList.remove('show');
            this.panelEl.style.removeProperty('display');
        }
        this.tierListEl.classList.remove('has-sidepanel-open');
        const backdrop = document.getElementById('inline-panel-backdrop');
        if (backdrop) {
            backdrop.classList.remove('show');
            setTimeout(() => backdrop.remove(), 250);
        }
        document.querySelectorAll('.tier-list-slot').forEach((c) => c.classList.remove('selected'));
        this.temporaryItem = null;
        this.selectedItem = null;
    }

    public toggle(item?: RadarItem): void {
        if (this.panelEl && this.panelEl.classList.contains('show') && this.panelEl.style.display !== 'none') {
            this.close();
        } else if (item) {
            this.open(item);
        } else if (this.itemsList.length > 0) {
            this.open(this.itemsList[0]);
        }
    }

    public refreshRadar(): void {
        const svg = this.panelEl?.querySelector<SVGSVGElement>('#inline-radar-chart');
        const legend = this.panelEl?.querySelector<HTMLElement>('#inline-radar-legend');
        if (!svg) return;

        drawRadarChart(
            svg,
            this.boardConfig,
            this.itemsList,
            this.selectedSlugs,
            this.focusedSlug,
            this.temporaryItem,
            legend || null,
            (slug) => {
                this.focusedSlug = slug;
                this.refreshRadar();
            },
            (slug) => {
                this.selectedSlugs.delete(slug);
                const card = this.tierListEl.querySelector(`[data-slug="${slug}"]`);
                if (card) {
                    card.classList.remove('has-graph-checked');
                    const cb = card.querySelector<HTMLInputElement>('.inline-card-checkbox');
                    if (cb) cb.checked = false;
                }
                this.refreshRadar();
            }
        );
    }

    private renderSliders(): void {
        const list = this.panelEl?.querySelector<HTMLElement>('#inline-sliders-list');
        const temp = this.temporaryItem;
        if (!list || !temp) return;
        list.innerHTML = '';

        const ranges = getAxesRanges(this.itemsList, this.boardConfig, temp);

        this.boardConfig.axes.forEach((axis) => {
            const row = document.createElement('div');
            row.className = 'inline-slider-row';

            const labelGroup = document.createElement('div');
            labelGroup.className = 'inline-slider-label';

            const label = document.createElement('span');
            label.textContent = axis.replace(/_/g, ' ');
            labelGroup.appendChild(label);

            const hint = document.createElement('span');
            hint.style.color = 'var(--text-muted)';
            hint.style.fontSize = '11px';
            const range = ranges[axis];
            hint.textContent = `Range: ${range.min} - ${range.max}`;
            labelGroup.appendChild(hint);

            row.appendChild(labelGroup);

            const controls = document.createElement('div');
            controls.className = 'inline-slider-controls';

            const rangeInput = document.createElement('input');
            rangeInput.type = 'range';
            rangeInput.min = String(range.min);
            rangeInput.max = String(range.max);
            rangeInput.value = String(temp.axes[axis] ?? 5);

            const valInput = document.createElement('input');
            valInput.type = 'number';
            valInput.className = 'inline-slider-val';
            valInput.value = String(temp.axes[axis] ?? 5);

            rangeInput.addEventListener('input', (e: any) => {
                const val = Number(e.target.value);
                valInput.value = String(val);
                if (this.temporaryItem) this.temporaryItem.axes[axis] = val;
                this.refreshRadar();
            });

            valInput.addEventListener('input', (e: any) => {
                let val = Number(e.target.value);
                if (isNaN(val)) val = 5;
                rangeInput.value = String(val);
                if (this.temporaryItem) this.temporaryItem.axes[axis] = val;
                this.refreshRadar();
            });

            controls.appendChild(rangeInput);
            controls.appendChild(valInput);
            row.appendChild(controls);
            list.appendChild(row);
        });
    }

    private promptAddAxis(addAxisBtn: HTMLButtonElement): void {
        const container = document.createElement('div');
        container.style.marginTop = '8px';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '6px';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'e.g. durability, aesthetic, price';
        input.className = 'tableview-search-input';
        container.appendChild(input);

        const suggContainer = document.createElement('div');
        suggContainer.style.display = 'flex';
        suggContainer.style.flexWrap = 'wrap';
        suggContainer.style.gap = '4px';

        const suggestions = ['price', 'aesthetic', 'durability', 'capacity', 'versatility', 'quality', 'safety'];
        suggestions
            .filter((s) => !this.boardConfig.axes.includes(s))
            .forEach((sug) => {
                const pill = document.createElement('span');
                pill.className = 'chip chip-shared-some';
                pill.style.cursor = 'pointer';
                pill.textContent = sug;
                pill.onclick = () => {
                    input.value = sug;
                    doAdd(sug);
                };
                suggContainer.appendChild(pill);
            });
        container.appendChild(suggContainer);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '6px';
        actions.style.marginTop = '4px';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'tableview-open-btn';
        cancelBtn.onclick = () => container.replaceWith(addAxisBtn);

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.textContent = 'Add Dimension';
        confirmBtn.className = 'inline-btn-save';
        confirmBtn.style.flex = '1';
        confirmBtn.onclick = () => doAdd(input.value.trim());

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        container.appendChild(actions);

        addAxisBtn.replaceWith(container);
        input.focus();

        const doAdd = (name: string) => {
            const clean = name.trim().toLowerCase().replace(/\s+/g, '_');
            if (!clean) return;
            if (this.boardConfig.axes.includes(clean)) {
                new Notice('Axis already exists!');
                return;
            }

            this.boardConfig.axes.push(clean);
            this.itemsList.forEach((it) => {
                if (it.axes[clean] === undefined) it.axes[clean] = 5;
            });
            if (this.temporaryItem && this.temporaryItem.axes[clean] === undefined) {
                this.temporaryItem.axes[clean] = 5;
            }

            this.renderSliders();
            this.refreshRadar();
            container.replaceWith(addAxisBtn);
        };
    }

    private async saveCurrentItemChanges(): Promise<void> {
        const temp = this.temporaryItem;
        if (!temp) return;
        const saveBtn = this.panelEl?.querySelector<HTMLButtonElement>('#inline-btn-save');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }

        try {
            // Update local memory
            const idx = this.itemsList.findIndex((i) => i.slug === temp.slug);
            if (idx !== -1 && this.temporaryItem) {
                this.itemsList[idx] = JSON.parse(JSON.stringify(this.temporaryItem));
            }

            // If item maps to a note, update frontmatter
            if (temp.tfile) {
                await this.app.fileManager.processFrontMatter(temp.tfile, (fm: any) => {
                    if (this.temporaryItem?.name) fm.title = this.temporaryItem.name;
                    if (this.temporaryItem?.image) fm.image = this.temporaryItem.image;
                    if (this.temporaryItem?.tier) fm.tier = this.temporaryItem.tier;
                    if (this.temporaryItem?.axes) {
                        for (const [k, v] of Object.entries(this.temporaryItem.axes)) {
                            fm[k] = v;
                        }
                    }
                });
                new Notice(`Updated frontmatter for "${temp.name}"!`);
            } else {
                new Notice(`Saved changes for "${temp.name}"!`);
            }
        } catch (err) {
            console.error('Failed to save frontmatter:', err);
            new Notice('Failed to update frontmatter: ' + err);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Note';
            }
        }
    }
}

/**
 * Injects checkboxes on Tier Board cards and sets up click-to-inspect
 */
export function setupTierboardCardsIntegration(
    tierListEl: HTMLElement,
    sidePanel: TierListSidePanel,
    itemsList: RadarItem[]
): void {
    const slots = tierListEl.querySelectorAll<HTMLElement>('.tier-list-slot');

    slots.forEach((slot) => {
        // Determine item matching this slot
        const linkEl = slot.querySelector<HTMLAnchorElement>('a.internal-link, a');
        const titleEl = slot.querySelector<HTMLElement>('.tier-list-title-text, .tier-list-title');
        const imgEl = slot.querySelector<HTMLImageElement>('img');

        let rawName = '';
        if (linkEl) rawName = linkEl.textContent?.trim() || linkEl.getAttribute('data-href') || '';
        else if (titleEl) rawName = titleEl.textContent?.trim() || '';
        else if (imgEl) rawName = imgEl.getAttribute('alt') || '';
        else rawName = slot.textContent?.trim() || '';

        rawName = rawName.replace(/^[!\[\]]+/g, '').replace(/[\]]+$/g, '').split('|')[0].trim();
        if (!rawName) return;

        const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        slot.setAttribute('data-slug', slug);

        let item: RadarItem | undefined = itemsList.find((i) => i.slug === slug || i.name.toLowerCase() === rawName.toLowerCase());
        if (!item) {
            const fallbackItem: RadarItem = {
                slug: slug || 'item-' + Math.random().toString(36).substring(2, 7),
                name: rawName || 'Item',
                tier: 'To Rank',
                image: '',
                axes: {}
            };
            itemsList.push(fallbackItem);
            item = fallbackItem;
        }

        // 1. Overlay Checkbox
        let cb = slot.querySelector<HTMLInputElement>('.inline-card-checkbox');
        if (!cb) {
            cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'inline-card-checkbox';
            cb.title = 'Select for Radar graph comparison';
            cb.checked = sidePanel.selectedSlugs.has(slug);

            cb.addEventListener('click', (e) => e.stopPropagation());
            cb.addEventListener('change', (e: any) => {
                e.stopPropagation();
                const checkbox = e.target as HTMLInputElement;
                if (checkbox.checked) {
                    sidePanel.selectedSlugs.add(slug);
                    sidePanel.focusedSlug = slug;
                    slot.classList.add('has-graph-checked');
                } else {
                    sidePanel.selectedSlugs.delete(slug);
                    slot.classList.remove('has-graph-checked');
                    if (sidePanel.focusedSlug === slug) {
                        const remaining = Array.from(sidePanel.selectedSlugs);
                        sidePanel.focusedSlug = remaining.length > 0 ? remaining[remaining.length - 1] : null;
                    }
                }
                sidePanel.refreshRadar();
                // Ensure sidepanel is open and show radar tab
                if (item) {
                    sidePanel.open(item, 'radar');
                }
            });

            slot.appendChild(cb);
        } else {
            cb.checked = sidePanel.selectedSlugs.has(slug);
            if (cb.checked) slot.classList.add('has-graph-checked');
            else slot.classList.remove('has-graph-checked');
        }

        // 2. Click to Inspect in Sidebar
        slot.addEventListener('click', (e) => {
            // Let modifier-key clicks pass through unchanged
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
            // If the click target IS a link/anchor, let Obsidian open the note normally
            const target = e.target as HTMLElement;
            if (target.tagName === 'A' || target.closest('a.internal-link, a.external-link')) return;
            // Any other area on the card → open the graph panel
            e.preventDefault();
            e.stopPropagation();
            if (item) {
                sidePanel.open(item, 'general');
            }
        });
    });
}
