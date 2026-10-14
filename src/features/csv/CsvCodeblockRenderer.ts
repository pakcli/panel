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

	constructor(containerEl: HTMLElement, source: string, ctx: MarkdownPostProcessorContext, plugin?: TablitePlugin) {
		super(containerEl);
		this.source = source;
		this.ctx = ctx;
		this.plugin = plugin;
	}

	onload(): void {
		this.render();
	}

	onunload(): void {
		if (this.rootEl) {
			render(null, this.rootEl);
			this.rootEl = null;
		}
		if (this.saveTimeout) {
			window.clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
	}

	private render(): void {
		this.containerEl.empty();

		this.rootEl = this.containerEl.createDiv({ cls: 'tablite-root tablite-codeblock-embed' });

		const initialText = this.source ?? '';
		const delimiter = initialText.trim().length > 0 ? detectDelimiter(initialText) : ',';
		const parsed = parseCSV(initialText, delimiter);
		const columnCount = parsed.headers.length > 0 ? parsed.headers.length : 1;
		const filePath = this.ctx.sourcePath || 'embedded.csv';

		const initialConfig = this.plugin?.getFileColumnConfig
			? this.plugin.getFileColumnConfig(filePath, columnCount)
			: createDefaultColumnConfig(columnCount);

		render(
			h(App, {
				key: `${filePath}#${this.ctx.getSectionInfo(this.containerEl)?.lineStart ?? 0}`,
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
	}

	private handleDataChange(newData: string): void {
		this.source = newData;
		if (this.saveTimeout) {
			window.clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = window.setTimeout(async () => {
			try {
				if (!this.plugin) return;
				const section = this.ctx.getSectionInfo(this.containerEl);
				if (!section) return;
				const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
				if (!(file instanceof TFile)) return;

				const content = await this.plugin.app.vault.read(file);
				const lines = content.split('\n');

				if (section.lineStart < 0 || section.lineEnd >= lines.length) return;

				const startLine = lines[section.lineStart];
				const endLine = lines[section.lineEnd];
				if (!startLine.trim().startsWith('```') || !endLine.trim().startsWith('```')) {
					return;
				}

				const before = lines.slice(0, section.lineStart + 1);
				const after = lines.slice(section.lineEnd);
				const cleanData = newData.trimEnd();
				const newLines = cleanData ? cleanData.split('\n') : [''];
				const newContent = [...before, ...newLines, ...after].join('\n');

				if (newContent !== content) {
					await this.plugin.app.vault.modify(file, newContent);
				}
			} catch (err) {
				console.error('CsvCodeblockRenderer: Failed to auto-save CSV changes to note', err);
			}
		}, 800);
	}
}
