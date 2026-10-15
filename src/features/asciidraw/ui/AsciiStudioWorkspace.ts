import { App, Notice, Menu, TFile } from 'obsidian';
import {
	AsciiTool,
	AsciiTheme,
	BoxStyle,
	LineStyle,
	ArrowStyle,
	CHARACTER_PRESETS,
	THEME_PALETTES,
	AsciiStudioConfig,
	Point,
	SelectionRect
} from '../types';
import { LayerManager } from '../core/LayerManager';
import { AsciiSerializer } from '../utils/serializer';
import { AsciiExporter } from '../utils/exporter';
import { AsciiRulerCanvas } from './AsciiRulerCanvas';
import { AsciiPromptModal } from './AsciiModals';

export interface AsciiWorkspaceOptions {
	app: App;
	containerEl: HTMLElement;
	config?: AsciiStudioConfig;
	isTabView?: boolean;
	onSave?: (savedContent: string) => void | Promise<void>;
	onClose?: () => void;
	onOpenInTab?: (content: string) => void;
}

export class AsciiStudioWorkspace {
	public app: App;
	public containerEl: HTMLElement;
	public config: AsciiStudioConfig;
	public isTabView: boolean;
	public onSave?: (savedContent: string) => void | Promise<void>;
	public onClose?: () => void;
	public onOpenInTab?: (content: string) => void;

	private layerManager: LayerManager;
	private activeTool: AsciiTool = 'pencil';
	private activeChar = '█';
	private activeFg = '';
	private activeBg = '';
	private activeTheme: AsciiTheme = 'default';
	private boxStyle: BoxStyle = 'single';
	private lineStyle: LineStyle = 'single';
	private arrowStyle: ArrowStyle = 'right';
	private fillBox = false;

	// Viewport Pan & Smooth Zoom
	private zoomScale = 1.0;
	private panX = 0;
	private panY = 0;
	private isPanning = false;
	private panStartClientX = 0;
	private panStartClientY = 0;
	private isSpacePressed = false;
	private isFullscreen = false;
	private isDrawing = false;
	private lastPointerPos: Point | null = null;
	private dragStartPos: Point | null = null;

	// Precision Canvas Rulers
	private showRulers = true;
	private topRulerEl!: HTMLElement;
	private leftRulerEl!: HTMLElement;
	private rulerCanvas!: AsciiRulerCanvas;
	private cursorCol: number | null = null;
	private cursorRow: number | null = null;
	private rulerRafPending = false;

	// Canvas Viewport & GPU Transform Layer
	private canvasViewportContainerEl!: HTMLElement;
	private canvasInnerViewportEl!: HTMLElement;
	private canvasTransformEl!: HTMLElement;
	private canvasGridEl!: HTMLElement;

	// Photo-Editor Grade Guide Lines (snapping to grid, drag from rulers)
	private guides: { horizontal: number[]; vertical: number[] } = { horizontal: [], vertical: [] };
	private showGuides = true;
	private activeGuideDrag: {
		type: 'horizontal' | 'vertical';
		index: number; // -1 if new guide being created
		currentPos: number; // grid row or col
		isDelete: boolean;
	} | null = null;
	private guidesOverlayEl!: HTMLElement;
	private guideHudEl!: HTMLElement;

	// High-Performance Direct Cell DOM Matrix (60 FPS)
	private cellSpans: HTMLSpanElement[][] = [];
	private gridBuiltCols = 0;
	private gridBuiltRows = 0;

	// Inline Text Typing
	private typingActive = false;
	private typingCol = 0;
	private typingRow = 0;
	private typingStartCol = 0;
	private hiddenTextInput!: HTMLInputElement;

	// Selection & History
	private selectionRect: SelectionRect | null = null;
	private historyStack: string[] = [];
	private historyIndex = -1;

	// Sidebar DOM Elements
	private layersListEl!: HTMLElement;
	private activeCharPreviewEl!: HTMLElement;
	private statusEl!: HTMLElement;

	constructor(options: AsciiWorkspaceOptions) {
		this.app = options.app;
		this.containerEl = options.containerEl;
		this.config = options.config || {};
		this.isTabView = options.isTabView || false;
		this.onSave = options.onSave;
		this.onClose = options.onClose;
		this.onOpenInTab = options.onOpenInTab;

		const parsed = AsciiSerializer.parse(this.config.initialContent || '');
		this.activeTheme = parsed.theme;

		this.layerManager = new LayerManager(parsed.cols, parsed.rows);
		if (parsed.layers && parsed.layers.length > 0) {
			this.layerManager.loadLayerData(parsed.layers, parsed.cols, parsed.rows);
		} else if (parsed.frames && parsed.frames.length > 0) {
			this.layerManager.getActiveBuffer().fromString(parsed.frames[0]);
		}

		this.pushHistory();
	}

	public init(): void {
		this.containerEl.empty();
		this.containerEl.addClass('asciidraw-studio-container');

		this.buildUI();
		this.renderCanvas();
		this.renderLayersList();

		window.setTimeout(() => this.fitToScreen(), 60);
		this.setupGlobalShortcuts();
	}

	public loadContent(content: string): void {
		const parsed = AsciiSerializer.parse(content);
		this.activeTheme = parsed.theme;
		this.applyTheme();

		this.layerManager.resizeAll(parsed.cols, parsed.rows);
		if (parsed.layers && parsed.layers.length > 0) {
			this.layerManager.loadLayerData(parsed.layers, parsed.cols, parsed.rows);
		} else if (parsed.frames && parsed.frames.length > 0) {
			this.layerManager.getActiveBuffer().fromString(parsed.frames[0]);
		}

		this.renderCanvas();
		this.renderLayersList();
		this.renderRulers();
		this.pushHistory();
	}

	// =========================================================================
	// UI Builder
	// =========================================================================

	private buildUI(): void {
		this.containerEl.empty();

		// 1. Top Navigation Bar
		const topNav = this.containerEl.createDiv({ cls: 'asciidraw-topnav' });
		this.buildTopNav(topNav);

		// 2. Main Workspace
		const mainArea = this.containerEl.createDiv({ cls: 'asciidraw-workspace' });

		const leftToolbar = mainArea.createDiv({ cls: 'asciidraw-left-toolbar' });
		this.buildLeftToolbar(leftToolbar);

		const canvasViewport = mainArea.createDiv({ cls: 'asciidraw-canvas-viewport' });
		this.buildCanvasViewport(canvasViewport);

		const rightSidebar = mainArea.createDiv({ cls: 'asciidraw-right-sidebar' });
		this.buildRightSidebar(rightSidebar);
	}

