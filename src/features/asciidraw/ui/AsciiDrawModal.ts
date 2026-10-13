import { AsciiPromptModal } from './AsciiModals';
import { App, Modal, Notice, Menu } from 'obsidian';
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
import { TransformEngine } from '../core/TransformEngine';
import { AsciiSerializer } from '../utils/serializer';
import { AsciiExporter } from '../utils/exporter';

export class AsciiDrawModal extends Modal {
	private config: AsciiStudioConfig;

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

	// Viewport Pan & Photoshop Zoom
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

	// Precision Rulers & Snapping
	private showRulers = true;
	private topRulerEl!: HTMLElement;
	private topRulerTrackEl!: HTMLElement;
	private topRulerMarkerEl!: HTMLElement;
	private leftRulerEl!: HTMLElement;
	private leftRulerTrackEl!: HTMLElement;
	private leftRulerMarkerEl!: HTMLElement;
	private canvasViewportContainerEl!: HTMLElement;
	private canvasInnerViewportEl!: HTMLElement;
	private canvasTransformEl!: HTMLElement;

	// Inline Text Typing
	private typingActive = false;
	private typingCol = 0;
	private typingRow = 0;
	private typingStartCol = 0;
	private hiddenTextInput!: HTMLInputElement;

	// Selection & Clipboard
	private selectionRect: SelectionRect | null = null;

	// Undo / Redo History Stack
	private historyStack: string[] = [];
	private historyIndex = -1;

	// DOM Elements
	private containerElModal!: HTMLElement;
	private canvasGridEl!: HTMLElement;

	private layersListEl!: HTMLElement;
	private activeCharPreviewEl!: HTMLElement;
	private statusEl!: HTMLElement;

