import { MarkdownView } from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type PakCLIPlugin from '../../main';

export interface CodeblockLanguageRule {
	id: string;
	language: string;
	behavior: 'scalefit' | 'flowclip' | 'wrap';
}

/**
 * Creates a CodeMirror 6 ViewPlugin that continuously attaches behavior classes
 * to codeblocks in Live Preview as the user types, edits, or scrolls.
 */
export function createCodeblockLivePreviewPlugin(scaler: CodeblockScaler) {
	return ViewPlugin.fromClass(
		class {
			constructor(view: EditorView) {
				scaler.processContainer(view.dom);
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					scaler.processContainer(update.view.dom);
				}
			}
		}
	);
}

/**
 * Renders an ASCII art text string as an SVG diagram widget (like Mermaid JS),
 * ensuring 100% fit to width, zero text wrapping, zero horizontal scrollbars,
 * and exact 1:1 vector aspect ratio scaling.
 */
export function renderAsciiSvg(source: string, container: HTMLElement, codeElToHide?: HTMLElement): void {
	if (codeElToHide && codeElToHide !== container) {
		codeElToHide.style.display = 'none';
	} else {
		container.empty();
	}

	const lines = source.split('\n');
	while (lines.length > 0 && lines[0].trim() === '') {
		lines.shift();
	}
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
		lines.pop();
	}

	if (lines.length === 0) return;

	let maxCols = 0;
	lines.forEach((l) => {
		if (l.length > maxCols) maxCols = l.length;
	});

	if (maxCols === 0) return;

	const charWidth = 8.1;
	const charHeight = 14;
	const totalWidth = Math.ceil(maxCols * charWidth);
	const totalHeight = Math.ceil(lines.length * charHeight);

	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
	svg.setAttribute('width', '100%');
	svg.setAttribute('height', 'auto');
	svg.setAttribute('class', 'pakcli-ascii-svg');

	const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
	style.textContent = `
		text.ascii-line {
			font-family: var(--font-monospace), 'Courier New', Courier, monospace;
			font-size: 13.5px;
			fill: var(--text-normal, currentColor);
			white-space: pre;
			letter-spacing: 0px;
		}
	`;
	svg.appendChild(style);

	lines.forEach((lineText, index) => {
		const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
		textNode.setAttribute('class', 'ascii-line');
		textNode.setAttribute('x', '0');
		textNode.setAttribute('y', `${(index + 1) * charHeight - 3}`);
		textNode.setAttribute('xml:space', 'preserve');
		textNode.textContent = lineText;
		svg.appendChild(textNode);
	});

	const wrapper = container.createDiv({ cls: 'pakcli-ascii-svg-wrapper' });
	wrapper.appendChild(svg);
}

export class CodeblockScaler {
	private isProcessing = false;
	private debounceTimer: number | null = null;

	constructor(private plugin: PakCLIPlugin) { }