	private buildTopNav(parent: HTMLElement): void {
		const leftGroup = parent.createDiv({ cls: 'asciidraw-nav-group' });

		// Logo / Title
		const title = leftGroup.createDiv({ cls: 'asciidraw-nav-title' });
		title.createSpan({ cls: 'asciidraw-logo-icon', text: '🔲' });
		title.appendText(this.isTabView ? ' ASCII Studio (Tab)' : ' ASCII Studio');

		// Canvas Dimension Selector & Custom Inputs
		const sizeSelector = leftGroup.createEl('select', { cls: 'asciidraw-select' });
		const presets = [
			{ label: 'Compact (40x15)', cols: 40, rows: 15 },
			{ label: 'Standard (60x20)', cols: 60, rows: 20 },
			{ label: 'Wide Terminal (80x24)', cols: 80, rows: 24 },
			{ label: 'HD Grid (100x30)', cols: 100, rows: 30 },
			{ label: 'Ultra Wide (120x40)', cols: 120, rows: 40 },
			{ label: 'Banner (600x20)', cols: 600, rows: 20 },
			{ label: 'Custom...', cols: 0, rows: 0 }
		];

		const curCols = this.layerManager.cols;
		const curRows = this.layerManager.rows;

		presets.forEach(p => {
			const opt = sizeSelector.createEl('option', { text: p.label, value: `${p.cols}x${p.rows}` });
			if (p.cols === curCols && p.rows === curRows) opt.selected = true;
		});

		// Custom dimension inputs
		const customSizeBox = leftGroup.createDiv({ cls: 'asciidraw-custom-size-box' });
		customSizeBox.createSpan({ text: 'W:' });
		const inputCols = customSizeBox.createEl('input', {
			type: 'number',
			cls: 'asciidraw-size-input',
			value: String(curCols),
			attr: { min: '5', max: '800', title: 'Custom Width (Cols)' }
		});
		customSizeBox.createSpan({ text: 'H:' });
		const inputRows = customSizeBox.createEl('input', {
			type: 'number',
			cls: 'asciidraw-size-input',
			value: String(curRows),
			attr: { min: '3', max: '300', title: 'Custom Height (Rows)' }
		});

		const applyCustomSize = () => {
			const w = Math.max(5, Math.min(800, parseInt(inputCols.value, 10) || 60));
			const h = Math.max(3, Math.min(300, parseInt(inputRows.value, 10) || 20));
			this.layerManager.resizeAll(w, h);
			this.renderCanvas();
			this.renderRulers();
			this.pushHistory();
		};
		inputCols.onchange = applyCustomSize;
		inputRows.onchange = applyCustomSize;

		sizeSelector.addEventListener('change', () => {
			if (sizeSelector.value !== '0x0') {
				const [w, h] = sizeSelector.value.split('x').map(n => parseInt(n, 10));
				inputCols.value = String(w);
				inputRows.value = String(h);
				this.layerManager.resizeAll(w, h);
				this.renderCanvas();
				this.renderRulers();
				this.pushHistory();
			}
		});

		// Theme Selector
		const themeSelector = leftGroup.createEl('select', { cls: 'asciidraw-select' });
		Object.entries(THEME_PALETTES).forEach(([key, val]) => {
			const opt = themeSelector.createEl('option', { text: val.label, value: key });
			if (key === this.activeTheme) opt.selected = true;
		});

		themeSelector.addEventListener('change', () => {
			this.activeTheme = themeSelector.value as AsciiTheme;
			this.applyTheme();
			this.renderCanvas();
			this.renderRulers();
		});

		// Center Controls: Zoom & History
		const centerGroup = parent.createDiv({ cls: 'asciidraw-nav-group' });

		const btnZoomOut = centerGroup.createEl('button', { text: '−', cls: 'asciidraw-btn-icon', title: 'Zoom Out' });
		btnZoomOut.onclick = () => this.adjustZoom(-0.15);

		centerGroup.createSpan({ text: `${Math.round(this.zoomScale * 100)}%`, cls: 'asciidraw-zoom-label' });

		const btnZoomIn = centerGroup.createEl('button', { text: '+', cls: 'asciidraw-btn-icon', title: 'Zoom In' });
		btnZoomIn.onclick = () => this.adjustZoom(0.15);

		const btnFit = centerGroup.createEl('button', { text: '⊡ Fit', cls: 'asciidraw-btn-sm', title: 'Fit Viewport (Ctrl+0)' });
		btnFit.onclick = () => this.fitToScreen();

		const btn100 = centerGroup.createEl('button', { text: '1:1', cls: 'asciidraw-btn-sm', title: 'Actual Size 100% (Ctrl+1)' });
		btn100.onclick = () => this.resetZoom100();

		const btnRulers = centerGroup.createEl('button', {
			text: this.showRulers ? '📐 Rulers' : '📐',
			cls: 'asciidraw-btn-sm' + (this.showRulers ? ' is-active' : ''),
			title: 'Toggle Precision Rulers (Ctrl+R)'
		});
		btnRulers.onclick = () => {
			this.showRulers = !this.showRulers;
			btnRulers.toggleClass('is-active', this.showRulers);
			btnRulers.setText(this.showRulers ? '📐 Rulers' : '📐');
			this.updateRulerVisibility();
		};

		const btnGuides = centerGroup.createEl('button', {
			text: this.showGuides ? '📏 Guides' : '📏',
			cls: 'asciidraw-btn-sm asciidraw-btn-guides' + (this.showGuides ? ' is-active' : ''),
			title: 'Toggle Photo-Editor Guide Lines (Ctrl+;)'
		});
		btnGuides.onclick = () => {
			this.toggleGuides();
			btnGuides.toggleClass('is-active', this.showGuides);
			btnGuides.setText(this.showGuides ? '📏 Guides' : '📏');
		};

		const btnUndo = centerGroup.createEl('button', { text: '↩ Undo', cls: 'asciidraw-btn-sm', title: 'Undo (Ctrl+Z)' });
		btnUndo.onclick = () => this.undo();

		const btnRedo = centerGroup.createEl('button', { text: '↪ Redo', cls: 'asciidraw-btn-sm', title: 'Redo (Ctrl+Y)' });
		btnRedo.onclick = () => this.redo();

		// Right Actions: Open in Tab, Fullscreen, Export, Save
		const rightGroup = parent.createDiv({ cls: 'asciidraw-nav-group' });

		if (!this.isTabView && this.onOpenInTab) {
			const btnTab = rightGroup.createEl('button', {
				text: '⧉ Open in Tab',
				cls: 'asciidraw-btn-sm',
				title: 'Embed and open ASCII Studio in an Obsidian Tab View'
			});
			btnTab.onclick = () => {
				const serialized = this.getSerializedContent();
				this.onOpenInTab?.(serialized);
			};
		}

		const btnFullscreen = rightGroup.createEl('button', {
			text: this.isFullscreen ? 'Exit Fullscreen' : '⛶ Fullscreen',
			cls: 'asciidraw-btn-sm',
			title: 'Toggle Fullscreen Mode'
		});
		btnFullscreen.onclick = () => this.toggleFullscreen();

		const btnExport = rightGroup.createEl('button', { text: 'Export ▾', cls: 'asciidraw-btn-sm' });
		btnExport.onclick = (e) => this.showExportMenu(e);

		const btnSave = rightGroup.createEl('button', {
			text: '💾 Save to Note',
			cls: 'asciidraw-btn-primary',
			title: 'Save changes directly into note codeblock'
		});
		btnSave.onclick = () => this.handleSave();
	}

	private buildLeftToolbar(parent: HTMLElement): void {
		const toolGroup = parent.createDiv({ cls: 'asciidraw-toolrack' });

		const tools: { id: AsciiTool; icon: string; name: string; shortcut: string }[] = [
			{ id: 'pencil', icon: '✏️', name: 'Pencil / Stamp', shortcut: 'P' },
			{ id: 'eraser', icon: '🧼', name: 'Eraser', shortcut: 'E' },
			{ id: 'line', icon: '📏', name: 'Straight Line', shortcut: 'L' },
			{ id: 'arrow', icon: '➔', name: 'Directional Arrow', shortcut: 'A' },
			{ id: 'box', icon: '🔲', name: 'Box / Rectangle', shortcut: 'B' },
			{ id: 'circle', icon: '⭕', name: 'Circle / Ellipse', shortcut: 'C' },
			{ id: 'fill', icon: '🪣', name: 'Flood Fill', shortcut: 'F' },
			{ id: 'text', icon: '🔤', name: 'Monospace Text', shortcut: 'T' },
			{ id: 'select', icon: '✂️', name: 'Marquee Selection', shortcut: 'S' }
		];

		tools.forEach(t => {
			const btn = toolGroup.createEl('button', {
				cls: `asciidraw-tool-btn ${this.activeTool === t.id ? 'is-active' : ''}`,
				title: `${t.name} (${t.shortcut})`
			});
			btn.createSpan({ cls: 'tool-icon', text: t.icon });
			btn.createSpan({ cls: 'tool-label', text: t.name });

			btn.onclick = () => {
				this.setTool(t.id);
				parent.querySelectorAll('.asciidraw-tool-btn').forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
			};
		});

		// Sub-options
		const subOpts = parent.createDiv({ cls: 'asciidraw-tool-suboptions' });

		const boxStyleSelect = subOpts.createEl('select', { cls: 'asciidraw-select-mini' });
		['single', 'double', 'rounded', 'solid', 'ascii', 'dashed'].forEach(style => {
			const opt = boxStyleSelect.createEl('option', { text: `${style} border`, value: style });
			if (style === this.boxStyle) opt.selected = true;
		});
		boxStyleSelect.onchange = () => {
			this.boxStyle = boxStyleSelect.value as BoxStyle;
			this.lineStyle = (boxStyleSelect.value === 'double' ? 'double' : (boxStyleSelect.value === 'ascii' ? 'ascii' : 'single')) as LineStyle;
		};

		const fillToggle = subOpts.createEl('label', { cls: 'asciidraw-checkbox-label' });
		const fillCb = fillToggle.createEl('input', { type: 'checkbox' });
		fillCb.checked = this.fillBox;
		fillToggle.createSpan({ text: ' Filled' });
		fillCb.onchange = () => {
			this.fillBox = fillCb.checked;
		};
	}

