import { MarkdownRenderChild, Notice, type MarkdownPostProcessorContext } from 'obsidian';
import Papa from 'papaparse';

export interface CsvParseData {
	headers: string[];
	rows: string[][];
	delimiter: string;
}

export class CsvCodeblockRenderer extends MarkdownRenderChild {
	private source: string;
	private ctx: MarkdownPostProcessorContext;
	private cardEl!: HTMLElement;
	private tableWrapperEl!: HTMLElement;
	private rawCodeEl!: HTMLElement;
	private isRawView = false;
	private toggleBtn!: HTMLButtonElement;

	constructor(containerEl: HTMLElement, source: string, ctx: MarkdownPostProcessorContext) {
		super(containerEl);
		this.source = source;
		this.ctx = ctx;
	}

	onload(): void {
		this.render();
	}

	private parseCSV(text: string): CsvParseData {
		const trimmed = text.trim();
		if (!trimmed) {
			return { headers: [], rows: [], delimiter: ',' };
		}

		// Detect delimiter if semicolon or tab
		const firstLine = trimmed.split('\n')[0] || '';
		let delimiter = ',';
		if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) {
			delimiter = ';';
		} else if ((firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length) {
			delimiter = '\t';
		}

		const parsed = Papa.parse<string[]>(trimmed, {
			delimiter,
			skipEmptyLines: 'greedy'
		});

		const rawRows = parsed.data || [];
		if (rawRows.length === 0) {
			return { headers: [], rows: [], delimiter };
		}

		// First row is headers
		const headers = rawRows[0].map((h, i) => (h !== undefined && h !== null && h.trim() !== '' ? h.trim() : `Col ${i + 1}`));
		const dataRows = rawRows.slice(1);

		return {
			headers,
			rows: dataRows,
			delimiter
		};
	}

	private render(): void {
		this.containerEl.empty();

		const { headers, rows } = this.parseCSV(this.source);

		// Outer Card Container
		this.cardEl = this.containerEl.createDiv({ cls: 'pakcli-csv-card' });

		// 1. Header Toolbar
		const toolbar = this.cardEl.createDiv({ cls: 'pakcli-csv-toolbar' });

		// Left info
		const leftGroup = toolbar.createDiv({ cls: 'pakcli-csv-toolbar-left' });
		const title = leftGroup.createSpan({ cls: 'pakcli-csv-title', text: '📊 CSV' });
		title.title = 'Rendered embedded CSV table';

		const rowCount = rows.length;
		const colCount = headers.length;
		const badgeText = `${rowCount} ${rowCount === 1 ? 'row' : 'rows'} • ${colCount} ${colCount === 1 ? 'col' : 'cols'}`;
		leftGroup.createSpan({ cls: 'pakcli-csv-badge', text: badgeText });

		// Right actions
		const rightGroup = toolbar.createDiv({ cls: 'pakcli-csv-toolbar-right' });

		// Copy Button
		const copyBtn = rightGroup.createEl('button', {
			cls: 'pakcli-csv-btn',
			text: '📋 Copy',
			title: 'Copy raw CSV to clipboard'
		});
		copyBtn.onclick = async () => {
			await navigator.clipboard.writeText(this.source.trim());
			new Notice('✓ Copied CSV data to clipboard');
		};

		// Toggle View Button (Table ↔ Raw Code)
		this.toggleBtn = rightGroup.createEl('button', {
			cls: 'pakcli-csv-btn',
			text: '🔀 Raw',
			title: 'Toggle Raw Code / Table View'
		});
		this.toggleBtn.onclick = () => {
			this.isRawView = !this.isRawView;
			if (this.isRawView) {
				this.tableWrapperEl.style.display = 'none';
				this.rawCodeEl.style.display = 'block';
				this.toggleBtn.setText('📊 Table');
			} else {
				this.tableWrapperEl.style.display = 'block';
				this.rawCodeEl.style.display = 'none';
				this.toggleBtn.setText('🔀 Raw');
			}
		};

		// 2. Table Wrapper (Dynamic Row Height)
		// Height strictly matches the total rows: for 1 row, only 1 row height; for 3 rows, only 3 rows height.
		this.tableWrapperEl = this.cardEl.createDiv({ cls: 'pakcli-csv-table-wrapper' });

		// If rowCount > 15, allow vertical scroll with max-height; otherwise natural fit
		if (rowCount > 15) {
			this.tableWrapperEl.addClass('is-scrollable-y');
		} else {
			this.tableWrapperEl.addClass('is-fit-content');
		}

		const table = this.tableWrapperEl.createEl('table', { cls: 'pakcli-csv-table' });

		// Thead
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		
		// Row number column
		headRow.createEl('th', { cls: 'pakcli-csv-th pakcli-csv-row-num', text: '#' });

		headers.forEach(h => {
			const th = headRow.createEl('th', { cls: 'pakcli-csv-th', text: h });
			th.title = h;
		});

		// Tbody
		const tbody = table.createEl('tbody');
		if (rows.length === 0) {
			const emptyRow = tbody.createEl('tr');
			const td = emptyRow.createEl('td', {
				cls: 'pakcli-csv-empty-cell',
				attr: { colspan: String(headers.length + 1) },
				text: '(No data rows)'
			});
		} else {
			rows.forEach((row, rowIdx) => {
				const tr = tbody.createEl('tr', { cls: 'pakcli-csv-tr' });

				// Row index cell
				tr.createEl('td', { cls: 'pakcli-csv-td pakcli-csv-row-num', text: String(rowIdx + 1) });

				headers.forEach((_, colIdx) => {
					const val = (row[colIdx] ?? '').trim();
					const td = tr.createEl('td', { cls: 'pakcli-csv-td' });
					this.renderCellContent(td, val);
				});
			});
		}

		// 3. Raw Code Container (hidden by default)
		this.rawCodeEl = this.cardEl.createEl('pre', { cls: 'pakcli-csv-raw-code' });
		this.rawCodeEl.createEl('code', { text: this.source.trim() });
		this.rawCodeEl.style.display = 'none';
	}

	private renderCellContent(td: HTMLElement, val: string): void {
		if (!val) {
			td.createSpan({ cls: 'pakcli-csv-null', text: '—' });
			return;
		}

		const lower = val.toLowerCase();

		// Boolean pills
		if (lower === 'true') {
			td.createSpan({ cls: 'pakcli-csv-pill is-true', text: 'true' });
			return;
		}
		if (lower === 'false') {
			td.createSpan({ cls: 'pakcli-csv-pill is-false', text: 'false' });
			return;
		}

		// Image path detector (e.g. assets/...png, or url ending with image ext)
		const isImgPath = /\.(png|jpe?g|webp|svg|gif)($|\?)/i.test(val);
		if (isImgPath) {
			const cellWrap = td.createDiv({ cls: 'pakcli-csv-img-cell' });
			const icon = cellWrap.createSpan({ cls: 'pakcli-csv-img-icon', text: '🖼️' });
			const link = cellWrap.createSpan({ cls: 'pakcli-csv-img-text', text: val });
			cellWrap.title = val;
			return;
		}

		// URL detector
		if (/^https?:\/\//i.test(val)) {
			const a = td.createEl('a', {
				cls: 'pakcli-csv-link',
				text: val,
				href: val,
				attr: { target: '_blank', rel: 'noopener noreferrer' }
			});
			return;
		}

		// Plain text
		td.createSpan({ text: val });
	}
}
