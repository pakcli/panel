import { setIcon } from 'obsidian';
import { BezierHandle, BEZIER_PRESETS, BezierPreset, evaluateCubicBezier } from '../bezierUtils';

export interface BezierCurveEditorOptions {
    p1: BezierHandle;
    p2: BezierHandle;
    p0?: BezierHandle;
    p3?: BezierHandle;
    onChange?: (p1: BezierHandle, p2: BezierHandle, p0: BezierHandle, p3: BezierHandle) => void;
    onSave?: (p1: BezierHandle, p2: BezierHandle, p0: BezierHandle, p3: BezierHandle) => void;
    onClose?: () => void;
}

export class BezierCurveEditor {
    private containerEl: HTMLElement;
    private canvasEl!: HTMLCanvasElement;
    private ctx!: CanvasRenderingContext2D;
    private p0: BezierHandle;
    private p1: BezierHandle;
    private p2: BezierHandle;
    private p3: BezierHandle;
    private options: BezierCurveEditorOptions;
    private activeHandle: 'p0' | 'p1' | 'p2' | 'p3' | null = null;
    private hoveredHandle: 'p0' | 'p1' | 'p2' | 'p3' | null = null;
    private coordinateBadgeEl!: HTMLElement;
    private presetButtonsMap = new Map<string, HTMLElement>();
    private playheadT: number | null = null;

    // Canvas layout padding and dimensions
    private padLeft = 28;
    private padRight = 24;
    private padTop = 28;
    private padBottom = 26;

    constructor(parentEl: HTMLElement, options: BezierCurveEditorOptions) {
        this.options = options;
        this.p0 = options.p0 ? { ...options.p0 } : { x: 0.0, y: 0.0 };
        this.p1 = { ...options.p1 };
        this.p2 = { ...options.p2 };
        this.p3 = options.p3 ? { ...options.p3 } : { x: 1.0, y: 1.0 };

        this.containerEl = parentEl.createDiv({ cls: 'pakcli-bezier-editor' });
        this.buildUI();
        this.setupCanvas();
        this.bindEvents();
        this.redraw();
    }

    public getElement(): HTMLElement {
        return this.containerEl;
    }

    public setHandles(p1: BezierHandle, p2: BezierHandle, p0?: BezierHandle, p3?: BezierHandle): void {
        this.p1 = { ...p1 };
        this.p2 = { ...p2 };
        if (p0) this.p0 = { ...p0 };
        if (p3) this.p3 = { ...p3 };
        this.updateCoordinatesUI();
        this.updateActivePresetHighlight();
        this.redraw();
    }

    public setPlayhead(t: number | null): void {
        const rounded = (t !== null && !isNaN(t)) ? Math.max(0, Math.min(1, t)) : null;
        if (this.playheadT === rounded) return;
        this.playheadT = rounded;
        this.redraw();
    }

    private buildUI(): void {
        // 1. Header Bar
        const header = this.containerEl.createDiv({ cls: 'pakcli-bezier-header' });
        const titleWrap = header.createDiv({ cls: 'pakcli-bezier-title-wrap' });
        
        const iconSpan = titleWrap.createSpan({ cls: 'pakcli-bezier-icon' });
        setIcon(iconSpan, 'activity');
        titleWrap.createSpan({ text: 'Blender F-Curve Editor', cls: 'pakcli-bezier-title' });

        this.coordinateBadgeEl = header.createDiv({ cls: 'pakcli-bezier-coords' });
        this.updateCoordinatesUI();

        if (this.options.onClose) {
            const closeBtn = header.createEl('button', {
                cls: 'clickable-icon pakcli-icon-btn pakcli-bezier-close-btn',
                title: 'Close Curve Editor'
            });
            setIcon(closeBtn, 'x');
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                this.options.onClose?.();
            };
        }

        // 2. Presets Bar
        const presetsBar = this.containerEl.createDiv({ cls: 'pakcli-bezier-presets-bar' });
        for (const preset of BEZIER_PRESETS) {
            const btn = presetsBar.createEl('button', {
                cls: 'pakcli-bezier-preset-btn',
                text: preset.name
            });
            btn.onclick = () => {
                this.applyPreset(preset);
            };
            this.presetButtonsMap.set(preset.id, btn);
        }

        this.updateActivePresetHighlight();