	private buildCanvasViewport(parent: HTMLElement): void {
		this.canvasViewportContainerEl = parent.createDiv({
			cls: `asciidraw-viewport-container ${this.showRulers ? '' : 'hide-rulers'}`
		});

		// 1. Origin Corner
		const corner = this.canvasViewportContainerEl.createDiv({ cls: 'asciidraw-ruler-corner', text: '⌗' });
		corner.title = 'Ruler Origin (0, 0)';

		// 2. High-DPI Canvas Rulers
		this.topRulerEl = this.canvasViewportContainerEl.createDiv({ cls: 'asciidraw-ruler-top' });
		this.leftRulerEl = this.canvasViewportContainerEl.createDiv({ cls: 'asciidraw-ruler-left' });
		this.rulerCanvas = new AsciiRulerCanvas(this.topRulerEl, this.leftRulerEl);
		this.rulerCanvas.onStartGuideDrag = (type, e) => this.startGuideDragFromRuler(type, e);

		// Context menu on ruler corner and rulers to clear or toggle guides
		const showRulerContextMenu = (e: MouseEvent) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem(item => {
				item.setTitle(this.showGuides ? 'Hide Guide Lines (Ctrl+;)' : 'Show Guide Lines (Ctrl+;)')
					.setIcon('ruler')
					.onClick(() => this.toggleGuides());
			});
			if (this.guides.horizontal.length > 0 || this.guides.vertical.length > 0) {
				menu.addItem(item => {
					item.setTitle('Clear All Guide Lines')
						.setIcon('trash')
						.onClick(() => this.clearAllGuides());
				});
			}
			menu.showAtMouseEvent(e);
		};
		corner.addEventListener('contextmenu', showRulerContextMenu);
		this.topRulerEl.addEventListener('contextmenu', showRulerContextMenu);
		this.leftRulerEl.addEventListener('contextmenu', showRulerContextMenu);

		// 3. Viewport Inner Container
		this.canvasInnerViewportEl = this.canvasViewportContainerEl.createDiv({ cls: 'asciidraw-inner-viewport' });

		// Hidden typing input
		this.hiddenTextInput = this.canvasInnerViewportEl.createEl('input', {
			cls: 'asciidraw-hidden-text-input',
			type: 'text',
			attr: { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }
		});

		// GPU Transform layer (smooth 60 FPS panning & zooming)
		this.canvasTransformEl = this.canvasInnerViewportEl.createDiv({ cls: 'asciidraw-canvas-transform-layer' });
		this.canvasGridEl = this.canvasTransformEl.createDiv({ cls: 'asciidraw-grid-surface' });
		this.guidesOverlayEl = this.canvasTransformEl.createDiv({ cls: 'asciidraw-guides-overlay' });

		// Floating Guide HUD Tooltip (inside inner viewport)
		this.guideHudEl = this.canvasInnerViewportEl.createDiv({ cls: 'asciidraw-guide-hud' });
		this.guideHudEl.style.display = 'none';

		// Context menu on the canvas inner viewport
		this.canvasInnerViewportEl.addEventListener('contextmenu', (e: MouseEvent) => {
			if ((e.target as HTMLElement)?.classList.contains('asciidraw-guide-line')) {
				return;
			}
			e.preventDefault();
			const innerRect = this.canvasInnerViewportEl.getBoundingClientRect();
			const mouseX = e.clientX - innerRect.left;
			const mouseY = e.clientY - innerRect.top;
			const canvasX = (mouseX - this.panX) / this.zoomScale;
			const canvasY = (mouseY - this.panY) / this.zoomScale;
			const cellCol = Math.round((canvasX - 8) / 10);
			const cellRow = Math.round((canvasY - 8) / 17);

			const menu = new Menu();

			menu.addItem((item) => {
				item.setTitle(`Add Horizontal Guide at Row ${cellRow}`)
					.setIcon('ruler')
					.onClick(() => {
						if (!this.guides.horizontal.includes(cellRow)) {
							this.guides.horizontal.push(cellRow);
							this.guides.horizontal.sort((a, b) => a - b);
							this.renderGuides();
							new Notice(`Added horizontal guide at Row ${cellRow}`);
						}
					});
			});

			menu.addItem((item) => {
				item.setTitle(`Add Vertical Guide at Col ${cellCol}`)
					.setIcon('ruler')
					.onClick(() => {
						if (!this.guides.vertical.includes(cellCol)) {
							this.guides.vertical.push(cellCol);
							this.guides.vertical.sort((a, b) => a - b);
							this.renderGuides();
							new Notice(`Added vertical guide at Col ${cellCol}`);
						}
					});
			});

			if (this.guides.horizontal.length > 0 || this.guides.vertical.length > 0) {
				menu.addItem((item) => {
					item.setTitle('Clear All Guides')
						.setIcon('trash')
						.onClick(() => this.clearAllGuides());
				});
			}

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle(this.showGuides ? 'Hide Guide Lines (Ctrl+;)' : 'Show Guide Lines (Ctrl+;)')
					.setIcon('eye')
					.onClick(() => this.toggleGuides());
			});

