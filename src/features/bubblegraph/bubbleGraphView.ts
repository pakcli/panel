import { ItemView, WorkspaceLeaf, setIcon, TFile, Menu, normalizePath, Notice } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DEFAULT_BUBBLE_GRAPH_SETTINGS } from '../../settings';
import { BubbleNode, BubbleCluster } from './types';
import { buildVaultGraph, BuiltGraph, getFolderColor, matchFolderRule, getNodeEffectiveTime, getNodeLatestTime } from './graphBuilder';
import { BubbleSimulation } from './simulation';
import { CanvasRenderer, ViewportTransform, RenderState } from './canvasRenderer';
import { SfxManager } from './sfxManager';

export const BUBBLE_GRAPH_VIEW_TYPE = 'pakcli-bubble-graph';

export class BubbleGraphView extends ItemView {
    private plugin: PakCLITablePlugin;
    private canvasEl!: HTMLCanvasElement;
    private renderer!: CanvasRenderer;
    private simulation!: BubbleSimulation;
    private sfxManager!: SfxManager;

    private graphData!: BuiltGraph;
    private transform: ViewportTransform = { panX: 0, panY: 0, zoom: 1.0 };
    private animFrameId: number | null = null;

    // Interactive State
    private layoutMode: 'bubble' | 'default' = 'bubble';
    private maxDragDepth: number = 2;
    private isSimulationLocked: boolean = false;
    private hoveredNode: BubbleNode | null = null;
    private hoveredCluster: BubbleCluster | null = null;
    private selectedNode: BubbleNode | null = null;
    private searchQuery: string = '';
    private scopeFilter: string = 'all';
    private scopedFolder: string | null = null;

    // Label & Line Controls
    private showLabels: boolean = true;
    private labelMode: 'hide' | 'all' | 'folder' | 'text' | 'custom' = 'all';
    private customLabelFormats: string = 'md, canvas, json, base, csv, folder';
    private customLabelFormatsSet: Set<string> = new Set(['md', 'canvas', 'json', 'base', 'csv', 'folder']);
    private showLines: boolean = true;
    private labelMinLevel: number = 1; // 1 to 4
    private labelMaxLevel: number = 2; // 1 to 4
    private labelRangeLevel: number = 2; // legacy single level fallback
    private labelFontSize: number = 11; // 8 - 24px

    // Timelapse State
    private timelapseMode: 'vanilla' | 'time' | 'filename' | 'title' = 'vanilla';
    private sortedNodes: BubbleNode[] = [];
    private isTimelapseRunning: boolean = false;
    private timelapseProgress: number = 1.0; // 0.0 (oldest) to 1.0 (present)
    private timelapseMinCtime: number = 0;
    private timelapseMaxCtime: number = 0;
    private lastVisibleCount: number = -1;
    private timelapseSpawnedClusters: Set<string> = new Set();
    private timelapseConnectedEdges: Set<string> = new Set();

    // Drag / Pan state
    private isPanning: boolean = false;
    private panStartX: number = 0;
    private panStartY: number = 0;
    private isDraggingNode: boolean = false;
    private isDraggingCluster: boolean = false;

    // UI Elements
    private headerEl!: HTMLElement;
    private statsPillEl: HTMLElement | null = null;
    private scopeBarEl!: HTMLElement;
    private inspectorEl!: HTMLElement;
    private inspectorBtnEl!: HTMLElement;
    private isInspectorOpen: boolean = true;
    private isHeaderSettingsOpen: boolean = true;
    private isFloatingToolsOpen: boolean = true;
    private isFooterOpen: boolean = true;
    private autoFitMode: 'off' | 'fit' | 'center' = 'off';
    private isFullscreen: boolean = false;
    private topSettingsToggleBtnEl!: HTMLElement;
    private floatingToolsToggleBtnEl!: HTMLElement;
    private footerToggleBtnEl!: HTMLElement;
    private fullscreenBtnEl!: HTMLElement;
    private fitModeBtnEl: HTMLElement | null = null;
    private centerModeBtnEl: HTMLElement | null = null;
    private floatingToolsEl: HTMLElement | null = null;
    private headerControlsWrapEl!: HTMLElement;
    private row2El!: HTMLElement;
    private timelineEl!: HTMLElement;
    private depthGroupEl: HTMLElement | null = null;
    private simLockGroupEl: HTMLElement | null = null;
    private simFreeBtnEl: HTMLButtonElement | null = null;
    private simLockBtnEl: HTMLButtonElement | null = null;
    private depthButtons: HTMLElement[] = [];
    private wandBtnEl: HTMLElement | null = null;
    private linesToggleBtnEl!: HTMLElement;
    private textToggleBtnEl: HTMLElement | null = null;
    private labelModeSelectEl: HTMLSelectElement | null = null;
    private customFormatInputEl: HTMLInputElement | null = null;
    private captainColorsBtnEl!: HTMLElement;
    private sfxToggleBtnEl!: HTMLElement;
    private volumeSliderEl!: HTMLInputElement;
    private volumeDisplayEl!: HTMLElement;
    private levelMinSliderEl!: HTMLInputElement;
    private levelMaxSliderEl!: HTMLInputElement;
    private levelHighlightEl!: HTMLElement;
    private levelGrayoutEl: HTMLElement | null = null;
    private levelDisplayEl!: HTMLElement;
    private levelResetBtnEl!: HTMLElement;
    private fontSizeSliderEl!: HTMLInputElement;
    private fontSizeDisplayEl!: HTMLElement;
    private timelinePlayBtnEl!: HTMLElement;
    private timelineSliderEl!: HTMLInputElement;
    private timelineCanvasEl!: HTMLCanvasElement;
    private timelineThumbTipEl!: HTMLElement;
    private timelineDateBadgeEl!: HTMLElement;
    private timelapseModeSelectEl: HTMLSelectElement | null = null;

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
        container.style.overflow = 'hidden';

        this.layoutMode = this.plugin.settings.bubbleDefaultLayout || 'bubble';
        this.maxDragDepth = this.plugin.settings.bubbleMaxDragDepth ?? DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleMaxDragDepth;
        this.isSimulationLocked = Boolean(this.plugin.settings.bubbleSimulationLocked);
        this.labelMode = (this.plugin.settings.bubbleLabelMode as any) || 'all';
        if ((this.labelMode as string) === 'off') this.labelMode = 'hide';
        this.showLabels = this.plugin.settings.bubbleShowLabels !== false && this.labelMode !== 'hide';
        if (!this.showLabels) this.labelMode = 'hide';
        this.customLabelFormats = this.plugin.settings.bubbleLabelCustomFormats || 'md, canvas, json, base, csv, folder';
        this.updateCustomLabelFormatsSet(this.customLabelFormats);
        const savedTimelapse = this.plugin.settings.bubbleTimelapseMode as string;
        if (savedTimelapse === 'date') {
            this.timelapseMode = 'time';
        } else if (savedTimelapse === 'time' || savedTimelapse === 'filename' || savedTimelapse === 'title' || savedTimelapse === 'vanilla') {
            this.timelapseMode = savedTimelapse;
        } else {
            this.timelapseMode = 'vanilla';
        }
        this.labelMinLevel = this.plugin.settings.bubbleLabelMinLevel ?? 1;
        this.labelMaxLevel = this.plugin.settings.bubbleLabelMaxLevel ?? (this.plugin.settings.bubbleLabelRangeLevel ?? 2);
        this.labelRangeLevel = this.labelMaxLevel;
        this.labelFontSize = this.plugin.settings.bubbleLabelFontSize ?? DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelFontSize;
        this.isInspectorOpen = this.plugin.settings.bubbleInspectorOpen !== false;
        this.isHeaderSettingsOpen = this.plugin.settings.bubbleHeaderSettingsOpen !== false;
        this.isFloatingToolsOpen = this.plugin.settings.bubbleFloatingToolsOpen !== false;
        this.isFooterOpen = this.plugin.settings.bubbleFooterOpen !== false;
        this.autoFitMode = this.plugin.settings.bubbleAutoFitMode || (this.plugin.settings.bubbleAlwaysFit ? 'fit' : 'off');

        // Initialize Procedural SFX Engine
        this.sfxManager = new SfxManager(
            this.plugin.settings.bubbleEnableSfx !== false,
            this.plugin.settings.bubbleSfxVolume ?? DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleSfxVolume
        );

        // 1. Build Header Bar
        this.renderHeader(container);

        // 2. Build Workspace Split Area (Canvas + Inspector)
        const workspaceEl = container.createDiv({ cls: 'pakcli-bubble-workspace' });

        const canvasWrap = workspaceEl.createDiv({ cls: 'pakcli-bubble-canvas-wrap' });
        this.canvasEl = canvasWrap.createEl('canvas', { cls: 'pakcli-bubble-canvas' });
        this.renderer = new CanvasRenderer(this.canvasEl);

        // Render Floating Canvas Tools (Search, Fit, Refresh, Reset View)
        this.renderCanvasFloatingTools(canvasWrap);

        this.renderInspector(workspaceEl);

        // 3. Build Bottom Timeline Minimap Scrubber
        this.renderTimelineScrubber(container);

        // 4. Initialize Graph & Simulation
        this.reloadGraphData();

        // 5. Setup Event Listeners
        this.setupCanvasEvents();
        this.setupResizeObserver(canvasWrap);

        // Listen for HTML5 Fullscreen changes (Clean 2-mode: "this" <-> "grand full screen")
        this.registerDomEvent(document, 'fullscreenchange', () => {
            const isNativeFs = !!(document.fullscreenElement === this.contentEl || document.fullscreenElement === this.containerEl);
            if (!isNativeFs) {
                // If native fullscreen was exited via ESC / OS, cleanly return to normal ("this")
                this.contentEl.removeClass('pakcli-view-fullscreen');
                this.isFullscreen = false;
            } else {
                this.isFullscreen = true;
                this.contentEl.addClass('pakcli-view-fullscreen');
            }
            this.updateFullscreenUI();
            setTimeout(() => {
                this.renderer?.resize();
                this.drawHeatmap();
            }, 60);
        });

        // Listen for ESC to exit fullscreen cleanly back to "this", and Space to toggle timelapse
        this.registerDomEvent(window, 'keydown', (evt: KeyboardEvent) => {
            if (evt.key === 'Escape') {
                if (document.fullscreenElement) {
                    try { document.exitFullscreen(); } catch {}
                }
                if (this.contentEl.hasClass('pakcli-view-fullscreen')) {
                    this.toggleCssFullscreen(false);
                }
            } else if (evt.code === 'Space' && (evt.target === this.contentEl || this.contentEl.contains(evt.target as Node))) {
                if ((evt.target as HTMLElement)?.tagName === 'INPUT') return;
                evt.preventDefault();
                this.toggleTimelapse();
            }
        });