        // 3. Canvas Container
        const canvasWrap = this.containerEl.createDiv({ cls: 'pakcli-bezier-canvas-wrap' });
        this.canvasEl = canvasWrap.createEl('canvas', { cls: 'pakcli-bezier-canvas' });
        this.canvasEl.width = 380;
        this.canvasEl.height = 200;
    }

    private setupCanvas(): void {
        const context = this.canvasEl.getContext('2d');
        if (!context) {
            throw new Error('Failed to get 2D context for Bezier editor');
        }
        this.ctx = context;

        // Auto-scale for high DPI displays
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvasEl.getBoundingClientRect();
        const displayWidth = rect.width > 0 ? rect.width : 380;
        const displayHeight = rect.height > 0 ? rect.height : 200;

        this.canvasEl.width = Math.round(displayWidth * dpr);
        this.canvasEl.height = Math.round(displayHeight * dpr);
        this.ctx.scale(dpr, dpr);
    }

    private getPlotBounds() {
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvasEl.width / dpr;
        const h = this.canvasEl.height / dpr;
        const xMin = this.padLeft;
        const xMax = w - this.padRight;
        const yMin = this.padTop;
        const yMax = h - this.padBottom;
        const plotWidth = xMax - xMin;
        const plotHeight = yMax - yMin;
        return { xMin, xMax, yMin, yMax, plotWidth, plotHeight, w, h };
    }

    // Mapping normalized (0..1) to canvas pixels
    private normToCanvas(nx: number, ny: number): { x: number; y: number } {
        const { xMin, plotWidth, yMin, plotHeight } = this.getPlotBounds();
        return {
            x: xMin + nx * plotWidth,
            y: (yMin + plotHeight) - ny * plotHeight
        };
    }

    // Mapping canvas pixels to normalized (0..1)
    private canvasToNorm(cx: number, cy: number): { x: number; y: number } {
        const { xMin, plotWidth, yMin, plotHeight } = this.getPlotBounds();
        return {
            x: Math.max(0, Math.min(1, (cx - xMin) / plotWidth)),
            y: ((yMin + plotHeight) - cy) / plotHeight
        };
    }

    private updateCoordinatesUI(): void {
        if (this.coordinateBadgeEl) {
            this.coordinateBadgeEl.setText(
                `P0: (${this.p0.x.toFixed(2)}, ${this.p0.y.toFixed(2)})  P3: (${this.p3.x.toFixed(2)}, ${this.p3.y.toFixed(2)})`
            );
            this.coordinateBadgeEl.setAttribute(
                'title',
                `P0: (${this.p0.x.toFixed(2)}, ${this.p0.y.toFixed(2)}) • P1: (${this.p1.x.toFixed(2)}, ${this.p1.y.toFixed(2)}) • P2: (${this.p2.x.toFixed(2)}, ${this.p2.y.toFixed(2)}) • P3: (${this.p3.x.toFixed(2)}, ${this.p3.y.toFixed(2)})`
            );
        }
    }

    private updateActivePresetHighlight(): void {
        for (const [id, btn] of this.presetButtonsMap.entries()) {
            const preset = BEZIER_PRESETS.find(p => p.id === id);
            if (!preset) continue;
            const matches = 
                Math.abs(this.p0.x - 0.0) < 0.03 &&
                Math.abs(this.p0.y - 0.0) < 0.03 &&
                Math.abs(this.p3.x - 1.0) < 0.03 &&
                Math.abs(this.p3.y - 1.0) < 0.03 &&
                Math.abs(preset.p1.x - this.p1.x) < 0.03 &&
                Math.abs(preset.p1.y - this.p1.y) < 0.03 &&
                Math.abs(preset.p2.x - this.p2.x) < 0.03 &&
                Math.abs(preset.p2.y - this.p2.y) < 0.03;
            btn.toggleClass('is-active', matches);
        }
    }

    public applyPreset(preset: BezierPreset): void {
        this.p0 = { x: 0.0, y: 0.0 };
        this.p3 = { x: 1.0, y: 1.0 };
        this.p1 = { ...preset.p1 };
        this.p2 = { ...preset.p2 };
        this.updateCoordinatesUI();
        this.updateActivePresetHighlight();
        this.redraw();
        this.options.onChange?.(this.p1, this.p2, this.p0, this.p3);
        this.options.onSave?.(this.p1, this.p2, this.p0, this.p3);
    }

    private bindEvents(): void {
        const getCanvasPos = (e: MouseEvent): { x: number; y: number } => {
            const rect = this.canvasEl.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        };

        const hitRadius = 15;

        this.canvasEl.addEventListener('pointerdown', (e: PointerEvent) => {
            const pos = getCanvasPos(e);
            const p0Pos = this.normToCanvas(this.p0.x, this.p0.y);
            const p1Pos = this.normToCanvas(this.p1.x, this.p1.y);
            const p2Pos = this.normToCanvas(this.p2.x, this.p2.y);
            const p3Pos = this.normToCanvas(this.p3.x, this.p3.y);

            const dist0 = Math.hypot(pos.x - p0Pos.x, pos.y - p0Pos.y);
            const dist1 = Math.hypot(pos.x - p1Pos.x, pos.y - p1Pos.y);
            const dist2 = Math.hypot(pos.x - p2Pos.x, pos.y - p2Pos.y);
            const dist3 = Math.hypot(pos.x - p3Pos.x, pos.y - p3Pos.y);

            const candidates: { handle: 'p0' | 'p1' | 'p2' | 'p3'; dist: number }[] = [
                { handle: 'p0', dist: dist0 },
                { handle: 'p3', dist: dist3 },
                { handle: 'p1', dist: dist1 },
                { handle: 'p2', dist: dist2 }
            ].filter(c => c.dist <= hitRadius).sort((a, b) => a.dist - b.dist);

            if (candidates.length > 0) {
                this.activeHandle = candidates[0].handle;
                this.canvasEl.setPointerCapture(e.pointerId);
                this.redraw();
            }
        });

        this.canvasEl.addEventListener('pointermove', (e: PointerEvent) => {
            const pos = getCanvasPos(e);
            if (this.activeHandle) {
                const norm = this.canvasToNorm(pos.x, pos.y);

                if (this.activeHandle === 'p0') {
                    // Left white handle
                    // Constraints:
                    // 1. Horizontal: p0.x in [0, p3.x - 0.02]
                    // 2. Vertical: left is below right -> p0.y in [0.0, p3.y]
                    const prevP0 = { ...this.p0 };
                    const clampedX = Math.max(0.0, Math.min(this.p3.x - 0.02, norm.x));
                    const clampedY = Math.max(0.0, Math.min(this.p3.y, norm.y));
                    this.p0 = { x: clampedX, y: clampedY };

                    // Move tangent handle p1 proportionally with p0
                    const dx = this.p0.x - prevP0.x;
                    const dy = this.p0.y - prevP0.y;
                    this.p1 = {
                        x: Math.max(0.0, Math.min(1.0, this.p1.x + dx)),
                        y: this.p1.y + dy
                    };
                } else if (this.activeHandle === 'p3') {
                    // Right white handle
                    // Constraints:
                    // 1. Horizontal: p3.x in [p0.x + 0.02, 1.0]
                    // 2. Vertical: right must be above left -> p3.y in [p0.y, 1.0]
                    const prevP3 = { ...this.p3 };
                    const clampedX = Math.max(this.p0.x + 0.02, Math.min(1.0, norm.x));
                    const clampedY = Math.max(this.p0.y, Math.min(1.0, norm.y));
                    this.p3 = { x: clampedX, y: clampedY };

                    // Move tangent handle p2 proportionally with p3
                    const dx = this.p3.x - prevP3.x;
                    const dy = this.p3.y - prevP3.y;
                    this.p2 = {
                        x: Math.max(0.0, Math.min(1.0, this.p2.x + dx)),
                        y: this.p2.y + dy
                    };
                } else if (this.activeHandle === 'p1') {
                    const clampedX = Math.max(0.0, Math.min(1.0, norm.x));
                    const clampedY = Math.max(-0.5, Math.min(2.0, norm.y));
                    this.p1 = { x: clampedX, y: clampedY };
                } else if (this.activeHandle === 'p2') {
                    const clampedX = Math.max(0.0, Math.min(1.0, norm.x));
                    const clampedY = Math.max(-0.5, Math.min(2.0, norm.y));
                    this.p2 = { x: clampedX, y: clampedY };
                }

                this.updateCoordinatesUI();
                this.updateActivePresetHighlight();
                this.redraw();
                this.options.onChange?.(this.p1, this.p2, this.p0, this.p3);
            } else {
                // Hover check across all 4 handles
                const p0Pos = this.normToCanvas(this.p0.x, this.p0.y);
                const p1Pos = this.normToCanvas(this.p1.x, this.p1.y);
                const p2Pos = this.normToCanvas(this.p2.x, this.p2.y);
                const p3Pos = this.normToCanvas(this.p3.x, this.p3.y);

                const dist0 = Math.hypot(pos.x - p0Pos.x, pos.y - p0Pos.y);
                const dist1 = Math.hypot(pos.x - p1Pos.x, pos.y - p1Pos.y);
                const dist2 = Math.hypot(pos.x - p2Pos.x, pos.y - p2Pos.y);
                const dist3 = Math.hypot(pos.x - p3Pos.x, pos.y - p3Pos.y);

                const hitRadius = 15;
                const candidates: { handle: 'p0' | 'p1' | 'p2' | 'p3'; dist: number }[] = [
                    { handle: 'p0', dist: dist0 },
                    { handle: 'p3', dist: dist3 },
                    { handle: 'p1', dist: dist1 },
                    { handle: 'p2', dist: dist2 }
                ].filter(c => c.dist <= hitRadius).sort((a, b) => a.dist - b.dist);

                const nextHover = candidates.length > 0 ? candidates[0].handle : null;
                if (nextHover !== this.hoveredHandle) {
                    this.hoveredHandle = nextHover;
                    this.canvasEl.style.cursor = nextHover ? 'grab' : 'crosshair';
                    this.redraw();
                }
            }
        });

        const handlePointerUp = (e: PointerEvent) => {
            if (this.activeHandle) {
                this.activeHandle = null;
                try {
                    this.canvasEl.releasePointerCapture(e.pointerId);
                } catch {
                    // Ignore capture release error
                }
                this.canvasEl.style.cursor = this.hoveredHandle ? 'grab' : 'crosshair';
                this.redraw();
                this.options.onSave?.(this.p1, this.p2, this.p0, this.p3);
            }
        };

        this.canvasEl.addEventListener('pointerup', handlePointerUp);
        this.canvasEl.addEventListener('pointercancel', handlePointerUp);

        // Window resize observer to keep crisp DPI
        if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
            const ro = new ResizeObserver(() => {
                this.setupCanvas();
                this.redraw();
            });
            ro.observe(this.canvasEl);
        }
    }

    public redraw(): void {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const { xMin, xMax, yMin, yMax, plotWidth, plotHeight, w, h } = this.getPlotBounds();

        // 1. Clear background
        ctx.fillStyle = '#1c1c1f';
        ctx.fillRect(0, 0, w, h);

        // 2. Draw Frame Ticks & Header (Top Ruler 0 .. 60)
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#71717a';

        const totalFrames = 60;
        const stepFrames = 5;

        for (let f = 0; f <= totalFrames; f += stepFrames) {
            const nx = f / totalFrames;
            const cx = xMin + nx * plotWidth;

            // Frame label along top
            if (f > 0) {
                ctx.fillText(f.toString(), cx, yMin - 6);
            }

            // Vertical grid line
            ctx.beginPath();
            ctx.moveTo(cx, yMin);
            ctx.lineTo(cx, yMax);
            ctx.strokeStyle = f % 15 === 0 ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // 3. Draw Horizontal Value Guides (y = 0.0, 0.25, 0.5, 0.75, 1.0)
        const yTicks = [0.0, 0.25, 0.5, 0.75, 1.0];
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        for (const ny of yTicks) {
            const cy = (yMin + plotHeight) - ny * plotHeight;
            ctx.beginPath();
            ctx.moveTo(xMin, cy);
            ctx.lineTo(xMax, cy);
            ctx.strokeStyle = (ny === 0.0 || ny === 1.0) ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = (ny === 0.0 || ny === 1.0) ? 1.2 : 1;
            ctx.stroke();

            // Value label
            ctx.fillStyle = '#52525b';
            ctx.fillText(ny.toFixed(2), xMin - 4, cy);
        }

        // 4. Subtle Blender-style colored reference horizontal lines (yellow/greenish & blueish)
        const guideY1 = (yMin + plotHeight) - 0.44 * plotHeight;
        const guideY2 = (yMin + plotHeight) - 0.38 * plotHeight;

        // Yellow/Green guideline
        ctx.beginPath();
        ctx.moveTo(xMin, guideY1);
        ctx.lineTo(xMax, guideY1);
        ctx.strokeStyle = 'rgba(163, 230, 53, 0.35)'; // lime/yellow accent
        ctx.lineWidth = 1;
        ctx.stroke();

        // Blue guideline
        ctx.beginPath();
        ctx.moveTo(xMin, guideY2);
        ctx.lineTo(xMax, guideY2);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)'; // sky blue accent
        ctx.lineWidth = 1;
        ctx.stroke();

        // Coordinates of Keyframe 0 (start) and Keyframe 60 (end)
        const p0Pos = this.normToCanvas(this.p0.x, this.p0.y);
        const p3Pos = this.normToCanvas(this.p3.x, this.p3.y);
        const p1Pos = this.normToCanvas(this.p1.x, this.p1.y);
        const p2Pos = this.normToCanvas(this.p2.x, this.p2.y);

        // 5. Draw Tangent Arms (Stick lines connecting keyframes to handles)
        // Handle 1 Tangent Stick
        ctx.beginPath();
        ctx.moveTo(p0Pos.x, p0Pos.y);
        ctx.lineTo(p1Pos.x, p1Pos.y);
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Handle 2 Tangent Stick
        ctx.beginPath();
        ctx.moveTo(p3Pos.x, p3Pos.y);
        ctx.lineTo(p2Pos.x, p2Pos.y);
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 6. Draw Cubic Bezier Curve (Red/Magenta Blender F-Curve Glow)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p0Pos.x, p0Pos.y);
        ctx.bezierCurveTo(p1Pos.x, p1Pos.y, p2Pos.x, p2Pos.y, p3Pos.x, p3Pos.y);
        ctx.strokeStyle = '#ff3b5c';
        ctx.shadowColor = 'rgba(255, 59, 92, 0.55)';
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();

        // 7. Draw Keyframe Endpoints (P0 and P3 - white draggable handles)
        const drawKeyframePoint = (pos: { x: number; y: number }, label: string, isHovered: boolean, isActive: boolean) => {
            ctx.save();
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, isActive ? 6.5 : (isHovered ? 6.0 : 4.5), 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = isActive ? '#00f2ff' : (isHovered ? '#00f2ff' : '#18181b');
            ctx.lineWidth = isActive ? 2.5 : 2.0;
            ctx.stroke();

            if (isHovered || isActive) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 11, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.restore();
        };

        drawKeyframePoint(p0Pos, 'F0', this.hoveredHandle === 'p0', this.activeHandle === 'p0');
        drawKeyframePoint(p3Pos, 'F60', this.hoveredHandle === 'p3', this.activeHandle === 'p3');

        // 8. Draw Draggable Tangent Handles (P1 and P2)
        const drawHandle = (pos: { x: number; y: number }, isHovered: boolean, isActive: boolean, label: string) => {
            ctx.save();
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, isActive ? 6.5 : (isHovered ? 6.0 : 5.0), 0, Math.PI * 2);
            ctx.fillStyle = isActive ? '#ffffff' : (isHovered ? '#ff8097' : '#1c1c1f');
            ctx.fill();

            ctx.strokeStyle = isActive ? '#ff3b5c' : '#f43f5e';
            ctx.lineWidth = 2;
            ctx.stroke();

            if (isHovered || isActive) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 11, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 59, 92, 0.35)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.restore();
        };

        drawHandle(p1Pos, this.hoveredHandle === 'p1', this.activeHandle === 'p1', 'P1');
        drawHandle(p2Pos, this.hoveredHandle === 'p2', this.activeHandle === 'p2', 'P2');

        // 9. Draw Live Playhead on Curve (indicates callout lifetime progress t)
        if (this.playheadT !== null && this.playheadT >= 0 && this.playheadT <= 1) {
            const headY = evaluateCubicBezier(this.playheadT, this.p1, this.p2, this.p0, this.p3);
            const headPos = this.normToCanvas(this.playheadT, headY);

            ctx.save();
            // Vertical dashed playhead line across ruler
            ctx.beginPath();
            ctx.moveTo(headPos.x, yMin - 14);
            ctx.lineTo(headPos.x, yMax);
            ctx.strokeStyle = 'rgba(0, 242, 255, 0.45)';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([3, 2]);
            ctx.stroke();

            // Glowing cyan playhead indicator on the curve
            ctx.beginPath();
            ctx.arc(headPos.x, headPos.y, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#00f2ff';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.strokeStyle = '#00f2ff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }
    }
}
