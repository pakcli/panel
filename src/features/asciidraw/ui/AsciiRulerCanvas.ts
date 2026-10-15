export interface RulerRenderOptions {
	cols: number;
	rows: number;
	cellW: number;
	cellH: number;
	pad: number;
	panX: number;
	panY: number;
	zoomScale: number;
	activeCol: number | null;
	activeRow: number | null;
	palette?: {
		fg?: string;
		bg?: string;
		border?: string;
		accent?: string;
	};
}

export class AsciiRulerCanvas {
	private topContainer: HTMLElement;
	private leftContainer: HTMLElement;
	private topCanvas: HTMLCanvasElement;
	private leftCanvas: HTMLCanvasElement;
	private topCtx: CanvasRenderingContext2D | null = null;
	private leftCtx: CanvasRenderingContext2D | null = null;

	constructor(topContainer: HTMLElement, leftContainer: HTMLElement) {
		this.topContainer = topContainer;
		this.leftContainer = leftContainer;

		this.topContainer.empty();
		this.leftContainer.empty();

		this.topCanvas = this.topContainer.createEl('canvas', { cls: 'asciidraw-ruler-canvas-x' });
		this.leftCanvas = this.leftContainer.createEl('canvas', { cls: 'asciidraw-ruler-canvas-y' });

		this.topCtx = this.topCanvas.getContext('2d');
		this.leftCtx = this.leftCanvas.getContext('2d');
	}

	public render(opts: RulerRenderOptions): void {
		this.renderTopRuler(opts);
		this.renderLeftRuler(opts);
	}

	private renderTopRuler(opts: RulerRenderOptions): void {
		if (!this.topCtx) return;
		const ctx = this.topCtx;
		const dpr = window.devicePixelRatio || 1;

		const width = this.topContainer.clientWidth || 800;
		const height = 24;

		if (this.topCanvas.width !== Math.round(width * dpr) || this.topCanvas.height !== Math.round(height * dpr)) {
			this.topCanvas.width = Math.round(width * dpr);
			this.topCanvas.height = Math.round(height * dpr);
			this.topCanvas.style.width = `${width}px`;
			this.topCanvas.style.height = `${height}px`;
		}

		ctx.save();
		ctx.scale(dpr, dpr);

		// Background
		const bgColor = opts.palette?.bg || '#1e1e22';
		const borderColor = opts.palette?.border || '#333338';
		const textColor = opts.palette?.fg || '#a1a1aa';
		const accentColor = opts.palette?.accent || 'var(--interactive-accent, #7c3aed)';

		ctx.fillStyle = bgColor;
		ctx.fillRect(0, 0, width, height);

		// Bottom border line
		ctx.strokeStyle = borderColor;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, height - 0.5);
		ctx.lineTo(width, height - 0.5);
		ctx.stroke();

		const { cols, cellW, pad, panX, zoomScale, activeCol } = opts;
		const pixelPerCol = cellW * zoomScale;

		// Adaptive tick step so numbers never collide
		// Minimum 45px between major tick labels
		const candidateSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
		let majorStep = 5;
		for (const step of candidateSteps) {
			if (step * pixelPerCol >= 45) {
				majorStep = step;
				break;
			}
		}

		let minorStep = 1;
		if (majorStep === 2) minorStep = 1;
		else if (majorStep === 5) minorStep = 1;
		else if (majorStep === 10) minorStep = 2;
		else if (majorStep === 20 || majorStep === 25) minorStep = 5;
		else if (majorStep === 50) minorStep = 10;
		else if (majorStep === 100) minorStep = 20;
		else if (majorStep >= 200) minorStep = 50;

		// Highlight active cursor column
		if (activeCol !== null && activeCol >= 0 && activeCol < cols) {
			const activeX = panX + (pad + activeCol * cellW) * zoomScale;
			const activeW = Math.max(1, cellW * zoomScale);
			ctx.fillStyle = 'rgba(124, 58, 237, 0.28)';
			ctx.fillRect(activeX, 0, activeW, height);

			ctx.fillStyle = accentColor;
			ctx.fillRect(activeX, height - 3, activeW, 3);
		}

		// Draw ticks and labels
		ctx.font = '9.5px ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		const minC = Math.max(0, Math.floor((-panX - 50) / pixelPerCol - pad / cellW));
		const maxC = Math.min(cols, Math.ceil((width - panX + 50) / pixelPerCol - pad / cellW));

		const startTick = Math.max(0, Math.floor(minC / minorStep) * minorStep);

