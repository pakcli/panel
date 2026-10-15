import { MarkdownRenderChild, type MarkdownPostProcessorContext, TFile } from 'obsidian';
import { render, h } from 'preact';
import { App } from '../sqlseal/components/App';
import type TablitePlugin from '../../main';
import { parseCSV } from '../sqlseal/parser/csv-engine';
import { detectDelimiter } from '../sqlseal/parser/detect';
import { createDefaultColumnConfig } from '../sqlseal/types';

export class CsvCodeblockRenderer extends MarkdownRenderChild {
	private source: string;
	private ctx: MarkdownPostProcessorContext;
	private plugin?: TablitePlugin;
	private rootEl: HTMLDivElement | null = null;
	private saveTimeout: number | null = null;
	private isRendered: boolean = false;

	constructor(containerEl: HTMLElement, source: string, ctx: MarkdownPostProcessorContext, plugin?: TablitePlugin) {
		super(containerEl);
		this.source = source;
		this.ctx = ctx;
		this.plugin = plugin;

		// Immediately render in constructor so Live Preview and Reading View display synchronously without delay
		this.render();
	}

	onload(): void {
		if (!this.isRendered) {
			this.render();
		}
	}

	onunload(): void {
		if (this.rootEl) {
			try {
				render(null, this.rootEl);
			} catch {
				// Ignore unload cleanup error
			}
			this.rootEl = null;
		}
		if (this.saveTimeout) {
			window.clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
	}

	private render(): void {
		try {
			this.containerEl.empty();
			this.rootEl = this.containerEl.createDiv({ cls: 'tablite-root tablite-codeblock-embed' });

			const initialText = this.source ?? '';
			const delimiter = initialText.trim().length > 0 ? detectDelimiter(initialText) : ',';
			const parsed = parseCSV(initialText, delimiter);
			const columnCount = parsed.headers.length > 0 ? parsed.headers.length : 1;
			const filePath = this.ctx.sourcePath || 'embedded.csv';

			let lineStart = 0;
			try {
				lineStart = this.ctx.getSectionInfo?.(this.containerEl)?.lineStart ?? 0;
			} catch {
				lineStart = 0;
			}

			const initialConfig = this.plugin?.getFileColumnConfig
				? this.plugin.getFileColumnConfig(filePath, columnCount)
				: createDefaultColumnConfig(columnCount);

			render(
				h(App, {
					key: `${filePath}#${lineStart}`,
					initialData: initialText,
					initialParsed: parsed,
					initialDelimiter: delimiter,
					initialEncoding: 'utf-8',
					filePath,
					plugin: this.plugin,
					initialColumnConfig: initialConfig,
					autocompleteColumns: this.plugin?.settings?.autocompleteColumns,
					isEmbedded: true,
					onColumnConfigChange: async (config, nextColumnCount) => {
						if (!filePath || !this.plugin?.setFileColumnConfig) return;
						await this.plugin.setFileColumnConfig(filePath, nextColumnCount, config);
					},
					onDataChange: (newData: string) => {
						this.handleDataChange(newData);
					}
				}),
				this.rootEl
			);
			this.isRendered = true;
		} catch (err) {
			console.error('CsvCodeblockRenderer: Failed to render CSV table', err);
			this.containerEl.empty();
			const errBox = this.containerEl.createDiv({
				cls: 'tablite-embed-error',
				attr: { style: 'padding: 8px 12px; color: var(--text-error, #e53e3e); font-size: 0.85em; background: rgba(229, 62, 62, 0.08); border-radius: 4px;' }
			});
			errBox.createSpan({ text: 'Error rendering CSV: ' + String((err as Error).message || err) });
		}
	}

	private handleDataChange(newData: string): void {
		this.source = newData;
		if (this.saveTimeout) {
			window.clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = window.setTimeout(async () => {
			try {
				if (!this.plugin) return;
				const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
				if (!(file instanceof TFile)) return;

				let section: { lineStart: number; lineEnd: number } | null = null;
				try {
					section = this.ctx.getSectionInfo?.(this.containerEl) ?? null;
				} catch {
					section = null;
				}

				const content = await this.plugin.app.vault.read(file);
				const lines = content.split(/\r?\n/);

				if (section && section.lineStart >= 0 && section.lineEnd < lines.length) {
					const startLine = lines[section.lineStart];
					const endLine = lines[section.lineEnd];
					if (startLine.trim().startsWith('```') && endLine.trim().startsWith('```')) {
						const before = lines.slice(0, section.lineStart + 1);
						const after = lines.slice(section.lineEnd);
						const cleanData = newData.trimEnd();
						const newLines = cleanData ? cleanData.split(/\r?\n/) : [''];
						const newContent = [...before, ...newLines, ...after].join('\n');

						if (newContent !== content) {
							await this.plugin.app.vault.modify(file, newContent);
						}
						return;
					}
				}
			} catch (err) {
				console.error('CsvCodeblockRenderer: Failed to auto-save CSV changes to note', err);
			}
		}, 800);
	}
}