        // Listen for active note changes in Obsidian workspace
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file && this.graphData) {
                    const activePath = file.path;
                    let foundNode: BubbleNode | null = null;
                    for (const node of this.graphData.nodes) {
                        node.isActive = Boolean(this.isInspectorOpen && node.id === activePath);
                        if (node.isActive) {
                            foundNode = node;
                        }
                    }
                    if (this.isInspectorOpen && foundNode) {
                        this.selectNode(foundNode, false);
                    } else if (!this.isInspectorOpen) {
                        this.selectedNode = null;
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
        if (this.isFullscreen && document.fullscreenElement) {
            try {
                await document.exitFullscreen();
            } catch { /* ignore */ }
        }
        if (this.animFrameId !== null) {
            window.cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        if (this.sfxManager) {
            this.sfxManager.dispose();
        }
    }

    public scopeToFolder(folderPath: string | null): void {
        this.scopedFolder = (folderPath && folderPath !== '/' && folderPath !== '.') ? normalizePath(folderPath) : null;
        this.reloadGraphData();
        this.syncLevelControls();
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
        this.labelMode = (DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelMode as any) || 'all';
        if ((this.labelMode as string) === 'off') this.labelMode = 'hide';
        this.customLabelFormats = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelCustomFormats || 'md, canvas, json, base, csv, folder';
        this.updateCustomLabelFormatsSet(this.customLabelFormats);
        this.useCaptainColors = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleUseCaptainColors;
        this.labelRangeLevel = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelRangeLevel;
        this.labelMinLevel = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelMinLevel;
        this.labelMaxLevel = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelMaxLevel;
        this.labelFontSize = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelFontSize;
        this.isInspectorOpen = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleInspectorOpen;
        this.isHeaderSettingsOpen = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleHeaderSettingsOpen !== false;
        this.isFloatingToolsOpen = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleFloatingToolsOpen !== false;
        this.isFooterOpen = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleFooterOpen !== false;
        this.autoFitMode = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleAutoFitMode ?? 'off';
        this.timelapseMode = (DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleTimelapseMode || 'vanilla') as 'vanilla' | 'time' | 'filename' | 'title';
        this.isSimulationLocked = false;

        // 2. Persist to plugin settings
        this.plugin.settings.bubbleMaxDragDepth = this.maxDragDepth;
        this.plugin.settings.bubbleSimulationLocked = false;
        this.plugin.settings.bubbleShowLines = this.showLines;
        this.plugin.settings.bubbleShowLabels = this.showLabels;
        this.plugin.settings.bubbleLabelMode = this.labelMode;
        this.plugin.settings.bubbleLabelCustomFormats = this.customLabelFormats;
        this.plugin.settings.bubbleUseCaptainColors = this.useCaptainColors;
        this.plugin.settings.bubbleLabelRangeLevel = this.labelRangeLevel;
        this.plugin.settings.bubbleLabelMinLevel = this.labelMinLevel;
        this.plugin.settings.bubbleLabelMaxLevel = this.labelMaxLevel;
        this.plugin.settings.bubbleLabelFontSize = this.labelFontSize;
        this.plugin.settings.bubbleInspectorOpen = this.isInspectorOpen;
        this.plugin.settings.bubbleHeaderSettingsOpen = this.isHeaderSettingsOpen;
        this.plugin.settings.bubbleFloatingToolsOpen = this.isFloatingToolsOpen;
        this.plugin.settings.bubbleFooterOpen = this.isFooterOpen;
        this.plugin.settings.bubbleAutoFitMode = this.autoFitMode;
        this.plugin.settings.bubbleAlwaysFit = this.autoFitMode !== 'off';
        this.plugin.settings.bubbleTimelapseMode = this.timelapseMode;
        this.plugin.settings.bubbleEnableSfx = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleEnableSfx;
        this.plugin.settings.bubbleSfxVolume = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleSfxVolume;
        this.plugin.settings.bubbleSfxThreshold = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleSfxThreshold;
        if (this.sfxManager) {
            this.sfxManager.setEnabled(DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleEnableSfx);
            this.sfxManager.setVolume(DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleSfxVolume);
        }
        if (this.simulation) {
            this.simulation.setOptions({ sfxThreshold: DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleSfxThreshold });
        }
        await this.plugin.saveSettings();

        // 3. Update UI states
        if (this.linesToggleBtnEl) {
            this.linesToggleBtnEl.toggleClass('active', this.showLines);
            this.linesToggleBtnEl.setAttribute('aria-pressed', this.showLines ? 'true' : 'false');
        }
        if (this.textToggleBtnEl) {
            this.textToggleBtnEl.toggleClass('active', this.showLabels);
            this.textToggleBtnEl.setAttribute('aria-pressed', this.showLabels ? 'true' : 'false');
        }
        if (this.customFormatInputEl) {
            this.customFormatInputEl.value = this.customLabelFormats;
        }
        this.updateLabelModeUI();
        if (this.captainColorsBtnEl) {
            this.captainColorsBtnEl.toggleClass('active', this.useCaptainColors);
            this.captainColorsBtnEl.setAttribute('aria-pressed', this.useCaptainColors ? 'true' : 'false');
        }
        if (this.sfxToggleBtnEl) {
            this.sfxToggleBtnEl.toggleClass('active', DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleEnableSfx);
            this.sfxToggleBtnEl.setAttribute('aria-pressed', DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleEnableSfx ? 'true' : 'false');
            setIcon(this.sfxToggleBtnEl, DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleEnableSfx ? 'volume-2' : 'volume-x');
        }
        if (this.volumeSliderEl) {
            const defVol = Math.round(DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleSfxVolume * 100);
            this.volumeSliderEl.value = defVol.toString();
            this.volumeSliderEl.title = `Sound FX Volume: ${defVol}%`;
            if (this.volumeDisplayEl) {
                this.volumeDisplayEl.setText(`${defVol}%`);
            }
        }
        await this.setSimulationLocked(false);
        this.syncLevelControls();
        if (this.fontSizeSliderEl) {
            this.fontSizeSliderEl.value = this.labelFontSize.toString();
        }
        if (this.fontSizeDisplayEl) {
            this.fontSizeDisplayEl.setText(`${this.labelFontSize}px`);
        }
        if (this.inspectorEl) {
            this.inspectorEl.toggleClass('collapsed', !this.isInspectorOpen);
        }
        if (this.inspectorBtnEl) {
            this.inspectorBtnEl.toggleClass('active', this.isInspectorOpen);
            this.inspectorBtnEl.setAttribute('aria-pressed', this.isInspectorOpen ? 'true' : 'false');
            this.inspectorBtnEl.setAttribute('title', this.isInspectorOpen ? 'Hide Inspector Sidepanel' : 'Show Inspector Sidepanel');
        }
        if (this.headerEl) {
            this.headerEl.toggleClass('settings-collapsed', !this.isHeaderSettingsOpen);
        }
        if (this.headerControlsWrapEl) {
            this.headerControlsWrapEl.toggleClass('collapsed', !this.isHeaderSettingsOpen);
        }
        if (this.row2El) {
            this.row2El.toggleClass('collapsed', !this.isHeaderSettingsOpen);
        }
        if (this.topSettingsToggleBtnEl) {
            this.topSettingsToggleBtnEl.toggleClass('active', this.isHeaderSettingsOpen);
            this.topSettingsToggleBtnEl.setAttribute('aria-pressed', this.isHeaderSettingsOpen ? 'true' : 'false');
            this.topSettingsToggleBtnEl.setAttribute('title', this.isHeaderSettingsOpen ? 'Hide Settings' : 'Show Settings');
        }
        if (this.floatingToolsEl) {
            this.floatingToolsEl.toggleClass('collapsed', !this.isFloatingToolsOpen);
        }
        if (this.floatingToolsToggleBtnEl) {
            this.floatingToolsToggleBtnEl.toggleClass('active', this.isFloatingToolsOpen);
            this.floatingToolsToggleBtnEl.setAttribute('aria-pressed', this.isFloatingToolsOpen ? 'true' : 'false');
            this.floatingToolsToggleBtnEl.setAttribute('title', this.isFloatingToolsOpen ? 'Hide Floating Search & Tools' : 'Show Floating Search & Tools');
        }
        this.updateAutoFitUI();
        if (this.timelineEl) {
            this.timelineEl.toggleClass('collapsed', !this.isFooterOpen);
        }
        if (this.footerToggleBtnEl) {
            this.footerToggleBtnEl.toggleClass('active', this.isFooterOpen);
            this.footerToggleBtnEl.setAttribute('aria-pressed', this.isFooterOpen ? 'true' : 'false');
            this.footerToggleBtnEl.setAttribute('title', this.isFooterOpen ? 'Hide Footer Timeline Scrubber' : 'Show Footer Timeline Scrubber');
        }
        if (this.timelapseModeSelectEl) {
            this.timelapseModeSelectEl.value = this.timelapseMode;
        }
        this.sortNodesForCurrentTimelapseMode();
        this.updateTimelineUI();
        this.drawHeatmap();

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
        const glyphSettings = {
            bubbleGlyphIsolated: this.plugin.settings.bubbleGlyphIsolated,
            bubbleGlyphOutgoing: this.plugin.settings.bubbleGlyphOutgoing,
            bubbleGlyphIncoming: this.plugin.settings.bubbleGlyphIncoming,
            bubbleGlyphBoth: this.plugin.settings.bubbleGlyphBoth,
        };
        this.graphData = buildVaultGraph(
            this.app, 
            this.isInspectorOpen && activeFile ? activeFile.path : null, 
            captainRules, 
            this.useCaptainColors, 
            maxDepth, 
            this.scopedFolder,
            glyphSettings
        );

        // Sort all nodes according to active timelapse mode (Vanilla, Time, Filename A-Z, File Title A-Z)
        this.sortNodesForCurrentTimelapseMode();

        // Compute min and max effective time for chronological timelapse
        const birthTimes = this.graphData.nodes.map(n => getNodeEffectiveTime(n)).filter(t => t > 946684800000);
        const latestTimes = this.graphData.nodes.map(n => getNodeLatestTime(n)).filter(t => t > 946684800000);

        if (birthTimes.length > 0) {
            this.timelapseMinCtime = Math.min(...birthTimes);
            this.timelapseMaxCtime = Math.max(...latestTimes, this.timelapseMinCtime + 86400000);
            if (this.timelapseMinCtime >= this.timelapseMaxCtime) {
                this.timelapseMinCtime = this.timelapseMaxCtime - 86400000;
            }
        } else {
            this.timelapseMinCtime = Date.now() - 30 * 86400000;
            this.timelapseMaxCtime = Date.now();
        }
        this.timelapseProgress = 1.0;
        this.isTimelapseRunning = false;
        this.updateTimelineUI();
        this.drawHeatmap();

        this.simulation = new BubbleSimulation(
            this.graphData.nodes,
            this.graphData.edges,
            this.graphData.clusters,
            {
                maxDragDepth: this.maxDragDepth,
                isLocked: this.isSimulationLocked,
                layoutMode: this.layoutMode,
                scopedFolder: this.scopedFolder,
                denseScale: this.plugin.settings.bubbleDenseScale ?? 1.15,
                sfx: this.sfxManager,
                sfxThreshold: this.plugin.settings.bubbleSfxThreshold ?? DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleSfxThreshold
            }
        );

        // Gentle spawn sound cascade on graph initialization / reload
        if (this.sfxManager && this.sfxManager.isEnabled() && this.graphData) {
            const topClusters = this.graphData.clusters.filter(c => c.depth === 1);
            topClusters.forEach((c, idx) => {
                setTimeout(() => {
                    this.sfxManager.playBubbleSpawn(c.depth);
                }, idx * 70);
            });
            const previewNodes = this.graphData.nodes.slice(0, 10);
            previewNodes.forEach((n, idx) => {
                this.sfxManager.playNodeSpawn(n.id, 80 + idx * 30);
            });
        }

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

    private updateCustomLabelFormatsSet(formatsStr: string): void {
        this.customLabelFormats = formatsStr;
        const tokens = formatsStr
            .split(/[,|\s]+/)
            .map(s => s.trim().toLowerCase().replace(/^\./, ''))
            .filter(Boolean);
        this.customLabelFormatsSet = new Set(tokens);
    }

    private updateLabelModeUI(): void {
        if (this.labelModeSelectEl) {
            this.labelModeSelectEl.value = this.labelMode;
        }
        if (this.customFormatInputEl) {
            const isCustom = this.showLabels && this.labelMode === 'custom';
            this.customFormatInputEl.toggleClass('visible', isCustom);
            this.customFormatInputEl.style.display = isCustom ? 'inline-block' : 'none';
        }
    }

    private sortNodesForCurrentTimelapseMode(): void {
        if (!this.graphData) return;
        if (this.timelapseMode === 'filename') {
            this.sortedNodes = [...this.graphData.nodes].sort((a, b) => {
                const folderCmp = (a.folderPath || '').localeCompare(b.folderPath || '', undefined, { numeric: true, sensitivity: 'base' });
                if (folderCmp !== 0) return folderCmp;
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });
        } else if (this.timelapseMode === 'title') {
            this.sortedNodes = [...this.graphData.nodes].sort((a, b) => {
                const folderCmp = (a.folderPath || '').localeCompare(b.folderPath || '', undefined, { numeric: true, sensitivity: 'base' });
                if (folderCmp !== 0) return folderCmp;
                const titleA = (a.title && a.title.trim()) ? a.title.trim() : a.name;
                const titleB = (b.title && b.title.trim()) ? b.title.trim() : b.name;
                return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
            });
        } else {
            // 'vanilla' or 'time': chronological birth order
            this.sortedNodes = [...this.graphData.nodes].sort((a, b) => getNodeEffectiveTime(a) - getNodeEffectiveTime(b));
        }
    }

    public async setTimelapseMode(mode: 'vanilla' | 'time' | 'filename' | 'title'): Promise<void> {
        this.timelapseMode = mode;
        this.plugin.settings.bubbleTimelapseMode = mode;
        await this.plugin.saveSettings();
        this.sortNodesForCurrentTimelapseMode();
        if (this.timelapseModeSelectEl) {
            this.timelapseModeSelectEl.value = mode;
        }
        this.lastVisibleCount = -1;
        this.updateTimelineUI();
        this.drawHeatmap();
    }

    public async setSimulationLocked(locked: boolean): Promise<void> {
        this.isSimulationLocked = locked;
        this.plugin.settings.bubbleSimulationLocked = locked;
        await this.plugin.saveSettings();

        if (this.simFreeBtnEl) {
            this.simFreeBtnEl.toggleClass('active', !locked);
            this.simFreeBtnEl.setAttribute('aria-pressed', !locked ? 'true' : 'false');
        }
        if (this.simLockBtnEl) {
            this.simLockBtnEl.toggleClass('active', locked);
            this.simLockBtnEl.setAttribute('aria-pressed', locked ? 'true' : 'false');
        }

        if (this.simulation) {
            this.simulation.setOptions({ isLocked: locked });
        }

        if (locked) {
            if (this.isTimelapseRunning) {
                this.pauseTimelapse();
            }
            if (this.isDraggingNode || this.isDraggingCluster) {
                this.simulation?.endDrag();
                this.isDraggingNode = false;
                this.isDraggingCluster = false;
            }
        } else {
            this.simulation?.reheat(0.35);
        }

        this.updateTimelapseLockedUI();
        new Notice(locked ? 'Simulation Locked (dragging & timelapse disabled)' : 'Simulation Free (nodes & bubbles draggable)');
    }

    private updateTimelapseLockedUI(): void {
        if (!this.timelineEl) return;
        this.timelineEl.toggleClass('is-locked', this.isSimulationLocked);
        this.timelineEl.toggleClass('pakcli-timeline-disabled', this.isSimulationLocked);

        if (this.wandBtnEl) {
            if (this.isSimulationLocked) this.wandBtnEl.setAttribute('disabled', 'true');
            else this.wandBtnEl.removeAttribute('disabled');
        }
        if (this.timelapseModeSelectEl) {
            this.timelapseModeSelectEl.disabled = this.isSimulationLocked;
        }
        if (this.timelineSliderEl) {
            this.timelineSliderEl.disabled = this.isSimulationLocked;
        }
    }

    private renderHeader(container: HTMLElement): void {
        this.headerEl = container.createDiv({
            cls: `pakcli-bubble-header ${this.isHeaderSettingsOpen ? '' : 'settings-collapsed'}`
        });
        const headerEl = this.headerEl;

        // ==========================================
        // ROW 1: [Left: 4 Toggles + Mode Tabs] [Center: Breadcrumbs] [Right: Depth Scrubber]
        // ==========================================
        const row1 = headerEl.createDiv({ cls: 'pakcli-header-row pakcli-header-row-1' });

        // Left: 4 Toggles + Mode Tabs
        const row1Left = row1.createDiv({ cls: 'pakcli-header-row-left' });
        const quickToggles = row1Left.createDiv({ cls: 'pakcli-header-quick-toggles' });

        // 1. Toggle Top Settings Bar (Gear)
        this.topSettingsToggleBtnEl = quickToggles.createEl('button', {
            cls: `pakcli-icon-btn pakcli-top-settings-btn ${this.isHeaderSettingsOpen ? 'active' : ''}`,
            title: this.isHeaderSettingsOpen ? 'Hide Settings' : 'Show Settings'
        });
        this.topSettingsToggleBtnEl.setAttribute('aria-pressed', this.isHeaderSettingsOpen ? 'true' : 'false');
        setIcon(this.topSettingsToggleBtnEl, 'settings');
        this.topSettingsToggleBtnEl.onclick = async () => {
            this.isHeaderSettingsOpen = !this.isHeaderSettingsOpen;
            this.topSettingsToggleBtnEl.toggleClass('active', this.isHeaderSettingsOpen);
            this.topSettingsToggleBtnEl.setAttribute('aria-pressed', this.isHeaderSettingsOpen ? 'true' : 'false');
            this.topSettingsToggleBtnEl.setAttribute('title', this.isHeaderSettingsOpen ? 'Hide Settings' : 'Show Settings');
            this.headerEl.toggleClass('settings-collapsed', !this.isHeaderSettingsOpen);
            if (this.row2El) {
                this.row2El.toggleClass('collapsed', !this.isHeaderSettingsOpen);
            }
            if (this.headerControlsWrapEl) {
                this.headerControlsWrapEl.toggleClass('collapsed', !this.isHeaderSettingsOpen);
            }
            this.plugin.settings.bubbleHeaderSettingsOpen = this.isHeaderSettingsOpen;
            await this.plugin.saveSettings();
            if (this.sfxManager?.isEnabled()) {
                this.sfxManager.playLinkSwitch();
            }
        };

        // 2. Toggle Floating Canvas Tools (Search & Actions)
        this.floatingToolsToggleBtnEl = quickToggles.createEl('button', {
            cls: `pakcli-icon-btn pakcli-floating-tools-btn ${this.isFloatingToolsOpen ? 'active' : ''}`,
            title: this.isFloatingToolsOpen ? 'Hide Floating Search & Tools' : 'Show Floating Search & Tools'
        });
        this.floatingToolsToggleBtnEl.setAttribute('aria-pressed', this.isFloatingToolsOpen ? 'true' : 'false');
        setIcon(this.floatingToolsToggleBtnEl, 'search');
        this.floatingToolsToggleBtnEl.onclick = async () => {
            this.isFloatingToolsOpen = !this.isFloatingToolsOpen;
            this.floatingToolsToggleBtnEl.toggleClass('active', this.isFloatingToolsOpen);
            this.floatingToolsToggleBtnEl.setAttribute('aria-pressed', this.isFloatingToolsOpen ? 'true' : 'false');
            this.floatingToolsToggleBtnEl.setAttribute('title', this.isFloatingToolsOpen ? 'Hide Floating Search & Tools' : 'Show Floating Search & Tools');
            if (this.floatingToolsEl) {
                this.floatingToolsEl.toggleClass('collapsed', !this.isFloatingToolsOpen);
            }
            this.plugin.settings.bubbleFloatingToolsOpen = this.isFloatingToolsOpen;
            await this.plugin.saveSettings();
            if (this.sfxManager?.isEnabled()) {
                this.sfxManager.playLinkSwitch();
            }
        };

        // 3. Toggle Footer Timeline Scrubber
        this.footerToggleBtnEl = quickToggles.createEl('button', {
            cls: `pakcli-icon-btn pakcli-footer-toggle-btn ${this.isFooterOpen ? 'active' : ''}`,
            title: this.isFooterOpen ? 'Hide Footer Timeline Scrubber' : 'Show Footer Timeline Scrubber'
        });
        this.footerToggleBtnEl.setAttribute('aria-pressed', this.isFooterOpen ? 'true' : 'false');
        setIcon(this.footerToggleBtnEl, 'panel-bottom');
        this.footerToggleBtnEl.onclick = async () => {
            this.isFooterOpen = !this.isFooterOpen;
            this.footerToggleBtnEl.toggleClass('active', this.isFooterOpen);
            this.footerToggleBtnEl.setAttribute('aria-pressed', this.isFooterOpen ? 'true' : 'false');
            this.footerToggleBtnEl.setAttribute('title', this.isFooterOpen ? 'Hide Footer Timeline Scrubber' : 'Show Footer Timeline Scrubber');
            if (this.timelineEl) {
                this.timelineEl.toggleClass('collapsed', !this.isFooterOpen);
            }
            this.plugin.settings.bubbleFooterOpen = this.isFooterOpen;
            await this.plugin.saveSettings();
            if (this.sfxManager?.isEnabled()) {
                this.sfxManager.playLinkSwitch();
            }
            setTimeout(() => this.renderer?.resize(), 50);
        };

        // 4. Toggle Info (Sidepanel Inspector)
        this.inspectorBtnEl = quickToggles.createEl('button', {
            cls: `pakcli-icon-btn pakcli-inspector-toggle-btn ${this.isInspectorOpen ? 'active' : ''}`,
            title: this.isInspectorOpen ? 'Hide Inspector Sidepanel' : 'Show Inspector Sidepanel'
        });
        this.inspectorBtnEl.setAttribute('aria-pressed', this.isInspectorOpen ? 'true' : 'false');
        setIcon(this.inspectorBtnEl, 'info');
        this.inspectorBtnEl.onclick = async () => {
            this.isInspectorOpen = !this.isInspectorOpen;
            if (this.inspectorEl) {
                this.inspectorEl.toggleClass('collapsed', !this.isInspectorOpen);
            }
            this.inspectorBtnEl.toggleClass('active', this.isInspectorOpen);
            this.inspectorBtnEl.setAttribute('aria-pressed', this.isInspectorOpen ? 'true' : 'false');
            this.inspectorBtnEl.setAttribute('title', this.isInspectorOpen ? 'Hide Inspector Sidepanel' : 'Show Inspector Sidepanel');
            this.plugin.settings.bubbleInspectorOpen = this.isInspectorOpen;
            await this.plugin.saveSettings();

            if (this.graphData) {
                const activeFile = this.app.workspace.getActiveFile();
                const activePath = activeFile ? activeFile.path : null;
                for (const node of this.graphData.nodes) {
                    node.isActive = Boolean(this.isInspectorOpen && activePath && node.id === activePath);
                }
                if (this.isInspectorOpen && activePath) {
                    const activeNode = this.graphData.nodes.find(n => n.id === activePath);
                    if (activeNode) {
                        this.selectNode(activeNode, false);
                    }
                } else {
                    this.selectedNode = null;
                }
            }

            if (this.sfxManager?.isEnabled()) {
                this.sfxManager.playLinkSwitch();
            }
            setTimeout(() => this.renderer?.resize(), 50);
        };

        // 5. Toggle Fullscreen (Clean 2-mode: "this" <-> "grand full screen")
        this.fullscreenBtnEl = quickToggles.createEl('button', {
            cls: `pakcli-icon-btn pakcli-fullscreen-btn ${this.isFullscreen ? 'active' : ''}`,
            title: this.isFullscreen ? 'Exit Fullscreen (Kembali ke Normal View)' : 'Grand Fullscreen (Layar Penuh)'
        });
        this.fullscreenBtnEl.setAttribute('aria-pressed', this.isFullscreen ? 'true' : 'false');
        setIcon(this.fullscreenBtnEl, this.isFullscreen ? 'minimize' : 'maximize');
        this.fullscreenBtnEl.onclick = () => {
            this.toggleFullscreen();
            if (this.sfxManager?.isEnabled()) {
                this.sfxManager.playLinkSwitch();
            }
        };
        this.fullscreenBtnEl.oncontextmenu = (e: MouseEvent) => {
            e.preventDefault();
            const menu = new Menu();
            menu.addItem(item => {
                item.setTitle('Grand Fullscreen (Monitor)')
                    .setIcon('maximize')
                    .setChecked(!!document.fullscreenElement)
                    .onClick(async () => {
                        if (document.fullscreenElement) {
                            await document.exitFullscreen();
                        } else {
                            if (this.contentEl.requestFullscreen) {
                                await this.contentEl.requestFullscreen();
                            } else {
                                this.toggleCssFullscreen(true);
                            }
                        }
                    });
            });
            menu.addItem(item => {
                item.setTitle('Panel View Fullscreen (Inside Obsidian)')
                    .setIcon('expand')
                    .setChecked(this.contentEl.hasClass('pakcli-view-fullscreen') && !document.fullscreenElement)
                    .onClick(async () => {
                        if (document.fullscreenElement) {
                            await document.exitFullscreen();
                        }
                        this.toggleCssFullscreen(!this.contentEl.hasClass('pakcli-view-fullscreen'));
                    });
            });
            menu.addItem(item => {
                item.setTitle('Exit Fullscreen (Normal Panel)')
                    .setIcon('minimize')
                    .onClick(async () => {
                        if (document.fullscreenElement) {
                            await document.exitFullscreen();
                        }
                        this.toggleCssFullscreen(false);
                    });
            });
            menu.showAtMouseEvent(e);
        };

        // Mode Tabs: [Graph View] [★ Bubble View]
        const tabsWrap = row1Left.createDiv({ cls: 'pakcli-mode-tabs' });
        const defaultTab = tabsWrap.createEl('button', {
            text: 'Graph View',
            cls: `pakcli-tab-btn ${this.layoutMode === 'default' ? 'active' : ''}`
        });
        defaultTab.setAttribute('aria-pressed', this.layoutMode === 'default' ? 'true' : 'false');
        const bubbleTab = tabsWrap.createEl('button', {
            text: '★ Bubble View',
            cls: `pakcli-tab-btn ${this.layoutMode === 'bubble' ? 'active' : ''}`
        });
        bubbleTab.setAttribute('aria-pressed', this.layoutMode === 'bubble' ? 'true' : 'false');

        const updateDepthVisibility = () => {
            if (this.simLockGroupEl) {
                this.simLockGroupEl.style.display = 'flex';
            }
        };

        defaultTab.onclick = () => {
            this.layoutMode = 'default';
            defaultTab.addClass('active');
            defaultTab.setAttribute('aria-pressed', 'true');
            bubbleTab.removeClass('active');
            bubbleTab.setAttribute('aria-pressed', 'false');
            this.simulation.setOptions({ layoutMode: 'default' });
            updateDepthVisibility();
        };

        bubbleTab.onclick = () => {
            this.layoutMode = 'bubble';
            bubbleTab.addClass('active');
            bubbleTab.setAttribute('aria-pressed', 'true');
            defaultTab.removeClass('active');
            defaultTab.setAttribute('aria-pressed', 'false');
            this.simulation.setOptions({ layoutMode: 'bubble' });
            updateDepthVisibility();
        };

        // Center: Breadcrumbs Scope Navigation
        const row1Center = row1.createDiv({ cls: 'pakcli-header-row-center' });
        this.scopeBarEl = row1Center.createDiv({ cls: 'pakcli-scope-bar' });
        this.updateScopeBar();

        // Right: Simulation Lock / Free Toggle
        const row1Right = row1.createDiv({ cls: 'pakcli-header-row-right' });
        const simLockGroup = row1Right.createDiv({ cls: 'pakcli-depth-group pakcli-sim-lock-group' });
        this.depthGroupEl = simLockGroup;
        this.simLockGroupEl = simLockGroup;
        simLockGroup.createSpan({ text: 'Simulation:', cls: 'pakcli-depth-label' });
        const simLockWrap = simLockGroup.createDiv({ cls: 'pakcli-depth-buttons' });

        this.simFreeBtnEl = simLockWrap.createEl('button', {
            text: '🔓 Free',
            cls: `pakcli-depth-btn ${!this.isSimulationLocked ? 'active' : ''}`,
            title: 'Simulation Free: Drag any node or bubble freely'
        });
        this.simFreeBtnEl.setAttribute('aria-pressed', !this.isSimulationLocked ? 'true' : 'false');

        this.simLockBtnEl = simLockWrap.createEl('button', {
            text: '🔒 Lock',
            cls: `pakcli-depth-btn ${this.isSimulationLocked ? 'active' : ''}`,
            title: 'Simulation Locked: Freeze movement, disable dragging & timelapse'
        });
        this.simLockBtnEl.setAttribute('aria-pressed', this.isSimulationLocked ? 'true' : 'false');

        this.simFreeBtnEl.onclick = async () => {
            await this.setSimulationLocked(false);
        };
        this.simLockBtnEl.onclick = async () => {
            await this.setSimulationLocked(true);
        };

        // ==========================================
        // ROW 2: Collapsible Settings Controls Row
        // ==========================================
        const row2 = headerEl.createDiv({
            cls: `pakcli-header-row pakcli-header-row-2 ${this.isHeaderSettingsOpen ? '' : 'collapsed'}`
        });
        this.row2El = row2;
        this.headerControlsWrapEl = row2;

        const textGroup = row2.createDiv({ cls: 'pakcli-text-controls-group' });

        // 1 & 2: Quick Toggles (Link line column, The folder colour)
        const togglesCluster = textGroup.createDiv({ cls: 'pakcli-layer-toggles-cluster' });

        // 1. Link line column (Show/Hide Lines)
        this.linesToggleBtnEl = togglesCluster.createEl('button', {
            cls: `pakcli-icon-btn pakcli-lines-toggle-btn ${this.showLines ? 'active' : ''}`,
            title: 'Toggle Lines (Show/Hide)'
        });
        this.linesToggleBtnEl.setAttribute('aria-pressed', this.showLines ? 'true' : 'false');
        setIcon(this.linesToggleBtnEl, 'link');
        this.linesToggleBtnEl.onclick = async () => {
            this.showLines = !this.showLines;
            this.linesToggleBtnEl.toggleClass('active', this.showLines);
            this.linesToggleBtnEl.setAttribute('aria-pressed', this.showLines ? 'true' : 'false');
            this.plugin.settings.bubbleShowLines = this.showLines;
            await this.plugin.saveSettings();
            if (this.sfxManager?.isEnabled()) {
                this.sfxManager.playLinkSwitch(this.showLines ? 1.0 : 0.6);
            }
        };

        // 2. The folder colour (Captain Folder Colors)
        this.captainColorsBtnEl = togglesCluster.createEl('button', {
            cls: `pakcli-icon-btn pakcli-captain-colors-btn ${this.useCaptainColors ? 'active' : ''}`,
            title: 'Toggle Captain Folder Colors (show custom colors on Captain Folders)'
        });
        this.captainColorsBtnEl.setAttribute('aria-pressed', this.useCaptainColors ? 'true' : 'false');
        setIcon(this.captainColorsBtnEl, 'anchor');
        this.captainColorsBtnEl.onclick = async () => {
            this.useCaptainColors = !this.useCaptainColors;
            this.captainColorsBtnEl.toggleClass('active', this.useCaptainColors);
            this.captainColorsBtnEl.setAttribute('aria-pressed', this.useCaptainColors ? 'true' : 'false');
            this.plugin.settings.bubbleUseCaptainColors = this.useCaptainColors;
            await this.plugin.saveSettings();
            this.applyCaptainFolderColors();
        };

        // Divider: Separator after Toggles
        textGroup.createDiv({ cls: 'pakcli-row2-divider' });

        // 3. Text dropdown + Custom format textbox
        const labelModeWrap = textGroup.createDiv({ cls: 'pakcli-label-mode-wrap' });
        labelModeWrap.createSpan({ text: 'Text:', cls: 'pakcli-level-label' });
        
        this.labelModeSelectEl = labelModeWrap.createEl('select', {
            cls: 'dropdown pakcli-label-mode-select'
        });

        const modes: Array<{ id: 'hide' | 'all' | 'folder' | 'text' | 'custom'; label: string }> = [
            { id: 'hide', label: 'hide' },
            { id: 'all', label: 'all type' },
            { id: 'folder', label: 'folder only' },
            { id: 'text', label: 'text only' },
            { id: 'custom', label: 'custom' }
        ];

        for (const m of modes) {
            const optEl = this.labelModeSelectEl.createEl('option', {
                value: m.id,
                text: m.label
            });
            if (this.labelMode === m.id) {
                optEl.selected = true;
            }
        }

        this.labelModeSelectEl.onchange = async () => {
            const val = (this.labelModeSelectEl?.value || 'all') as 'hide' | 'all' | 'folder' | 'text' | 'custom';
            this.labelMode = val;
            this.showLabels = val !== 'hide';
            this.updateLabelModeUI();
            this.plugin.settings.bubbleLabelMode = this.labelMode;
            this.plugin.settings.bubbleShowLabels = this.showLabels;
            await this.plugin.saveSettings();
            if (this.sfxManager?.isEnabled()) {
                this.sfxManager.playLinkSwitch();
            }
        };

        // Custom Format Textbox
        this.customFormatInputEl = labelModeWrap.createEl('input', {
            type: 'text',
            cls: `pakcli-label-custom-input ${this.showLabels && this.labelMode === 'custom' ? 'visible' : ''}`,
            value: this.customLabelFormats,
            placeholder: 'md, canvas, json, base, csv, folder'
        });
        this.customFormatInputEl.title = 'Enter comma-separated file formats to show labels for (e.g. md, canvas, json, base, csv, folder)';
        this.customFormatInputEl.style.display = (this.showLabels && this.labelMode === 'custom') ? 'inline-block' : 'none';

        this.customFormatInputEl.oninput = () => {
            const val = this.customFormatInputEl?.value || '';
            this.updateCustomLabelFormatsSet(val);
        };

        this.customFormatInputEl.onchange = async () => {
            const val = this.customFormatInputEl?.value || '';
            this.updateCustomLabelFormatsSet(val);
            this.plugin.settings.bubbleLabelCustomFormats = val;
            await this.plugin.saveSettings();
        };

        // Divider: Separator after Text Mode
        textGroup.createDiv({ cls: 'pakcli-row2-divider' });

        // 4. Text Level Dual Handle Slider (1-4) + Reset to Single Level Button
        const levelGroup = textGroup.createDiv({ cls: 'pakcli-level-group' });
        levelGroup.createSpan({ text: 'Text Level:', cls: 'pakcli-level-label' });

        const dualSliderContainer = levelGroup.createDiv({ cls: 'pakcli-dual-slider' });
        dualSliderContainer.createDiv({ cls: 'pakcli-dual-track' });
        this.levelHighlightEl = dualSliderContainer.createDiv({ cls: 'pakcli-dual-highlight' });
        this.levelGrayoutEl = dualSliderContainer.createDiv({ cls: 'pakcli-dual-grayout' });

        this.levelMinSliderEl = dualSliderContainer.createEl('input', {
            type: 'range',
            cls: 'pakcli-range-min'
        });
        this.levelMinSliderEl.min = '1';
        this.levelMinSliderEl.max = '4';
        this.levelMinSliderEl.step = '1';
        this.levelMinSliderEl.value = this.labelMinLevel.toString();

        this.levelMaxSliderEl = dualSliderContainer.createEl('input', {
            type: 'range',
            cls: 'pakcli-range-max'
        });
        this.levelMaxSliderEl.min = '1';
        this.levelMaxSliderEl.max = '4';
        this.levelMaxSliderEl.step = '1';
        this.levelMaxSliderEl.value = this.labelMaxLevel.toString();

        this.levelDisplayEl = levelGroup.createSpan({
            cls: 'pakcli-level-display'
        });

        this.levelResetBtnEl = levelGroup.createEl('button', {
            cls: 'clickable-icon pakcli-level-reset-btn'
        });
        setIcon(this.levelResetBtnEl, 'rotate-ccw');

        this.syncLevelControls();

        const handleMinInput = () => {
            let minVal = parseInt(this.levelMinSliderEl.value, 10) || 1;
            let maxVal = parseInt(this.levelMaxSliderEl.value, 10) || 4;
            if (minVal > maxVal) {
                minVal = maxVal;
                this.levelMinSliderEl.value = minVal.toString();
            }
            this.labelMinLevel = minVal;
            this.labelMaxLevel = maxVal;
            this.labelRangeLevel = maxVal;
            this.syncLevelControls();
        };

        const handleMaxInput = () => {
            let minVal = parseInt(this.levelMinSliderEl.value, 10) || 1;
            let maxVal = parseInt(this.levelMaxSliderEl.value, 10) || 4;
            if (maxVal < minVal) {
                maxVal = minVal;
                this.levelMaxSliderEl.value = maxVal.toString();
            }
            this.labelMinLevel = minVal;
            this.labelMaxLevel = maxVal;
            this.labelRangeLevel = maxVal;
            this.syncLevelControls();
        };

        const saveLevelChange = async () => {
            this.plugin.settings.bubbleLabelMinLevel = this.labelMinLevel;
            this.plugin.settings.bubbleLabelMaxLevel = this.labelMaxLevel;
            this.plugin.settings.bubbleLabelRangeLevel = this.labelMaxLevel;
            await this.plugin.saveSettings();
        };

        this.levelMinSliderEl.oninput = handleMinInput;
        this.levelMinSliderEl.onchange = saveLevelChange;

        this.levelMaxSliderEl.oninput = handleMaxInput;
        this.levelMaxSliderEl.onchange = saveLevelChange;

        dualSliderContainer.onmousemove = (e: MouseEvent) => {
            if (this.labelMinLevel === this.labelMaxLevel) {
                const rect = dualSliderContainer.getBoundingClientRect();
                const relX = (e.clientX - rect.left) / (rect.width || 1);
                const thumbPos = (this.labelMinLevel - 1) / 3;
                if (relX < thumbPos) {
                    this.levelMinSliderEl.style.zIndex = '5';
                    this.levelMaxSliderEl.style.zIndex = '4';
                } else {
                    this.levelMaxSliderEl.style.zIndex = '5';
                    this.levelMinSliderEl.style.zIndex = '4';
                }
            } else {
                this.levelMinSliderEl.style.zIndex = '4';
                this.levelMaxSliderEl.style.zIndex = '4';
            }
        };

        this.levelResetBtnEl.onclick = async () => {
            if (this.labelMinLevel !== this.labelMaxLevel) {
                await this.setTextLevelRange(this.labelMinLevel, this.labelMinLevel);
            } else {
                await this.setTextLevelRange(1, 1);
            }
            if (this.sfxManager && this.sfxManager.isEnabled()) {
                this.sfxManager.playLinkSwitch();
            }
        };

        // Divider: Separator after Text Level
        textGroup.createDiv({ cls: 'pakcli-row2-divider' });

        // 5. Text Size Slider
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

        // Divider: Separator after Text Size
        textGroup.createDiv({ cls: 'pakcli-row2-divider' });

        // 6. Toggle Speaker (Sound FX Mute / Unmute)
        const sfxCluster = textGroup.createDiv({ cls: 'pakcli-layer-toggles-cluster' });
        this.sfxToggleBtnEl = sfxCluster.createEl('button', {
            cls: `pakcli-icon-btn pakcli-sfx-toggle-btn ${this.sfxManager.isEnabled() ? 'active' : ''}`,
            title: 'Toggle Graph Sound FX (Mute / Unmute)'
        });
        this.sfxToggleBtnEl.setAttribute('aria-pressed', this.sfxManager.isEnabled() ? 'true' : 'false');
        setIcon(this.sfxToggleBtnEl, this.sfxManager.isEnabled() ? 'volume-2' : 'volume-x');
        this.sfxToggleBtnEl.onclick = async () => {
            const newState = !this.sfxManager.isEnabled();
            this.sfxManager.setEnabled(newState);
            this.sfxToggleBtnEl.toggleClass('active', newState);
            this.sfxToggleBtnEl.setAttribute('aria-pressed', newState ? 'true' : 'false');
            setIcon(this.sfxToggleBtnEl, newState ? 'volume-2' : 'volume-x');
            this.plugin.settings.bubbleEnableSfx = newState;
            await this.plugin.saveSettings();
            if (newState) {
                this.sfxManager.playNodeSpawn(1);
            }
        };

        // 7. Speaker Slider (SFX Volume Slider)
        const volGroup = textGroup.createDiv({ cls: 'pakcli-volume-group' });
        volGroup.createSpan({ text: 'Vol:', cls: 'pakcli-volume-label' });
        this.volumeSliderEl = volGroup.createEl('input', {
            type: 'range',
            cls: 'pakcli-volume-slider'
        });
        this.volumeSliderEl.min = '0';
        this.volumeSliderEl.max = '100';
        this.volumeSliderEl.step = '5';
        const currentVol = Math.round((this.plugin.settings.bubbleSfxVolume ?? DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleSfxVolume) * 100);
        this.volumeSliderEl.value = currentVol.toString();
        this.volumeSliderEl.title = `Sound FX Volume: ${currentVol}%`;

        this.volumeDisplayEl = volGroup.createSpan({
            text: `${currentVol}%`,
            cls: 'pakcli-volume-display'
        });

        this.volumeSliderEl.oninput = () => {
            const val = parseInt(this.volumeSliderEl.value, 10) || 0;
            this.volumeDisplayEl.setText(`${val}%`);
            this.volumeSliderEl.title = `Sound FX Volume: ${val}%`;
            const normalized = val / 100;
            this.sfxManager.setVolume(normalized);
            if (val > 0 && !this.sfxManager.isEnabled()) {
                this.sfxManager.setEnabled(true);
                this.sfxToggleBtnEl.addClass('active');
                this.sfxToggleBtnEl.setAttribute('aria-pressed', 'true');
                setIcon(this.sfxToggleBtnEl, 'volume-2');
                this.plugin.settings.bubbleEnableSfx = true;
            } else if (val === 0) {
                setIcon(this.sfxToggleBtnEl, 'volume-x');
            }
        };

        this.volumeSliderEl.onchange = async () => {
            const val = parseInt(this.volumeSliderEl.value, 10) || 0;
            const normalized = val / 100;
            this.plugin.settings.bubbleSfxVolume = normalized;
            await this.plugin.saveSettings();
            if (normalized > 0 && this.sfxManager.isEnabled()) {
                this.sfxManager.playNodeSpawn(1);
            }
        };
    }

    /**
     * Floating action tools pinned to the top-right corner of the canvas frame:
     * Search note input, Fit to View, Refresh Graph, Reset View Graph settings.
     */
    private renderCanvasFloatingTools(parent: HTMLElement): void {
        this.floatingToolsEl = parent.createDiv({
            cls: `pakcli-canvas-floating-tools ${this.isFloatingToolsOpen ? '' : 'collapsed'}`
        });
        const floatingTools = this.floatingToolsEl;

        // Prevent canvas dragging or selection while clicking floating tools
        floatingTools.addEventListener('mousedown', (e) => e.stopPropagation());
        floatingTools.addEventListener('click', (e) => e.stopPropagation());
        floatingTools.addEventListener('dblclick', (e) => e.stopPropagation());

        // 1. Search Note Input
        const searchWrap = floatingTools.createDiv({ cls: 'pakcli-search-wrap' });
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

        // 2. Zoom In & Zoom Out Buttons
        const zoomInBtn = floatingTools.createEl('button', {
            cls: 'pakcli-icon-btn pakcli-zoom-in-btn',
            title: 'Zoom In (+)'
        });
        setIcon(zoomInBtn, 'zoom-in');
        zoomInBtn.onclick = () => this.zoomIn();

        const zoomOutBtn = floatingTools.createEl('button', {
            cls: 'pakcli-icon-btn pakcli-zoom-out-btn',
            title: 'Zoom Out (-)'
        });
        setIcon(zoomOutBtn, 'zoom-out');
        zoomOutBtn.onclick = () => this.zoomOut();

        // 3. Fit to View Button (One-shot snap)
        const fitBtn = floatingTools.createEl('button', {
            cls: 'pakcli-icon-btn pakcli-fit-btn',
            title: 'Fit to View (Center & Zoom once)'
        });
        setIcon(fitBtn, 'crosshair');
        fitBtn.onclick = () => {
            this.fitToView(true);
            if (this.sfxManager?.isEnabled()) {
                this.sfxManager.playLinkSwitch(0.6);
            }
        };

        // 3. Always Auto-tracking Radio Group: [ Fit | Center ]
        const radioGroup = floatingTools.createDiv({
            cls: 'pakcli-always-fit-group',
            title: "Always Auto-tracking: [Fit = Zoom & Center | Center = Center only, won't zoom]"
        });

        this.fitModeBtnEl = radioGroup.createEl('button', {
            cls: `pakcli-always-fit-btn ${this.autoFitMode === 'fit' ? 'active' : ''}`,
            text: 'Fit',
            title: 'Always Fit: Continuously fit zoom & center'
        });
        this.fitModeBtnEl.setAttribute('aria-pressed', this.autoFitMode === 'fit' ? 'true' : 'false');
        this.fitModeBtnEl.onclick = () => {
            this.setAutoFitMode('fit');
        };

        this.centerModeBtnEl = radioGroup.createEl('button', {
            cls: `pakcli-always-fit-btn ${this.autoFitMode === 'center' ? 'active' : ''}`,
            text: 'Center',
            title: "Always Center: Continuously center without changing zoom"
        });
        this.centerModeBtnEl.setAttribute('aria-pressed', this.autoFitMode === 'center' ? 'true' : 'false');
        this.centerModeBtnEl.onclick = () => {
            this.setAutoFitMode('center');
        };

        // 4. Refresh Graph Button
        const refreshBtn = floatingTools.createEl('button', {
            cls: 'pakcli-icon-btn pakcli-refresh-btn',
            title: 'Refresh Graph'
        });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.onclick = () => this.reloadGraphData();

        // 5. Reset View Graph Settings Button
        const resetSettingsBtn = floatingTools.createEl('button', {
            cls: 'pakcli-icon-btn pakcli-reset-settings-btn',
            title: 'Reset View Settings to Default'
        });
        setIcon(resetSettingsBtn, 'rotate-ccw');
        resetSettingsBtn.onclick = () => this.resetViewSettings();
    }

    private toggleTimelapse(): void {
        if (this.isTimelapseRunning) {
            this.pauseTimelapse();
        } else {
            if (this.timelapseProgress >= 0.99) {
                this.timelapseProgress = 0.0;
                this.lastVisibleCount = -1;
                this.timelapseSpawnedClusters.clear();
                this.timelapseConnectedEdges.clear();
            }
            this.startTimelapse();
        }
    }

    private startTimelapse(): void {
        this.sfxManager?.initContext();
        this.isTimelapseRunning = true;
        if (this.timelinePlayBtnEl) {
            setIcon(this.timelinePlayBtnEl, 'pause');
            this.timelinePlayBtnEl.addClass('active');
            this.timelinePlayBtnEl.setAttribute('aria-pressed', 'true');
            this.timelinePlayBtnEl.setAttribute('title', 'Pause Timelapse');
        }
        if (this.timelapseProgress <= 0.05) {
            this.timelapseSpawnedClusters.clear();
            this.timelapseConnectedEdges.clear();
        }
        this.updateTimelineUI();
    }

    private pauseTimelapse(): void {
        this.isTimelapseRunning = false;
        if (this.timelinePlayBtnEl) {
            setIcon(this.timelinePlayBtnEl, 'play');
            this.timelinePlayBtnEl.removeClass('active');
            this.timelinePlayBtnEl.setAttribute('aria-pressed', 'false');
            this.timelinePlayBtnEl.setAttribute('title', 'Play Timelapse');
        }
        this.updateTimelineUI();
    }

    public updateTimelineUI(): void {
        if (this.timelineSliderEl) {
            this.timelineSliderEl.value = Math.round(this.timelapseProgress * 1000).toString();
        }

        const pct = Math.max(0, Math.min(100, this.timelapseProgress * 100));
        if (this.timelineThumbTipEl) {
            this.timelineThumbTipEl.style.left = `${pct}%`;
            this.timelineThumbTipEl.style.transform = `translateX(-${pct}%)`;
            this.timelineThumbTipEl.style.setProperty('--tip-pct', `${pct}%`);

            if (pct <= 25) {
                this.timelineThumbTipEl.setAttribute('data-align', 'left');
            } else if (pct >= 75) {
                this.timelineThumbTipEl.setAttribute('data-align', 'right');
            } else {
                this.timelineThumbTipEl.setAttribute('data-align', 'center');
            }
        }

        if (this.timelineCanvasEl) {
            this.timelineCanvasEl.style.display = 'block';
        }

        if (this.timelineDateBadgeEl && this.graphData) {
            const totalCount = this.graphData.nodes.length;

            if (this.timelapseMode !== 'time') {
                const spawnedCount = Math.round(this.timelapseProgress * totalCount);
                if (this.timelapseProgress < 0.999 && spawnedCount < totalCount) {
                    const latestNode = spawnedCount > 0 ? this.sortedNodes[spawnedCount - 1] : this.sortedNodes[0];
                    if (this.timelapseMode === 'title') {
                        const displayTitle = (latestNode?.title && latestNode.title.trim()) ? latestNode.title.trim() : (latestNode?.name || '');
                        if (this.timelineThumbTipEl) this.timelineThumbTipEl.setText(`${spawnedCount}/${totalCount}: ${displayTitle}`);
                        if (this.timelineSliderEl) this.timelineSliderEl.title = `Note ${spawnedCount}/${totalCount} (${displayTitle})`;
                        this.timelineDateBadgeEl.setText(`🏷️ ${displayTitle} (${spawnedCount}/${totalCount}) • Title A-Z`);
                    } else if (this.timelapseMode === 'filename') {
                        const displayName = latestNode ? latestNode.name : '';
                        if (this.timelineThumbTipEl) this.timelineThumbTipEl.setText(`${spawnedCount}/${totalCount}: ${displayName}`);
                        if (this.timelineSliderEl) this.timelineSliderEl.title = `Note ${spawnedCount}/${totalCount} (${displayName})`;
                        this.timelineDateBadgeEl.setText(`🔤 ${displayName} (${spawnedCount}/${totalCount}) • Filename A-Z`);
                    } else {
                        // Vanilla (chronological birth)
                        const nodeTime = latestNode ? getNodeEffectiveTime(latestNode) : 0;
                        const dateStr = nodeTime ? this.formatTimelineDate(nodeTime) : '';
                        if (this.timelineThumbTipEl) this.timelineThumbTipEl.setText(`${spawnedCount}/${totalCount}`);
                        if (this.timelineSliderEl) this.timelineSliderEl.title = `Note ${spawnedCount}/${totalCount} (${dateStr})`;
                        this.timelineDateBadgeEl.setText(`📅 ${dateStr} (${spawnedCount}/${totalCount} notes) • Vanilla`);
                    }
                } else {
                    if (this.timelineThumbTipEl) this.timelineThumbTipEl.setText(`${totalCount}/${totalCount}`);
                    if (this.timelineSliderEl) this.timelineSliderEl.title = `All Notes (${totalCount}/${totalCount})`;
                    let modeSuffix = 'Vanilla';
                    if (this.timelapseMode === 'filename') modeSuffix = 'Filename A-Z';
                    else if (this.timelapseMode === 'title') modeSuffix = 'File Title A-Z';
                    this.timelineDateBadgeEl.setText(`Present (${totalCount}/${totalCount} notes) • ${modeSuffix}`);
                }
            } else {
                // Time-based continuous timeline interpolation
                const cutoff = this.timelapseProgress < 0.999
                    ? this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress
                    : null;
                const visibleCount = this.graphData.nodes.filter(n => !cutoff || getNodeEffectiveTime(n) <= cutoff).length;
                if (cutoff) {
                    const dateStr = this.formatTimelineDate(cutoff);
                    if (this.timelineThumbTipEl) this.timelineThumbTipEl.setText(dateStr);
                    if (this.timelineSliderEl) this.timelineSliderEl.title = dateStr;
                    this.timelineDateBadgeEl.setText(`📅 ${dateStr} (${visibleCount}/${totalCount} notes) • Time`);
                } else {
                    const latestT = this.timelapseMaxCtime || Date.now();
                    const dateStr = this.formatTimelineDate(latestT);
                    if (this.timelineThumbTipEl) this.timelineThumbTipEl.setText(dateStr);
                    if (this.timelineSliderEl) this.timelineSliderEl.title = `Present (${dateStr})`;
                    this.timelineDateBadgeEl.setText(`📅 Present (${totalCount}/${totalCount} notes) • Time`);
                }
            }
        }
        if (this.wandBtnEl) {
            if (this.isTimelapseRunning) {
                this.wandBtnEl.addClass('active');
                this.wandBtnEl.setAttribute('aria-pressed', 'true');
                this.wandBtnEl.setAttribute('title', 'Pause timelapse animation');
            } else {
                this.wandBtnEl.removeClass('active');
                this.wandBtnEl.setAttribute('aria-pressed', 'false');
                let modeLabel = 'Vanilla (0.025s/node)';
                if (this.timelapseMode === 'time') modeLabel = 'Time';
                else if (this.timelapseMode === 'filename') modeLabel = 'Filename A-Z';
                else if (this.timelapseMode === 'title') modeLabel = 'File Title A-Z';
                this.wandBtnEl.setAttribute('title', `Start timelapse animation (${modeLabel})`);
            }
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
                item.onclick = () => this.selectNode(b, true, true);
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
                item.onclick = () => this.selectNode(o, true, true);
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
        const timelineEl = container.createDiv({
            cls: `pakcli-timeline-minimap ${this.isFooterOpen ? '' : 'collapsed'}`
        });
        this.timelineEl = timelineEl;

        // Present / Date badge placed beside the left of the play toggle
        this.timelineDateBadgeEl = timelineEl.createDiv({
            cls: 'pakcli-timeline-date-badge',
            title: 'Click to Jump to Present'
        });
        this.timelineDateBadgeEl.onclick = () => {
            if (this.isTimelapseRunning) {
                this.pauseTimelapse();
            }
            this.timelapseProgress = 1.0;
            this.lastVisibleCount = -1;
            this.updateTimelineUI();
        };

        this.timelinePlayBtnEl = timelineEl.createEl('button', {
            cls: 'pakcli-timeline-nav pakcli-timeline-play-btn',
            title: 'Play / Pause Timelapse'
        });
        setIcon(this.timelinePlayBtnEl, 'play');
        this.timelinePlayBtnEl.onclick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleTimelapse();
        };

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

        // Timelapse Mode Dropdown: [ Vanilla | Time | Filename A-Z | File Title A-Z ]
        this.timelapseModeSelectEl = timelineEl.createEl('select', {
            cls: 'dropdown pakcli-timelapse-mode-select'
        });

        const timelapseModes = [
            { value: 'vanilla', text: 'Vanilla' },
            { value: 'time', text: 'Time' },
            { value: 'filename', text: 'Filename A-Z' },
            { value: 'title', text: 'File Title A-Z' }
        ];

        for (const tm of timelapseModes) {
            const opt = this.timelapseModeSelectEl.createEl('option', {
                value: tm.value,
                text: tm.text
            });
            if (this.timelapseMode === tm.value) {
                opt.selected = true;
            }
        }

        this.timelapseModeSelectEl.onchange = async () => {
            const newMode = (this.timelapseModeSelectEl?.value || 'vanilla') as 'vanilla' | 'time' | 'filename' | 'title';
            await this.setTimelapseMode(newMode);
        };

        const sliderWrap = timelineEl.createDiv({ cls: 'pakcli-timeline-track-wrap' });

        this.timelineCanvasEl = sliderWrap.createEl('canvas', {
            cls: 'pakcli-timeline-heatmap-canvas'
        });

        this.timelineThumbTipEl = sliderWrap.createDiv({
            cls: 'pakcli-timeline-thumb-tip'
        });

        this.timelineSliderEl = sliderWrap.createEl('input', {
            type: 'range',
            cls: 'pakcli-timeline-slider'
        });
        this.timelineSliderEl.min = '0';
        this.timelineSliderEl.max = '1000';
        this.timelineSliderEl.step = '1';
        this.timelineSliderEl.value = '1000';

        this.timelineSliderEl.onpointerdown = () => {
            if (this.isTimelapseRunning) {
                this.pauseTimelapse();
            }
        };

        this.timelineSliderEl.oninput = () => {
            if (this.isTimelapseRunning) {
                this.pauseTimelapse();
            }
            this.timelapseProgress = parseFloat(this.timelineSliderEl.value) / 1000;
            this.lastVisibleCount = -1;
            this.timelapseSpawnedClusters.clear();
            this.timelapseConnectedEdges.clear();
            this.updateTimelineUI();
        };

        if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
            const ro = new ResizeObserver(() => {
                this.drawHeatmap();
            });
            ro.observe(sliderWrap);
        }

        this.updateTimelineUI();
        this.updateTimelapseLockedUI();
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
            if (this.autoFitMode === 'fit') {
                this.setAutoFitMode('center');
            }
        });

        canvas.addEventListener('mousedown', (e) => {
            this.sfxManager?.initContext();
            const worldPos = this.screenToWorld(e.clientX, e.clientY);

            if (this.isSimulationLocked) {
                // When locked: cannot drag nodes or bubbles; only pan canvas
                this.isPanning = true;
                this.panStartX = e.clientX - this.transform.panX;
                this.panStartY = e.clientY - this.transform.panY;
                if (this.autoFitMode !== 'off') {
                    this.setAutoFitMode('off');
                }
                canvas.setCssStyles({ cursor: 'grabbing' });
                return;
            }

            const clickedNode = this.findNodeAt(worldPos.x, worldPos.y);

            if (clickedNode) {
                this.isDraggingNode = true;
                this.simulation.startDrag(clickedNode, worldPos.x, worldPos.y);
                canvas.setCssStyles({ cursor: 'grabbing' });
            } else {
                const clickedCluster = this.findClusterAt(worldPos.x, worldPos.y);
                if (clickedCluster && this.layoutMode === 'bubble') {
                    this.isDraggingCluster = true;
                    this.simulation.startDragCluster(clickedCluster, worldPos.x, worldPos.y);
                    canvas.setCssStyles({ cursor: 'grabbing' });
                } else {
                    this.isPanning = true;
                    this.panStartX = e.clientX - this.transform.panX;
                    this.panStartY = e.clientY - this.transform.panY;
                    if (this.autoFitMode !== 'off') {
                        this.setAutoFitMode('off');
                    }
                    canvas.setCssStyles({ cursor: 'grabbing' });
                }
            }
        });

        window.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                if (!this.isPanning && !this.isDraggingNode && !this.isDraggingCluster) return;
            }

            const worldPos = this.screenToWorld(e.clientX, e.clientY);

            if (this.isDraggingNode || this.isDraggingCluster) {
                this.simulation.updateDrag(worldPos.x, worldPos.y);
            } else if (this.isPanning) {
                this.transform.panX = e.clientX - this.panStartX;
                this.transform.panY = e.clientY - this.panStartY;
            } else {
                // Hover Detection
                const node = this.findNodeAt(worldPos.x, worldPos.y);
                this.hoveredNode = node;

                // Check cluster hover if no node hovered
                if (!node && this.graphData) {
                    this.hoveredCluster = this.findClusterAt(worldPos.x, worldPos.y);
                } else {
                    this.hoveredCluster = null;
                }

                if (this.isSimulationLocked) {
                    canvas.setCssStyles({ cursor: node ? 'pointer' : 'default' });
                } else {
                    canvas.setCssStyles({ cursor: node ? 'pointer' : (this.hoveredCluster ? 'grab' : 'default') });
                }
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDraggingNode || this.isDraggingCluster) {
                this.simulation.endDrag();
                this.isDraggingNode = false;
                this.isDraggingCluster = false;
            }
            this.isPanning = false;
            if (this.hoveredNode) {
                canvas.setCssStyles({ cursor: 'pointer' });
            } else if (this.hoveredCluster && !this.isSimulationLocked) {
                canvas.setCssStyles({ cursor: 'grab' });
            } else {
                canvas.setCssStyles({ cursor: 'default' });
            }
        });

        canvas.addEventListener('click', (e) => {
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const clickedNode = this.findNodeAt(worldPos.x, worldPos.y);
            if (clickedNode && this.isInspectorOpen) {
                this.selectNode(clickedNode, false, true);
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
                if (this.timelapseMode !== 'time') {
                    // Sequential modes: Vanilla, Filename A-Z, File Title A-Z (0.025s per node)
                    const delayPerNodeMs = (this.plugin.settings.bubbleTimelapseVanillaSpeed ?? 0.025) * 1000;
                    const totalDurationMs = Math.max(500, this.sortedNodes.length * delayPerNodeMs);
                    this.timelapseProgress += dt / totalDurationMs;
                } else {
                    // Time mode: ~12s continuous time range interpolation
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
                if (this.timelapseMode !== 'time') {
                    const count = Math.max(1, Math.round(this.timelapseProgress * this.sortedNodes.length));
                    renderVisibleNodeIds = new Set(this.sortedNodes.slice(0, count).map(n => n.id));
                } else {
                    renderCutoff = this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress;
                    renderVisibleNodeIds = new Set(this.graphData.nodes.filter(n => getNodeEffectiveTime(n) <= renderCutoff).map(n => n.id));
                }
            }

            const currentVisibleCount = renderVisibleNodeIds ? renderVisibleNodeIds.size : (this.graphData ? this.graphData.nodes.length : 0);
            if (currentVisibleCount !== this.lastVisibleCount) {
                if (this.lastVisibleCount !== -1 && currentVisibleCount > this.lastVisibleCount) {
                    if (this.sfxManager && this.sfxManager.isEnabled()) {
                        this.sfxManager.playNodeSpawn(currentVisibleCount);
                    }
                }
                this.lastVisibleCount = currentVisibleCount;
                if (this.simulation) {
                    this.simulation.reheat(0.35);
                }
            } else if (this.isTimelapseRunning && this.simulation) {
                this.simulation.reheat(0.35);
            }

            // Detect newly visible bubble clusters during timelapse and trigger resonant chime
            if (this.isTimelapseRunning && renderVisibleNodeIds && this.graphData && this.sfxManager?.isEnabled()) {
                for (const cluster of this.graphData.clusters) {
                    if (cluster.radius > 0 && !this.timelapseSpawnedClusters.has(cluster.id)) {
                        const hasVisible = cluster.nodeIds.some(id => renderVisibleNodeIds!.has(id));
                        if (hasVisible) {
                            this.timelapseSpawnedClusters.add(cluster.id);
                            this.sfxManager.playBubbleSpawn(cluster.depth);
                        }
                    }
                }

                // Detect newly linked lines (edges) during timelapse and trigger tactile switch SFX
                let newlyLinkedCount = 0;
                for (const edge of this.graphData.edges) {
                    const edgeKey = `${edge.source}->${edge.target}`;
                    if (!this.timelapseConnectedEdges.has(edgeKey)) {
                        if (renderVisibleNodeIds.has(edge.source) && renderVisibleNodeIds.has(edge.target)) {
                            this.timelapseConnectedEdges.add(edgeKey);
                            newlyLinkedCount++;
                        }
                    }
                }
                if (newlyLinkedCount > 0) {
                    this.sfxManager.playLinkSwitch(Math.min(1.0, 0.4 + newlyLinkedCount * 0.15));
                }
            }

            if (this.simulation) {
                this.simulation.step(renderVisibleNodeIds);
            }

            if (this.autoFitMode !== 'off' && !this.isPanning) {
                this.autoFitStep(0.08);
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
                    selectedNode: this.isInspectorOpen ? this.selectedNode : null,
                    isInspectorOpen: this.isInspectorOpen,
                    searchQuery: this.searchQuery,
                    scopeFilter: this.scopeFilter,
                    scopedFolder: this.scopedFolder,
                    showVennBridges: this.plugin.settings.bubbleShowVennBridges !== false,
                    interLinkGlow: this.plugin.settings.bubbleInterLinkGlow !== false,
                    showLines: this.showLines,
                    showLabels: this.showLabels,
                    labelMode: this.labelMode,
                    customLabelFormats: this.customLabelFormatsSet,
                    labelRangeLevel: this.labelRangeLevel,
                    labelMinLevel: this.labelMinLevel,
                    labelMaxLevel: this.labelMaxLevel,
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
            if (this.timelapseMode !== 'time') {
                const count = Math.round(this.timelapseProgress * this.sortedNodes.length);
                visibleSet = new Set(this.sortedNodes.slice(0, count).map(n => n.id));
            } else {
                cutoff = this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress;
            }
        }

        for (let i = this.graphData.nodes.length - 1; i >= 0; i--) {
            const node = this.graphData.nodes[i];
            if (visibleSet && !visibleSet.has(node.id)) continue;
            if (cutoff && getNodeEffectiveTime(node) > cutoff) continue;
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
            if (this.timelapseMode !== 'time') {
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
                    if (cutoff) return getNodeEffectiveTime(n) <= cutoff;
                    return true;
                });
                if (!hasVisible) continue;
            }

            const dist = Math.hypot(worldX - cluster.centroid.x, worldY - cluster.centroid.y);
            if (dist <= cluster.radius) {
                return cluster;
            }
            // Also hit-test folder tab badge above the cluster rim
            if (worldY >= cluster.centroid.y - cluster.radius - 24 && worldY <= cluster.centroid.y - cluster.radius + 6) {
                if (Math.abs(worldX - cluster.centroid.x) <= Math.max(60, cluster.radius)) {
                    return cluster;
                }
            }
        }
        return null;
    }

    public selectNode(node: BubbleNode, centerCamera: boolean = true, playSound: boolean = false): void {
        if (!this.isInspectorOpen) {
            this.selectedNode = null;
            return;
        }
        this.selectedNode = node;
        this.updateInspectorContent();

        if (playSound && this.sfxManager?.isEnabled() && node.totalDegree && node.totalDegree > 0) {
            this.sfxManager.playLinkSwitch(1.0);
        }

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

    private calculateFitTransform(): { zoom: number; panX: number; panY: number } | null {
        if (!this.graphData || this.graphData.nodes.length === 0) return null;

        let visibleNodeIds: Set<string> | null = null;
        if (this.timelapseProgress < 0.999) {
            if (this.timelapseMode !== 'time') {
                const count = Math.max(1, Math.round(this.timelapseProgress * this.sortedNodes.length));
                visibleNodeIds = new Set(this.sortedNodes.slice(0, count).map(n => n.id));
            } else {
                const cutoff = this.timelapseMinCtime + (this.timelapseMaxCtime - this.timelapseMinCtime) * this.timelapseProgress;
                visibleNodeIds = new Set(this.graphData.nodes.filter(n => getNodeEffectiveTime(n) <= cutoff).map(n => n.id));
            }
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const node of this.graphData.nodes) {
            if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x);
            maxY = Math.max(maxY, node.y);
        }

        if (this.layoutMode === 'bubble') {
            for (const c of this.graphData.clusters) {
                if (c.radius > 0) {
                    if (visibleNodeIds && !c.nodeIds.some(id => visibleNodeIds!.has(id))) continue;
                    minX = Math.min(minX, c.centroid.x - c.radius);
                    minY = Math.min(minY, c.centroid.y - c.radius);
                    maxX = Math.max(maxX, c.centroid.x + c.radius);
                    maxY = Math.max(maxY, c.centroid.y + c.radius);
                }
            }
        }

        if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
            return null;
        }

        const padding = 70;
        const width = Math.max(80, maxX - minX + padding);
        const height = Math.max(80, maxY - minY + padding);
        const canvasW = this.canvasEl.width > 0 ? this.canvasEl.width : 800;
        const canvasH = this.canvasEl.height > 0 ? this.canvasEl.height : 600;
        const scaleX = canvasW / width;
        const scaleY = canvasH / height;
        const targetZoom = Math.min(2.5, Math.max(0.15, Math.min(scaleX, scaleY) * 0.94));
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const targetPanX = -centerX * targetZoom;
        const targetPanY = -centerY * targetZoom;

        return { zoom: targetZoom, panX: targetPanX, panY: targetPanY, centerX, centerY };
    }

    public zoomIn(): void {
        this.zoomBy(1.25);
    }

    public zoomOut(): void {
        this.zoomBy(0.8);
    }

    public zoomBy(factor: number): void {
        const newZoom = Math.min(4.0, Math.max(0.15, this.transform.zoom * factor));
        if (Math.abs(newZoom - this.transform.zoom) < 0.0001) return;

        const ratio = newZoom / this.transform.zoom;
        this.transform.panX *= ratio;
        this.transform.panY *= ratio;
        this.transform.zoom = newZoom;

        // If in 'fit' mode, manual zoom switches to 'center' mode
        if (this.autoFitMode === 'fit') {
            this.setAutoFitMode('center');
        }

        if (this.sfxManager?.isEnabled()) {
            this.sfxManager.playLinkSwitch(0.5);
        }
    }

    private fitToView(instant: boolean = true): void {
        const fit = this.calculateFitTransform();
        if (!fit) {
            this.transform = { panX: 0, panY: 0, zoom: 1 };
            return;
        }

        if (instant) {
            this.transform.zoom = fit.zoom;
            this.transform.panX = fit.panX;
            this.transform.panY = fit.panY;
        } else {
            this.transform.zoom += (fit.zoom - this.transform.zoom) * 0.25;
            this.transform.panX += (fit.panX - this.transform.panX) * 0.25;
            this.transform.panY += (fit.panY - this.transform.panY) * 0.25;
        }
    }

    private centerToView(instant: boolean = true): void {
        const fit = this.calculateFitTransform();
        if (!fit) return;

        // Mode 2: Center only, won't zoom - respects current zoom level!
        const targetPanX = -fit.centerX * this.transform.zoom;
        const targetPanY = -fit.centerY * this.transform.zoom;

        if (instant) {
            this.transform.panX = targetPanX;
            this.transform.panY = targetPanY;
        } else {
            this.transform.panX += (targetPanX - this.transform.panX) * 0.25;
            this.transform.panY += (targetPanY - this.transform.panY) * 0.25;
        }
    }

    private autoFitStep(lerpFactor: number = 0.08): void {
        if (this.autoFitMode === 'off') return;
        const fit = this.calculateFitTransform();
        if (!fit) return;

        if (this.autoFitMode === 'fit') {
            // Mode 1: Always Fit - adjusts both zoom & pan
            this.transform.zoom += (fit.zoom - this.transform.zoom) * lerpFactor;
            this.transform.panX += (fit.panX - this.transform.panX) * lerpFactor;
            this.transform.panY += (fit.panY - this.transform.panY) * lerpFactor;
        } else if (this.autoFitMode === 'center') {
            // Mode 2: Always Center - centers position but WON'T zoom!
            const targetPanX = -fit.centerX * this.transform.zoom;
            const targetPanY = -fit.centerY * this.transform.zoom;
            this.transform.panX += (targetPanX - this.transform.panX) * lerpFactor;
            this.transform.panY += (targetPanY - this.transform.panY) * lerpFactor;
        }
    }

    public setAutoFitMode(mode: 'off' | 'fit' | 'center'): void {
        // Toggle off if clicking the currently active mode
        this.autoFitMode = (this.autoFitMode === mode) ? 'off' : mode;
        this.updateAutoFitUI();
        this.plugin.settings.bubbleAutoFitMode = this.autoFitMode;
        this.plugin.settings.bubbleAlwaysFit = this.autoFitMode !== 'off';
        this.plugin.saveSettings();

        if (this.sfxManager?.isEnabled()) {
            this.sfxManager.playLinkSwitch();
        }

        if (this.autoFitMode === 'fit') {
            this.fitToView(true);
        } else if (this.autoFitMode === 'center') {
            this.centerToView(true);
        }
    }

    private updateAutoFitUI(): void {
        if (this.fitModeBtnEl) {
            const isFit = this.autoFitMode === 'fit';
            this.fitModeBtnEl.toggleClass('active', isFit);
            this.fitModeBtnEl.setAttribute('aria-pressed', isFit ? 'true' : 'false');
            this.fitModeBtnEl.setAttribute('title', isFit
                ? 'Always Fit: ACTIVE (Continuously fits zoom & center) - Click to turn OFF'
                : 'Always Fit: Continuously fit zoom & center');
        }
        if (this.centerModeBtnEl) {
            const isCenter = this.autoFitMode === 'center';
            this.centerModeBtnEl.toggleClass('active', isCenter);
            this.centerModeBtnEl.setAttribute('aria-pressed', isCenter ? 'true' : 'false');
            this.centerModeBtnEl.setAttribute('title', isCenter
                ? "Always Center: ACTIVE (Continuously centers, won't zoom) - Click to turn OFF"
                : "Always Center: Continuously center without changing zoom");
        }
    }

    public setSfxEnabled(enabled: boolean): void {
        if (this.sfxManager) {
            this.sfxManager.setEnabled(enabled);
        }
        if (this.sfxToggleBtnEl) {
            this.sfxToggleBtnEl.toggleClass('active', enabled);
            this.sfxToggleBtnEl.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            setIcon(this.sfxToggleBtnEl, enabled ? 'volume-2' : 'volume-x');
        }
    }

    public setSfxVolume(vol: number): void {
        if (this.sfxManager) {
            this.sfxManager.setVolume(vol);
        }
        if (this.volumeSliderEl) {
            const percent = Math.round(vol * 100);
            this.volumeSliderEl.value = percent.toString();
            this.volumeSliderEl.title = `Sound FX Volume: ${percent}%`;
            if (this.volumeDisplayEl) {
                this.volumeDisplayEl.setText(`${percent}%`);
            }
        }
    }

    public setSfxThreshold(thresh: number): void {
        if (this.simulation) {
            this.simulation.setOptions({ sfxThreshold: thresh });
        }
    }

    private getLevelName(lvl: number): string {
        switch (lvl) {
            case 1: return 'Top Folders & Root Files';
            case 2: return 'Level 1 Files & Subfolders';
            case 3: return 'Level 2 Files & Deep Folders';
            case 4: return 'Deepest Hierarchy (L4+)';
            default: return `Level ${lvl}`;
        }
    }

    private getLevelTooltip(min: number, max: number): string {
        if (min === max) {
            return `Text Level ${min} only: ${this.getLevelName(min)}`;
        }
        return `Text Levels ${min}-${max}: ${this.getLevelName(min)} to ${this.getLevelName(max)}`;
    }

    private syncLevelControls(): void {
        if (!this.levelMinSliderEl || !this.levelMaxSliderEl) return;
        this.levelMinSliderEl.value = this.labelMinLevel.toString();
        this.levelMaxSliderEl.value = this.labelMaxLevel.toString();

        const leftPercent = ((this.labelMinLevel - 1) / 3) * 100;
        const widthPercent = ((this.labelMaxLevel - this.labelMinLevel) / 3) * 100;
        if (this.levelHighlightEl) {
            this.levelHighlightEl.style.left = `${leftPercent}%`;
            this.levelHighlightEl.style.width = `${widthPercent}%`;
        }

        // Compute scope depth (items inside scoped folder start at 1 + scope depth)
        const scopeLevel = (this.scopedFolder && this.scopedFolder !== '/' && this.scopedFolder !== '.')
            ? Math.min(4, 1 + this.scopedFolder.split('/').filter(Boolean).length)
            : 1;

        // Visual grayout of unavailable levels < scopeLevel without altering stored user setting
        if (this.levelGrayoutEl) {
            if (scopeLevel > 1) {
                const grayoutWidth = ((scopeLevel - 1) / 3) * 100;
                this.levelGrayoutEl.style.width = `${grayoutWidth}%`;
                this.levelGrayoutEl.style.display = 'block';
                this.levelGrayoutEl.title = `Levels 1${scopeLevel > 2 ? `-${scopeLevel - 1}` : ''} inactive: view scoped to Level ${scopeLevel} (${this.scopedFolder})`;
            } else {
                this.levelGrayoutEl.style.width = '0%';
                this.levelGrayoutEl.style.display = 'none';
                this.levelGrayoutEl.title = '';
            }
        }

        const effMin = Math.max(this.labelMinLevel, scopeLevel);
        const effMax = Math.max(this.labelMaxLevel, effMin);

        const isSingle = this.labelMinLevel === this.labelMaxLevel;
        const displayText = isSingle
            ? this.labelMinLevel.toString()
            : `${this.labelMinLevel}-${this.labelMaxLevel}`;

        let desc = this.getLevelTooltip(this.labelMinLevel, this.labelMaxLevel);
        if (scopeLevel > 1 && (effMin !== this.labelMinLevel || effMax !== this.labelMaxLevel)) {
            desc += ` [Effective: Level ${effMin === effMax ? effMin : `${effMin}-${effMax}`}, scoped to Level ${scopeLevel}]`;
        }

        this.levelMinSliderEl.title = `Min Text Level: ${this.labelMinLevel} (${this.getLevelName(this.labelMinLevel)})`;
        this.levelMaxSliderEl.title = `Max Text Level: ${this.labelMaxLevel} (${this.getLevelName(this.labelMaxLevel)})`;

        if (this.levelDisplayEl) {
            this.levelDisplayEl.setText(displayText);
            this.levelDisplayEl.title = desc;
        }

        if (this.levelResetBtnEl) {
            this.levelResetBtnEl.title = isSingle
                ? (this.labelMinLevel === 1 ? `Level 1 active (click to reset to 1-2)` : `Reset to Level 1 (Top Folders & Root Files)`)
                : `Reset to single level (Level ${this.labelMinLevel} only)`;
            this.levelResetBtnEl.setAttribute('aria-label', this.levelResetBtnEl.title);
        }
    }

    public async setTextLevelRange(min: number, max: number): Promise<void> {
        this.labelMinLevel = Math.max(1, Math.min(4, Math.min(min, max)));
        this.labelMaxLevel = Math.max(1, Math.min(4, Math.max(min, max)));
        this.labelRangeLevel = this.labelMaxLevel;
        this.plugin.settings.bubbleLabelMinLevel = this.labelMinLevel;
        this.plugin.settings.bubbleLabelMaxLevel = this.labelMaxLevel;
        this.plugin.settings.bubbleLabelRangeLevel = this.labelRangeLevel;
        await this.plugin.saveSettings();
        this.syncLevelControls();
    }

    public setTextLevel(level: number): void {
        this.setTextLevelRange(level, level);
    }

    public formatTimelineDate(timestamp: number, customFormat?: string): string {
        const format = customFormat || this.plugin.settings.bubbleTimelapseDateFormat || 'DD - MM - YYYY';
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return '';

        try {
            if (typeof window !== 'undefined' && (window as any).moment) {
                return (window as any).moment(timestamp).format(format);
            }
        } catch {
            // fallback
        }

        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = String(d.getFullYear());

        return format
            .replace(/DD/gi, day)
            .replace(/MM/gi, month)
            .replace(/YYYY/gi, year)
            .replace(/YY/gi, year.slice(-2));
    }

    public drawHeatmap(): void {
        if (!this.timelineCanvasEl || !this.graphData) return;
        const canvas = this.timelineCanvasEl;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const computed = getComputedStyle(this.containerEl);
        const accent = computed.getPropertyValue('--interactive-accent').trim() || 
                       computed.getPropertyValue('--color-accent').trim() || 
                       '#7c3aed';

        // Pitch for |||| tick marks: 2px bar + 1px gap = 3px pitch
        const tickW = 2;
        const gap = 1;
        const pitch = tickW + gap;
        const numBars = Math.max(1, Math.floor(rect.width / pitch));

        if (this.timelapseMode !== 'time') {
            // In Vanilla, Filename A-Z, File Title A-Z modes: draw uniform subtle ticks across the entire track
            ctx.save();
            ctx.fillStyle = accent;
            ctx.globalAlpha = 0.22;
            for (let i = 0; i < numBars; i++) {
                const x = i * pitch;
                const barH = rect.height - 4;
                const y = 2;
                ctx.fillRect(x, y, tickW, barH);
            }
            ctx.restore();
            return;
        }

        const minT = this.timelapseMinCtime;
        const maxT = this.timelapseMaxCtime;
        const span = Math.max(1, maxT - minT);

        const barCounts = new Uint32Array(numBars);

        for (const node of this.graphData.nodes) {
            const times = new Set<number>();
            const birthT = getNodeEffectiveTime(node);
            const latestT = getNodeLatestTime(node);
            if (birthT >= minT && birthT <= maxT) times.add(birthT);
            if (latestT >= minT && latestT <= maxT) times.add(latestT);

            for (const t of times) {
                const ratio = (t - minT) / span;
                const idx = Math.min(numBars - 1, Math.max(0, Math.floor(ratio * numBars)));
                barCounts[idx]++;
            }
        }

        // Draw |||| tick marks with saturation based on count:
        // 0 -> 0% (nothing), 1 -> 10% (0.1), 5 -> 50% (0.5), 10+ -> 100% (1.0)
        for (let i = 0; i < numBars; i++) {
            const count = barCounts[i];
            if (count > 0) {
                const saturation = Math.min(1.0, count * 0.10);
                ctx.save();
                ctx.globalAlpha = saturation;
                ctx.fillStyle = accent;
                const x = i * pitch;
                const barH = rect.height - 4;
                const y = 2;
                ctx.fillRect(x, y, tickW, barH);
                ctx.restore();
            }
        }
    }

    public async toggleFullscreen(): Promise<void> {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
                this.isFullscreen = false;
                this.contentEl.removeClass('pakcli-view-fullscreen');
                this.updateFullscreenUI();
            } else if (this.contentEl.hasClass('pakcli-view-fullscreen')) {
                this.toggleCssFullscreen(false);
            } else {
                if (this.contentEl.requestFullscreen) {
                    await this.contentEl.requestFullscreen();
                } else if ((this.contentEl as any).webkitRequestFullscreen) {
                    await (this.contentEl as any).webkitRequestFullscreen();
                } else {
                    this.toggleCssFullscreen(true);
                }
            }
        } catch (err) {
            console.warn('[BubbleGraphView] Fullscreen error, falling back to CSS fullscreen:', err);
            this.toggleCssFullscreen(!this.contentEl.hasClass('pakcli-view-fullscreen'));
        }
    }

    public toggleCssFullscreen(enable?: boolean): void {
        const target = enable ?? !this.contentEl.hasClass('pakcli-view-fullscreen');
        this.contentEl.toggleClass('pakcli-view-fullscreen', target);
        this.isFullscreen = target;
        this.updateFullscreenUI();
        setTimeout(() => {
            this.renderer?.resize();
            this.drawHeatmap();
        }, 60);
    }

    private updateFullscreenUI(): void {
        if (!this.fullscreenBtnEl) return;
        this.fullscreenBtnEl.toggleClass('active', this.isFullscreen);
        this.fullscreenBtnEl.setAttribute('aria-pressed', this.isFullscreen ? 'true' : 'false');
        this.fullscreenBtnEl.setAttribute('title', this.isFullscreen ? 'Exit Fullscreen (Kembali ke Normal View)' : 'Grand Fullscreen (Layar Penuh)');
        setIcon(this.fullscreenBtnEl, this.isFullscreen ? 'minimize' : 'maximize');
    }
}