	constructor(app: App, config: AsciiStudioConfig = {}) {
		super(app);
		this.config = config;

		const parsed = AsciiSerializer.parse(config.initialContent || '');
		this.activeTheme = parsed.theme;

		this.layerManager = new LayerManager(parsed.cols, parsed.rows);
		if (parsed.layers && parsed.layers.length > 0) {
			this.layerManager.loadLayerData(parsed.layers, parsed.cols, parsed.rows);
		} else if (parsed.frames && parsed.frames.length > 0) {
			this.layerManager.getActiveBuffer().fromString(parsed.frames[0]);
		}

		this.pushHistory();
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('asciidraw-modal-window');
		contentEl.empty();
		contentEl.addClass('asciidraw-studio-container');
		this.containerElModal = contentEl;

		this.buildUI();
		this.renderCanvas();
		this.renderLayersList();
		window.setTimeout(() => this.fitToScreen(), 60);

		// Keyboard Shortcuts
		this.scope.register(['Mod'], 'z', (evt) => {
			evt.preventDefault();
			this.undo();
		});
		this.scope.register(['Mod', 'Shift'], 'z', (evt) => {
			evt.preventDefault();
			this.redo();
		});
		this.scope.register(['Mod'], 'y', (evt) => {
			evt.preventDefault();
			this.redo();
		});
		this.scope.register(['Mod'], 's', (evt) => {
			evt.preventDefault();
			this.handleSave();
		});
		this.scope.register(['Mod'], '0', (evt) => {
			evt.preventDefault();
			this.fitToScreen();
		});
		this.scope.register(['Mod'], '1', (evt) => {
			evt.preventDefault();
			this.resetZoom100();
		});
		this.scope.register(['Mod'], 'r', (evt) => {
			evt.preventDefault();
			this.showRulers = !this.showRulers;
			this.updateRulerVisibility();
		});
		this.scope.register([], 'Escape', () => {
			if (this.typingActive) {
				this.finishTyping();
			} else if (this.selectionRect) {
				this.selectionRect = null;
				this.renderCanvas();
			} else {
				this.close();
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// =========================================================================
	// UI Builder
	// =========================================================================

	private buildUI(): void {
		this.containerElModal.empty();

		// 1. Top Navigation Bar
		const topNav = this.containerElModal.createDiv({ cls: 'asciidraw-topnav' });
		this.buildTopNav(topNav);

		// 2. Middle Main Workspace (Left Toolbar + Center Canvas + Right Sidebar)
		const mainArea = this.containerElModal.createDiv({ cls: 'asciidraw-workspace' });

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
		title.appendText(' ASCII Studio');

		// Canvas Dimension Selector & Custom Inputs
		const sizeSelector = leftGroup.createEl('select', { cls: 'asciidraw-select' });
		const presets = [
			{ label: 'Compact (40x15)', cols: 40, rows: 15 },
			{ label: 'Standard (60x20)', cols: 60, rows: 20 },
			{ label: 'Wide Terminal (80x24)', cols: 80, rows: 24 },
			{ label: 'HD Grid (100x30)', cols: 100, rows: 30 },
			{ label: 'Ultra Wide (120x40)', cols: 120, rows: 40 },
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
			attr: { min: '5', max: '300', title: 'Custom Width (Cols)' }
		});
		customSizeBox.createSpan({ text: 'H:' });
		const inputRows = customSizeBox.createEl('input', {
			type: 'number',
			cls: 'asciidraw-size-input',
			value: String(curRows),
			attr: { min: '3', max: '200', title: 'Custom Height (Rows)' }
		});

		const applyCustomSize = () => {
			const w = Math.max(5, parseInt(inputCols.value, 10) || 60);
			const h = Math.max(3, parseInt(inputRows.value, 10) || 20);
			this.layerManager.resizeAll(w, h);
			this.renderRulerTicks();
			this.renderCanvas();
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
				this.renderRulerTicks();
				this.renderCanvas();
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

		const btnUndo = centerGroup.createEl('button', { text: '↩ Undo', cls: 'asciidraw-btn-sm', title: 'Undo (Ctrl+Z)' });
		btnUndo.onclick = () => this.undo();

		const btnRedo = centerGroup.createEl('button', { text: '↪ Redo', cls: 'asciidraw-btn-sm', title: 'Redo (Ctrl+Y)' });
		btnRedo.onclick = () => this.redo();

		// Right Actions: Fullscreen, Export, Save
		const rightGroup = parent.createDiv({ cls: 'asciidraw-nav-group' });

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
			{ id: 'select', icon: '✂️', name: 'Marquee Selection', shortcut: 'S' },
			{ id: 'transform', icon: '🔄', name: 'Transform Gizmo', shortcut: 'M' }
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

		// Tool options sub-bar (box style, fill, arrow type)
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
		// 2x2 grid container for precision rulers + inner viewport
		this.canvasViewportContainerEl = parent.createDiv({
			cls: `asciidraw-viewport-container ${this.showRulers ? '' : 'hide-rulers'}`
		});

		// 1. Top-Left Corner Origin
		const corner = this.canvasViewportContainerEl.createDiv({ cls: 'asciidraw-ruler-corner', text: '⌗' });
		corner.title = 'Ruler Origin (0, 0)';

		// 2. Top Ruler
		this.topRulerEl = this.canvasViewportContainerEl.createDiv({ cls: 'asciidraw-ruler-top' });
		this.topRulerTrackEl = this.topRulerEl.createDiv({ cls: 'asciidraw-ruler-track-x' });
		this.topRulerMarkerEl = this.topRulerEl.createDiv({ cls: 'asciidraw-ruler-marker-x' });

		// 3. Left Ruler
		this.leftRulerEl = this.canvasViewportContainerEl.createDiv({ cls: 'asciidraw-ruler-left' });
		this.leftRulerTrackEl = this.leftRulerEl.createDiv({ cls: 'asciidraw-ruler-track-y' });
		this.leftRulerMarkerEl = this.leftRulerEl.createDiv({ cls: 'asciidraw-ruler-marker-y' });

		// 4. Center Inner Viewport
		this.canvasInnerViewportEl = this.canvasViewportContainerEl.createDiv({ cls: 'asciidraw-inner-viewport' });

		// Hidden input for direct typing & mobile keyboard handling
		this.hiddenTextInput = this.canvasInnerViewportEl.createEl('input', {
			cls: 'asciidraw-hidden-text-input',
			type: 'text',
			attr: { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }
		});

		// GPU Transform layer (runs at 60 FPS without DOM re-render)
		this.canvasTransformEl = this.canvasInnerViewportEl.createDiv({ cls: 'asciidraw-canvas-transform-layer' });

		this.canvasGridEl = this.canvasTransformEl.createDiv({ cls: 'asciidraw-grid-surface' });

		// Setup navigation events (Photoshop zoom & pan)
		this.setupViewportNavigationEvents();

		// Setup direct typing events
		this.setupDirectTypingEvents();

		this.statusEl = parent.createDiv({ cls: 'asciidraw-status-bar' });
		this.updateStatus('Ready • Select a tool and start drawing');

		this.renderRulerTicks();
		this.updateCanvasTransform();
	}

	private setupViewportNavigationEvents(): void {
		const viewport = this.canvasInnerViewportEl;

		// 1. Wheel: Zoom to cursor on Ctrl/Alt+Wheel or smooth pan
		viewport.addEventListener('wheel', (e: WheelEvent) => {
			e.preventDefault();

			if (e.ctrlKey || e.altKey || e.metaKey) {
				// Zoom anchored at cursor position
				const rect = viewport.getBoundingClientRect();
				const mouseX = e.clientX - rect.left;
				const mouseY = e.clientY - rect.top;

				const oldScale = this.zoomScale;
				const factor = e.deltaY < 0 ? 1.15 : 0.85;
				const newScale = Math.min(3.5, Math.max(0.3, oldScale * factor));

				if (newScale !== oldScale) {
					// Anchor focal point:
					this.panX = mouseX - ((mouseX - this.panX) / oldScale) * newScale;
					this.panY = mouseY - ((mouseY - this.panY) / oldScale) * newScale;
					this.zoomScale = newScale;
					this.updateCanvasTransform();
					this.updateZoomDisplay();
				}
			} else {
				// Pan via trackpad / regular wheel
				this.panX -= e.deltaX;
				this.panY -= e.deltaY;
				this.updateCanvasTransform();
			}
		}, { passive: false });

		// 2. Spacebar key events for Hand tool panning
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

		// 3. Pointer navigation (Space+Drag or Middle-Click drag)
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

			// Drawing / typing if left click and not hand tool
			if (e.button === 0 && !this.isSpacePressed) {
				this.handlePointerDown(e);
			}
		});

		window.addEventListener('pointermove', (e: PointerEvent) => {
			if (this.isPanning) {
				const dx = e.clientX - this.panStartClientX;
				const dy = e.clientY - this.panStartClientY;
				this.panX += dx;
				this.panY += dy;
				this.panStartClientX = e.clientX;
				this.panStartClientY = e.clientY;
				this.updateCanvasTransform();
				e.preventDefault();
				return;
			}

			this.handlePointerMove(e);
		});

		window.addEventListener('pointerup', (e: PointerEvent) => {
			if (this.isPanning) {
				this.isPanning = false;
				viewport.removeClass('is-grabbing');
				return;
			}

			this.handlePointerUp(e);
		});

		// 4. Touch Gestures: 2-finger pinch zoom and 2-finger pan
		let initialPinchDistance = 0;
		let initialPinchScale = 1;
		let initialMidpoint = { x: 0, y: 0 };
		let initialPan = { x: 0, y: 0 };

		viewport.addEventListener('touchstart', (e: TouchEvent) => {
			if (e.touches.length === 2) {
				const t1 = e.touches[0];
				const t2 = e.touches[1];
				initialPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
				initialPinchScale = this.zoomScale;
				initialMidpoint = {
					x: (t1.clientX + t2.clientX) / 2,
					y: (t1.clientY + t2.clientY) / 2
				};
				initialPan = { x: this.panX, y: this.panY };
			}
		}, { passive: true });

		viewport.addEventListener('touchmove', (e: TouchEvent) => {
			if (e.touches.length === 2 && initialPinchDistance > 0) {
				const t1 = e.touches[0];
				const t2 = e.touches[1];
				const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
				const currentMid = {
					x: (t1.clientX + t2.clientX) / 2,
					y: (t1.clientY + t2.clientY) / 2
				};

				const scaleDelta = currentDist / initialPinchDistance;
				const newScale = Math.min(3.5, Math.max(0.3, initialPinchScale * scaleDelta));

				const rect = viewport.getBoundingClientRect();
				const midX = initialMidpoint.x - rect.left;
				const midY = initialMidpoint.y - rect.top;

				this.zoomScale = newScale;
				this.panX = initialPan.x + (currentMid.x - initialMidpoint.x);
				this.panY = initialPan.y + (currentMid.y - initialMidpoint.y);

				this.updateCanvasTransform();
				this.updateZoomDisplay();
			}
		}, { passive: true });

		viewport.addEventListener('touchend', (e: TouchEvent) => {
			if (e.touches.length < 2) {
				initialPinchDistance = 0;
			}
		}, { passive: true });
	}

	private setupDirectTypingEvents(): void {
		if (!this.hiddenTextInput) return;

		this.hiddenTextInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (!this.typingActive) return;

			if (e.key === 'Enter') {
				e.preventDefault();
				this.finishTyping();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.finishTyping();
			} else if (e.key === 'Backspace') {
				e.preventDefault();
				const activeBuffer = this.layerManager.getActiveBuffer();
				if (this.typingCol > this.typingStartCol) {
					this.typingCol--;
					activeBuffer.setCell(this.typingCol, this.typingRow, { char: ' ' });
					this.renderCanvas();
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
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				if (this.typingRow > 0) {
					this.typingRow--;
					this.updateTypingCaret();
				}
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				if (this.typingRow < this.layerManager.rows - 1) {
					this.typingRow++;
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
					this.typingCol++;
				}
			}
			this.renderCanvas();
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
			this.hiddenTextInput.blur(); // Dismiss mobile keyboard!
		}
		this.renderCanvas();
		this.pushHistory();
		this.updateStatus('Text committed');
	}

	private updateTypingCaret(): void {
		this.clearTypingCaret();
		if (!this.typingActive) return;
		const cell = this.canvasGridEl?.querySelector(`.ascii-cell[data-col="${this.typingCol}"][data-row="${this.typingRow}"]`);
		if (cell) {
			cell.addClass('is-typing-caret');
		}
	}

	private clearTypingCaret(): void {
		if (this.canvasGridEl) {
			this.canvasGridEl.querySelectorAll('.ascii-cell.is-typing-caret').forEach(c => c.removeClass('is-typing-caret'));
		}
	}

	private renderRulerTicks(): void {
		if (!this.topRulerTrackEl || !this.leftRulerTrackEl) return;
		this.topRulerTrackEl.empty();
		this.leftRulerTrackEl.empty();

		const cols = this.layerManager.cols;
		const rows = this.layerManager.rows;
		const cellW = 10;
		const cellH = 17;
		const pad = 8;

		// Top ruler (horizontal columns)
		for (let c = 0; c <= cols; c += 5) {
			const tick = this.topRulerTrackEl.createDiv({ cls: 'asciidraw-ruler-tick-major-x' });
			tick.style.left = `${pad + c * cellW}px`;
			tick.createSpan({ cls: 'asciidraw-ruler-num', text: String(c) });
		}
		for (let c = 0; c <= cols; c++) {
			if (c % 5 !== 0) {
				const tick = this.topRulerTrackEl.createDiv({ cls: 'asciidraw-ruler-tick-minor-x' });
				tick.style.left = `${pad + c * cellW}px`;
			}
		}

		// Left ruler (vertical rows)
		for (let r = 0; r <= rows; r += 5) {
			const tick = this.leftRulerTrackEl.createDiv({ cls: 'asciidraw-ruler-tick-major-y' });
			tick.style.top = `${pad + r * cellH}px`;
			tick.createSpan({ cls: 'asciidraw-ruler-num', text: String(r) });
		}
		for (let r = 0; r <= rows; r++) {
			if (r % 5 !== 0) {
				const tick = this.leftRulerTrackEl.createDiv({ cls: 'asciidraw-ruler-tick-minor-y' });
				tick.style.top = `${pad + r * cellH}px`;
			}
		}
	}

	private updateCanvasTransform(): void {
		if (this.canvasTransformEl) {
			this.canvasTransformEl.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0px) scale(${this.zoomScale})`;
		}
		this.updateRulers();
	}

	private updateRulers(): void {
		if (this.topRulerTrackEl) {
			this.topRulerTrackEl.style.transform = `translate3d(${this.panX}px, 0px, 0px) scaleX(${this.zoomScale})`;
		}
		if (this.leftRulerTrackEl) {
			this.leftRulerTrackEl.style.transform = `translate3d(0px, ${this.panY}px, 0px) scaleY(${this.zoomScale})`;
		}
	}

	private updateRulerCursorTracking(col: number, row: number): void {
		if (!this.showRulers) return;
		const cellW = 10;
		const cellH = 17;
		const pad = 8;
		if (this.topRulerMarkerEl) {
			const x = this.panX + (pad + col * cellW) * this.zoomScale;
			const w = cellW * this.zoomScale;
			this.topRulerMarkerEl.style.transform = `translate3d(${x}px, 0px, 0px)`;
			this.topRulerMarkerEl.style.width = `${w}px`;
		}
		if (this.leftRulerMarkerEl) {
			const y = this.panY + (pad + row * cellH) * this.zoomScale;
			const h = cellH * this.zoomScale;
			this.leftRulerMarkerEl.style.transform = `translate3d(0px, ${y}px, 0px)`;
			this.leftRulerMarkerEl.style.height = `${h}px`;
		}
	}

	private updateRulerVisibility(): void {
		if (this.canvasViewportContainerEl) {
			this.canvasViewportContainerEl.toggleClass('hide-rulers', !this.showRulers);
		}
	}

	private updateZoomDisplay(): void {
		const zoomLabel = this.containerElModal?.querySelector('.asciidraw-zoom-label');
		if (zoomLabel) zoomLabel.textContent = `${Math.round(this.zoomScale * 100)}%`;
	}

	private fitToScreen(): void {
		if (!this.canvasInnerViewportEl) return;
		const rect = this.canvasInnerViewportEl.getBoundingClientRect();
		const cols = this.layerManager.cols;
		const rows = this.layerManager.rows;
		const contentW = 16 + cols * 10; // 8px pad each side
		const contentH = 16 + rows * 17;

		const scaleX = (rect.width - 40) / contentW;
		const scaleY = (rect.height - 40) / contentH;
		this.zoomScale = Math.min(2.5, Math.max(0.3, Math.min(scaleX, scaleY)));

		this.panX = Math.round((rect.width - contentW * this.zoomScale) / 2);
		this.panY = Math.round((rect.height - contentH * this.zoomScale) / 2);

		this.updateCanvasTransform();
		this.updateZoomDisplay();
		new Notice(`Fitted to viewport (${Math.round(this.zoomScale * 100)}%)`);
	}

	private resetZoom100(): void {
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
		new Notice('Reset zoom to 100%');
	}

	private buildRightSidebar(parent: HTMLElement): void {
		// 1. Photoshop-style Drag-Sortable Layers Panel
		this.buildLayersSection(parent);

		// 2. Active Character preview & Custom Input
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

		// 3. Presets Sections
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

		// 4. Transform & Quick Actions
		const actionsSection = parent.createDiv({ cls: 'asciidraw-sidebar-section' });
		actionsSection.createEl('h4', { text: 'Canvas Actions' });

		const actionGrid = actionsSection.createDiv({ cls: 'asciidraw-action-grid' });

		const btnFlipH = actionGrid.createEl('button', { text: '⇄ Flip H', cls: 'asciidraw-btn-sm' });
		btnFlipH.onclick = () => this.applyFlipH();

		const btnFlipV = actionGrid.createEl('button', { text: '⇅ Flip V', cls: 'asciidraw-btn-sm' });
		btnFlipV.onclick = () => this.applyFlipV();

		const btnRotate = actionGrid.createEl('button', { text: '⟳ Rotate 90°', cls: 'asciidraw-btn-sm' });
		btnRotate.onclick = () => this.applyRotate90();

		const btnClear = actionGrid.createEl('button', { text: '🗑️ Clear Active Layer', cls: 'asciidraw-btn-danger' });
		btnClear.onclick = () => {
			this.layerManager.getActiveBuffer().clear();
			this.renderCanvas();
			this.pushHistory();
			new Notice(`Cleared active layer (${this.layerManager.cols}×${this.layerManager.rows} dimensions preserved).`);
		};
	}

	// =========================================================================
	// Photoshop-Style Drag-Sortable Layers Panel
	// =========================================================================

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
		// Render in reverse order so topmost layer is displayed at the top of the list (Photoshop style)
		for (let i = lm.layers.length - 1; i >= 0; i--) {
			const layer = lm.layers[i];
			const layerIndex = i;

			const item = this.layersListEl.createDiv({
				cls: `asciidraw-layer-item ${layerIndex === lm.activeLayerIndex ? 'is-active' : ''}`
			});
			item.draggable = true;

			// Drag handle
			item.createSpan({ cls: 'layer-drag-handle', text: '⋮⋮', title: 'Drag to reorder layer' });

			// Eye Visibility Toggle
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

			// Lock Toggle
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

			// Layer Name (Click to select, double-click to rename)
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

			// Quick Up / Down Reorder Buttons for tablet/touch
			const reorderGroup = item.createDiv({ cls: 'layer-reorder-group' });
			if (layerIndex < lm.layers.length - 1) {
				const upBtn = reorderGroup.createSpan({ cls: 'layer-shift-btn', text: '▲', title: 'Move Up' });
				upBtn.onclick = (e) => {
					e.stopPropagation();
					lm.reorderLayers(layerIndex, layerIndex + 1);
					this.renderLayersList();
					this.renderCanvas();
					this.pushHistory();
				};
			}
			if (layerIndex > 0) {
				const downBtn = reorderGroup.createSpan({ cls: 'layer-shift-btn', text: '▼', title: 'Move Down' });
				downBtn.onclick = (e) => {
					e.stopPropagation();
					lm.reorderLayers(layerIndex, layerIndex - 1);
					this.renderLayersList();
					this.renderCanvas();
					this.pushHistory();
				};
			}

			// Select active layer on row click
			item.onclick = () => {
				lm.setActiveLayer(layerIndex);
				this.renderLayersList();
				this.updateStatus(`Active Layer: ${layer.name}`);
			};

			// Right-click context menu (Photoshop style)
			item.addEventListener('contextmenu', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();

				const menu = new Menu();

				menu.addItem((mi) => {
					mi.setTitle(layer.visible ? 'Hide Layer' : 'Show Layer');
					mi.setIcon(layer.visible ? 'eye-off' : 'eye');
					mi.onClick(() => {
						lm.toggleVisibility(layerIndex);
						this.renderLayersList();
						this.renderCanvas();
						this.pushHistory();
					});
				});

				menu.addItem((mi) => {
					mi.setTitle(layer.locked ? 'Unlock Layer' : 'Lock Layer');
					mi.setIcon(layer.locked ? 'unlock' : 'lock');
					mi.onClick(() => {
						lm.toggleLock(layerIndex);
						this.renderLayersList();
						this.pushHistory();
					});
				});

				menu.addSeparator();

				menu.addItem((mi) => {
					mi.setTitle('Duplicate Layer');
					mi.setIcon('copy');
					mi.onClick(() => {
						lm.setActiveLayer(layerIndex);
						lm.duplicateLayer();
						this.renderLayersList();
						this.renderCanvas();
						this.pushHistory();
					});
				});

				menu.addItem((mi) => {
					mi.setTitle(`Apply Character "${this.activeChar}" to Layer`);
					mi.setIcon('type');
					mi.onClick(() => {
						lm.applyCharToLayer(layerIndex, this.activeChar);
						this.renderCanvas();
						this.pushHistory();
						new Notice(`Applied "${this.activeChar}" to all drawn cells in ${layer.name}`);
					});
				});

				menu.addItem((mi) => {
					mi.setTitle('Invert Layer Mask');
					mi.setIcon('contrast');
					mi.onClick(() => {
						lm.invertLayerMask(layerIndex, this.activeChar);
						this.renderCanvas();
						this.pushHistory();
						new Notice(`Inverted layer mask for ${layer.name}`);
					});
				});

				if (layerIndex > 0) {
					menu.addItem((mi) => {
						mi.setTitle('Merge Down');
						mi.setIcon('arrow-down');
						mi.onClick(() => {
							lm.setActiveLayer(layerIndex);
							lm.mergeDown();
							this.renderLayersList();
							this.renderCanvas();
							this.pushHistory();
						});
					});
				}

				menu.addSeparator();

				menu.addItem((mi) => {
					mi.setTitle('Rename Layer');
					mi.setIcon('edit');
					mi.onClick(() => {
						new AsciiPromptModal(this.app, 'Rename Layer', layer.name, (newName) => {
							if (newName && newName.trim()) {
								lm.renameLayer(layerIndex, newName.trim());
								this.renderLayersList();
								this.pushHistory();
							}
						}).open();
					});
				});

				if (lm.layers.length > 1) {
					menu.addItem((mi) => {
						mi.setTitle('Delete Layer');
						mi.setIcon('trash');
						mi.setWarning(true);
						mi.onClick(() => {
							lm.setActiveLayer(layerIndex);
							lm.deleteLayer();
							this.renderLayersList();
							this.renderCanvas();
							this.pushHistory();
						});
					});
				}

				menu.showAtMouseEvent(e);
			});

			// HTML5 Drag and Drop Handlers for drag-sorting
			item.addEventListener('dragstart', (e) => {
				e.dataTransfer?.setData('text/plain', String(layerIndex));
				item.addClass('is-dragging');
			});

			item.addEventListener('dragend', () => {
				item.removeClass('is-dragging');
				this.layersListEl.querySelectorAll('.asciidraw-layer-item').forEach(el => el.removeClass('is-drag-over'));
			});

			item.addEventListener('dragover', (e) => {
				e.preventDefault();
				item.addClass('is-drag-over');
			});

			item.addEventListener('dragleave', () => {
				item.removeClass('is-drag-over');
			});

			item.addEventListener('drop', (e) => {
				e.preventDefault();
				item.removeClass('is-drag-over');
				const fromIdx = parseInt(e.dataTransfer?.getData('text/plain') || '-1', 10);
				if (fromIdx >= 0 && fromIdx !== layerIndex) {
					lm.reorderLayers(fromIdx, layerIndex);
					this.renderLayersList();
					this.renderCanvas();
					this.pushHistory();
					new Notice(`Reordered: ${layer.name}`);
				}
			});
		}
	}

	// =========================================================================
	// Canvas Rendering (Compositing All Visible Layers)
	// =========================================================================

	private renderCanvas(): void {
		if (!this.canvasGridEl) return;
		const composite = this.layerManager.getCompositeBuffer();
		const cols = composite.cols;
		const rows = composite.rows;
		const palette = THEME_PALETTES[this.activeTheme] || THEME_PALETTES.default;

		this.canvasGridEl.setCssStyles({
			backgroundColor: palette.bg,
			borderColor: palette.border
		});

		const frag = createFragment();
		for (let r = 0; r < rows; r++) {
			const rowDiv = createDiv({ cls: 'ascii-row' });
			for (let c = 0; c < cols; c++) {
				const cell = composite.getCell(c, r);
				const charToDisplay = cell ? cell.char : ' ';
				const cellSpan = rowDiv.createSpan({ cls: 'ascii-cell' });
				cellSpan.setAttribute('data-col', String(c));
				cellSpan.setAttribute('data-row', String(r));
				cellSpan.textContent = charToDisplay === ' ' ? '\u00A0' : charToDisplay;
				if (cell?.fg) cellSpan.setCssStyles({ color: cell.fg });
				else cellSpan.setCssStyles({ color: palette.fg });
				if (cell?.bg) cellSpan.setCssStyles({ backgroundColor: cell.bg });
			}
			frag.appendChild(rowDiv);
		}

		this.canvasGridEl.empty();
		this.canvasGridEl.appendChild(frag);

		if (this.typingActive) {
			this.updateTypingCaret();
		}
	}



	private applyTheme(): void {
		const palette = THEME_PALETTES[this.activeTheme] || THEME_PALETTES.default;
		this.containerElModal.setCssProps({
			'--asciidraw-fg': palette.fg,
			'--asciidraw-bg': palette.bg,
			'--asciidraw-border': palette.border,
			'--asciidraw-accent': palette.accent
		});
	}

	// =========================================================================
	// Pointer & Drawing Handlers
	// =========================================================================

	private getCellFromPointer(e: PointerEvent): Point | null {
		const target = e.target as HTMLElement;
		if (target && target.classList.contains('ascii-cell')) {
			const col = parseInt(target.getAttribute('data-col') || '-1', 10);
			const row = parseInt(target.getAttribute('data-row') || '-1', 10);
			if (col >= 0 && row >= 0) {
				this.updateRulerCursorTracking(col, row);
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
			this.updateRulerCursorTracking(col, row);
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
			this.renderCanvas();
		} else if (this.activeTool === 'eraser') {
			frame.setCell(pt.x, pt.y, { char: ' ', fg: undefined, bg: undefined });
			this.renderCanvas();
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

		if (this.activeTool === 'pencil' && this.lastPointerPos) {
			const points = frame.getBresenhamPoints(this.lastPointerPos.x, this.lastPointerPos.y, pt.x, pt.y);
			for (const p of points) {
				frame.setCell(p.x, p.y, { char: this.activeChar, fg: this.activeFg, bg: this.activeBg });
			}
			this.lastPointerPos = pt;
			this.renderCanvas();
		} else if (this.activeTool === 'eraser' && this.lastPointerPos) {
			const points = frame.getBresenhamPoints(this.lastPointerPos.x, this.lastPointerPos.y, pt.x, pt.y);
			for (const p of points) {
				frame.setCell(p.x, p.y, { char: ' ' });
			}
			this.lastPointerPos = pt;
			this.renderCanvas();
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
			} else if (this.activeTool === 'arrow') {
				frame.drawArrow(x0, y0, x1, y1, this.arrowStyle, this.lineStyle, this.activeFg, this.activeBg);
			} else if (this.activeTool === 'box') {
				frame.drawBox(x0, y0, x1, y1, this.boxStyle, this.fillBox, this.activeChar, this.activeFg, this.activeBg);
			} else if (this.activeTool === 'circle') {
				const rx = Math.abs(x1 - x0) / 2;
				const ry = Math.abs(y1 - y0) / 2;
				const xc = Math.min(x0, x1) + rx;
				const yc = Math.min(y0, y1) + ry;
				frame.drawCircle(xc, yc, rx, ry, this.activeChar, this.fillBox, this.activeChar, this.activeFg, this.activeBg);
			}
		}

		this.dragStartPos = null;
		this.lastPointerPos = null;
		this.renderCanvas();
		this.pushHistory();
	}

	// =========================================================================
	// Tool & State Management
	// =========================================================================

	private setTool(tool: AsciiTool): void {
		this.activeTool = tool;
		this.updateStatus(`Tool selected: ${tool.toUpperCase()}`);
	}

	private setActiveChar(char: string): void {
		this.activeChar = char;
		if (this.activeCharPreviewEl) {
			this.activeCharPreviewEl.textContent = char;
		}
		this.updateStatus(`Active character set to: "${char}"`);
	}

	private adjustZoom(delta: number): void {
		if (!this.canvasInnerViewportEl) return;
		const rect = this.canvasInnerViewportEl.getBoundingClientRect();
		const centerX = rect.width / 2;
		const centerY = rect.height / 2;

		const oldScale = this.zoomScale;
		const newScale = Math.min(3.5, Math.max(0.3, oldScale + delta));
		if (newScale !== oldScale) {
			this.panX = centerX - ((centerX - this.panX) / oldScale) * newScale;
			this.panY = centerY - ((centerY - this.panY) / oldScale) * newScale;
			this.zoomScale = newScale;
			this.updateCanvasTransform();
			this.updateZoomDisplay();
		}
	}

	private toggleFullscreen(): void {
		this.isFullscreen = !this.isFullscreen;
		this.modalEl.toggleClass('is-fullscreen-immersive', this.isFullscreen);
		this.containerElModal.toggleClass('is-fullscreen-immersive', this.isFullscreen);
		new Notice(this.isFullscreen ? 'Entered Immersive Fullscreen Mode' : 'Exited Fullscreen Mode');
	}

	private updateStatus(text: string): void {
		if (this.statusEl) {
			this.statusEl.textContent = text;
		}
	}

	// =========================================================================
	// Transformations
	// =========================================================================

	private applyFlipH(): void {
		const frame = this.layerManager.getActiveBuffer();
		frame.cells = TransformEngine.flipHorizontal(frame.cells);
		this.renderCanvas();
		this.pushHistory();
		new Notice('Flipped Active Layer Horizontally');
	}

	private applyFlipV(): void {
		const frame = this.layerManager.getActiveBuffer();
		frame.cells = TransformEngine.flipVertical(frame.cells);
		this.renderCanvas();
		this.pushHistory();
		new Notice('Flipped Active Layer Vertically');
	}

	private applyRotate90(): void {
		const frame = this.layerManager.getActiveBuffer();
		frame.cells = TransformEngine.rotate90(frame.cells);
		this.renderCanvas();
		this.pushHistory();
		new Notice('Rotated Active Layer 90° Clockwise');
	}

	// =========================================================================
	// History (Undo / Redo)
	// =========================================================================

	private pushHistory(): void {
		const serialized = AsciiSerializer.serialize(
			[this.layerManager.getCompositeBuffer()],
			this.activeTheme,
			true,
			this.layerManager.exportLayerData()
		);

		if (this.historyIndex < this.historyStack.length - 1) {
			this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
		}

		this.historyStack.push(serialized);
		this.historyIndex = this.historyStack.length - 1;
	}

	private undo(): void {
		if (this.historyIndex > 0) {
			this.historyIndex--;
			this.restoreSnapshot(this.historyStack[this.historyIndex]);
		}
	}

	private redo(): void {
		if (this.historyIndex < this.historyStack.length - 1) {
			this.historyIndex++;
			this.restoreSnapshot(this.historyStack[this.historyIndex]);
		}
	}

	private restoreSnapshot(snapshot: string): void {
		const parsed = AsciiSerializer.parse(snapshot);
		this.activeTheme = parsed.theme;
		this.applyTheme();

		if (parsed.layers && parsed.layers.length > 0) {
			this.layerManager.loadLayerData(parsed.layers, parsed.cols, parsed.rows);
		} else if (parsed.frames && parsed.frames.length > 0) {
			this.layerManager.resizeAll(parsed.cols, parsed.rows);
			this.layerManager.getActiveBuffer().fromString(parsed.frames[0]);
		}

		// Synchronize size inputs & dropdown in TopNav
		if (this.containerElModal) {
			const inputCols = this.containerElModal.querySelector('.asciidraw-size-input[title*="Width"]') as HTMLInputElement;
			const inputRows = this.containerElModal.querySelector('.asciidraw-size-input[title*="Height"]') as HTMLInputElement;
			const sizeSelect = this.containerElModal.querySelector('.asciidraw-select') as HTMLSelectElement;
			if (inputCols) inputCols.value = String(this.layerManager.cols);
			if (inputRows) inputRows.value = String(this.layerManager.rows);
			if (sizeSelect) {
				sizeSelect.value = `${this.layerManager.cols}x${this.layerManager.rows}`;
				if (!sizeSelect.value) sizeSelect.value = '0x0';
			}
		}

		this.renderRulerTicks();
		this.renderLayersList();
		this.renderCanvas();
	}

	// =========================================================================
	// Save & Export Handlers
	// =========================================================================

	private async handleSave(): Promise<void> {
		const layersData = this.layerManager.exportLayerData();
		const composite = this.layerManager.getCompositeBuffer();

		const serialized = AsciiSerializer.serialize(
			[composite],
			this.activeTheme,
			layersData.length > 1 || this.activeTheme !== 'default',
			layersData
		);

		if (this.config.onSave) {
			await this.config.onSave(serialized);
			new Notice('✓ ASCII drawing saved to note!');
		} else {
			await AsciiExporter.copyToClipboard(serialized);
			new Notice('✓ Copied ASCII codeblock to clipboard!');
		}

		this.close();
	}

	private showExportMenu(e: MouseEvent): void {
		const menu = createDiv({ cls: 'asciidraw-export-dropdown' });
		const composite = this.layerManager.getCompositeBuffer();

		const optCopy = menu.createDiv({ text: '📋 Copy Plain ASCII Text' });
		optCopy.onclick = async () => {
			await AsciiExporter.copyToClipboard(composite.toString(true));
			new Notice('Copied plain ASCII text to clipboard!');
			menu.remove();
		};

		const optSvg = menu.createDiv({ text: '🖼️ Download Vector SVG' });
		optSvg.onclick = () => {
			const svg = AsciiExporter.toSVG(composite, this.activeTheme);
			AsciiExporter.downloadFile('drawing.svg', svg, 'image/svg+xml');
			new Notice('Downloaded drawing.svg');
			menu.remove();
		};

		const optPng = menu.createDiv({ text: '📸 Download PNG Image' });
		optPng.onclick = () => {
			const png = AsciiExporter.toPNG(composite, this.activeTheme);
			const a = document.createElement('a');
			a.href = png;
			a.download = 'drawing.png';
			a.click();
			new Notice('Downloaded drawing.png');
			menu.remove();
		};

		const target = e.target as HTMLElement;
		const rect = target.getBoundingClientRect();
		menu.setCssProps({
			position: 'fixed',
			left: `${rect.left}px`,
			top: `${rect.bottom + 6}px`
		});
		document.body.appendChild(menu);

		const closeDropdown = (evt: MouseEvent) => {
			if (!menu.contains(evt.target as Node)) {
				menu.remove();
				document.removeEventListener('click', closeDropdown);
			}
		};
		window.setTimeout(() => document.addEventListener('click', closeDropdown), 10);
	}
}