	init(): void {
		// 1. Register CodeMirror 6 Live Preview Extension for real-time line tagging
		try {
			this.plugin.registerEditorExtension(createCodeblockLivePreviewPlugin(this));
		} catch (err) {
			console.warn('[PakCLI CodeblockScaler] Failed to register CM6 extension:', err);
		}

		// 2. Register Post Processor for Reading View
		this.plugin.registerMarkdownPostProcessor((element) => {
			this.processContainer(element);
		});

		// 3. Register Workspace & Editor events
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('layout-change', () => this.scheduleRescale())
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => this.scheduleRescale())
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('css-change', () => this.scheduleRescale())
		);
	}

	scheduleRescale(): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = window.setTimeout(() => {
			this.rescaleAll();
		}, 50);
	}

	rescaleAll(): void {
		if (this.isProcessing) return;
		this.isProcessing = true;

		try {
			// 1. Process all open markdown views across all leaves
			this.plugin.app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.view instanceof MarkdownView && leaf.view.contentEl) {
					this.processContainer(leaf.view.contentEl);
				}
			});

			// 2. Process all visible rendered and source views in document (even when settings modal is open)
			const roots = document.querySelectorAll(
				'.markdown-rendered, .markdown-source-view.mod-cm6, .workspace-leaf, .popover'
			);
			roots.forEach((root) => {
				this.processContainer(root as HTMLElement);
			});
		} finally {
			this.isProcessing = false;
		}
	}

	getBehaviorForLanguage(lang: string): 'scalefit' | 'flowclip' | 'wrap' {
		const cleanLang = (lang || '').trim().toLowerCase();
		const settings = this.plugin?.settings;
		const defaultBehavior = settings?.codeblockWrapMode || 'flowclip';

		if (!cleanLang) {
			return defaultBehavior;
		}

		// 1. Explicit scalefit pseudo-language tag in markdown (e.g. ```scalefit)
		if (cleanLang === 'scalefit') {
			return 'scalefit';
		}

		// 2. Read through Per-Language Rules first
		const rules = settings?.codeblockLanguageRules || [];
		for (const rule of rules) {
			const rawRuleLang = (rule.language || '').trim().toLowerCase();
			if (!rawRuleLang) continue;

			// Support exact match or comma/space-separated aliases (e.g. "ascii, asci" or "py, python")
			const aliases = rawRuleLang.split(/[,|\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
			if (aliases.includes(cleanLang) || rawRuleLang === cleanLang) {
				return rule.behavior;
			}
		}

		// 3. If not configured in Per-Language Rules, strictly fallback to default codeblock wrap mode
		return defaultBehavior;
	}

	getLanguageFromElement(preEl: HTMLElement, codeEl: HTMLElement): string {
		// 1. Check data-language or data-lang attributes
		const dataLang =
			preEl.getAttribute('data-language') ||
			preEl.getAttribute('data-lang') ||
			codeEl.getAttribute('data-language') ||
			codeEl.getAttribute('data-lang') ||
			preEl.parentElement?.getAttribute('data-language') ||
			preEl.parentElement?.getAttribute('data-lang');
		if (dataLang) {
			return dataLang.trim().toLowerCase();
		}

		// 2. Check classes on codeEl, preEl, and immediate parentElement
		const elementsToCheck = [codeEl, preEl, preEl.parentElement].filter(Boolean) as HTMLElement[];
		for (const el of elementsToCheck) {
			for (const cls of Array.from(el.classList)) {
				const m = cls.match(/^(?:language|block-language)-([a-zA-Z0-9_-]+)$/i);
				if (m) {
					return m[1].toLowerCase();
				}
			}
		}

		// 3. Check closest container with language class
		const containerWithLang = preEl.closest('[class*="language-"], [class*="block-language-"]');
		if (containerWithLang) {
			for (const cls of Array.from(containerWithLang.classList)) {
				const m = cls.match(/^(?:language|block-language)-([a-zA-Z0-9_-]+)$/i);
				if (m) {
					return m[1].toLowerCase();
				}
			}
		}

		// 4. Check any badge / flair element (e.g. .code-block-flair)
		const flair = preEl.parentElement?.querySelector('.code-block-flair, .code-block-language, .code-language');
		if (flair && flair.textContent) {
			const tag = flair.textContent.trim().toLowerCase();
			if (tag && tag.length < 30) {
				return tag;
			}
		}

		return '';
	}

	getBehaviorForElement(preEl: HTMLElement, codeEl: HTMLElement): 'scalefit' | 'flowclip' | 'wrap' {
		const lang = this.getLanguageFromElement(preEl, codeEl);
		return this.getBehaviorForLanguage(lang);
	}

	processContainer(container: HTMLElement): void {
		// Reading View <pre>
		const preElements = container.querySelectorAll('pre');
		preElements.forEach((pre) => {
			const codeEl = pre.querySelector('code') ?? pre;
			const behavior = this.getBehaviorForElement(pre, codeEl);

			pre.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-flowclip', 'pakcli-codeblock-scalefit');

			const existingSvg = pre.querySelector('.pakcli-ascii-svg-wrapper');

			if (behavior === 'scalefit') {
				pre.classList.add('pakcli-codeblock-scalefit');
				if (!existingSvg) {
					const text = codeEl.textContent || pre.textContent || '';
					if (text.trim()) {
						renderAsciiSvg(text, pre, codeEl);
					}
				}
			} else {
				// Restore original code element if previously converted to SVG
				if (existingSvg) {
					existingSvg.remove();
					if (codeEl) codeEl.style.display = '';
				}

				if (behavior === 'wrap') {
					pre.classList.add('pakcli-codeblock-wrap');
				} else {
					// Flowclip: Individual horizontal scrollbar
					pre.classList.add('pakcli-codeblock-flowclip');
				}
			}
		});

		// Live Preview CodeMirror lines (.cm-line.HyperMD-codeblock)
		const cmLines = container.querySelectorAll('.cm-line.HyperMD-codeblock');
		if (cmLines.length > 0) {
			this.processCmLines(cmLines);
		}
	}

	private processCmLines(cmLines: NodeListOf<Element>): void {
		let currentBlockLines: HTMLElement[] = [];
		let currentLanguage = '';

		const flushBlock = () => {
			if (currentBlockLines.length === 0) return;

			const behavior = this.getBehaviorForLanguage(currentLanguage);

			currentBlockLines.forEach((line) => {
				line.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-line-flowclip', 'pakcli-codeblock-line-scalefit');
				if (behavior === 'wrap') {
					line.classList.add('pakcli-codeblock-wrap');
				} else if (behavior === 'scalefit') {
					line.classList.add('pakcli-codeblock-line-scalefit');
				} else {
					line.classList.add('pakcli-codeblock-line-flowclip');
				}
			});

			currentBlockLines = [];
			currentLanguage = '';
		};

		cmLines.forEach((el) => {
			const line = el as HTMLElement;
			const text = line.textContent?.trim() || '';

			if (line.classList.contains('HyperMD-codeblock-begin')) {
				flushBlock();
				currentLanguage = text.replace(/^`+/, '').trim().toLowerCase();
				currentBlockLines.push(line);
			} else if (line.classList.contains('HyperMD-codeblock-end')) {
				currentBlockLines.push(line);
				flushBlock();
			} else {
				if (!currentLanguage && text.startsWith('```')) {
					currentLanguage = text.replace(/^`+/, '').trim().toLowerCase();
				}
				currentBlockLines.push(line);
			}
		});

		flushBlock();
	}

	destroy(): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}
}
