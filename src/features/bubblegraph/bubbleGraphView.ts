import { ItemView, WorkspaceLeaf, setIcon, TFile, Menu, normalizePath, Notice } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DEFAULT_BUBBLE_GRAPH_SETTINGS } from '../../settings';
import { BubbleNode, BubbleCluster } from './types';
import { buildVaultGraph, BuiltGraph, getFolderColor, matchFolderRule } from './graphBuilder';
import { BubbleSimulation } from './simulation';
import { CanvasRenderer, ViewportTransform, RenderState } from './canvasRenderer';

export const BUBBLE_GRAPH_VIEW_TYPE = 'pakcli-bubble-graph';

export class BubbleGraphView extends ItemView {
    private plugin: PakCLITablePlugin;
    private canvasEl!: HTMLCanvasElement;
    private renderer!: CanvasRenderer;
    private simulation!: BubbleSimulation;

    private graphData!: BuiltGraph;
    private transform: ViewportTransform = { panX: 0, panY: 0, zoom: 1.0 };
    private animFrameId: number | null = null;

    // Interactive State
    private layoutMode: 'bubble' | 'default' = 'bubble';
    private maxDragDepth: number = 2;
    private hoveredNode: BubbleNode | null = null;
    private hoveredCluster: BubbleCluster | null = null;
    private selectedNode: BubbleNode | null = null;
    private searchQuery: string = '';
    private scopeFilter: string = 'all';
    private scopedFolder: string | null = null;

    // Label & Line Controls
    private showLabels: boolean = true;
    private showLines: boolean = true;
    private labelRangeLevel: number = 2; // 0=None, 1=Hubs/Active, 2=Docs, 3=All
    private labelFontSize: number = 11; // 8 - 24px

    // Timelapse State
    private timelapseMode: 'date' | 'vanilla' = 'date';
    private sortedNodes: BubbleNode[] = [];
    private isTimelapseRunning: boolean = false;
    private timelapseProgress: number = 1.0; // 0.0 (oldest) to 1.0 (present)
    private timelapseMinCtime: number = 0;
    private timelapseMaxCtime: number = 0;
    private lastVisibleCount: number = -1;

    // Drag / Pan state
    private isPanning: boolean = false;
    private panStartX: number = 0;
    private panStartY: number = 0;
    private isDraggingNode: boolean = false;

    // UI Elements
    private statsPillEl!: HTMLElement;
    private scopeBarEl!: HTMLElement;
    private inspectorEl!: HTMLElement;
    private inspectorBtnEl!: HTMLElement;
    private isInspectorOpen: boolean = true;
    private depthButtons: HTMLElement[] = [];
    private wandBtnEl!: HTMLElement;
    private linesToggleBtnEl!: HTMLElement;
    private textToggleBtnEl!: HTMLElement;
    private captainColorsBtnEl!: HTMLElement;
    private levelButtons: HTMLElement[] = [];
    private fontSizeSliderEl!: HTMLInputElement;
    private fontSizeDisplayEl!: HTMLElement;
    private timelinePlayBtnEl!: HTMLElement;
    private timelineSliderEl!: HTMLInputElement;
    private timelineDateBadgeEl!: HTMLElement;
    private timelapseModeButtons: HTMLElement[] = [];

    // Captain Folder Colors toggle
    private useCaptainColors: boolean = false;

    constructor(leaf: WorkspaceLeaf, plugin: PakCLITablePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return BUBBLE_GRAPH_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Bubble Graph View';
    }

    getIcon(): string {
        return this.plugin.settings.bubbleRibbonIcon || 'circle-dot';
    }