		for (let c = startTick; c <= maxC; c += minorStep) {
			const x = Math.round(panX + (pad + c * cellW) * zoomScale) + 0.5;
			if (x < -20 || x > width + 20) continue;

			const isMajor = c % majorStep === 0;

			if (isMajor) {
				// Major tick line
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
				ctx.beginPath();
				ctx.moveTo(x, 13);
				ctx.lineTo(x, height);
				ctx.stroke();

				// Major label
				ctx.fillStyle = c === activeCol ? '#ffffff' : textColor;
				ctx.fillText(String(c), x, 7);
			} else {
				// Minor tick line
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
				ctx.beginPath();
				ctx.moveTo(x, 18);
				ctx.lineTo(x, height);
				ctx.stroke();
			}
		}

		ctx.restore();
	}

	private renderLeftRuler(opts: RulerRenderOptions): void {
		if (!this.leftCtx) return;
		const ctx = this.leftCtx;
		const dpr = window.devicePixelRatio || 1;

		const width = 28;
		const height = this.leftContainer.clientHeight || 600;

		if (this.leftCanvas.width !== Math.round(width * dpr) || this.leftCanvas.height !== Math.round(height * dpr)) {
			this.leftCanvas.width = Math.round(width * dpr);
			this.leftCanvas.height = Math.round(height * dpr);
			this.leftCanvas.style.width = `${width}px`;
			this.leftCanvas.style.height = `${height}px`;
		}

		ctx.save();
		ctx.scale(dpr, dpr);

		// Background
		const bgColor = opts.palette?.bg || '#1e1e22';
		const borderColor = opts.palette?.border || '#333338';
		const textColor = opts.palette?.fg || '#a1a1aa';
		const accentColor = opts.palette?.accent || 'var(--interactive-accent, #7c3aed)';

		ctx.fillStyle = bgColor;
		ctx.fillRect(0, 0, width, height);

		// Right border line
		ctx.strokeStyle = borderColor;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(width - 0.5, 0);
		ctx.lineTo(width - 0.5, height);
		ctx.stroke();

		const { rows, cellH, pad, panY, zoomScale, activeRow } = opts;
		const pixelPerRow = cellH * zoomScale;

		// Adaptive vertical step (minimum 18px between row numbers)
		const candidateSteps = [1, 2, 5, 10, 20, 25, 50, 100];
		let majorStep = 5;
		for (const step of candidateSteps) {
			if (step * pixelPerRow >= 20) {
				majorStep = step;
				break;
			}
		}

		let minorStep = 1;
		if (majorStep === 2) minorStep = 1;
		else if (majorStep === 5) minorStep = 1;
		else if (majorStep === 10) minorStep = 2;
		else if (majorStep >= 20) minorStep = 5;

		// Highlight active cursor row
		if (activeRow !== null && activeRow >= 0 && activeRow < rows) {
			const activeY = panY + (pad + activeRow * cellH) * zoomScale;
			const activeH = Math.max(1, cellH * zoomScale);
			ctx.fillStyle = 'rgba(124, 58, 237, 0.28)';
			ctx.fillRect(0, activeY, width, activeH);

			ctx.fillStyle = accentColor;
			ctx.fillRect(width - 3, activeY, 3, activeH);
		}

		// Draw ticks and labels
		ctx.font = '9px ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace';
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';

		const minR = Math.max(0, Math.floor((-panY - 50) / pixelPerRow - pad / cellH));
		const maxR = Math.min(rows, Math.ceil((height - panY + 50) / pixelPerRow - pad / cellH));

		const startTick = Math.max(0, Math.floor(minR / minorStep) * minorStep);

		for (let r = startTick; r <= maxR; r += minorStep) {
			const y = Math.round(panY + (pad + r * cellH) * zoomScale) + 0.5;
			if (y < -20 || y > height + 20) continue;

			const isMajor = r % majorStep === 0;

			if (isMajor) {
				// Major tick line
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
				ctx.beginPath();
				ctx.moveTo(width - 8, y);
				ctx.lineTo(width, y);
				ctx.stroke();

				// Major label
				ctx.fillStyle = r === activeRow ? '#ffffff' : textColor;
				ctx.fillText(String(r), width - 11, y);
			} else {
				// Minor tick line
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
				ctx.beginPath();
				ctx.moveTo(width - 4, y);
				ctx.lineTo(width, y);
				ctx.stroke();
			}
		}

		ctx.restore();
	}
}