			menu.addItem((item) => {
				item.setTitle(this.showRulers ? 'Hide Precision Rulers (Ctrl+R)' : 'Show Precision Rulers (Ctrl+R)')
					.setIcon('sliders')
					.onClick(() => {
						this.showRulers = !this.showRulers;
						this.updateRulerVisibility();
					});
			});

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle('Fit to Screen (Ctrl+0)')
					.setIcon('minimize')
					.onClick(() => this.fitToScreen());
			});

			menu.addItem((item) => {
				item.setTitle('Actual Size 100% (Ctrl+1)')
					.setIcon('maximize')
					.onClick(() => this.resetZoom100());
			});

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle('Copy Plain ASCII Text')
					.setIcon('copy')
					.onClick(async () => {
						const composite = this.layerManager.getCompositeBuffer();
						await AsciiExporter.copyToClipboard(composite.toString(true));
						new Notice('Copied plain ASCII text to clipboard!');
					});
			});

			menu.addItem((item) => {
				item.setTitle('Save to Note (Ctrl+S)')
					.setIcon('save')
					.onClick(() => this.handleSave());
			});

			menu.showAtMouseEvent(e);
		});

		this.setupViewportNavigationEvents();
		this.setupDirectTypingEvents();

		this.statusEl = parent.createDiv({ cls: 'asciidraw-status-bar' });
		this.updateStatus('Ready • 60 FPS Lightweight Engine Active');

		this.updateCanvasTransform();
		this.renderRulers();
		this.renderGuides();
	}

	private setupViewportNavigationEvents(): void {
		const viewport = this.canvasInnerViewportEl;

		// Mouse Wheel Zoom / Trackpad Pan
		viewport.addEventListener('wheel', (e: WheelEvent) => {
			e.preventDefault();

			if (e.ctrlKey || e.altKey || e.metaKey) {
				const rect = viewport.getBoundingClientRect();
				const mouseX = e.clientX - rect.left;
				const mouseY = e.clientY - rect.top;

				const oldScale = this.zoomScale;
				const factor = e.deltaY < 0 ? 1.15 : 0.85;
				const newScale = Math.min(3.5, Math.max(0.2, oldScale * factor));

				if (newScale !== oldScale) {
					this.panX = mouseX - ((mouseX - this.panX) / oldScale) * newScale;
					this.panY = mouseY - ((mouseY - this.panY) / oldScale) * newScale;
					this.zoomScale = newScale;
					this.updateCanvasTransform();
					this.updateZoomDisplay();
					this.renderRulers();
				}
			} else {
				this.panX -= e.deltaX;
				this.panY -= e.deltaY;
				this.updateCanvasTransform();
				this.renderRulers();
			}
		}, { passive: false });

		// Spacebar Hand Panning
		window.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.code === 'Space' && !this.isSpacePressed && !this.typingActive && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
				this.isSpacePressed = true;
				viewport.addClass('is-space-panning');
				e.preventDefault();
			}
		});

		window.addEventListener('keyup', (e: KeyboardEvent) => {
			if (e.code === 'Space') {
				this.isSpacePressed = false;
				viewport.removeClass('is-space-panning');
			}
		});

		// Pointer navigation
		viewport.addEventListener('pointerdown', (e: PointerEvent) => {
			if (e.button === 1 || (e.button === 0 && this.isSpacePressed)) {
				this.isPanning = true;
				this.panStartClientX = e.clientX;
				this.panStartClientY = e.clientY;
				viewport.addClass('is-grabbing');
				e.preventDefault();
				e.stopPropagation();
				return;
			}

			if (e.button === 0 && !this.isSpacePressed) {
				this.handlePointerDown(e);
			}
		});

		window.addEventListener('pointermove', (e: PointerEvent) => {
			if (this.activeGuideDrag) {
				this.updateGuideDragPosition(e.clientX, e.clientY);
				e.preventDefault();
				return;
			}

			if (this.isPanning) {
				const dx = e.clientX - this.panStartClientX;
				const dy = e.clientY - this.panStartClientY;
				this.panX += dx;
				this.panY += dy;
				this.panStartClientX = e.clientX;
				this.panStartClientY = e.clientY;
				this.updateCanvasTransform();
				this.renderRulers();
				e.preventDefault();
				return;
			}

			this.handlePointerMove(e);
		});

		window.addEventListener('pointerup', (e: PointerEvent) => {
			if (this.activeGuideDrag) {
				this.finishGuideDrag();
				e.preventDefault();
				return;
			}

			if (this.isPanning) {
				this.isPanning = false;
				viewport.removeClass('is-grabbing');
				return;
			}

			this.handlePointerUp(e);
		});
	}

	private setupDirectTypingEvents(): void {
		if (!this.hiddenTextInput) return;

		this.hiddenTextInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (!this.typingActive) return;

			if (e.key === 'Enter' || e.key === 'Escape') {
				e.preventDefault();
				this.finishTyping();
			} else if (e.key === 'Backspace') {
				e.preventDefault();
				const activeBuffer = this.layerManager.getActiveBuffer();
				if (this.typingCol > this.typingStartCol) {
					this.typingCol--;
					activeBuffer.setCell(this.typingCol, this.typingRow, { char: ' ' });
					this.updateSingleCell(this.typingCol, this.typingRow);
					this.updateTypingCaret();
				}
			} else if (e.key === 'ArrowLeft') {
				e.preventDefault();
				if (this.typingCol > 0) {
					this.typingCol--;
					this.updateTypingCaret();
				}
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				if (this.typingCol < this.layerManager.cols - 1) {
					this.typingCol++;
					this.updateTypingCaret();
				}
			}
		});

		this.hiddenTextInput.addEventListener('input', () => {
			if (!this.typingActive) return;
			const text = this.hiddenTextInput.value;
			this.hiddenTextInput.value = '';
			if (!text) return;

			const activeBuffer = this.layerManager.getActiveBuffer();
			for (let i = 0; i < text.length; i++) {
				const char = text[i];
				if (this.typingCol < this.layerManager.cols) {
					activeBuffer.setCell(this.typingCol, this.typingRow, {
						char,
						fg: this.activeFg || undefined,
						bg: this.activeBg || undefined
					});
					this.updateSingleCell(this.typingCol, this.typingRow);
					this.typingCol++;
				}
			}
			this.updateTypingCaret();
		});

		this.hiddenTextInput.addEventListener('blur', () => {
			window.setTimeout(() => {
				if (this.typingActive) {
					this.finishTyping();
				}
			}, 150);
		});
	}

	private startTyping(col: number, row: number): void {
		if (this.typingActive) {
			this.finishTyping();
		}
		this.typingActive = true;
		this.typingCol = col;
		this.typingRow = row;
		this.typingStartCol = col;
		this.updateTypingCaret();
		this.updateStatus(`Typing at (${col}, ${row}) • Type text, press Enter to commit`);

		if (this.hiddenTextInput) {
			this.hiddenTextInput.value = '';
			this.hiddenTextInput.focus();
		}
	}

	private finishTyping(): void {
		if (!this.typingActive) return;
		this.typingActive = false;
		this.clearTypingCaret();
		if (this.hiddenTextInput) {
			this.hiddenTextInput.blur();
		}
		this.pushHistory();
		this.updateStatus('Text committed');
	}

	private updateTypingCaret(): void {
		this.clearTypingCaret();
		if (!this.typingActive) return;
		const cell = this.cellSpans[this.typingRow]?.[this.typingCol];
		if (cell) {
			cell.addClass('is-typing-caret');
		}
	}

	private clearTypingCaret(): void {
		if (this.canvasGridEl) {
			this.canvasGridEl.querySelectorAll('.ascii-cell.is-typing-caret').forEach(c => c.removeClass('is-typing-caret'));
		}
	}

	// =========================================================================
	// High-Performance 60 FPS Direct Cell Canvas Engine
	// =========================================================================

	public renderCanvas(): void {
		if (!this.canvasGridEl) return;
		const composite = this.layerManager.getCompositeBuffer();
		const cols = composite.cols;
		const rows = composite.rows;
		const palette = THEME_PALETTES[this.activeTheme] || THEME_PALETTES.default;

		this.canvasGridEl.setCssStyles({
			backgroundColor: palette.bg,
			borderColor: palette.border
		});

		// 1. Fast Path: If DOM grid already matches dimensions, do NOT rebuild DOM elements!
		if (this.gridBuiltCols === cols && this.gridBuiltRows === rows && this.cellSpans.length === rows) {
			for (let r = 0; r < rows; r++) {
				const rowSpans = this.cellSpans[r];
				for (let c = 0; c < cols; c++) {
					const cell = composite.getCell(c, r);
					const charToDisplay = cell ? cell.char : ' ';
					const span = rowSpans[c];
					if (span) {
						span.textContent = charToDisplay === ' ' ? '\u00A0' : charToDisplay;
						span.style.color = cell?.fg || palette.fg;
						span.style.backgroundColor = cell?.bg || '';
					}
				}
			}
			if (this.typingActive) this.updateTypingCaret();
			return;
		}

		// 2. Full Allocation Path (only on dimension change or first load)
		this.gridBuiltCols = cols;
		this.gridBuiltRows = rows;
		this.cellSpans = [];

		const frag = document.createDocumentFragment();
		for (let r = 0; r < rows; r++) {
			const rowDiv = document.createElement('div');
			rowDiv.className = 'ascii-row';
			const rowSpans: HTMLSpanElement[] = [];

			for (let c = 0; c < cols; c++) {
				const cell = composite.getCell(c, r);
				const charToDisplay = cell ? cell.char : ' ';
				const span = document.createElement('span');
				span.className = 'ascii-cell';
				span.setAttribute('data-col', String(c));
				span.setAttribute('data-row', String(r));
				span.textContent = charToDisplay === ' ' ? '\u00A0' : charToDisplay;
				span.style.color = cell?.fg || palette.fg;
				span.style.backgroundColor = cell?.bg || '';
				rowDiv.appendChild(span);
				rowSpans.push(span);
			}

			this.cellSpans.push(rowSpans);
			frag.appendChild(rowDiv);
		}

		this.canvasGridEl.empty();
		this.canvasGridEl.appendChild(frag);

		if (this.typingActive) {
			this.updateTypingCaret();
		}
	}

	/**
	 * Ultra-fast single cell update (runs in < 0.005ms)
	 */
	public updateSingleCell(c: number, r: number): void {
		const span = this.cellSpans[r]?.[c];
		if (!span) return;
		const composite = this.layerManager.getCompositeBuffer();
		const cell = composite.getCell(c, r);
		const palette = THEME_PALETTES[this.activeTheme] || THEME_PALETTES.default;
		const charToDisplay = cell ? cell.char : ' ';
		span.textContent = charToDisplay === ' ' ? '\u00A0' : charToDisplay;
		span.style.color = cell?.fg || palette.fg;
		span.style.backgroundColor = cell?.bg || '';
	}

	// =========================================================================
	// Precision Canvas Rulers
	// =========================================================================

	public renderRulers(): void {
		if (!this.showRulers || !this.rulerCanvas) return;
		const palette = THEME_PALETTES[this.activeTheme] || THEME_PALETTES.default;

		this.rulerCanvas.render({
			cols: this.layerManager.cols,
			rows: this.layerManager.rows,
			cellW: 10,
			cellH: 17,
			pad: 8,
			panX: this.panX,
			panY: this.panY,
			zoomScale: this.zoomScale,
			activeCol: this.cursorCol,
			activeRow: this.cursorRow,
			palette
		});
	}

	private triggerRulerUpdate(col: number, row: number): void {
		this.cursorCol = col;
		this.cursorRow = row;
		if (this.rulerRafPending) return;
		this.rulerRafPending = true;
		requestAnimationFrame(() => {
			this.rulerRafPending = false;
			this.renderRulers();
		});
	}

	private updateCanvasTransform(): void {
		if (this.canvasTransformEl) {
			this.canvasTransformEl.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0px) scale(${this.zoomScale})`;
		}
	}

	private updateRulerVisibility(): void {
		if (this.canvasViewportContainerEl) {
			this.canvasViewportContainerEl.toggleClass('hide-rulers', !this.showRulers);
		}
		if (this.showRulers) {
			this.renderRulers();
		}
	}

	// =========================================================================
	// Photo-Editor Grade Guide Lines (Snap to Grid & Drag from Rulers)
	// =========================================================================

	public toggleGuides(): void {
		this.showGuides = !this.showGuides;
		const btn = this.containerEl.querySelector('.asciidraw-btn-guides');
		if (btn) {
			btn.toggleClass('is-active', this.showGuides);
			btn.textContent = this.showGuides ? '📏 Guides' : '📏';
		}
		this.renderGuides();
		new Notice(`Guide lines ${this.showGuides ? 'visible' : 'hidden'} (Ctrl+;)`);
	}

	public clearAllGuides(): void {
		this.guides = { horizontal: [], vertical: [] };
		this.renderGuides();
		new Notice('Cleared all guide lines');
	}

	public startGuideDragFromRuler(type: 'horizontal' | 'vertical', e: PointerEvent): void {
		this.showGuides = true;
		const btn = this.containerEl.querySelector('.asciidraw-btn-guides');
		if (btn) {
			btn.addClass('is-active');
			btn.textContent = '📏 Guides';
		}

		if (!this.canvasInnerViewportEl) return;
		const innerRect = this.canvasInnerViewportEl.getBoundingClientRect();
		const mouseX = e.clientX - innerRect.left;
		const mouseY = e.clientY - innerRect.top;
		const canvasX = (mouseX - this.panX) / this.zoomScale;
		const canvasY = (mouseY - this.panY) / this.zoomScale;

		const initialPos = type === 'horizontal'
			? Math.max(0, Math.min(this.layerManager.rows, Math.round((canvasY - 8) / 17)))
			: Math.max(0, Math.min(this.layerManager.cols, Math.round((canvasX - 8) / 10)));

		this.activeGuideDrag = {
			type,
			index: -1, // new guide
			currentPos: initialPos,
			isDelete: false
		};

		if (this.guideHudEl) {
			this.guideHudEl.style.display = 'block';
		}
		this.updateGuideDragPosition(e.clientX, e.clientY);
	}

	public startGuideDragExisting(type: 'horizontal' | 'vertical', index: number, currentPos: number, e: PointerEvent): void {
		this.activeGuideDrag = {
			type,
			index,
			currentPos,
			isDelete: false
		};

		if (this.guideHudEl) {
			this.guideHudEl.style.display = 'block';
		}
		this.updateGuideDragPosition(e.clientX, e.clientY);
	}

	private updateGuideDragPosition(clientX: number, clientY: number): void {
		if (!this.activeGuideDrag || !this.canvasInnerViewportEl) return;
		const innerRect = this.canvasInnerViewportEl.getBoundingClientRect();
		const mouseX = clientX - innerRect.left;
		const mouseY = clientY - innerRect.top;

		const canvasX = (mouseX - this.panX) / this.zoomScale;
		const canvasY = (mouseY - this.panY) / this.zoomScale;

		const type = this.activeGuideDrag.type;
		let pos = 0;
		let isDelete = false;

		if (type === 'horizontal') {
			pos = Math.round((canvasY - 8) / 17);
			// Dragged back to ruler or outside bounds
			if (mouseY <= 0 || pos < -2 || pos > this.layerManager.rows + 2) {
				isDelete = true;
			}
		} else {
			pos = Math.round((canvasX - 8) / 10);
			// Dragged back to ruler or outside bounds
			if (mouseX <= 0 || pos < -2 || pos > this.layerManager.cols + 2) {
				isDelete = true;
			}
		}

		this.activeGuideDrag.currentPos = pos;
		this.activeGuideDrag.isDelete = isDelete;

		// Position HUD near cursor
		if (this.guideHudEl) {
			this.guideHudEl.style.left = `${Math.min(innerRect.width - 150, Math.max(10, mouseX + 16))}px`;
			this.guideHudEl.style.top = `${Math.min(innerRect.height - 35, Math.max(10, mouseY + 16))}px`;

			if (isDelete) {
				this.guideHudEl.textContent = 'Release to remove guide';
				this.guideHudEl.addClass('is-delete');
			} else {
				this.guideHudEl.removeClass('is-delete');
				this.guideHudEl.textContent = type === 'horizontal' ? `Row: ${pos}` : `Col: ${pos}`;
			}
		}

		this.renderGuides();
	}

	private finishGuideDrag(): void {
		if (!this.activeGuideDrag) return;
		const { type, index, currentPos, isDelete } = this.activeGuideDrag;
		if (this.guideHudEl) {
			this.guideHudEl.style.display = 'none';
		}

		if (isDelete) {
			if (index >= 0) {
				this.guides[type].splice(index, 1);
				new Notice(`Removed ${type} guide`);
			}
		} else {
			if (index >= 0) {
				this.guides[type][index] = currentPos;
			} else {
				if (!this.guides[type].includes(currentPos)) {
					this.guides[type].push(currentPos);
					this.guides[type].sort((a, b) => a - b);
					new Notice(`Added ${type} guide at ${type === 'horizontal' ? 'Row' : 'Col'} ${currentPos}`);
				}
			}
		}

		this.activeGuideDrag = null;
		this.renderGuides();
	}

	public renderGuides(): void {
		if (!this.guidesOverlayEl) return;
		this.guidesOverlayEl.empty();
		if (!this.showGuides) return;

		// 1. Horizontal Guides
		this.guides.horizontal.forEach((row, idx) => {
			if (this.activeGuideDrag && this.activeGuideDrag.type === 'horizontal' && this.activeGuideDrag.index === idx) {
				return;
			}
			const line = this.guidesOverlayEl.createDiv({
				cls: 'asciidraw-guide-line is-horizontal'
			});
			line.style.top = `${8 + row * 17}px`;
			line.title = `Horizontal Guide (Row ${row}) • Drag to move, right-click to delete`;

			line.addEventListener('pointerdown', (e: PointerEvent) => {
				if (e.button === 0) {
					e.stopPropagation();
					e.preventDefault();
					this.startGuideDragExisting('horizontal', idx, row, e);
				}
			});

			line.addEventListener('contextmenu', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
				const menu = new Menu();
				menu.addItem(item => {
					item.setTitle(`Delete Guide (Row ${row})`)
						.setIcon('trash')
						.onClick(() => {
							this.guides.horizontal.splice(idx, 1);
							this.renderGuides();
							new Notice(`Deleted Horizontal Guide (Row ${row})`);
						});
				});
				menu.addItem(item => {
					item.setTitle('Clear All Guides')
						.setIcon('trash')
						.onClick(() => this.clearAllGuides());
				});
				menu.showAtMouseEvent(e);
			});
		});

		// 2. Vertical Guides
		this.guides.vertical.forEach((col, idx) => {
			if (this.activeGuideDrag && this.activeGuideDrag.type === 'vertical' && this.activeGuideDrag.index === idx) {
				return;
			}
			const line = this.guidesOverlayEl.createDiv({
				cls: 'asciidraw-guide-line is-vertical'
			});
			line.style.left = `${8 + col * 10}px`;
			line.title = `Vertical Guide (Col ${col}) • Drag to move, right-click to delete`;

			line.addEventListener('pointerdown', (e: PointerEvent) => {
				if (e.button === 0) {
					e.stopPropagation();
					e.preventDefault();
					this.startGuideDragExisting('vertical', idx, col, e);
				}
			});

			line.addEventListener('contextmenu', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
				const menu = new Menu();
				menu.addItem(item => {
					item.setTitle(`Delete Guide (Col ${col})`)
						.setIcon('trash')
						.onClick(() => {
							this.guides.vertical.splice(idx, 1);
							this.renderGuides();
							new Notice(`Deleted Vertical Guide (Col ${col})`);
						});
				});
				menu.addItem(item => {
					item.setTitle('Clear All Guides')
						.setIcon('trash')
						.onClick(() => this.clearAllGuides());
				});
				menu.showAtMouseEvent(e);
			});
		});

		// 3. Active dragged guide preview
		if (this.activeGuideDrag) {
			const drag = this.activeGuideDrag;
			const preview = this.guidesOverlayEl.createDiv({
				cls: `asciidraw-guide-line is-${drag.type} is-dragging ${drag.isDelete ? 'is-delete' : ''}`
			});
			if (drag.type === 'horizontal') {
				preview.style.top = `${8 + drag.currentPos * 17}px`;
			} else {
				preview.style.left = `${8 + drag.currentPos * 10}px`;
			}
		}
	}

	private updateZoomDisplay(): void {
		const zoomLabel = this.containerEl?.querySelector('.asciidraw-zoom-label');
		if (zoomLabel) zoomLabel.textContent = `${Math.round(this.zoomScale * 100)}%`;
	}

	public fitToScreen(): void {
		if (!this.canvasInnerViewportEl) return;
		const rect = this.canvasInnerViewportEl.getBoundingClientRect();
		const cols = this.layerManager.cols;
		const rows = this.layerManager.rows;
		const contentW = 16 + cols * 10;
		const contentH = 16 + rows * 17;

		const scaleX = (rect.width - 40) / contentW;
		const scaleY = (rect.height - 40) / contentH;
		this.zoomScale = Math.min(2.5, Math.max(0.15, Math.min(scaleX, scaleY)));

		this.panX = Math.round((rect.width - contentW * this.zoomScale) / 2);
		this.panY = Math.round((rect.height - contentH * this.zoomScale) / 2);

		this.updateCanvasTransform();
		this.updateZoomDisplay();
		this.renderRulers();
		new Notice(`Fitted to viewport (${Math.round(this.zoomScale * 100)}%)`);
	}

	public resetZoom100(): void {
		if (!this.canvasInnerViewportEl) return;
		const rect = this.canvasInnerViewportEl.getBoundingClientRect();
		const cols = this.layerManager.cols;
		const rows = this.layerManager.rows;
		const contentW = 16 + cols * 10;
		const contentH = 16 + rows * 17;

		this.zoomScale = 1.0;
		this.panX = Math.round((rect.width - contentW) / 2);
		this.panY = Math.round((rect.height - contentH) / 2);

		this.updateCanvasTransform();
		this.updateZoomDisplay();
		this.renderRulers();
		new Notice('Reset zoom to 100%');
	}

	private adjustZoom(delta: number): void {
		const newScale = Math.min(3.5, Math.max(0.2, this.zoomScale + delta));
		if (newScale !== this.zoomScale) {
			this.zoomScale = newScale;
			this.updateCanvasTransform();
			this.updateZoomDisplay();
			this.renderRulers();
		}
	}

	// =========================================================================
	// Pointer & Drawing Handlers (Lightweight 60 FPS)
	// =========================================================================

	private getCellFromPointer(e: PointerEvent): Point | null {
		const target = e.target as HTMLElement;
		if (target && target.classList.contains('ascii-cell')) {
			const col = parseInt(target.getAttribute('data-col') || '-1', 10);
			const row = parseInt(target.getAttribute('data-row') || '-1', 10);
			if (col >= 0 && row >= 0) {
				this.triggerRulerUpdate(col, row);
				return { x: col, y: row };
			}
		}

		if (!this.canvasGridEl) return null;
		const rect = this.canvasGridEl.getBoundingClientRect();
		const relX = e.clientX - rect.left;
		const relY = e.clientY - rect.top;

		const cur = this.layerManager.getActiveBuffer();
		const cellW = rect.width / cur.cols;
		const cellH = rect.height / cur.rows;

		const col = Math.floor(relX / cellW);
		const row = Math.floor(relY / cellH);

		if (cur.inBounds(col, row)) {
			this.triggerRulerUpdate(col, row);
			return { x: col, y: row };
		}
		return null;
	}

	private handlePointerDown(e: PointerEvent): void {
		e.preventDefault();

		const activeLayer = this.layerManager.getActiveLayer();
		if (activeLayer.locked) {
			new Notice(`Layer "${activeLayer.name}" is locked. Unlock to edit.`);
			return;
		}
		if (!activeLayer.visible) {
			new Notice(`Layer "${activeLayer.name}" is hidden. Make visible to edit.`);
			return;
		}

		const pt = this.getCellFromPointer(e);
		if (!pt) {
			if (this.typingActive) this.finishTyping();
			return;
		}

		if (this.typingActive && this.activeTool !== 'text') {
			this.finishTyping();
		}

		if (this.activeTool === 'text') {
			this.startTyping(pt.x, pt.y);
			return;
		}

		this.isDrawing = true;
		this.dragStartPos = pt;
		this.lastPointerPos = pt;

		const frame = activeLayer.buffer;

		if (this.activeTool === 'pencil') {
			frame.setCell(pt.x, pt.y, { char: this.activeChar, fg: this.activeFg, bg: this.activeBg });
			this.updateSingleCell(pt.x, pt.y);
		} else if (this.activeTool === 'eraser') {
			frame.setCell(pt.x, pt.y, { char: ' ', fg: undefined, bg: undefined });
			this.updateSingleCell(pt.x, pt.y);
		} else if (this.activeTool === 'fill') {
			frame.floodFill(pt.x, pt.y, this.activeChar, this.activeFg, this.activeBg);
			this.renderCanvas();
			this.pushHistory();
		} else if (this.activeTool === 'select') {
			this.selectionRect = { startX: pt.x, startY: pt.y, endX: pt.x, endY: pt.y };
		}
	}

	private handlePointerMove(e: PointerEvent): void {
		if (!this.isDrawing) return;
		const pt = this.getCellFromPointer(e);
		if (!pt) return;

		const activeLayer = this.layerManager.getActiveLayer();
		const frame = activeLayer.buffer;

		// 60 FPS Direct Cell Mutation: only update cells along the Bresenham line!
		if (this.activeTool === 'pencil' && this.lastPointerPos) {
			const points = frame.getBresenhamPoints(this.lastPointerPos.x, this.lastPointerPos.y, pt.x, pt.y);
			for (const p of points) {
				frame.setCell(p.x, p.y, { char: this.activeChar, fg: this.activeFg, bg: this.activeBg });
				this.updateSingleCell(p.x, p.y);
			}
			this.lastPointerPos = pt;
		} else if (this.activeTool === 'eraser' && this.lastPointerPos) {
			const points = frame.getBresenhamPoints(this.lastPointerPos.x, this.lastPointerPos.y, pt.x, pt.y);
			for (const p of points) {
				frame.setCell(p.x, p.y, { char: ' ' });
				this.updateSingleCell(p.x, p.y);
			}
			this.lastPointerPos = pt;
		} else if (this.activeTool === 'select' && this.dragStartPos) {
			this.selectionRect = {
				startX: this.dragStartPos.x,
				startY: this.dragStartPos.y,
				endX: pt.x,
				endY: pt.y
			};
		}
	}

	private handlePointerUp(e: PointerEvent): void {
		if (!this.isDrawing) return;
		this.isDrawing = false;
		const pt = this.getCellFromPointer(e) || this.lastPointerPos;

		if (this.dragStartPos && pt) {
			const activeLayer = this.layerManager.getActiveLayer();
			const frame = activeLayer.buffer;
			const { x: x0, y: y0 } = this.dragStartPos;
			const { x: x1, y: y1 } = pt;

			if (this.activeTool === 'line') {
				frame.drawLine(x0, y0, x1, y1, this.lineStyle, this.activeFg, this.activeBg);
				this.renderCanvas();
			} else if (this.activeTool === 'arrow') {
				frame.drawArrow(x0, y0, x1, y1, this.arrowStyle, this.lineStyle, this.activeFg, this.activeBg);
				this.renderCanvas();
			} else if (this.activeTool === 'box') {
				frame.drawBox(x0, y0, x1, y1, this.boxStyle, this.fillBox, this.activeChar, this.activeFg, this.activeBg);
				this.renderCanvas();
			} else if (this.activeTool === 'circle') {
				const rx = Math.abs(x1 - x0) / 2;
				const ry = Math.abs(y1 - y0) / 2;
				const xc = Math.min(x0, x1) + rx;
				const yc = Math.min(y0, y1) + ry;
				frame.drawCircle(xc, yc, rx, ry, this.activeChar, this.fillBox, this.activeChar, this.activeFg, this.activeBg);
				this.renderCanvas();
			}
		}

		this.dragStartPos = null;
		this.lastPointerPos = null;
		this.pushHistory();
	}

	// =========================================================================
	// Right Sidebar: Layers & Characters
	// =========================================================================

	private buildRightSidebar(parent: HTMLElement): void {
		this.buildLayersSection(parent);

		// Active Character
		const activeCharSection = parent.createDiv({ cls: 'asciidraw-sidebar-section' });
		activeCharSection.createEl('h4', { text: 'Active Character' });

		const previewRow = activeCharSection.createDiv({ cls: 'asciidraw-char-preview-row' });
		this.activeCharPreviewEl = previewRow.createDiv({ cls: 'asciidraw-char-badge', text: this.activeChar });

		const customInput = previewRow.createEl('input', {
			cls: 'asciidraw-input-char',
			type: 'text',
			value: this.activeChar,
			attr: { maxlength: '2' }
		});
		customInput.oninput = () => {
			if (customInput.value) {
				this.setActiveChar(customInput.value[0]);
			}
		};

		// Presets
		CHARACTER_PRESETS.forEach(group => {
			const section = parent.createDiv({ cls: 'asciidraw-sidebar-section' });
			section.createEl('h4', { text: group.title });

			const grid = section.createDiv({ cls: 'asciidraw-palette-grid' });
			group.chars.forEach(ch => {
				const tile = grid.createEl('button', { cls: 'asciidraw-char-tile', text: ch });
				tile.onclick = () => {
					this.setActiveChar(ch);
					customInput.value = ch;
				};
			});
		});

		// Quick Actions
		const actionsSection = parent.createDiv({ cls: 'asciidraw-sidebar-section' });
		actionsSection.createEl('h4', { text: 'Canvas Actions' });

		const actionGrid = actionsSection.createDiv({ cls: 'asciidraw-action-grid' });

		const btnClear = actionGrid.createEl('button', { text: '🗑️ Clear Active Layer', cls: 'asciidraw-btn-danger' });
		btnClear.onclick = () => {
			this.layerManager.getActiveBuffer().clear();
			this.renderCanvas();
			this.pushHistory();
			new Notice(`Cleared active layer (${this.layerManager.cols}×${this.layerManager.rows}).`);
		};
	}

	private buildLayersSection(parent: HTMLElement): void {
		const layerSection = parent.createDiv({ cls: 'asciidraw-sidebar-section asciidraw-layers-section' });
		const headerRow = layerSection.createDiv({ cls: 'asciidraw-layers-header' });
		headerRow.createEl('h4', { text: 'Layers' });

		const layerActions = headerRow.createDiv({ cls: 'asciidraw-layer-header-actions' });

		const btnAdd = layerActions.createEl('button', { text: '+ New', cls: 'asciidraw-btn-mini', title: 'Add New Layer' });
		btnAdd.onclick = () => {
			this.layerManager.addLayer();
			this.renderLayersList();
			this.renderCanvas();
			this.pushHistory();
		};

		const btnDup = layerActions.createEl('button', { text: '📋', cls: 'asciidraw-btn-mini', title: 'Duplicate Layer' });
		btnDup.onclick = () => {
			this.layerManager.duplicateLayer();
			this.renderLayersList();
			this.renderCanvas();
			this.pushHistory();
		};

		const btnMerge = layerActions.createEl('button', { text: '⮛', cls: 'asciidraw-btn-mini', title: 'Merge Down' });
		btnMerge.onclick = () => {
			this.layerManager.mergeDown();
			this.renderLayersList();
			this.renderCanvas();
			this.pushHistory();
		};

		const btnDel = layerActions.createEl('button', { text: '🗑️', cls: 'asciidraw-btn-mini', title: 'Delete Layer' });
		btnDel.onclick = () => {
			this.layerManager.deleteLayer();
			this.renderLayersList();
			this.renderCanvas();
			this.pushHistory();
		};

		this.layersListEl = layerSection.createDiv({ cls: 'asciidraw-layers-list' });
	}

	private renderLayersList(): void {
		if (!this.layersListEl) return;
		this.layersListEl.empty();

		const lm = this.layerManager;
		for (let i = lm.layers.length - 1; i >= 0; i--) {
			const layer = lm.layers[i];
			const layerIndex = i;

			const item = this.layersListEl.createDiv({
				cls: `asciidraw-layer-item ${layerIndex === lm.activeLayerIndex ? 'is-active' : ''}`
			});

			// Visibility
			const eyeBtn = item.createSpan({
				cls: `layer-eye-btn ${layer.visible ? 'is-visible' : 'is-hidden'}`,
				text: layer.visible ? '👁' : '🚫',
				title: layer.visible ? 'Hide Layer' : 'Show Layer'
			});
			eyeBtn.onclick = (e) => {
				e.stopPropagation();
				lm.toggleVisibility(layerIndex);
				this.renderLayersList();
				this.renderCanvas();
				this.pushHistory();
			};

			// Lock
			const lockBtn = item.createSpan({
				cls: `layer-lock-btn ${layer.locked ? 'is-locked' : ''}`,
				text: layer.locked ? '🔒' : '🔓',
				title: layer.locked ? 'Unlock Layer' : 'Lock Layer'
			});
			lockBtn.onclick = (e) => {
				e.stopPropagation();
				lm.toggleLock(layerIndex);
				this.renderLayersList();
				this.pushHistory();
			};

			// Layer Name
			const nameEl = item.createSpan({ cls: 'layer-name', text: layer.name });
			nameEl.ondblclick = (e) => {
				e.stopPropagation();
				new AsciiPromptModal(this.app, 'Rename Layer', layer.name, (newName) => {
					if (newName && newName.trim()) {
						lm.renameLayer(layerIndex, newName.trim());
						this.renderLayersList();
						this.pushHistory();
					}
				}).open();
			};

			// Select active layer
			item.onclick = () => {
				lm.setActiveLayer(layerIndex);
				this.renderLayersList();
				this.updateStatus(`Active Layer: ${layer.name}`);
			};

			// Right-Click Context Menu for Layer (In-Page Tab)
			item.addEventListener('contextmenu', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();

				// Activate this layer on right click if not already active
				if (lm.activeLayerIndex !== layerIndex) {
					lm.setActiveLayer(layerIndex);
					this.renderLayersList();
				}

				const menu = new Menu();

				// 1. Rename Layer
				menu.addItem((m) => {
					m.setTitle(`Rename "${layer.name}"...`)
						.setIcon('pencil')
						.onClick(() => {
							new AsciiPromptModal(this.app, 'Rename Layer', layer.name, (newName) => {
								if (newName && newName.trim()) {
									lm.renameLayer(layerIndex, newName.trim());
									this.renderLayersList();
									this.pushHistory();
									new Notice(`Renamed to "${newName.trim()}"`);
								}
							}).open();
						});
				});

				// 2. Duplicate Layer
				menu.addItem((m) => {
					m.setTitle('Duplicate Layer')
						.setIcon('copy')
						.onClick(() => {
							lm.duplicateLayer(layerIndex);
							this.renderLayersList();
							this.renderCanvas();
							this.pushHistory();
							new Notice(`Duplicated "${layer.name}"`);
						});
				});

				menu.addSeparator();

				// 3. Toggle Visibility
				menu.addItem((m) => {
					m.setTitle(layer.visible ? 'Hide Layer' : 'Show Layer')
						.setIcon(layer.visible ? 'eye-off' : 'eye')
						.onClick(() => {
							lm.toggleVisibility(layerIndex);
							this.renderLayersList();
							this.renderCanvas();
							this.pushHistory();
						});
				});

				// 4. Toggle Lock
				menu.addItem((m) => {
					m.setTitle(layer.locked ? 'Unlock Layer' : 'Lock Layer')
						.setIcon(layer.locked ? 'unlock' : 'lock')
						.onClick(() => {
							lm.toggleLock(layerIndex);
							this.renderLayersList();
							this.pushHistory();
						});
				});

				menu.addSeparator();

				// 5. Apply Active Character to Layer
				menu.addItem((m) => {
					m.setTitle(`Apply Char "${this.activeChar}" to Layer`)
						.setIcon('type')
						.onClick(() => {
							lm.applyCharToLayer(layerIndex, this.activeChar);
							this.renderLayersList();
							this.renderCanvas();
							this.pushHistory();
							new Notice(`Applied "${this.activeChar}" across "${layer.name}"`);
						});
				});

				// 6. Invert Layer Mask
				menu.addItem((m) => {
					m.setTitle('Invert Layer Mask')
						.setIcon('refresh-cw')
						.onClick(() => {
							lm.invertLayerMask(layerIndex, this.activeChar || '#');
							this.renderLayersList();
							this.renderCanvas();
							this.pushHistory();
							new Notice(`Inverted mask for "${layer.name}"`);
						});
				});

				menu.addSeparator();

				// 7. Move Layer Up (higher index)
				if (layerIndex < lm.layers.length - 1) {
					menu.addItem((m) => {
						m.setTitle('Move Layer Up')
							.setIcon('arrow-up')
							.onClick(() => {
								lm.reorderLayers(layerIndex, layerIndex + 1);
								this.renderLayersList();
								this.renderCanvas();
								this.pushHistory();
							});
					});
				}

				// 8. Move Layer Down (lower index)
				if (layerIndex > 0) {
					menu.addItem((m) => {
						m.setTitle('Move Layer Down')
							.setIcon('arrow-down')
							.onClick(() => {
								lm.reorderLayers(layerIndex, layerIndex - 1);
								this.renderLayersList();
								this.renderCanvas();
								this.pushHistory();
							});
					});
				}

				// 9. Merge Down (only if not bottom layer)
				if (layerIndex > 0) {
					menu.addItem((m) => {
						m.setTitle('Merge Down')
							.setIcon('arrow-down-circle')
							.onClick(() => {
								lm.mergeDown(layerIndex);
								this.renderLayersList();
								this.renderCanvas();
								this.pushHistory();
								new Notice('Merged layer down');
							});
					});
				}

				menu.addSeparator();

				// 10. Clear Layer Content
				menu.addItem((m) => {
					m.setTitle('Clear Layer Content')
						.setIcon('eraser')
						.onClick(() => {
							layer.buffer.clear();
							this.renderCanvas();
							this.pushHistory();
							new Notice(`Cleared "${layer.name}" content`);
						});
				});

				// 11. Delete Layer
				if (lm.layers.length > 1) {
					menu.addItem((m) => {
						m.setTitle(`Delete "${layer.name}"`)
							.setIcon('trash')
							.onClick(() => {
								lm.deleteLayer(layerIndex);
								this.renderLayersList();
								this.renderCanvas();
								this.pushHistory();
								new Notice(`Deleted "${layer.name}"`);
							});
					});
				}

				menu.showAtMouseEvent(e);
			});
		}
	}

	// =========================================================================
	// Utilities & History
	// =========================================================================

	private setTool(tool: AsciiTool): void {
		this.activeTool = tool;
		this.updateStatus(`Tool: ${tool}`);
	}

	private setActiveChar(char: string): void {
		this.activeChar = char;
		if (this.activeCharPreviewEl) {
			this.activeCharPreviewEl.textContent = char;
		}
	}

	private updateStatus(text: string): void {
		if (this.statusEl) {
			this.statusEl.textContent = text;
		}
	}

	private applyTheme(): void {
		const palette = THEME_PALETTES[this.activeTheme] || THEME_PALETTES.default;
		this.containerEl.setCssProps({
			'--asciidraw-fg': palette.fg,
			'--asciidraw-bg': palette.bg,
			'--asciidraw-border': palette.border,
			'--asciidraw-accent': palette.accent
		});
	}

	public getSerializedContent(): string {
		const layersData = this.layerManager.exportLayerData();
		const composite = this.layerManager.getCompositeBuffer();
		return AsciiSerializer.serialize(
			[composite],
			this.activeTheme,
			layersData.length > 1 || this.activeTheme !== 'default',
			layersData
		);
	}

	private pushHistory(): void {
		const serialized = this.getSerializedContent();
		if (this.historyIndex < this.historyStack.length - 1) {
			this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
		}
		this.historyStack.push(serialized);
		this.historyIndex = this.historyStack.length - 1;
		if (this.historyStack.length > 50) {
			this.historyStack.shift();
			this.historyIndex--;
		}
	}

	public undo(): void {
		if (this.historyIndex > 0) {
			this.historyIndex--;
			this.loadContent(this.historyStack[this.historyIndex]);
			new Notice('Undone');
		}
	}

	public redo(): void {
		if (this.historyIndex < this.historyStack.length - 1) {
			this.historyIndex++;
			this.loadContent(this.historyStack[this.historyIndex]);
			new Notice('Redone');
		}
	}

	public toggleFullscreen(): void {
		this.isFullscreen = !this.isFullscreen;
		this.containerEl.toggleClass('is-fullscreen-immersive', this.isFullscreen);
		const fsBtn = this.containerEl.querySelector('.asciidraw-nav-group button[title*="Fullscreen"]');
		if (fsBtn) fsBtn.textContent = this.isFullscreen ? 'Exit Fullscreen' : '⛶ Fullscreen';
		this.fitToScreen();
	}

	public async handleSave(): Promise<void> {
		const serialized = this.getSerializedContent();
		if (this.onSave) {
			await this.onSave(serialized);
		} else {
			await AsciiExporter.copyToClipboard(serialized);
			new Notice('✓ Copied ASCII codeblock to clipboard!');
		}
	}

	private showExportMenu(e: MouseEvent): void {
		const menu = new Menu();
		const composite = this.layerManager.getCompositeBuffer();

		menu.addItem((item) => {
			item.setTitle('Copy Plain ASCII Text')
				.setIcon('copy')
				.onClick(async () => {
					await AsciiExporter.copyToClipboard(composite.toString(true));
					new Notice('Copied plain ASCII text to clipboard!');
				});
		});

		menu.addItem((item) => {
			item.setTitle('Download Vector SVG')
				.setIcon('image')
				.onClick(() => {
					const svg = AsciiExporter.toSVG(composite, this.activeTheme);
					AsciiExporter.downloadFile('drawing.svg', svg, 'image/svg+xml');
					new Notice('Downloaded drawing.svg');
				});
		});

		menu.addItem((item) => {
			item.setTitle('Download PNG Image')
				.setIcon('camera')
				.onClick(() => {
					const png = AsciiExporter.toPNG(composite, this.activeTheme);
					const a = document.createElement('a');
					a.href = png;
					a.download = 'drawing.png';
					a.click();
					new Notice('Downloaded drawing.png');
				});
		});

		menu.showAtMouseEvent(e);
	}

	private setupGlobalShortcuts(): void {
		this.containerEl.addEventListener('keydown', (e: KeyboardEvent) => {
			const isMod = e.ctrlKey || e.metaKey;
			if (isMod && (e.key === 'z' || e.key === 'Z')) {
				e.preventDefault();
				if (e.shiftKey) this.redo();
				else this.undo();
			} else if (isMod && (e.key === 'y' || e.key === 'Y')) {
				e.preventDefault();
				this.redo();
			} else if (isMod && (e.key === 's' || e.key === 'S')) {
				e.preventDefault();
				this.handleSave();
			} else if (isMod && e.key === '0') {
				e.preventDefault();
				this.fitToScreen();
			} else if (isMod && e.key === '1') {
				e.preventDefault();
				this.resetZoom100();
			} else if (isMod && (e.key === 'r' || e.key === 'R')) {
				e.preventDefault();
				this.showRulers = !this.showRulers;
				this.updateRulerVisibility();
			} else if (isMod && (e.key === ';' || e.code === 'Semicolon')) {
				e.preventDefault();
				if (e.altKey) {
					this.clearAllGuides();
				} else {
					this.toggleGuides();
				}
			}
		});
	}
}