    async onOpen(): Promise<void> {
        const container = this.contentEl;
        container.empty();
        container.addClass('pakcli-bubble-graph-container');

        this.layoutMode = this.plugin.settings.bubbleDefaultLayout || 'bubble';
        this.maxDragDepth = this.plugin.settings.bubbleMaxDragDepth ?? DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleMaxDragDepth;
        this.showLabels = this.plugin.settings.bubbleShowLabels !== false;
        this.showLines = this.plugin.settings.bubbleShowLines !== false;
        this.timelapseMode = this.plugin.settings.bubbleTimelapseMode || 'date';
        this.useCaptainColors = this.plugin.settings.bubbleUseCaptainColors === true;
        this.labelRangeLevel = this.plugin.settings.bubbleLabelRangeLevel ?? DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelRangeLevel;
        this.labelFontSize = this.plugin.settings.bubbleLabelFontSize ?? DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelFontSize;
        this.isInspectorOpen = this.plugin.settings.bubbleInspectorOpen !== false;

        // 1. Build Header Bar
        this.renderHeader(container);

        // 2. Build Workspace Split Area (Canvas + Inspector)
        const workspaceEl = container.createDiv({ cls: 'pakcli-bubble-workspace' });

        const canvasWrap = workspaceEl.createDiv({ cls: 'pakcli-bubble-canvas-wrap' });
        this.canvasEl = canvasWrap.createEl('canvas', { cls: 'pakcli-bubble-canvas' });
        this.renderer = new CanvasRenderer(this.canvasEl);

        this.renderInspector(workspaceEl);

        // 3. Build Bottom Timeline Minimap Scrubber
        this.renderTimelineScrubber(container);

        // 4. Initialize Graph & Simulation
        this.reloadGraphData();

        // 5. Setup Event Listeners
        this.setupCanvasEvents();
        this.setupResizeObserver(canvasWrap);

        // Listen for active note changes in Obsidian workspace
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file && this.graphData) {
                    const activePath = file.path;
                    let foundNode: BubbleNode | null = null;
                    for (const node of this.graphData.nodes) {
                        const wasActive = node.isActive;
                        node.isActive = node.id === activePath;
                        if (node.isActive) {
                            node.glyph = 'active';
                            foundNode = node;
                        } else if (wasActive) {
                            node.glyph = node.totalDegree <= 1 ? 'leaf' : 'document';
                        }
                    }
                    if (foundNode) {
                        this.selectNode(foundNode, false);
                    }
                }
            })
        );

        // Listen for theme / css changes in Obsidian workspace to adjust adaptive accent colors
        this.registerEvent(
            this.app.workspace.on('css-change', () => {
                this.applyCaptainFolderColors();
            })
        );

        // 6. Start Render Loop
        this.startRenderLoop();
    }

    async onClose(): Promise<void> {
        if (this.animFrameId !== null) {
            window.cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    public scopeToFolder(folderPath: string | null): void {
        this.scopedFolder = (folderPath && folderPath !== '/' && folderPath !== '.') ? normalizePath(folderPath) : null;
        this.reloadGraphData();
        this.updateScopeBar();
        this.updateInspectorContent();
        this.fitToView();
    }

    public scopeToParentFolder(): void {
        if (!this.scopedFolder) return;
        if (this.scopedFolder.includes('/')) {
            const parent = this.scopedFolder.split('/').slice(0, -1).join('/');
            this.scopeToFolder(parent);
        } else {
            this.scopeToFolder(null);
        }
    }

    public resetScope(): void {
        this.scopeToFolder(null);
    }

    public async resetViewSettings(): Promise<void> {
        // 1. Reset values to DEFAULT_BUBBLE_GRAPH_SETTINGS
        this.maxDragDepth = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleMaxDragDepth;
        this.showLines = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleShowLines;
        this.showLabels = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleShowLabels;
        this.useCaptainColors = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleUseCaptainColors;
        this.labelRangeLevel = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelRangeLevel;
        this.labelFontSize = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelFontSize;
        this.isInspectorOpen = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleInspectorOpen;

        // 2. Persist to plugin settings
        this.plugin.settings.bubbleMaxDragDepth = this.maxDragDepth;
        this.plugin.settings.bubbleShowLines = this.showLines;
        this.plugin.settings.bubbleShowLabels = this.showLabels;
        this.plugin.settings.bubbleUseCaptainColors = this.useCaptainColors;
        this.plugin.settings.bubbleLabelRangeLevel = this.labelRangeLevel;
        this.plugin.settings.bubbleLabelFontSize = this.labelFontSize;
        this.plugin.settings.bubbleInspectorOpen = this.isInspectorOpen;
        await this.plugin.saveSettings();

        // 3. Update UI states
        if (this.linesToggleBtnEl) {
            this.linesToggleBtnEl.toggleClass('active', this.showLines);
        }
        if (this.textToggleBtnEl) {
            this.textToggleBtnEl.toggleClass('active', this.showLabels);
        }
        if (this.captainColorsBtnEl) {
            this.captainColorsBtnEl.toggleClass('active', this.useCaptainColors);
        }
        if (this.depthButtons) {
            this.depthButtons.forEach(btn => {
                const text = btn.innerText.trim();
                const isMatch = text.startsWith(`${this.maxDragDepth}:`) ||
                    (this.maxDragDepth === 99 && text.includes('Node'));
                btn.toggleClass('active', isMatch);
            });
        }
        if (this.levelButtons) {
            this.levelButtons.forEach((btn, idx) => {
                btn.toggleClass('active', idx === this.labelRangeLevel);
            });
        }
        if (this.fontSizeSliderEl) {
            this.fontSizeSliderEl.value = this.labelFontSize.toString();
        }
        if (this.fontSizeDisplayEl) {
            this.fontSizeDisplayEl.setText(`${this.labelFontSize}px`);
        }
        if (this.inspectorEl) {
            if (this.isInspectorOpen) {
                this.inspectorEl.removeClass('collapsed');
            } else {
                this.inspectorEl.addClass('collapsed');
            }
        }
        if (this.inspectorBtnEl) {
            this.inspectorBtnEl.toggleClass('active', this.isInspectorOpen);
        }

        // 4. Update Simulation & Colors
        if (this.simulation) {
            this.simulation.setOptions({ maxDragDepth: this.maxDragDepth });
            this.simulation.reheat(0.35);
        }
        this.applyCaptainFolderColors();
        this.fitToView();

        new Notice('Bubble View controls reset to default');
    }

    public reloadGraphData(): void {
        const activeFile = this.app.workspace.getActiveFile();
        const captainRules = this.plugin.settings.rules || [];
        const maxDepth = this.plugin.settings.bubbleMaxClusterDepth ?? 3;
        this.graphData = buildVaultGraph(this.app, activeFile ? activeFile.path : null, captainRules, this.useCaptainColors, maxDepth, this.scopedFolder);

        // Sort all nodes chronologically by ctime for sequential vanilla timelapse
        this.sortedNodes = [...this.graphData.nodes].sort((a, b) => (a.ctime || 0) - (b.ctime || 0));

        // Compute min and max ctime for chronological timelapse
        const ctimes = this.graphData.nodes.map(n => n.ctime).filter(t => t && t > 0);
        if (ctimes.length > 0) {
            this.timelapseMinCtime = Math.min(...ctimes);
            this.timelapseMaxCtime = Math.max(...ctimes);
            if (this.timelapseMinCtime === this.timelapseMaxCtime) {
                this.timelapseMinCtime -= 86400000;
            }
        } else {
            this.timelapseMinCtime = Date.now() - 30 * 86400000;
            this.timelapseMaxCtime = Date.now();
        }
        this.timelapseProgress = 1.0;
        this.isTimelapseRunning = false;
        this.updateTimelineUI();

        this.simulation = new BubbleSimulation(
            this.graphData.nodes,
            this.graphData.edges,
            this.graphData.clusters,
            {
                maxDragDepth: this.maxDragDepth,
                layoutMode: this.layoutMode,
                scopedFolder: this.scopedFolder,
                denseScale: this.plugin.settings.bubbleDenseScale ?? 1.15
            }
        );

        this.updateStatsPill();
        this.updateScopeBar();
        if (activeFile) {
            const activeNode = this.graphData.nodeMap.get(activeFile.path);
            if (activeNode) {
                this.selectNode(activeNode, false);
            }
        }
    }

    /**
     * Hot-updates node and cluster colors based on the current useCaptainColors toggle state.
     * Called when the toggle changes, avoiding a full simulation restart.
     */
    private applyCaptainFolderColors(): void {
        if (!this.graphData) return;
        const captainRules = this.plugin.settings.rules || [];

        for (const node of this.graphData.nodes) {
            node.color = getFolderColor(node.folderPath || node.topLevelFolder, captainRules, this.useCaptainColors);
        }
        for (const cluster of this.graphData.clusters) {
            cluster.color = getFolderColor(cluster.id, captainRules, this.useCaptainColors);
        }
    }

    private renderHeader(container: HTMLElement): void {
        const headerEl = container.createDiv({ cls: 'pakcli-bubble-header' });

        // Left Branding & Tabs
        const leftGroup = headerEl.createDiv({ cls: 'pakcli-header-left' });
        const brandBadge = leftGroup.createDiv({ cls: 'pakcli-brand-badge' });
        brandBadge.createSpan({ text: '🫧 BUBBLE VIEW', cls: 'pakcli-brand-title' });

        const tabsWrap = leftGroup.createDiv({ cls: 'pakcli-mode-tabs' });
        const defaultTab = tabsWrap.createEl('button', {
            text: 'Graph View',
            cls: `pakcli-tab-btn ${this.layoutMode === 'default' ? 'active' : ''}`
        });
        const bubbleTab = tabsWrap.createEl('button', {
            text: '★ Bubble View',
            cls: `pakcli-tab-btn ${this.layoutMode === 'bubble' ? 'active' : ''}`
        });

        defaultTab.onclick = () => {
            this.layoutMode = 'default';
            defaultTab.addClass('active');
            bubbleTab.removeClass('active');
            this.simulation.setOptions({ layoutMode: 'default' });
        };

        bubbleTab.onclick = () => {
            this.layoutMode = 'bubble';
            bubbleTab.addClass('active');
            defaultTab.removeClass('active');
            this.simulation.setOptions({ layoutMode: 'bubble' });
        };

        // Scope Navigation Bar & Breadcrumbs
        this.scopeBarEl = leftGroup.createDiv({ cls: 'pakcli-scope-bar' });
        this.updateScopeBar();

        // Middle Drag Depth Scrubber
        const depthGroup = headerEl.createDiv({ cls: 'pakcli-depth-group' });
        depthGroup.createSpan({ text: 'Depth:', cls: 'pakcli-depth-label' });
        const depthWrap = depthGroup.createDiv({ cls: 'pakcli-depth-buttons' });

        const maxDepthSetting = Math.min(5, Math.max(2, this.plugin.settings.bubbleMaxClusterDepth ?? 3));
        const depths: Array<{ level: number; label: string }> = [
            { level: 0, label: '0: Lock' },
            { level: 1, label: '1: Folder' },
            { level: 2, label: '2: Subfolder' }
        ];
        for (let lvl = 3; lvl <= maxDepthSetting; lvl++) {
            depths.push({ level: lvl, label: `${lvl}: L${lvl}` });
        }
        depths.push({ level: 99, label: 'Node' });

        this.depthButtons = depths.map(d => {
            const btn = depthWrap.createEl('button', {
                text: d.label,
                cls: `pakcli-depth-btn ${this.maxDragDepth === d.level ? 'active' : ''}`
            });
            btn.onclick = async () => {
                this.maxDragDepth = d.level;
                this.depthButtons.forEach(b => b.removeClass('active'));
                btn.addClass('active');
                this.simulation.setOptions({ maxDragDepth: d.level });
                this.plugin.settings.bubbleMaxDragDepth = d.level;
                await this.plugin.saveSettings();
            };
            return btn;
        });

        // Text & Line Controls Group
        const textGroup = headerEl.createDiv({ cls: 'pakcli-text-controls-group' });

        // 1. Show Lines Toggle (Edges show or hide)
        this.linesToggleBtnEl = textGroup.createEl('button', {
            cls: `pakcli-icon-btn pakcli-lines-toggle-btn ${this.showLines ? 'active' : ''}`,
            title: 'Toggle Lines (Show/Hide)'
        });
        setIcon(this.linesToggleBtnEl, 'link');
        this.linesToggleBtnEl.onclick = async () => {
            this.showLines = !this.showLines;
            if (this.showLines) {
                this.linesToggleBtnEl.addClass('active');
            } else {
                this.linesToggleBtnEl.removeClass('active');
            }
            this.plugin.settings.bubbleShowLines = this.showLines;
            await this.plugin.saveSettings();
        };

        // 2. Show Text Node Toggle
        this.textToggleBtnEl = textGroup.createEl('button', {
            cls: `pakcli-icon-btn pakcli-text-toggle-btn ${this.showLabels ? 'active' : ''}`,
            title: 'Toggle Text Labels'
        });
        setIcon(this.textToggleBtnEl, 'type');
        this.textToggleBtnEl.onclick = async () => {
            this.showLabels = !this.showLabels;
            if (this.showLabels) {
                this.textToggleBtnEl.addClass('active');
            } else {
                this.textToggleBtnEl.removeClass('active');
            }
            this.plugin.settings.bubbleShowLabels = this.showLabels;
            await this.plugin.saveSettings();
        };

        // 3. Captain Folder Colors Toggle
        this.captainColorsBtnEl = textGroup.createEl('button', {
            cls: `pakcli-icon-btn pakcli-captain-colors-btn ${this.useCaptainColors ? 'active' : ''}`,
            title: 'Toggle Captain Folder Colors (show custom colors on Captain Folders)'
        });
        setIcon(this.captainColorsBtnEl, 'anchor');
        this.captainColorsBtnEl.onclick = async () => {
            this.useCaptainColors = !this.useCaptainColors;
            if (this.useCaptainColors) {
                this.captainColorsBtnEl.addClass('active');
            } else {
                this.captainColorsBtnEl.removeClass('active');
            }
            this.plugin.settings.bubbleUseCaptainColors = this.useCaptainColors;
            await this.plugin.saveSettings();
            this.applyCaptainFolderColors();
        };

        // 2. Show Text Range Level 0-3
        const levelGroup = textGroup.createDiv({ cls: 'pakcli-level-group' });
        levelGroup.createSpan({ text: 'Text Level:', cls: 'pakcli-level-label' });
        const levelWrap = levelGroup.createDiv({ cls: 'pakcli-level-buttons' });

        const levels = [
            { lvl: 0, label: '0', title: 'Level 0: No labels (hover / select only)' },
            { lvl: 1, label: '1', title: 'Level 1: Hubs & active notes only' },
            { lvl: 2, label: '2', title: 'Level 2: Hubs & documents (2+ links)' },
            { lvl: 3, label: '3', title: 'Level 3: All notes including leaves' }
        ];

        this.levelButtons = levels.map(l => {
            const btn = levelWrap.createEl('button', {
                text: l.label,
                cls: `pakcli-level-btn ${this.labelRangeLevel === l.lvl ? 'active' : ''}`,
                title: l.title
            });
            btn.onclick = async () => {
                this.labelRangeLevel = l.lvl;
                this.levelButtons.forEach(b => b.removeClass('active'));
                btn.addClass('active');
                this.plugin.settings.bubbleLabelRangeLevel = l.lvl;
                await this.plugin.saveSettings();
            };
            return btn;
        });

        // 3. Text Size Slider
        const sizeGroup = textGroup.createDiv({ cls: 'pakcli-size-group' });
        sizeGroup.createSpan({ text: 'Size:', cls: 'pakcli-size-label' });
        this.fontSizeSliderEl = sizeGroup.createEl('input', {
            type: 'range',
            cls: 'pakcli-font-slider'
        });
        this.fontSizeSliderEl.min = '8';
        this.fontSizeSliderEl.max = '24';
        this.fontSizeSliderEl.step = '1';
        this.fontSizeSliderEl.value = this.labelFontSize.toString();

        this.fontSizeDisplayEl = sizeGroup.createSpan({
            text: `${this.labelFontSize}px`,
            cls: 'pakcli-size-display'
        });

        this.fontSizeSliderEl.oninput = () => {
            this.labelFontSize = parseInt(this.fontSizeSliderEl.value, 10) || 11;
            this.fontSizeDisplayEl.setText(`${this.labelFontSize}px`);
        };

        this.fontSizeSliderEl.onchange = async () => {
            this.labelFontSize = parseInt(this.fontSizeSliderEl.value, 10) || 11;
            this.plugin.settings.bubbleLabelFontSize = this.labelFontSize;
            await this.plugin.saveSettings();
        };

        // Stats Pill
        this.statsPillEl = headerEl.createDiv({ cls: 'pakcli-stats-pill' });
        this.updateStatsPill();

        // Right Controls: Timelapse Wand & Search & Buttons
        const rightGroup = headerEl.createDiv({ cls: 'pakcli-header-right' });

        // 4. Timelapse Magic Wand Button (Identical to Obsidian vanilla graph "Start timelapse animation")
        this.wandBtnEl = rightGroup.createEl('button', {
            cls: `pakcli-icon-btn pakcli-wand-btn ${this.isTimelapseRunning ? 'active' : ''}`,
            title: 'Start timelapse animation'
        });
        setIcon(this.wandBtnEl, 'wand-2');
        this.wandBtnEl.onclick = () => this.toggleTimelapse();

        const searchWrap = rightGroup.createDiv({ cls: 'pakcli-search-wrap' });
        const searchInput = searchWrap.createEl('input', {
            type: 'text',
            placeholder: '🔍 Search notes...',
            cls: 'pakcli-search-input'
        });
        searchInput.oninput = () => {
            this.searchQuery = searchInput.value.toLowerCase().trim();
            if (this.searchQuery && this.graphData) {
                const matched = this.graphData.nodes.find(n =>
                    n.name.toLowerCase().includes(this.searchQuery) ||
                    n.folderPath.toLowerCase().includes(this.searchQuery)
                );
                if (matched) {
                    this.hoveredNode = matched;
                }
            } else {
                this.hoveredNode = null;
            }
        };

        // Fit to View Button
        const fitBtn = rightGroup.createEl('button', { cls: 'pakcli-icon-btn', title: 'Fit to View' });
        setIcon(fitBtn, 'maximize-2');
        fitBtn.onclick = () => this.fitToView();

        // Refresh Button
        const refreshBtn = rightGroup.createEl('button', { cls: 'pakcli-icon-btn', title: 'Refresh Graph' });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.onclick = () => this.reloadGraphData();

        // Reset View Settings Button
        const resetSettingsBtn = rightGroup.createEl('button', {
            cls: 'pakcli-icon-btn pakcli-reset-settings-btn',
            title: 'Reset View Settings to Default'
        });
        setIcon(resetSettingsBtn, 'rotate-ccw');
        resetSettingsBtn.onclick = () => this.resetViewSettings();

        // Inspector Toggle Button
        this.inspectorBtnEl = rightGroup.createEl('button', {
            cls: `pakcli-icon-btn ${this.isInspectorOpen ? 'active' : ''}`,
            title: 'Toggle Inspector'
        });
        setIcon(this.inspectorBtnEl, 'info');
        this.inspectorBtnEl.onclick = async () => {
            this.isInspectorOpen = !this.isInspectorOpen;
            if (this.isInspectorOpen) {
                this.inspectorEl.removeClass('collapsed');
                this.inspectorBtnEl.addClass('active');
            } else {
                this.inspectorEl.addClass('collapsed');
                this.inspectorBtnEl.removeClass('active');
            }
            this.plugin.settings.bubbleInspectorOpen = this.isInspectorOpen;
            await this.plugin.saveSettings();
        };
    }

    private toggleTimelapse(): void {
        if (this.isTimelapseRunning) {
            this.pauseTimelapse();
        } else {
            if (this.timelapseProgress >= 1.0) {
                this.timelapseProgress = 0.0;
                this.lastVisibleCount = -1;
            }
            this.startTimelapse();
        }
    }

    private startTimelapse(): void {
        this.isTimelapseRunning = true;
        this.updateTimelineUI();
    }

    private pauseTimelapse(): void {
        this.isTimelapseRunning = false;
        this.updateTimelineUI();
    }

    private updateTimelineUI(): void {
        if (this.timelineSliderEl) {
            this.timelineSliderEl.value = Math.round(this.timelapseProgress * 1000).toString();
        }
        if (this.timelineDateBadgeEl && this.graphData) {
            const totalCount = this.graphData.nodes.length;

            if (this.timelapseMode === 'vanilla') {
                const spawnedCount = Math.round(this.timelapseProgress * totalCount);
                if (this.timelapseProgress < 0.999 && spawnedCount < totalCount) {
                    const latestNode = spawnedCount > 0 ? this.sortedNodes[spawnedCount - 1] : this.sortedNodes[0];
                    const dateStr = latestNode?.ctime ? new Date(latestNode.ctime).toISOString().slice(0, 10) : '';
                    this.timelineDateBadgeEl.setText(`📅 ${dateStr} (${spawnedCount}/${totalCount} notes) • Vanilla 0.025s`);
                } else {
                    this.timelineDateBadgeEl.setText(`📅 Present (${totalCount}/${totalCount} notes) • Vanilla`);
                }
            } else {
                // Default: Date-based continuous timeline interpolation
                const cutoff = this.timelapseProgress < 0.999
                    ? this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress
                    : null;
                const visibleCount = this.graphData.nodes.filter(n => !cutoff || n.ctime <= cutoff).length;
                if (cutoff) {
                    const dateStr = new Date(cutoff).toISOString().slice(0, 10);
                    this.timelineDateBadgeEl.setText(`📅 ${dateStr} (${visibleCount}/${totalCount} notes) • Date-based`);
                } else {
                    this.timelineDateBadgeEl.setText(`📅 Present (${totalCount}/${totalCount} notes) • Date-based`);
                }
            }
        }
        if (this.wandBtnEl) {
            if (this.isTimelapseRunning) {
                this.wandBtnEl.addClass('active');
                this.wandBtnEl.setAttribute('title', 'Pause timelapse animation');
            } else {
                this.wandBtnEl.removeClass('active');
                const modeLabel = this.timelapseMode === 'vanilla' ? 'Vanilla 0.025s/node' : 'Date-based';
                this.wandBtnEl.setAttribute('title', `Start timelapse animation (${modeLabel})`);
            }
        }
        if (this.timelinePlayBtnEl) {
            setIcon(this.timelinePlayBtnEl, this.isTimelapseRunning ? 'pause' : 'play');
        }
    }

    private updateScopeBar(): void {
        if (!this.scopeBarEl) return;
        this.scopeBarEl.empty();

        const showBreadcrumbs = this.plugin.settings.bubbleShowBreadcrumbs !== false;

        if (!this.scopedFolder) {
            // Unscoped: Showing All Notes in Vault
            const rootBadge = this.scopeBarEl.createDiv({ cls: 'pakcli-scope-badge root', title: 'Showing all notes in vault' });
            setIcon(rootBadge.createSpan({ cls: 'pakcli-scope-icon' }), 'globe');
            rootBadge.createSpan({ text: 'All Notes', cls: 'pakcli-scope-text' });
            return;
        }

        // Scoped View Active
        const wrap = this.scopeBarEl.createDiv({ cls: 'pakcli-scope-wrap active' });

        // 1. "⬅ Out" Button (Keluar folder ini / ke parent)
        const outBtn = wrap.createEl('button', {
            cls: 'pakcli-scope-out-btn',
            title: 'Out this folder (Keluar ke parent folder)'
        });
        setIcon(outBtn, 'arrow-up-left');
        outBtn.createSpan({ text: 'Out', cls: 'pakcli-scope-out-label' });
        outBtn.onclick = () => this.scopeToParentFolder();

        // 2. Interactive Breadcrumbs (can be disabled in Settings)
        if (showBreadcrumbs) {
            const crumbsWrap = wrap.createDiv({ cls: 'pakcli-scope-crumbs' });
            
            const rootCrumb = crumbsWrap.createSpan({ cls: 'pakcli-scope-crumb root', text: 'Vault' });
            rootCrumb.onclick = () => this.resetScope();

            const parts = this.scopedFolder.split('/');
            let accumulated = '';

            for (let i = 0; i < parts.length; i++) {
                crumbsWrap.createSpan({ cls: 'pakcli-scope-crumb-sep', text: '/' });
                accumulated = accumulated ? `${accumulated}/${parts[i]}` : parts[i];
                const currentPath = accumulated;
                const isLast = i === parts.length - 1;

                const crumb = crumbsWrap.createSpan({
                    cls: `pakcli-scope-crumb ${isLast ? 'active' : ''}`,
                    text: parts[i],
                    title: isLast ? `Currently scoped to: ${currentPath}` : `Jump up to: ${currentPath}`
                });

                if (!isLast) {
                    crumb.onclick = () => this.scopeToFolder(currentPath);
                }
            }
        } else {
            // Minimal Scope Indicator when breadcrumbs are disabled
            const folderName = this.scopedFolder.split('/').pop() || this.scopedFolder;
            const badge = wrap.createDiv({ cls: 'pakcli-scope-badge scoped', title: `Scoped to: ${this.scopedFolder}` });
            setIcon(badge.createSpan({ cls: 'pakcli-scope-icon' }), 'folder');
            badge.createSpan({ text: folderName, cls: 'pakcli-scope-text' });
        }

        // 3. Reset Button (✕ Show All)
        const resetBtn = wrap.createEl('button', {
            cls: 'pakcli-scope-reset-btn',
            title: 'Reset Scope (Show All notes)'
        });
        setIcon(resetBtn, 'x');
        resetBtn.onclick = () => this.resetScope();
    }

    private updateStatsPill(): void {
        if (!this.statsPillEl || !this.graphData) return;
        const s = this.graphData.stats;
        const scopeLabel = this.scopedFolder ? `[Scoped: ${this.scopedFolder}] ` : '';
        this.statsPillEl.setText(`${scopeLabel}Nodes: ${s.totalNodes}  |  Clusters: ${s.totalClusters}  |  Venn Bridges: ${s.totalVennBridges}`);
    }

    private renderInspector(parent: HTMLElement): void {
        this.inspectorEl = parent.createDiv({ cls: 'pakcli-bubble-inspector' });
        if (!this.isInspectorOpen) {
            this.inspectorEl.addClass('collapsed');
        }
        this.updateInspectorContent();
    }

    private updateInspectorContent(): void {
        if (!this.inspectorEl) return;
        this.inspectorEl.empty();

        const header = this.inspectorEl.createDiv({ cls: 'pakcli-inspector-header' });
        header.createSpan({ text: 'ℹ️ INSPECTOR', cls: 'pakcli-inspector-title' });

        if (this.scopedFolder) {
            const scopeBanner = this.inspectorEl.createDiv({ cls: 'pakcli-inspector-scope-banner' });
            scopeBanner.createSpan({ text: `📍 Scoped: ${this.scopedFolder}`, cls: 'pakcli-inspector-scope-text' });
            const outBtn = scopeBanner.createEl('button', {
                cls: 'pakcli-inspector-out-btn',
                text: '⬅ Out',
                title: 'Out this folder (Keluar ke parent)'
            });
            outBtn.onclick = () => this.scopeToParentFolder();
        }

        if (!this.selectedNode) {
            const emptyState = this.inspectorEl.createDiv({ cls: 'pakcli-inspector-empty' });
            emptyState.createEl('p', { text: 'Click any note on the graph to inspect its hierarchy, Venn bridges, and connections.' });
            return;
        }

        const node = this.selectedNode;
        const details = this.inspectorEl.createDiv({ cls: 'pakcli-inspector-details' });

        // Note Title
        const titleRow = details.createDiv({ cls: 'pakcli-inspector-row' });
        titleRow.createSpan({ text: 'Active Note:', cls: 'pakcli-row-label' });
        titleRow.createEl('strong', { text: `📄 ${node.name}`, cls: 'pakcli-row-value primary' });

        // Folder
        const folderRow = details.createDiv({ cls: 'pakcli-inspector-row' });
        folderRow.createSpan({ text: 'Folder:', cls: 'pakcli-row-label' });
        const folderVal = folderRow.createSpan({ cls: 'pakcli-row-value pakcli-folder-val-wrap' });
        folderVal.createSpan({ text: `📁 ${node.folderPath || '/'}` });

        if (node.folderPath && node.folderPath !== '/' && node.folderPath !== this.scopedFolder) {
            const scopeBtn = folderVal.createEl('button', {
                cls: 'pakcli-inspector-scope-btn',
                text: '🔍 Masuk',
                title: `Masuk folder "${node.folderPath}" (Scope bubble view)`
            });
            scopeBtn.onclick = () => this.scopeToFolder(node.folderPath);
        }

        // Degree Centrality
        const degRow = details.createDiv({ cls: 'pakcli-inspector-row' });
        degRow.createSpan({ text: 'Degree Centrality:', cls: 'pakcli-row-label' });
        degRow.createSpan({ text: `${node.totalDegree} connections`, cls: 'pakcli-row-value' });

        // Scope Affinity
        const connectedEdges = this.graphData.edges.filter(e => e.source === node.id || e.target === node.id);
        const intraEdges = connectedEdges.filter(e => e.tier === 'tier1_intra');
        const affinityPercent = connectedEdges.length > 0
            ? Math.round((intraEdges.length / connectedEdges.length) * 100)
            : 100;

        const affinityRow = details.createDiv({ cls: 'pakcli-inspector-row' });
        affinityRow.createSpan({ text: 'Scope Affinity:', cls: 'pakcli-row-label' });
        affinityRow.createSpan({ text: `${affinityPercent}% Cluster`, cls: 'pakcli-row-value highlight' });

        // Backlinks Section
        const backSection = details.createDiv({ cls: 'pakcli-inspector-section' });
        const backlinks = this.graphData.edges
            .filter(e => e.target === node.id && e.sourceNode)
            .map(e => e.sourceNode);
        backSection.createEl('h4', { text: `Backlinks (${backlinks.length}):` });
        const backList = backSection.createDiv({ cls: 'pakcli-link-list' });
        if (backlinks.length === 0) {
            backList.createSpan({ text: 'None', cls: 'pakcli-muted' });
        } else {
            backlinks.forEach(b => {
                const item = backList.createDiv({ text: `• ${b.name}`, cls: 'pakcli-link-item' });
                item.onclick = () => this.selectNode(b, true);
            });
        }

        // Outgoing Links Section
        const outSection = details.createDiv({ cls: 'pakcli-inspector-section' });
        const outgoing = this.graphData.edges
            .filter(e => e.source === node.id && e.targetNode)
            .map(e => e.targetNode);
        outSection.createEl('h4', { text: `Outgoing (${outgoing.length}):` });
        const outList = outSection.createDiv({ cls: 'pakcli-link-list' });
        if (outgoing.length === 0) {
            outList.createSpan({ text: 'None', cls: 'pakcli-muted' });
        } else {
            outgoing.forEach(o => {
                const item = outList.createDiv({ text: `• ${o.name}`, cls: 'pakcli-link-item' });
                item.onclick = () => this.selectNode(o, true);
            });
        }

        // Open Note Button
        const openBtn = details.createEl('button', {
            text: 'Open Note ↗',
            cls: 'pakcli-open-note-btn'
        });
        openBtn.onclick = () => {
            this.openNoteInWorkspace(node.id);
        };
    }

    private renderTimelineScrubber(container: HTMLElement): void {
        const timelineEl = container.createDiv({ cls: 'pakcli-timeline-minimap' });

        this.timelinePlayBtnEl = timelineEl.createEl('button', {
            cls: 'pakcli-timeline-nav pakcli-timeline-play-btn',
            title: 'Play / Pause Timelapse'
        });
        setIcon(this.timelinePlayBtnEl, 'play');
        this.timelinePlayBtnEl.onclick = () => this.toggleTimelapse();

        const restartBtn = timelineEl.createEl('button', {
            cls: 'pakcli-timeline-nav',
            title: 'Restart from Oldest Note'
        });
        setIcon(restartBtn, 'rotate-ccw');
        restartBtn.onclick = () => {
            this.timelapseProgress = 0.0;
            this.lastVisibleCount = -1;
            this.startTimelapse();
        };

        timelineEl.createSpan({ text: '⏱ TIMELAPSE:', cls: 'pakcli-timeline-label' });

        // Mode Segmented Buttons: [ Date | Vanilla (0.025s) ]
        const modeGroup = timelineEl.createDiv({ cls: 'pakcli-timelapse-mode-group' });
        const dateModeBtn = modeGroup.createEl('button', {
            text: 'Date',
            cls: `pakcli-timelapse-mode-btn ${this.timelapseMode === 'date' ? 'active' : ''}`,
            title: 'Default: Date-based continuous timeline interpolation'
        });
        const vanillaModeBtn = modeGroup.createEl('button', {
            text: 'Vanilla (0.025s)',
            cls: `pakcli-timelapse-mode-btn ${this.timelapseMode === 'vanilla' ? 'active' : ''}`,
            title: 'Vanilla: Sequential spawn (0.025s per node/folder in chronological order)'
        });

        this.timelapseModeButtons = [dateModeBtn, vanillaModeBtn];

        dateModeBtn.onclick = () => {
            this.timelapseMode = 'date';
            dateModeBtn.addClass('active');
            vanillaModeBtn.removeClass('active');
            this.plugin.settings.bubbleTimelapseMode = 'date';
            this.plugin.saveSettings();
            this.lastVisibleCount = -1;
            this.updateTimelineUI();
        };

        vanillaModeBtn.onclick = () => {
            this.timelapseMode = 'vanilla';
            vanillaModeBtn.addClass('active');
            dateModeBtn.removeClass('active');
            this.plugin.settings.bubbleTimelapseMode = 'vanilla';
            this.plugin.saveSettings();
            this.lastVisibleCount = -1;
            this.updateTimelineUI();
        };

        const sliderWrap = timelineEl.createDiv({ cls: 'pakcli-timeline-track-wrap' });
        this.timelineSliderEl = sliderWrap.createEl('input', {
            type: 'range',
            cls: 'pakcli-timeline-slider'
        });
        this.timelineSliderEl.min = '0';
        this.timelineSliderEl.max = '1000';
        this.timelineSliderEl.step = '1';
        this.timelineSliderEl.value = '1000';

        this.timelineSliderEl.oninput = () => {
            this.timelapseProgress = parseFloat(this.timelineSliderEl.value) / 1000;
            this.lastVisibleCount = -1;
            this.updateTimelineUI();
        };

        this.timelineDateBadgeEl = timelineEl.createDiv({ cls: 'pakcli-timeline-date-badge' });
        this.updateTimelineUI();
    }

    private setupCanvasEvents(): void {
        const canvas = this.canvasEl;

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            const newZoom = Math.min(4.0, Math.max(0.15, this.transform.zoom * zoomFactor));

            // Zoom toward mouse position
            const rect = canvas.getBoundingClientRect();
            const mouseScreenX = e.clientX - rect.left - canvas.width / 2;
            const mouseScreenY = e.clientY - rect.top - canvas.height / 2;

            this.transform.panX -= (mouseScreenX - this.transform.panX) * (zoomFactor - 1);
            this.transform.panY -= (mouseScreenY - this.transform.panY) * (zoomFactor - 1);
            this.transform.zoom = newZoom;
        });

        canvas.addEventListener('mousedown', (e) => {
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const clickedNode = this.findNodeAt(worldPos.x, worldPos.y);

            if (clickedNode) {
                this.isDraggingNode = true;
                this.simulation.startDrag(clickedNode, worldPos.x, worldPos.y);
            } else {
                this.isPanning = true;
                this.panStartX = e.clientX - this.transform.panX;
                this.panStartY = e.clientY - this.transform.panY;
            }
        });

        window.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                if (!this.isPanning && !this.isDraggingNode) return;
            }

            const worldPos = this.screenToWorld(e.clientX, e.clientY);

            if (this.isDraggingNode) {
                this.simulation.updateDrag(worldPos.x, worldPos.y);
            } else if (this.isPanning) {
                this.transform.panX = e.clientX - this.panStartX;
                this.transform.panY = e.clientY - this.panStartY;
            } else {
                // Hover Detection
                const node = this.findNodeAt(worldPos.x, worldPos.y);
                this.hoveredNode = node;
                canvas.setCssStyles({ cursor: node ? 'pointer' : 'grab' });

                // Check cluster hover if no node hovered
                if (!node && this.graphData) {
                    this.hoveredCluster = this.findClusterAt(worldPos.x, worldPos.y);
                } else {
                    this.hoveredCluster = null;
                }
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDraggingNode) {
                this.simulation.endDrag();
                this.isDraggingNode = false;
            }
            this.isPanning = false;
        });

        canvas.addEventListener('click', (e) => {
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const clickedNode = this.findNodeAt(worldPos.x, worldPos.y);
            if (clickedNode) {
                this.selectNode(clickedNode, false);
            }
        });

        canvas.addEventListener('dblclick', (e) => {
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const clickedNode = this.findNodeAt(worldPos.x, worldPos.y);
            if (clickedNode) {
                this.openNoteInWorkspace(clickedNode.id);
            }
        });

        canvas.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const clickedNode = this.findNodeAt(worldPos.x, worldPos.y);
            const clickedCluster = !clickedNode ? this.findClusterAt(worldPos.x, worldPos.y) : null;

            const menu = new Menu();

            if (clickedNode) {
                const targetFolder = clickedNode.folderPath;
                if (targetFolder && targetFolder !== '/' && targetFolder !== this.scopedFolder) {
                    menu.addItem((item) => {
                        item.setTitle(`Masuk folder "${targetFolder}"`)
                            .setIcon('folder-input')
                            .onClick(() => {
                                this.scopeToFolder(targetFolder);
                            });
                    });
                }

                menu.addItem((item) => {
                    item.setTitle(`Open "${clickedNode.name}"`)
                        .setIcon('file-text')
                        .onClick(() => {
                            this.openNoteInWorkspace(clickedNode.id);
                        });
                });

                menu.addSeparator();
            } else if (clickedCluster) {
                if (clickedCluster.id !== this.scopedFolder) {
                    menu.addItem((item) => {
                        item.setTitle(`Masuk folder "${clickedCluster.name}"`)
                            .setIcon('folder-input')
                            .onClick(() => {
                                this.scopeToFolder(clickedCluster.id);
                            });
                    });
                }
                menu.addSeparator();
            }

            if (this.scopedFolder) {
                menu.addItem((item) => {
                    item.setTitle('Out this folder (Keluar ke parent)')
                        .setIcon('arrow-up-left')
                        .onClick(() => {
                            this.scopeToParentFolder();
                        });
                });

                menu.addItem((item) => {
                    item.setTitle('Reset Scope (Show All notes)')
                        .setIcon('rotate-ccw')
                        .onClick(() => {
                            this.resetScope();
                        });
                });

                menu.addSeparator();
            }

            menu.addItem((item) => {
                item.setTitle('Fit to View')
                    .setIcon('maximize-2')
                    .onClick(() => this.fitToView());
            });

            menu.addItem((item) => {
                item.setTitle('Refresh Graph')
                    .setIcon('refresh-cw')
                    .onClick(() => this.reloadGraphData());
            });

            menu.addItem((item) => {
                item.setTitle('Reset View Settings to Default')
                    .setIcon('rotate-ccw')
                    .onClick(() => this.resetViewSettings());
            });

            menu.showAtMouseEvent(e);
        });
    }

    private setupResizeObserver(wrapEl: HTMLElement): void {
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    this.canvasEl.width = width;
                    this.canvasEl.height = height;
                }
            }
        });
        resizeObserver.observe(wrapEl);
    }

    private startRenderLoop(): void {
        let lastTime = performance.now();

        const renderLoop = (time: number) => {
            const dt = Math.min(64, time - lastTime);
            lastTime = time;

            if (this.isTimelapseRunning) {
                if (this.timelapseMode === 'vanilla') {
                    // Vanilla mode: 0.025s (25ms) per node / folder in chronological order
                    const delayPerNodeMs = (this.plugin.settings.bubbleTimelapseVanillaSpeed ?? 0.025) * 1000;
                    const totalDurationMs = Math.max(500, this.sortedNodes.length * delayPerNodeMs);
                    this.timelapseProgress += dt / totalDurationMs;
                } else {
                    // Default Date-based mode: ~12s continuous time range interpolation
                    this.timelapseProgress += dt / 12000;
                }

                if (this.timelapseProgress >= 1.0) {
                    this.timelapseProgress = 1.0;
                    this.pauseTimelapse();
                }
                this.updateTimelineUI();
            }

            let renderVisibleNodeIds: Set<string> | null = null;
            let renderCutoff: number | null = null;

            if (this.timelapseProgress < 0.999) {
                if (this.timelapseMode === 'vanilla') {
                    const count = Math.round(this.timelapseProgress * this.sortedNodes.length);
                    renderVisibleNodeIds = new Set(this.sortedNodes.slice(0, count).map(n => n.id));
                } else {
                    renderCutoff = this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress;
                    renderVisibleNodeIds = new Set(this.graphData.nodes.filter(n => n.ctime <= renderCutoff).map(n => n.id));
                }
            }

            const currentVisibleCount = renderVisibleNodeIds ? renderVisibleNodeIds.size : (this.graphData ? this.graphData.nodes.length : 0);
            if (currentVisibleCount !== this.lastVisibleCount) {
                this.lastVisibleCount = currentVisibleCount;
                if (this.simulation) {
                    this.simulation.reheat(0.35);
                }
            }

            if (this.simulation) {
                this.simulation.step(renderVisibleNodeIds);
            }

            if (this.renderer && this.graphData) {

                const renderState: RenderState = {
                    nodes: this.graphData.nodes,
                    edges: this.graphData.edges,
                    clusters: this.graphData.clusters,
                    nodeMap: this.graphData.nodeMap,
                    layoutMode: this.layoutMode,
                    hoveredNode: this.hoveredNode,
                    hoveredCluster: this.hoveredCluster,
                    selectedNode: this.selectedNode,
                    searchQuery: this.searchQuery,
                    scopeFilter: this.scopeFilter,
                    scopedFolder: this.scopedFolder,
                    showVennBridges: this.plugin.settings.bubbleShowVennBridges !== false,
                    interLinkGlow: this.plugin.settings.bubbleInterLinkGlow !== false,
                    showLines: this.showLines,
                    showLabels: this.showLabels,
                    labelRangeLevel: this.labelRangeLevel,
                    labelFontSize: this.labelFontSize,
                    hullOpacity: this.plugin.settings.bubbleHullOpacity || 0.12,
                    intraLinkOpacity: this.plugin.settings.bubbleIntraLinkOpacity || 0.2,
                    timelapseCtimeCutoff: renderCutoff,
                    timelapseVisibleNodeIds: renderVisibleNodeIds
                };

                this.renderer.render(this.transform, renderState, time);
            }

            this.animFrameId = window.requestAnimationFrame(renderLoop);
        };

        this.animFrameId = window.requestAnimationFrame(renderLoop);
    }

    private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
        const rect = this.canvasEl.getBoundingClientRect();
        const screenX = clientX - rect.left - this.canvasEl.width / 2;
        const screenY = clientY - rect.top - this.canvasEl.height / 2;

        return {
            x: (screenX - this.transform.panX) / this.transform.zoom,
            y: (screenY - this.transform.panY) / this.transform.zoom
        };
    }

    private findNodeAt(worldX: number, worldY: number): BubbleNode | null {
        if (!this.graphData) return null;

        let visibleSet: Set<string> | null = null;
        let cutoff: number | null = null;

        if (this.timelapseProgress < 0.999) {
            if (this.timelapseMode === 'vanilla') {
                const count = Math.round(this.timelapseProgress * this.sortedNodes.length);
                visibleSet = new Set(this.sortedNodes.slice(0, count).map(n => n.id));
            } else {
                cutoff = this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress;
            }
        }

        for (let i = this.graphData.nodes.length - 1; i >= 0; i--) {
            const node = this.graphData.nodes[i];
            if (visibleSet && !visibleSet.has(node.id)) continue;
            if (cutoff && node.ctime > cutoff) continue;
            const dist = Math.hypot(node.x - worldX, node.y - worldY);
            if (dist <= node.radius + 4) {
                return node;
            }
        }
        return null;
    }

    private findClusterAt(worldX: number, worldY: number): BubbleCluster | null {
        if (!this.graphData) return null;

        let visibleSet: Set<string> | null = null;
        let cutoff: number | null = null;

        if (this.timelapseProgress < 0.999) {
            if (this.timelapseMode === 'vanilla') {
                const count = Math.round(this.timelapseProgress * this.sortedNodes.length);
                visibleSet = new Set(this.sortedNodes.slice(0, count).map(n => n.id));
            } else {
                cutoff = this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress;
            }
        }

        // Check nested subclusters (depth 2) before parent clusters (depth 1)
        const sorted = [...this.graphData.clusters].sort((a, b) => b.depth - a.depth);

        for (const cluster of sorted) {
            if (cluster.radius <= 0) continue;
            if (this.scopedFolder && (
                cluster.id === this.scopedFolder ||
                (cluster as any).folderPath === this.scopedFolder ||
                cluster.id === normalizePath(this.scopedFolder) ||
                (this.scopedFolder && cluster.depth === 1)
            )) continue;

            if (visibleSet || cutoff) {
                const hasVisible = cluster.nodeIds.some(id => {
                    const n = this.graphData.nodeMap.get(id);
                    if (!n) return false;
                    if (visibleSet) return visibleSet.has(id);
                    if (cutoff) return n.ctime <= cutoff;
                    return true;
                });
                if (!hasVisible) continue;
            }

            const dist = Math.hypot(worldX - cluster.centroid.x, worldY - cluster.centroid.y);
            if (dist <= cluster.radius) {
                return cluster;
            }
        }
        return null;
    }

    public selectNode(node: BubbleNode, centerCamera: boolean = true): void {
        this.selectedNode = node;
        this.updateInspectorContent();

        if (centerCamera) {
            this.transform.panX = -node.x * this.transform.zoom;
            this.transform.panY = -node.y * this.transform.zoom;
        }
    }

    public openNoteInWorkspace(filePath: string): void {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    private fitToView(): void {
        if (!this.graphData || this.graphData.nodes.length === 0) {
            this.transform = { panX: 0, panY: 0, zoom: 1 };
            return;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const node of this.graphData.nodes) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x);
            maxY = Math.max(maxY, node.y);
        }

        if (this.layoutMode === 'bubble') {
            for (const c of this.graphData.clusters) {
                if (c.radius > 0) {
                    minX = Math.min(minX, c.centroid.x - c.radius);
                    minY = Math.min(minY, c.centroid.y - c.radius);
                    maxX = Math.max(maxX, c.centroid.x + c.radius);
                    maxY = Math.max(maxY, c.centroid.y + c.radius);
                }
            }
        }

        if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
            this.transform = { panX: 0, panY: 0, zoom: 1 };
            return;
        }

        const width = Math.max(80, maxX - minX + 60);
        const height = Math.max(80, maxY - minY + 60);
        const canvasW = this.canvasEl.width > 0 ? this.canvasEl.width : 800;
        const canvasH = this.canvasEl.height > 0 ? this.canvasEl.height : 600;
        const scaleX = canvasW / width;
        const scaleY = canvasH / height;
        const newZoom = Math.min(2.5, Math.max(0.3, Math.min(scaleX, scaleY)));

        this.transform.zoom = newZoom;
        this.transform.panX = -((minX + maxX) / 2) * newZoom;
        this.transform.panY = -((minY + maxY) / 2) * newZoom;
    }
}
