import { MarkdownView, Notice } from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type PakCLIPlugin from '../../main';

export interface CodeblockLanguageRule {
	id: string;
	language: string;
	behavior: 'scalefit' | 'flowclip' | 'wrap';
	/** Optional script template fired on clipboard copy.
	 *  Supports two styles:
	 *   • `.{ <scripts> }`          – dot-block style
	 *   • `{ <scripts> }invoke()`   – invoke style (auto-executes)
	 */
	onClipboard?: string;
	/**
	 * If true (default), scans prefix and suffix (.{}, {}.invoke(), @{})
	 * and replaces already written wrappers instead of double-wrapping.
	 */
	replaceExisting?: boolean;
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

interface StickyBarEntry {
	bar: HTMLElement;
	inner: HTMLElement;
	lines: HTMLElement[];
	io: IntersectionObserver;
	onScroll: () => void;
	onResize: () => void;
}

export class CodeblockScaler {
	private isProcessing = false;
	private debounceTimer: number | null = null;
	private observer: MutationObserver | null = null;
	private pendingClipboardTransform: { timestamp: number; lang: string; template: string; replaceExisting?: boolean } | null = null;
	private cmStickyBars: StickyBarEntry[] = [];

	constructor(private plugin: PakCLIPlugin) { }

	init(): void {
		// Clean up any stale/orphaned bars from previous reloads or hot module replacements
		document.querySelectorAll('.pakcli-codeblock-flowclip-bar, .pakcli-cb-sticky-bar').forEach((el) => el.remove());
		// 0. Patch navigator.clipboard.writeText as safety net
		this.patchClipboardWriteText();
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
			this.plugin.app.workspace.on('file-open', () => this.scheduleRescale())
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('css-change', () => this.scheduleRescale())
		);

		// 4. Initial rescale when workspace layout is fully ready
		this.plugin.app.workspace.onLayoutReady(() => {
			console.log('[PakCLI CodeblockScaler] Workspace layout ready, running initial rescaleAll()');
			this.rescaleAll();
		});

		// 5. DOM MutationObserver: Catches asynchronously rendered codeblock preview widgets
		try {
			this.observer = new MutationObserver((mutations) => {
				for (const mut of mutations) {
					for (const node of Array.from(mut.addedNodes)) {
						if (node.nodeType === Node.ELEMENT_NODE) {
							const el = node as HTMLElement;
							if (
								el.tagName === 'PRE' ||
								el.querySelector?.('pre') ||
								el.classList?.contains('HyperMD-codeblock')
							) {
								this.processContainer(el);
							}
						}
					}
				}
			});
			this.observer.observe(document.body, { childList: true, subtree: true });
			console.log('[PakCLI CodeblockScaler] MutationObserver attached to document.body');
		} catch (err) {
			console.warn('[PakCLI CodeblockScaler] MutationObserver setup failed:', err);
		}

		// 6. Expose global debug function on window
		(window as any).debugPakcli = () => this.debugInspect();

		// 7. Global click interceptor (capture phase) for all codeblock copy buttons (Obsidian native and custom)
		this.plugin.registerDomEvent(
			document,
			'click',
			(evt: MouseEvent) => {
				this.handleCodeblockCopyClick(evt);
			},
			true // capture phase: intercepts before Obsidian's native listener executes
		);

		// 8. Global copy event interceptor for highlighted text inside codeblocks
		this.plugin.registerDomEvent(
			document,
			'copy',
			(evt: ClipboardEvent) => {
				this.handleCodeblockCopyEvent(evt);
			},
			true
		);

		// 9. Context menu interceptor to pre-arm transform on right-click copy
		this.plugin.registerDomEvent(
			document,
			'contextmenu',
			(evt: MouseEvent) => {
				this.handleCodeblockContextMenu(evt);
			},
			true
		);
	}

	debugInspect(targetEl?: HTMLElement): {
		codeblocksFound: number;
		cmLinesFound: number;
		details: any[];
	} {
		const doc = targetEl || document.body;
		const details: any[] = [];

		const preElements = doc.querySelectorAll('pre');
		preElements.forEach((pre, i) => {
			const codeEl = pre.querySelector('code') ?? pre;
			const detectedLang = this.getLanguageFromElement(pre, codeEl);
			const resolvedBehavior = this.getBehaviorForElement(pre, codeEl);
			const computed = window.getComputedStyle(pre);
			const codeComputed = window.getComputedStyle(codeEl);

			details.push({
				type: 'pre',
				index: i,
				detectedLang,
				resolvedBehavior,
				classes: pre.className,
				preOverflowX: computed.overflowX,
				preWhiteSpace: computed.whiteSpace,
				preWordBreak: computed.wordBreak,
				codeWhiteSpace: codeComputed.whiteSpace
			});
		});

		const cmLines = doc.querySelectorAll('.cm-line.HyperMD-codeblock');
		cmLines.forEach((line, i) => {
			const computed = window.getComputedStyle(line);
			details.push({
				type: 'cm-line',
				index: i,
				snippet: line.textContent?.substring(0, 30),
				classes: line.className,
				overflowX: computed.overflowX,
				whiteSpace: computed.whiteSpace,
				wordBreak: computed.wordBreak
			});
		});

		console.group('[PakCLI Codeblock Debug Report]');
		console.log('Settings:', {
			defaultWrapMode: this.plugin.settings.codeblockWrapMode,
			languageRules: this.plugin.settings.codeblockLanguageRules
		});
		console.log(`Found ${preElements.length} <pre> blocks and ${cmLines.length} CM6 code lines.`);
		if (details.length > 0) {
			console.table(details);
		} else {
			console.log('No codeblocks or CM6 code lines found in active container.');
		}
		console.groupEnd();

		return {
			codeblocksFound: preElements.length,
			cmLinesFound: cmLines.length,
			details
		};
	}

	scheduleRescale(): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = window.setTimeout(() => {
			this.rescaleAll();
		}, 40);
	}

	get flowclipMode(): 'all-lines' | 'current' | 'per-line' {
		return this.plugin.settings.flowclipSliderMode || 'all-lines';
	}

	private saveDebounceTimer: number | null = null;
	saveScrollState(key: string, pct: number): void {
		if (this.plugin.settings.flowclipSaveState === false) return;
		if (!this.plugin.settings.flowclipScrollStates) {
			this.plugin.settings.flowclipScrollStates = {};
		}
		this.plugin.settings.flowclipScrollStates[key] = Math.round(pct * 1000) / 1000;
		if (this.saveDebounceTimer !== null) {
			window.clearTimeout(this.saveDebounceTimer);
		}
		this.saveDebounceTimer = window.setTimeout(() => {
			this.plugin.saveSettings();
			this.saveDebounceTimer = null;
		}, 400);
	}

	getSavedScrollPct(key: string): number {
		if (this.plugin.settings.flowclipSaveState === false) return 0;
		return this.plugin.settings.flowclipScrollStates?.[key] || 0;
	}

	isElementVisibleInActiveView(el: HTMLElement): boolean {
		if (!el || !el.isConnected) return false;

		// 1. If element or any ancestor is display: none, offsetParent is null (unless position: fixed)
		if (el.offsetParent === null && window.getComputedStyle(el).position !== 'fixed') {
			return false;
		}

		// 2. Find the owning MarkdownView across all leaves
		let ownerView: MarkdownView | null = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (!ownerView && leaf.view instanceof MarkdownView) {
				if (leaf.view.containerEl.contains(el)) {
					ownerView = leaf.view;
				}
			}
		});

		if (ownerView) {
			// If the leaf container itself is hidden (e.g. background tab), reject
			if ((ownerView as MarkdownView).containerEl.offsetParent === null) return false;
			const csContainer = window.getComputedStyle((ownerView as MarkdownView).containerEl);
			if (csContainer.display === 'none' || csContainer.visibility === 'hidden') return false;

			const mode = (ownerView as MarkdownView).getMode(); // 'source' or 'preview'
			const isInsideSource = !!el.closest('.markdown-source-view');
			const isInsideRendered = !!el.closest('.markdown-rendered');
			const isInsideEmbed = !!el.closest('.cm-embed-block');

			if (mode === 'preview') {
				// Reading View: ONLY elements inside .markdown-rendered are valid
				if (isInsideSource) return false;
				if (!isInsideRendered) return false;
			} else if (mode === 'source') {
				// Live Preview / Editing View: ONLY elements inside .markdown-source-view are valid
				// Background .markdown-rendered is strictly rejected
				if (isInsideRendered && !isInsideEmbed && !isInsideSource) return false;
				if (!isInsideSource && !isInsideEmbed) return false;
			}
		} else {
			// Fallback: Check standard DOM hierarchy (e.g. popover preview)
			const popover = el.closest('.popover');
			if (popover && (popover as HTMLElement).offsetParent === null) {
				return false;
			}
		}

		return true;
	}

	rescaleAll(): void {
		if (this.isProcessing) return;
		this.isProcessing = true;

		try {
			if (this.flowclipMode === 'per-line') {
				// In per-line mode, remove all floating sticky bars
				document.querySelectorAll<HTMLElement>('.pakcli-cb-sticky-bar').forEach((bar) => bar.remove());
			} else {
				// Clean up any sticky bars whose anchor element is no longer visible in active view
				document.querySelectorAll<HTMLElement>('.pakcli-cb-sticky-bar').forEach((bar) => {
					const anchor = (bar as any)._pakcliAnchor as HTMLElement | undefined;
					if (!anchor || !anchor.isConnected) {
						bar.remove();
					} else if (!this.isElementVisibleInActiveView(anchor)) {
						bar.style.setProperty('display', 'none', 'important');
					}
				});
			}

			// 1. Process all open markdown views across all leaves
			this.plugin.app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.view instanceof MarkdownView && leaf.view.contentEl) {
					this.processContainer(leaf.view.contentEl);
				}
			});

			// 2. Process all visible rendered and source views in document (even when settings modal is open)
			const roots = document.querySelectorAll(
				'.markdown-rendered, .markdown-source-view, .cm-editor, .workspace-leaf, .popover'
			);
			roots.forEach((root) => {
				this.processContainer(root as HTMLElement);
			});
		} finally {
			this.isProcessing = false;
			this.dumpDebugInfo();
		}
	}

	async dumpDebugInfo(): Promise<void> {
		try {
			const activeFile = this.plugin.app.workspace.getActiveFile()?.path;
			const preList: any[] = [];
			document.querySelectorAll('pre').forEach((pre, i) => {
				const codeEl = pre.querySelector('code') ?? pre;
				const csPre = window.getComputedStyle(pre);
				const csCode = window.getComputedStyle(codeEl);
				const csParent = pre.parentElement ? window.getComputedStyle(pre.parentElement) : null;
				const embed = pre.closest('.cm-embed-block');
				const csEmbed = embed ? window.getComputedStyle(embed) : null;
				const rPre = pre.getBoundingClientRect();
				const rParent = pre.parentElement?.getBoundingClientRect();
				const rEmbed = embed?.getBoundingClientRect();

				preList.push({
					index: i,
					text: (pre.textContent || '').substring(0, 50),
					detectedLang: this.getLanguageFromElement(pre, codeEl),
					resolvedBehavior: this.getBehaviorForElement(pre, codeEl),
					preClasses: pre.className,
					parentTag: pre.parentElement?.tagName,
					parentClasses: pre.parentElement?.className,
					embedClasses: embed?.className,
					preRect: { w: rPre.width, h: rPre.height, l: rPre.left, r: rPre.right },
					parentRect: rParent ? { w: rParent.width, h: rParent.height, l: rParent.left, r: rParent.right } : null,
					embedRect: rEmbed ? { w: rEmbed.width, h: rEmbed.height, l: rEmbed.left, r: rEmbed.right } : null,
					preMetrics: { scrollWidth: pre.scrollWidth, clientWidth: pre.clientWidth, offsetWidth: pre.offsetWidth },
					codeMetrics: { scrollWidth: codeEl.scrollWidth, clientWidth: codeEl.clientWidth },
					preStyles: {
						display: csPre.display,
						width: csPre.width,
						maxWidth: csPre.maxWidth,
						minWidth: csPre.minWidth,
						overflowX: csPre.overflowX,
						overflowY: csPre.overflowY,
						whiteSpace: csPre.whiteSpace,
						wordBreak: csPre.wordBreak,
						contain: (csPre as any).contain,
						boxSizing: csPre.boxSizing,
						background: csPre.backgroundColor
					},
					codeStyles: {
						display: csCode.display,
						width: csCode.width,
						minWidth: csCode.minWidth,
						whiteSpace: csCode.whiteSpace,
						wordBreak: csCode.wordBreak
					},
					parentStyles: csParent ? {
						display: csParent.display,
						width: csParent.width,
						maxWidth: csParent.maxWidth,
						overflow: csParent.overflow,
						boxSizing: csParent.boxSizing
					} : null,
					embedStyles: csEmbed ? {
						display: csEmbed.display,
						width: csEmbed.width,
						maxWidth: csEmbed.maxWidth,
						overflow: csEmbed.overflow,
						boxSizing: csEmbed.boxSizing,
						background: csEmbed.backgroundColor,
						borderRadius: csEmbed.borderRadius
					} : null
				});
			});

			const cmLineList: any[] = [];
			document.querySelectorAll('.cm-line.HyperMD-codeblock').forEach((line, i) => {
				const cs = window.getComputedStyle(line);
				const r = line.getBoundingClientRect();
				cmLineList.push({
					index: i,
					text: (line.textContent || '').substring(0, 50),
					classes: line.className,
					rect: { w: r.width, h: r.height, l: r.left, r: r.right },
					metrics: { scrollWidth: line.scrollWidth, clientWidth: line.clientWidth },
					styles: {
						width: cs.width,
						maxWidth: cs.maxWidth,
						overflowX: cs.overflowX,
						whiteSpace: cs.whiteSpace,
						wordBreak: cs.wordBreak,
						contain: (cs as any).contain
					}
				});
			});

			const data = {
				timestamp: new Date().toISOString(),
				activeFile,
				bodyClasses: document.body.className,
				settings: {
					defaultWrapMode: this.plugin.settings.codeblockWrapMode,
					rules: this.plugin.settings.codeblockLanguageRules
				},
				preElements: preList,
				cmLines: cmLineList
			};

			await this.plugin.app.vault.adapter.write('debug_codeblock.json', JSON.stringify(data, null, 2));
		} catch (err) {
			console.warn('[PakCLI Scaler] dumpDebugInfo error:', err);
		}
	}

	findMatchingRule(lang: string, rules: CodeblockLanguageRule[]): CodeblockLanguageRule | null {
		const cleanLang = (lang || '').trim().toLowerCase();
		if (!cleanLang) return null;

		const aliasGroups = [
			['powershell', 'ps1', 'pwsh', 'ps'],
			['javascript', 'js', 'node'],
			['typescript', 'ts'],
			['python', 'py'],
			['bash', 'sh', 'shell', 'zsh'],
			['markdown', 'md'],
			['yaml', 'yml'],
			['ascii', 'asci'],
		];

		for (const rule of rules) {
			const ruleLang = (rule.language || '').trim().toLowerCase();
			if (!ruleLang) continue;

			if (ruleLang === cleanLang) return rule;

			const ruleAliases = ruleLang.split(/[,|\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
			if (ruleAliases.includes(cleanLang)) return rule;

			for (const group of aliasGroups) {
				if (group.includes(cleanLang) && (group.includes(ruleLang) || ruleAliases.some((a) => group.includes(a)))) {
					return rule;
				}
			}
		}

		return null;
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

		// 2. Read through Per-Language Rules with alias support
		const rules = settings?.codeblockLanguageRules || [];
		const matched = this.findMatchingRule(cleanLang, rules);
		if (matched) {
			console.log(`[PakCLI Scaler] Language "${cleanLang}" matched rule "${matched.language}" -> Behavior: "${matched.behavior}"`);
			return matched.behavior;
		}

		// 3. If not configured in Per-Language Rules, strictly fallback to default codeblock wrap mode
		console.log(`[PakCLI Scaler] Language "${cleanLang}" uncustomized in rules -> Fallback to default: "${defaultBehavior}"`);
		return defaultBehavior;
	}

	getLanguageFromElement(preEl: HTMLElement, codeEl: HTMLElement): string {
		// 1. Check data-language or data-lang attributes on pre, code, or any ancestor
		const dataLang =
			preEl.getAttribute('data-language') ||
			preEl.getAttribute('data-lang') ||
			codeEl.getAttribute('data-language') ||
			codeEl.getAttribute('data-lang') ||
			preEl.parentElement?.getAttribute('data-language') ||
			preEl.parentElement?.getAttribute('data-lang') ||
			preEl.closest('[data-language]')?.getAttribute('data-language') ||
			preEl.closest('[data-lang]')?.getAttribute('data-lang');
		if (dataLang) {
			return dataLang.trim().toLowerCase();
		}

		// 2. Check classes on codeEl, preEl, parentElement, or closest block container
		const elementsToCheck = [
			codeEl,
			preEl,
			preEl.parentElement,
			preEl.closest('[class*="block-language-"]'),
			preEl.closest('[class*="language-"]'),
			preEl.closest('.cm-embed-block')
		].filter(Boolean) as HTMLElement[];

		for (const el of elementsToCheck) {
			for (const cls of Array.from(el.classList)) {
				const m = cls.match(/^(?:language|block-language)-([a-zA-Z0-9_-]+)$/i);
				if (m) {
					return m[1].toLowerCase();
				}
			}
		}

		// 3. Check any badge / flair / header element inside the block wrapper
		const wrapper = preEl.closest('.cm-embed-block, .block-language, [class*="block-language"]') || preEl.parentElement;
		const flair = wrapper?.querySelector('.code-block-flair, .code-block-language, .code-language, .code-block-header span');
		if (flair && flair.textContent) {
			const tag = flair.textContent.trim().toLowerCase();
			if (tag && tag.length < 40) {
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
		// 1. All <pre> elements (Reading View AND Live Preview embed widgets)
		const preElements: HTMLElement[] = [];
		if (container.matches && container.matches('pre')) {
			preElements.push(container);
		}
		container.querySelectorAll('pre').forEach((p) => preElements.push(p as HTMLElement));

		preElements.forEach((pre) => {
			if (!this.isElementVisibleInActiveView(pre)) {
				if ((pre as any)._pakcliStickyBar) {
					(pre as any)._pakcliStickyBar.style.setProperty('display', 'none', 'important');
				}
				return;
			}
			const codeEl = pre.querySelector('code') ?? pre;
			const behavior = this.getBehaviorForElement(pre, codeEl);

			pre.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-flowclip', 'pakcli-codeblock-scalefit');

			const existingSvg = pre.querySelector('.pakcli-ascii-svg-wrapper');

			if (behavior === 'scalefit') {
				pre.classList.add('pakcli-codeblock-scalefit');
				pre.style.setProperty('max-width', '100%', 'important');
				pre.style.setProperty('width', 'auto', 'important');
				pre.style.setProperty('min-width', '0', 'important');
				pre.style.setProperty('overflow-x', 'auto', 'important');
				pre.style.setProperty('box-sizing', 'border-box', 'important');
				pre.style.setProperty('contain', 'none', 'important');

				const embedBlock = pre.closest('.cm-embed-block') as HTMLElement | null;
				if (embedBlock) {
					embedBlock.style.setProperty('max-width', '100%', 'important');
					embedBlock.style.setProperty('width', 'auto', 'important');
					embedBlock.style.setProperty('overflow', 'hidden', 'important');
					embedBlock.style.setProperty('box-sizing', 'border-box', 'important');
				}
				if (pre.parentElement) {
					pre.parentElement.style.setProperty('max-width', '100%', 'important');
					pre.parentElement.style.setProperty('width', 'auto', 'important');
					pre.parentElement.style.setProperty('min-width', '0', 'important');
					pre.parentElement.style.setProperty('overflow', 'hidden', 'important');
					pre.parentElement.style.setProperty('box-sizing', 'border-box', 'important');
				}

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
					pre.style.setProperty('white-space', 'pre-wrap', 'important');
					pre.style.setProperty('word-break', 'break-all', 'important');
					pre.style.setProperty('overflow-wrap', 'anywhere', 'important');
					pre.style.setProperty('word-wrap', 'break-word', 'important');
					pre.style.setProperty('overflow-x', 'hidden', 'important');
					pre.style.setProperty('max-width', '100%', 'important');
					pre.style.setProperty('width', 'auto', 'important');
					pre.style.setProperty('min-width', '0', 'important');
					pre.style.setProperty('box-sizing', 'border-box', 'important');
					pre.style.setProperty('contain', 'none', 'important');

					const embedBlock = pre.closest('.cm-embed-block') as HTMLElement | null;
					if (embedBlock) {
						embedBlock.style.setProperty('max-width', '100%', 'important');
						embedBlock.style.setProperty('width', 'auto', 'important');
						embedBlock.style.setProperty('overflow', 'hidden', 'important');
						embedBlock.style.setProperty('box-sizing', 'border-box', 'important');
					}
					if (pre.parentElement) {
						pre.parentElement.style.setProperty('max-width', '100%', 'important');
						pre.parentElement.style.setProperty('width', 'auto', 'important');
						pre.parentElement.style.setProperty('min-width', '0', 'important');
						pre.parentElement.style.setProperty('box-sizing', 'border-box', 'important');
					}

					if (codeEl) {
						codeEl.style.setProperty('white-space', 'pre-wrap', 'important');
						codeEl.style.setProperty('word-break', 'break-all', 'important');
						codeEl.style.setProperty('overflow-wrap', 'anywhere', 'important');
						codeEl.style.setProperty('word-wrap', 'break-word', 'important');
						codeEl.style.setProperty('display', 'block', 'important');
						codeEl.style.setProperty('width', 'auto', 'important');
						codeEl.style.setProperty('max-width', '100%', 'important');
					}
				} else {
					// Flowclip: horizontal overflow
					pre.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-scalefit');
					pre.classList.add('pakcli-codeblock-flowclip');
					pre.style.setProperty('white-space', 'pre', 'important');
					pre.style.setProperty('word-break', 'normal', 'important');
					pre.style.setProperty('word-wrap', 'normal', 'important');
					pre.style.setProperty('overflow-x', 'auto', 'important');
					pre.style.setProperty('overflow-y', 'hidden', 'important');
					pre.style.setProperty('max-width', '100%', 'important');
					pre.style.setProperty('width', 'auto', 'important');
					pre.style.setProperty('min-width', '0', 'important');
					pre.style.setProperty('box-sizing', 'border-box', 'important');
					pre.style.setProperty('contain', 'none', 'important');

					const embedBlock = pre.closest('.cm-embed-block') as HTMLElement | null;
					if (embedBlock) {
						embedBlock.style.setProperty('max-width', '100%', 'important');
						embedBlock.style.setProperty('width', 'auto', 'important');
						embedBlock.style.setProperty('overflow', 'hidden', 'important');
						embedBlock.style.setProperty('box-sizing', 'border-box', 'important');
					}
					if (pre.parentElement && !pre.parentElement.classList.contains('pakcli-cb-wrap')) {
						pre.parentElement.style.setProperty('max-width', '100%', 'important');
						pre.parentElement.style.setProperty('width', 'auto', 'important');
						pre.parentElement.style.setProperty('min-width', '0', 'important');
						pre.parentElement.style.setProperty('overflow', 'visible', 'important');
						pre.parentElement.style.setProperty('box-sizing', 'border-box', 'important');
					}

					if (codeEl) {
						codeEl.style.setProperty('white-space', 'pre', 'important');
						codeEl.style.setProperty('word-break', 'normal', 'important');
						codeEl.style.setProperty('word-wrap', 'normal', 'important');
						codeEl.style.setProperty('display', 'inline-block', 'important');
						codeEl.style.setProperty('min-width', '100%', 'important');
						codeEl.style.setProperty('width', 'auto', 'important');
						codeEl.style.setProperty('box-sizing', 'border-box', 'important');
					}

					if (this.flowclipMode === 'per-line') {
						// Mode 3: Native scrollbar on <pre>
						pre.classList.add('pakcli-codeblock-flowclip-native');
						pre.style.setProperty('scrollbar-width', 'thin', 'important');
						(pre.style as any)['-ms-overflow-style'] = 'auto';

						if ((pre as any)._pakcliStickyBar) {
							(pre as any)._pakcliStickyBar.remove();
							(pre as any)._pakcliStickyBar = null;
							(pre as any)._pakcliStickyPositionBar = null;
						}

						const filePath = this.plugin.app.workspace.getActiveFile()?.path || 'unknown';
						const snippet = (pre.textContent || '').trim().substring(0, 30).replace(/\s+/g, '_');
						const key = `${filePath}::pre::${snippet}`;
						const savedPct = this.getSavedScrollPct(key);
						if (savedPct > 0) {
							const maxScroll = pre.scrollWidth - pre.clientWidth;
							if (maxScroll > 0) pre.scrollLeft = Math.round(savedPct * maxScroll);
						}
						const oldHandler = (pre as any)._pakcliPreNativeScroll;
						if (oldHandler) pre.removeEventListener('scroll', oldHandler);
						const handler = () => {
							const maxScroll = pre.scrollWidth - pre.clientWidth;
							if (maxScroll > 0) this.saveScrollState(key, pre.scrollLeft / maxScroll);
						};
						(pre as any)._pakcliPreNativeScroll = handler;
						pre.addEventListener('scroll', handler, { passive: true });
					} else {
						// Mode 1 ('all-lines') or Mode 2 ('current'): 1 bottom sticky bar
						pre.classList.remove('pakcli-codeblock-flowclip-native');
						pre.style.setProperty('scrollbar-width', 'none', 'important');
						(pre.style as any)['-ms-overflow-style'] = 'none';

						this.injectStickyBarForPre(pre);
					}
				}
			}

			// Inject clipboard button overlay (once per pre)
			this.injectClipboardButton(pre, codeEl);
		});

		// 2. Live Preview CodeMirror lines (.cm-line.HyperMD-codeblock)
		const cmLines = container.querySelectorAll('.cm-line.HyperMD-codeblock');
		if (cmLines.length > 0) {
			const firstLine = cmLines[0] as HTMLElement;
			if (this.isElementVisibleInActiveView(firstLine)) {
				this.processCmLines(cmLines);
			} else {
				cmLines.forEach((l) => {
					if ((l as any)._pakcliStickyBar) {
						(l as any)._pakcliStickyBar.style.setProperty('display', 'none', 'important');
					}
				});
			}
		}
	}

	// Height of the sticky scrollbar in px — must match the CSS height
	private static readonly BAR_H = 14;

	/**
	 * Injects a fixed-position scrollbar for a Reading View <pre> flowclip block.
	 * The bar sits at the BOTTOM OF THE CODEBLOCK, clamping to viewport-bottom
	 * when the block extends below the viewport.
	 */
	private injectStickyBarForPre(pre: HTMLElement): void {
		// If already inited, just refresh the bar position
		if ((pre as any)._pakcliStickyBar) {
			const fn: (() => void) | undefined = (pre as any)._pakcliStickyPositionBar;
			if (fn) fn();
			return;
		}

		pre.style.setProperty('padding-bottom', `${CodeblockScaler.BAR_H}px`, 'important');

		// Build fixed bar
		const bar = document.createElement('div');
		bar.className = 'pakcli-cb-sticky-bar';
		const inner = document.createElement('div');
		inner.className = 'pakcli-cb-sticky-inner';
		bar.appendChild(inner);
		document.body.appendChild(bar);
		(bar as any)._pakcliAnchor = pre;
		(pre as any)._pakcliStickyBar = bar;

		const BAR_H = CodeblockScaler.BAR_H;

		const cleanup = () => {
			window.removeEventListener('scroll', onWindowScroll, true);
			window.removeEventListener('resize', positionBar);
			io.disconnect();
			(pre as any)._pakcliResizeObserver?.disconnect();
			(pre as any)._pakcliStickyBar = null;
			(pre as any)._pakcliStickyPositionBar = null;
		};

		const positionBar = () => {
			if (!this.isElementVisibleInActiveView(pre)) {
				bar.style.setProperty('display', 'none', 'important');
				if (!pre.isConnected) {
					bar.remove();
					cleanup();
				}
				return;
			}
			const rect = pre.getBoundingClientRect();
			const sw = pre.scrollWidth;
			const cw = rect.width;
			const hasOverflow = sw > cw + 2;
			const viewH = window.innerHeight;
			const isVisible = rect.bottom >= BAR_H && rect.bottom <= viewH + BAR_H && rect.top < viewH;
			if (!hasOverflow || !isVisible) {
				bar.style.setProperty('display', 'none', 'important');
				return;
			}

			// Position at bottom of the codeblock (not bottom of screen)
			const barTop = rect.bottom - BAR_H;

			bar.style.setProperty('display', 'block', 'important');
			bar.style.setProperty('left', `${rect.left}px`, 'important');
			bar.style.setProperty('width', `${cw}px`, 'important');
			bar.style.setProperty('top', `${barTop}px`, 'important');
			inner.style.setProperty('width', `${sw}px`, 'important');
		};
		(pre as any)._pakcliStickyPositionBar = positionBar;

		let isSyncing = false;
		let syncTimeout: number | null = null;
		const setSyncing = () => {
			isSyncing = true;
			if (syncTimeout !== null) window.clearTimeout(syncTimeout);
			syncTimeout = window.setTimeout(() => {
				isSyncing = false;
				syncTimeout = null;
			}, 50);
		};

		const filePath = this.plugin.app.workspace.getActiveFile()?.path || 'unknown';
		const snippet = (pre.textContent || '').trim().substring(0, 30).replace(/\s+/g, '_');
		const key = `${filePath}::pre::${snippet}`;

		// Restore saved scroll percentage
		const savedPct = this.getSavedScrollPct(key);
		if (savedPct > 0) {
			const maxScroll = pre.scrollWidth - pre.clientWidth;
			if (maxScroll > 0) {
				const target = Math.round(savedPct * maxScroll);
				pre.scrollLeft = target;
				bar.scrollLeft = target;
			}
		}

		pre.addEventListener('scroll', () => {
			if (isSyncing) return;
			setSyncing();
			bar.scrollLeft = pre.scrollLeft;
			const maxScroll = pre.scrollWidth - pre.clientWidth;
			if (maxScroll > 0) this.saveScrollState(key, pre.scrollLeft / maxScroll);
		}, { passive: true });

		bar.addEventListener('scroll', () => {
			if (isSyncing) return;
			setSyncing();
			pre.scrollLeft = bar.scrollLeft;
			const maxScroll = pre.scrollWidth - pre.clientWidth;
			if (maxScroll > 0) this.saveScrollState(key, bar.scrollLeft / maxScroll);
		}, { passive: true });

		const onWindowScroll = (e: Event) => {
			const t = e.target as HTMLElement;
			if (t === bar || t === pre || bar.contains(t) || pre.contains(t)) return;
			positionBar();
		};

		window.addEventListener('scroll', onWindowScroll, { passive: true, capture: true });
		window.addEventListener('resize', positionBar, { passive: true });

		const io = new IntersectionObserver(() => positionBar(), { threshold: 0 });
		io.observe(pre);

		if (typeof ResizeObserver !== 'undefined') {
			const ro = new ResizeObserver(positionBar);
			ro.observe(pre);
			// Also observe the <code> child — its width changing means scrollWidth changed
			const codeEl = pre.querySelector('code');
			if (codeEl) ro.observe(codeEl);
			(pre as any)._pakcliResizeObserver = ro;
		}

		bar.scrollLeft = pre.scrollLeft;
		positionBar();
		window.requestAnimationFrame(positionBar);
		window.setTimeout(positionBar, 150);
		window.setTimeout(positionBar, 700);
	}

	/** Strips leading/trailing blank lines and unindents lines by common leading whitespace. */
	unindentLines(inner: string): string {
		let lines = inner.replace(/\r\n/g, '\n').split('\n');
		while (lines.length > 0 && lines[0].trim() === '') {
			lines.shift();
		}
		while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
			lines.pop();
		}
		if (lines.length === 0) return '';

		let minIndent = Infinity;
		for (const line of lines) {
			if (line.trim().length === 0) continue;
			const indentMatch = line.match(/^[ \t]+/);
			const indentLen = indentMatch ? indentMatch[0].length : 0;
			if (indentLen < minIndent) minIndent = indentLen;
		}

		if (minIndent > 0 && minIndent !== Infinity) {
			lines = lines.map((line) => {
				if (line.trim().length === 0) return '';
				return line.slice(minIndent);
			});
		}

		return lines.join('\n');
	}

	/**
	 * Scans for and strips any existing wrapper prefixes and suffixes:
	 *   - `.{ ... }`
	 *   - `@{ ... }`
	 *   - `{ ... }.invoke()` or `{ ... }invoke()`
	 *   - `{ ... }`
	 * Returns the unwrapped inner script content.
	 */
	unwrapExistingWrapper(content: string): string {
		const s = (content || '').replace(/\r\n/g, '\n').trim();
		if (!s) return content;

		// 1. .{\n ... \n} or .{ ... }
		const dotMatch = s.match(/^\.\s*\{([\s\S]*)\}\s*$/);
		if (dotMatch) {
			return this.unindentLines(dotMatch[1]);
		}

		// 2. @{\n ... \n} or @{ ... }
		const atMatch = s.match(/^@\s*\{([\s\S]*)\}\s*$/);
		if (atMatch) {
			return this.unindentLines(atMatch[1]);
		}

		// 3. {\n ... \n}.invoke() or {\n ... \n}invoke() or { ... }.invoke()
		const invokeMatch = s.match(/^\{([\s\S]*)\}\s*\.?\s*in[vc]oke\s*(?:\(\s*\))?\s*$/i);
		if (invokeMatch) {
			return this.unindentLines(invokeMatch[1]);
		}

		// 4. {\n ... \n} (plain script block wrapper)
		const braceMatch = s.match(/^\{([\s\S]*)\}\s*$/);
		if (braceMatch) {
			return this.unindentLines(braceMatch[1]);
		}

		return content;
	}

	/** Transform codeblock content according to an onClipboard template or preset.
	 *
	 *  Supported templates / presets:
	 *   1. PowerShell Presets:
	 *      - `invoke` (or `{}.invoke()`): wraps in `{ \n\tscripts\n }.invoke()`
	 *      - `dot` (or `.{}`): wraps in `.{ \n\tscripts\n }`
	 *      - `at` (or `@{}`): wraps in `@{ \n\tscripts\n }`
	 *   2. Custom Template with placeholder:
	 *      - `<scripts>`, `scripts`, `<content>`, `content`, `{scripts}`, `{content}`, `$content`
	 *   3. Custom Block:
	 *      - `.{ ... }` or `{ ... }.invoke()` or `{ ... }`
	 */
	transformClipboardContent(content: string, template: string, language: string, replaceExisting: boolean = true): string {
		let raw = (content || '').replace(/\r\n/g, '\n').trimEnd();
		const t = (template || '').trim();

		const isPowerShell = ['powershell', 'ps1', 'pwsh', 'ps'].includes((language || '').trim().toLowerCase());

		// When replaceExisting is enabled for PowerShell, unwrap any existing .{}, @{}, {}.invoke() wrapper first
		if (replaceExisting && isPowerShell) {
			raw = this.unwrapExistingWrapper(raw);
		}

		if (!t) return raw;

		const indentWith = (str: string, indent: string = '\t') => {
			return str
				.split('\n')
				.map((line) => (line.length > 0 ? indent + line : line))
				.join('\n');
		};

		// 1. PowerShell Presets
		const isInvoke = t === 'invoke' || t === '{}.invoke()' || t === '{}.invoke' || t === '{}.incvoke' || /\{\s*\}\s*\.?\s*in[vc]oke/i.test(t);
		const isDot = t === 'dot' || t === '.{}' || t === '. prefix' || /^\s*\.\s*\{\s*\}\s*$/i.test(t);
		const isAt = t === 'at' || t === '@{}' || t === '@ prefix' || /^\s*@\s*\{\s*\}\s*$/i.test(t) || t.includes("'@'");

		if (isInvoke) {
			return `{\n${indentWith(raw, '\t')}\n}.invoke()`;
		}
		if (isDot) {
			return `.{\n${indentWith(raw, '\t')}\n}`;
		}
		if (isAt) {
			return `@{\n${indentWith(raw, '\t')}\n}`;
		}

		// 2. Custom template with placeholder keyword
		const placeholderRegex = /<scripts>|scripts|<content>|content|\{scripts\}|\{content\}|\$content/i;
		if (placeholderRegex.test(t)) {
			const lines = t.split('\n');
			let indent = '\t';
			for (const line of lines) {
				const match = line.match(/^([ \t]+)(?:<scripts>|scripts|<content>|content|\{scripts\}|\{content\}|\$content)/i);
				if (match) {
					indent = match[1];
					break;
				}
			}
			const indented = raw
				.split('\n')
				.map((l, i) => (i === 0 ? l : (l.length > 0 ? indent + l : l)))
				.join('\n');
			return t.replace(placeholderRegex, indented);
		}

		// 3. Dot-block template without placeholder: .{ ... } or { ... }invoke()
		const dotBlockMatch = t.match(/^(\s*\.\s*\{)([\s\S]*?)(\}\s*)$/);
		if (dotBlockMatch) {
			return `${dotBlockMatch[1]}\n${indentWith(raw, '\t')}\n${dotBlockMatch[3]}`;
		}

		const invokeBlockMatch = t.match(/^(\s*\{)([\s\S]*?)(\}\s*\.?\s*in[vc]oke\s*(?:\(\s*\))?\s*)$/i);
		if (invokeBlockMatch) {
			return `${invokeBlockMatch[1]}\n${indentWith(raw, '\t')}\n}.invoke()`;
		}

		const genericBraceMatch = t.match(/^([\s\S]*?\{)([\s\S]*?)(\}[\s\S]*)$/);
		if (genericBraceMatch) {
			return `${genericBraceMatch[1]}\n${indentWith(raw, '\t')}\n${genericBraceMatch[3]}`;
		}

		// Fallback: prefix template
		return `${t}\n${raw}`;
	}

	private originalClipboardWriteText: ((text: string) => Promise<void>) | null = null;

	formatTemplateNoticeLabel(tpl: string): string {
		const t = (tpl || '').trim();
		if (t === 'invoke' || t === '{}.invoke()' || t === '{}.incvoke' || /invoke/i.test(t)) return '{}.invoke()';
		if (t === 'dot' || t === '.{}' || t.includes('. prefix')) return '.{}';
		if (t === 'at' || t === '@{}' || t.includes('@ prefix')) return '@{}';
		return t;
	}

	/** Patches navigator.clipboard.writeText and Electron clipboard as guaranteed safety net */
	private patchClipboardWriteText(): void {
		// 1. Global / Window navigator.clipboard
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			const nav = navigator.clipboard as any;
			if (!nav.__pakcliPatched) {
				nav.__pakcliPatched = true;
				const originalWriteText = nav.writeText.bind(navigator.clipboard);
				this.originalClipboardWriteText = originalWriteText;

				nav.writeText = async (text: string) => {
					const pending = this.pendingClipboardTransform;
					if (pending && (Date.now() - pending.timestamp < 3000)) {
						console.log(`[PakCLI] Intercepted navigator.clipboard.writeText for "${pending.lang}" (${pending.template})`);
						this.pendingClipboardTransform = null;
						const transformed = this.transformClipboardContent(text, pending.template, pending.lang, pending.replaceExisting !== false);
						new Notice(`[PakCLI] Copied with ${pending.lang} (${this.formatTemplateNoticeLabel(pending.template)}) template!`, 2500);
						return originalWriteText(transformed);
					}
					return originalWriteText(text);
				};
			}
		}

		// 2. activeDocument defaultView navigator.clipboard (popout windows / active leaves)
		try {
			const activeWin = (activeDocument as any)?.defaultView;
			if (activeWin?.navigator?.clipboard && !activeWin.navigator.clipboard.__pakcliPatched) {
				activeWin.navigator.clipboard.__pakcliPatched = true;
				const origDocWrite = activeWin.navigator.clipboard.writeText.bind(activeWin.navigator.clipboard);
				activeWin.navigator.clipboard.writeText = async (text: string) => {
					const pending = this.pendingClipboardTransform;
					if (pending && (Date.now() - pending.timestamp < 3000)) {
						console.log(`[PakCLI] Intercepted activeDoc writeText for "${pending.lang}" (${pending.template})`);
						this.pendingClipboardTransform = null;
						const transformed = this.transformClipboardContent(text, pending.template, pending.lang, pending.replaceExisting !== false);
						new Notice(`[PakCLI] Copied with ${pending.lang} (${this.formatTemplateNoticeLabel(pending.template)}) template!`, 2500);
						return origDocWrite(transformed);
					}
					return origDocWrite(text);
				};
			}
		} catch (e) {
			// ignore
		}

		// 3. Electron clipboard if available in Obsidian desktop
		try {
			const electron = (window as any).require?.('electron');
			if (electron?.clipboard && !electron.clipboard.__pakcliPatched) {
				electron.clipboard.__pakcliPatched = true;
				const origElectronWrite = electron.clipboard.writeText.bind(electron.clipboard);
				electron.clipboard.writeText = (text: string, type?: string) => {
					const pending = this.pendingClipboardTransform;
					if (pending && (Date.now() - pending.timestamp < 3000)) {
						console.log(`[PakCLI] Intercepted electron.clipboard.writeText for "${pending.lang}" (${pending.template})`);
						this.pendingClipboardTransform = null;
						const transformed = this.transformClipboardContent(text, pending.template, pending.lang, pending.replaceExisting !== false);
						new Notice(`[PakCLI] Copied with ${pending.lang} (${this.formatTemplateNoticeLabel(pending.template)}) template!`, 2500);
						return origElectronWrite(transformed, type);
					}
					return origElectronWrite(text, type);
				};
			}
		} catch (e) {
			// ignore
		}
	}

	/** Intercepts clicks on Obsidian's built-in .code-block-flair, .copy-code-button, and custom copy buttons */
	private async handleCodeblockCopyClick(evt: MouseEvent): Promise<void> {
		const target = (evt.target instanceof Element ? evt.target : (evt.target as Node)?.parentElement) as HTMLElement | null;
		if (!target || typeof target.closest !== 'function') return;
		if (target.closest('.suggestion-container, .suggestion, .menu, .modal-container, .prompt')) return;

		// Match ANY copy button, flair element, or icon in Live Preview / Reading View
		const copyBtn = target.closest(
			'.code-block-flair, .copy-code-button, .pakcli-cb-copy-btn, button[aria-label*="Copy" i], button[aria-label*="copy" i], [aria-label*="Copy" i], [aria-label*="copy" i], [class*="code-block-flair"]'
		) as HTMLElement | null;
		if (!copyBtn) return;

		let detectedLang = '';
		let rawCode = '';

		// ─── A. Language Detection ───
		// 1. If copyBtn is or contains .code-block-flair (Obsidian Live Preview)
		const flair = (copyBtn.classList.contains('code-block-flair') ? copyBtn : copyBtn.closest('.code-block-flair')) as HTMLElement | null;
		if (flair && flair.textContent) {
			detectedLang = flair.textContent.trim().toLowerCase().split(/\s+/)[0];
		}

		// 2. From closest pre > code or container (Reading View / Embed block)
		if (!detectedLang) {
			const pre = copyBtn.closest('pre') || copyBtn.closest('.cm-embed-block, .cm-preview-code-block')?.querySelector('pre');
			if (pre) {
				const codeEl = (pre.querySelector('code') ?? pre) as HTMLElement;
				detectedLang = this.getLanguageFromElement(pre, codeEl);
			}
		}

		// 3. From .cm-line.HyperMD-codeblock-begin
		if (!detectedLang) {
			let line = copyBtn.closest('.cm-line') as HTMLElement | null;
			while (line) {
				if (line.classList.contains('HyperMD-codeblock-begin')) {
					const m = (line.textContent || '').match(/`{3,}\s*([a-zA-Z0-9_-]+)/);
					if (m) {
						detectedLang = m[1].toLowerCase();
						break;
					}
				}
				const f = line.querySelector('.code-block-flair');
				if (f?.textContent?.trim()) {
					detectedLang = f.textContent.trim().toLowerCase().split(/\s+/)[0];
					break;
				}
				if (!line.classList.contains('HyperMD-codeblock') && !line.querySelector('.HyperMD-codeblock') && !line.className.includes('codeblock')) {
					break;
				}
				line = line.previousElementSibling as HTMLElement | null;
			}
		}

		// 4. From container class list (e.g. language-powershell, block-language-powershell)
		if (!detectedLang) {
			const block = copyBtn.closest('[class*="language-"], [class*="block-language-"]') as HTMLElement | null;
			if (block) {
				for (const cls of Array.from(block.classList)) {
					const m = cls.match(/^(?:language|block-language)-([a-zA-Z0-9_-]+)$/i);
					if (m) {
						detectedLang = m[1].toLowerCase();
						break;
					}
				}
			}
		}

		console.log(`[PakCLI Copy Click] detectedLang="${detectedLang}"`);

		const rules = this.plugin?.settings?.codeblockLanguageRules || [];
		const matchedRule = this.findMatchingRule(detectedLang, rules);

		if (!matchedRule?.onClipboard?.trim()) {
			this.pendingClipboardTransform = null;
			return; // Native copy without transform
		}

		// Arm safety net for writeText: when Obsidian calls writeText(code), it will be intercepted and transformed!
		this.pendingClipboardTransform = {
			timestamp: Date.now(),
			lang: detectedLang,
			template: matchedRule.onClipboard.trim(),
			replaceExisting: matchedRule.replaceExisting !== false
		};
		console.log(`[PakCLI Copy Click] Armed transform for "${detectedLang}" (${matchedRule.onClipboard}, replaceExisting=${matchedRule.replaceExisting !== false})`);

		// ─── B. Extract rawCode from DOM for 70ms fallback ───
		let beginLine = copyBtn.closest('.cm-line.HyperMD-codeblock-begin, .HyperMD-codeblock-begin') as HTMLElement | null;
		if (!beginLine && flair) {
			beginLine = (flair.closest('.cm-line.HyperMD-codeblock-begin') ||
				flair.previousElementSibling?.closest('.cm-line.HyperMD-codeblock-begin') ||
				flair.nextElementSibling?.closest('.cm-line.HyperMD-codeblock-begin') ||
				flair.parentElement?.querySelector('.cm-line.HyperMD-codeblock-begin')) as HTMLElement | null;
		}

		if (beginLine) {
			const codeLines: string[] = [];
			let nextLine = beginLine.nextElementSibling as HTMLElement | null;
			while (nextLine) {
				if (nextLine.classList.contains('HyperMD-codeblock-end') || nextLine.textContent?.trim().startsWith('```')) {
					break;
				}
				const clone = nextLine.cloneNode(true) as HTMLElement;
				clone.querySelectorAll('.copy-code-button, .pakcli-cb-copy-btn, .code-block-flair, .pakcli-codeblock-flowclip-bar, button').forEach(el => el.remove());
				codeLines.push(clone.textContent ?? '');
				nextLine = nextLine.nextElementSibling as HTMLElement | null;
			}
			rawCode = codeLines.join('\n');
		}

		if (!rawCode) {
			const container = copyBtn.closest('pre') || copyBtn.closest('.cm-embed-block') || copyBtn.closest('.block-language, [class*="block-language"]') || copyBtn.parentElement;
			if (container) {
				const pre = (container.tagName === 'PRE' ? container : container.querySelector('pre')) as HTMLElement | null;
				const codeEl = (pre?.querySelector('code') ?? pre ?? container.querySelector('code') ?? container) as HTMLElement;
				const clone = (codeEl || pre || container).cloneNode(true) as HTMLElement;
				clone.querySelectorAll('.copy-code-button, .pakcli-cb-copy-btn, .code-block-flair, .code-block-header, .pakcli-codeblock-flowclip-bar, button').forEach((el) => el.remove());
				rawCode = clone.textContent ?? '';
			}
		}

		// Visual feedback
		copyBtn.classList.add('pakcli-cb-copy-btn--done');
		setTimeout(() => copyBtn.classList.remove('pakcli-cb-copy-btn--done'), 1500);

		// Fallback timer (70ms): If Obsidian's writeText did not fire, write our transformed rawCode directly
		window.setTimeout(async () => {
			const pending = this.pendingClipboardTransform;
			if (pending && rawCode) {
				console.log('[PakCLI] Fallback writeText triggered from extracted rawCode');
				this.pendingClipboardTransform = null;
				const transformed = this.transformClipboardContent(rawCode, pending.template, pending.lang, pending.replaceExisting !== false);
				if (this.originalClipboardWriteText) {
					await this.originalClipboardWriteText(transformed);
				} else if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(transformed);
				}
				new Notice(`[PakCLI] Copied with ${pending.lang} (${this.formatTemplateNoticeLabel(pending.template)}) template!`, 2500);
			}
		}, 70);
	}

	/** Pre-arms clipboard transform when user right-clicks on code or inside a codeblock */
	private handleCodeblockContextMenu(evt: MouseEvent): void {
		const target = evt.target as HTMLElement | null;
		if (!target) return;

		let lang = '';
		const pre = target.closest('pre') || target.closest('.cm-embed-block, .cm-preview-code-block')?.querySelector('pre');
		if (pre) {
			const codeEl = (pre.querySelector('code') ?? pre) as HTMLElement;
			lang = this.getLanguageFromElement(pre, codeEl);
		}

		if (!lang) {
			let line = target.closest('.cm-line') as HTMLElement | null;
			while (line) {
				if (line.classList.contains('HyperMD-codeblock-begin')) {
					const m = (line.textContent || '').match(/`{3,}\s*([a-zA-Z0-9_-]+)/);
					if (m) {
						lang = m[1].toLowerCase();
						break;
					}
				}
				const flair = line.querySelector('.code-block-flair');
				if (flair?.textContent?.trim()) {
					lang = flair.textContent.trim().toLowerCase().split(/\s+/)[0];
					break;
				}
				if (!line.classList.contains('HyperMD-codeblock') && !line.querySelector('.HyperMD-codeblock') && !line.className.includes('codeblock')) {
					break;
				}
				line = line.previousElementSibling as HTMLElement | null;
			}
		}

		if (!lang) return;
		const rules = this.plugin?.settings?.codeblockLanguageRules || [];
		const rule = this.findMatchingRule(lang, rules);
		if (rule?.onClipboard?.trim()) {
			this.pendingClipboardTransform = {
				timestamp: Date.now(),
				lang,
				template: rule.onClipboard.trim(),
				replaceExisting: rule.replaceExisting !== false
			};
		}
	}

	/** Intercepts keyboard Ctrl+C / Cmd+C inside codeblocks when template is configured */
	private handleCodeblockCopyEvent(evt: ClipboardEvent): void {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

		const anchor = (sel.anchorNode?.parentElement || sel.focusNode?.parentElement) as HTMLElement | null;
		let lang = '';

		// 1. Reading view or embed block: pre code
		const pre = anchor?.closest('pre') || anchor?.closest('.cm-embed-block, .cm-preview-code-block')?.querySelector('pre');
		if (pre) {
			const codeEl = (pre.querySelector('code') ?? pre) as HTMLElement;
			lang = this.getLanguageFromElement(pre, codeEl);
		}

		// 2. Live preview: walk backwards from anchor line to HyperMD-codeblock-begin
		if (!lang) {
			let line = anchor?.closest('.cm-line') as HTMLElement | null;
			while (line) {
				if (line.classList.contains('HyperMD-codeblock-begin')) {
					const m = (line.textContent || '').match(/`{3,}\s*([a-zA-Z0-9_-]+)/);
					if (m) {
						lang = m[1].toLowerCase();
						break;
					}
				}
				const flair = line.querySelector('.code-block-flair');
				if (flair?.textContent?.trim()) {
					lang = flair.textContent.trim().toLowerCase().split(/\s+/)[0];
					break;
				}
				if (!line.classList.contains('HyperMD-codeblock') && !line.querySelector('.HyperMD-codeblock') && !line.className.includes('codeblock')) {
					break;
				}
				line = line.previousElementSibling as HTMLElement | null;
			}
		}

		if (!lang) return;

		const rules = this.plugin?.settings?.codeblockLanguageRules || [];
		const rule = this.findMatchingRule(lang, rules);
		if (!rule?.onClipboard?.trim()) return;

		const selectedText = sel.toString();
		if (!selectedText.trim()) return;

		// Arm writeText safety net for Obsidian's editor:copy command
		this.pendingClipboardTransform = {
			timestamp: Date.now(),
			lang: lang,
			template: rule.onClipboard.trim(),
			replaceExisting: rule.replaceExisting !== false
		};

		const transformed = this.transformClipboardContent(selectedText, rule.onClipboard, lang, rule.replaceExisting !== false);
		if (evt.clipboardData) {
			evt.clipboardData.setData('text/plain', transformed);
			evt.preventDefault();
			new Notice(`[PakCLI] Copied with ${lang} (${this.formatTemplateNoticeLabel(rule.onClipboard)}) template!`, 2000);
		}
	}

	/** Injects (or refreshes) a clipboard button on a rendered pre element. */
	private injectClipboardButton(pre: HTMLElement, codeEl: HTMLElement): void {
		const lang = this.getLanguageFromElement(pre, codeEl);

		const rules = this.plugin?.settings?.codeblockLanguageRules || [];
		const matched = this.findMatchingRule(lang, rules);
		const script = matched?.onClipboard?.trim() || '';

		const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
		const SCRIPT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;

		// If already injected, just refresh icon/title to match current settings
		const existing = pre.querySelector('.pakcli-cb-copy-btn') as HTMLButtonElement | null;
		if (existing) {
			const hasScript = !!script;
			existing.innerHTML = hasScript ? SCRIPT_ICON : COPY_ICON;
			existing.title = hasScript ? `Custom ${lang} clipboard action` : 'Copy code';
			existing.setAttribute('aria-label', hasScript ? `Copy with ${lang} clipboard template` : 'Copy to clipboard');
			return;
		}

		const btn = document.createElement('button');
		btn.className = 'pakcli-cb-copy-btn';

		const hasScript = !!script;
		btn.innerHTML = hasScript ? SCRIPT_ICON : COPY_ICON;
		btn.title = hasScript ? `Custom ${lang} clipboard action` : 'Copy code';
		btn.setAttribute('aria-label', hasScript ? `Copy with ${lang} clipboard template` : 'Copy to clipboard');

		btn.onclick = async (e) => {
			e.stopPropagation();
			const curRules = this.plugin?.settings?.codeblockLanguageRules || [];
			const curRule = this.findMatchingRule(lang, curRules);
			const curScript = curRule?.onClipboard?.trim() || '';

			const clone = (codeEl || pre).cloneNode(true) as HTMLElement;
			clone.querySelectorAll('.copy-code-button, .pakcli-cb-copy-btn, .code-block-flair, .code-block-header, button').forEach((el) => el.remove());
			const content = clone.textContent ?? '';

			const transformed = curScript ? this.transformClipboardContent(content, curScript, lang, curRule?.replaceExisting !== false) : content;

			const flash = () => {
				btn.classList.add('pakcli-cb-copy-btn--done');
				setTimeout(() => btn.classList.remove('pakcli-cb-copy-btn--done'), 1200);
			};

			try {
				this.pendingClipboardTransform = null;
				if (this.originalClipboardWriteText) {
					await this.originalClipboardWriteText(transformed);
				} else {
					await navigator.clipboard.writeText(transformed);
				}
				flash();
				if (curScript) {
					new Notice(`[PakCLI] Copied with ${lang} (${this.formatTemplateNoticeLabel(curScript)}) template!`, 2000);
				}
			} catch {
				const ta = document.createElement('textarea');
				ta.value = transformed;
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.focus();
				ta.select();
				document.execCommand('copy');
				ta.remove();
				flash();
			}
		};

		if (getComputedStyle(pre).position === 'static') {
			pre.style.position = 'relative';
		}
		pre.appendChild(btn);
	}

	private processCmLines(cmLines: NodeListOf<Element>): void {
		let currentBlockLines: HTMLElement[] = [];
		let currentLanguage = '';

		const flushBlock = () => {
			if (currentBlockLines.length === 0) return;

			const behavior = this.getBehaviorForLanguage(currentLanguage);

			// Clean up any old injected bars from previous versions
			currentBlockLines.forEach((line) => {
				const oldBar = line.querySelector('.pakcli-codeblock-flowclip-bar');
				if (oldBar) oldBar.remove();
			});

			if (behavior === 'wrap') {
				currentBlockLines.forEach((line) => {
					line.classList.remove('pakcli-codeblock-line-flowclip', 'pakcli-codeblock-line-scalefit', 'pakcli-codeblock-end-scroll');
					line.classList.add('pakcli-codeblock-wrap');
					line.style.setProperty('contain', 'none', 'important');
					line.style.setProperty('white-space', 'pre-wrap', 'important');
					line.style.setProperty('word-break', 'break-all', 'important');
					line.style.setProperty('overflow-wrap', 'anywhere', 'important');
					line.style.setProperty('word-wrap', 'break-word', 'important');
					line.style.setProperty('overflow-x', 'hidden', 'important');
					line.style.setProperty('max-width', '100%', 'important');
					line.style.setProperty('width', 'auto', 'important');
					line.style.setProperty('min-width', '0', 'important');
					line.style.setProperty('box-sizing', 'border-box', 'important');
					line.style.removeProperty('--codeblock-scroll-width');
					line.scrollLeft = 0;

					const oldHandler = (line as any)._pakcliScrollHandler;
					if (oldHandler) {
						line.removeEventListener('scroll', oldHandler);
						(line as any)._pakcliScrollHandler = null;
					}
				});
			} else if (behavior === 'scalefit') {
				currentBlockLines.forEach((line) => {
					line.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-line-flowclip', 'pakcli-codeblock-end-scroll');
					line.classList.add('pakcli-codeblock-line-scalefit');
					line.style.setProperty('contain', 'none', 'important');
					line.style.setProperty('white-space', 'pre', 'important');
					line.style.setProperty('font-size', 'min(var(--code-size, 13px), 2.2vw)', 'important');
					line.style.setProperty('overflow-x', 'auto', 'important');
					line.style.setProperty('max-width', '100%', 'important');
					line.style.setProperty('width', 'auto', 'important');
					line.style.setProperty('min-width', '0', 'important');
					line.style.setProperty('box-sizing', 'border-box', 'important');
					line.style.removeProperty('--codeblock-scroll-width');
				});
			} else if (this.flowclipMode === 'per-line') {
				// Mode 3: 1 line flowing 1 slider bar
				currentBlockLines.forEach((line) => {
					// Clean up any sticky bars
					if ((line as any)._pakcliStickyBar) {
						(line as any)._pakcliStickyBar.remove();
						(line as any)._pakcliStickyBar = null;
						(line as any)._pakcliStickyPositionBar = null;
						(line as any)._pakcliBindLineScroll = null;
					}
					line.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-line-scalefit', 'pakcli-codeblock-line-all-synced', 'pakcli-codeblock-line-flowclip', 'pakcli-codeblock-end-scroll');
					line.classList.add('pakcli-codeblock-line-per-line');
					line.style.setProperty('contain', 'none', 'important');
					line.style.setProperty('white-space', 'pre', 'important');
					line.style.setProperty('word-break', 'normal', 'important');
					line.style.setProperty('word-wrap', 'normal', 'important');
					line.style.setProperty('overflow-x', 'auto', 'important');
					line.style.setProperty('overflow-y', 'hidden', 'important');
					line.style.setProperty('max-width', '100%', 'important');
					line.style.setProperty('width', 'auto', 'important');
					line.style.setProperty('min-width', '0', 'important');
					line.style.setProperty('box-sizing', 'border-box', 'important');
					line.style.removeProperty('--codeblock-scroll-width');

					// Save & restore state for per-line
					const filePath = this.plugin.app.workspace.getActiveFile()?.path || 'unknown';
					const snippet = (line.textContent || '').trim().substring(0, 30).replace(/\s+/g, '_');
					const key = `${filePath}::line::${snippet}`;
					const savedPct = this.getSavedScrollPct(key);
					if (savedPct > 0) {
						const maxScroll = line.scrollWidth - line.clientWidth;
						if (maxScroll > 0) line.scrollLeft = Math.round(savedPct * maxScroll);
					}
					const oldHandler = (line as any)._pakcliPerLineScroll;
					if (oldHandler) line.removeEventListener('scroll', oldHandler);
					const handler = () => {
						const maxScroll = line.scrollWidth - line.clientWidth;
						if (maxScroll > 0) this.saveScrollState(key, line.scrollLeft / maxScroll);
					};
					(line as any)._pakcliPerLineScroll = handler;
					line.addEventListener('scroll', handler, { passive: true });
				});
			} else {
				// Mode 1 ('all-lines') or Mode 2 ('current'): 1 bottom slider bar
				// First reset padding-right and --codeblock-scroll-width to accurately read natural text widths
				currentBlockLines.forEach((l) => {
					l.style.removeProperty('padding-right');
					l.style.removeProperty('--codeblock-scroll-width');
				});

				let maxScrollWidth = 0;
				currentBlockLines.forEach((l) => {
					if (l.scrollWidth > maxScrollWidth) maxScrollWidth = l.scrollWidth;
				});

				const isAllLines = this.flowclipMode === 'all-lines';

				currentBlockLines.forEach((line) => {
					line.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-line-scalefit', 'pakcli-codeblock-line-per-line', 'pakcli-codeblock-end-scroll');
					line.classList.add('pakcli-codeblock-line-flowclip');
					line.style.setProperty('contain', 'none', 'important');
					line.style.setProperty('white-space', 'pre', 'important');
					line.style.setProperty('word-break', 'normal', 'important');
					line.style.setProperty('word-wrap', 'normal', 'important');
					line.style.setProperty('overflow-x', 'auto', 'important');
					line.style.setProperty('overflow-y', 'hidden', 'important');
					line.style.setProperty('max-width', '100%', 'important');
					line.style.setProperty('width', 'auto', 'important');
					line.style.setProperty('min-width', '0', 'important');

					if (isAllLines) {
						// Mode 1: 1 slider controls all lines together as a whole block
						// Set box-sizing content-box and padding-right to maxScrollWidth so
						// EVERY line's scrollWidth >= maxScrollWidth and all lines scroll in lockstep
						line.classList.add('pakcli-codeblock-line-all-synced');
						line.style.setProperty('box-sizing', 'content-box', 'important');
						line.style.setProperty('padding-right', `${maxScrollWidth}px`, 'important');
						line.style.setProperty('--codeblock-scroll-width', `${maxScrollWidth}px`);
					} else {
						// Mode 2: current (flowing lines only)
						line.classList.remove('pakcli-codeblock-line-all-synced');
						line.style.setProperty('box-sizing', 'border-box', 'important');
						line.style.removeProperty('padding-right');
						line.style.removeProperty('--codeblock-scroll-width');
					}
				});

				const lastLine = currentBlockLines[currentBlockLines.length - 1];
				this.injectStickyBarForCmBlock(lastLine, currentBlockLines);
			}

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

	/**
	 * Injects a fixed-position scrollbar for a Live Preview CodeMirror codeblock.
	 * Anchored to the bottom line (lastLine) of the codeblock.
	 * Sits strictly at the bottom of the codeblock and shares identical mechanics with Reading View.
	 */
	private injectStickyBarForCmBlock(lastLine: HTMLElement, blockLines: HTMLElement[]): void {
		// Clean up any old bars previously attached to earlier lines in this exact block
		for (const l of blockLines) {
			if (l !== lastLine && (l as any)._pakcliStickyBar) {
				const oldBar = (l as any)._pakcliStickyBar as HTMLElement;
				oldBar.remove();
				(l as any)._pakcliStickyBar = null;
				(l as any)._pakcliStickyPositionBar = null;
				(l as any)._pakcliBindLineScroll = null;
			}
		}

		// Store updated lines for this codeblock
		(lastLine as any)._pakcliBlockLines = blockLines.slice();

		// Add padding-bottom to lastLine so text/backticks are not covered by the 14px bar
		lastLine.style.setProperty('padding-bottom', `${CodeblockScaler.BAR_H}px`, 'important');
		lastLine.style.setProperty('box-sizing', 'content-box', 'important');

		// If already inited, bind any new lines and refresh the bar position
		if ((lastLine as any)._pakcliStickyBar) {
			const bindFn: ((line: HTMLElement) => void) | undefined = (lastLine as any)._pakcliBindLineScroll;
			if (bindFn) blockLines.forEach(bindFn);
			const fn: (() => void) | undefined = (lastLine as any)._pakcliStickyPositionBar;
			if (fn) fn();
			return;
		}

		// Build fixed bar
		const bar = document.createElement('div');
		bar.className = 'pakcli-cb-sticky-bar pakcli-cb-sticky-bar--fixed';
		const inner = document.createElement('div');
		inner.className = 'pakcli-cb-sticky-inner';
		bar.appendChild(inner);
		document.body.appendChild(bar);
		(bar as any)._pakcliAnchor = lastLine;
		(lastLine as any)._pakcliStickyBar = bar;

		const BAR_H = CodeblockScaler.BAR_H;

		const cleanup = () => {
			window.removeEventListener('scroll', onWindowScroll, true);
			window.removeEventListener('resize', positionBar);
			io.disconnect();
			(lastLine as any)._pakcliResizeObserver?.disconnect();
			(lastLine as any)._pakcliStickyBar = null;
			(lastLine as any)._pakcliStickyPositionBar = null;
			(lastLine as any)._pakcliBindLineScroll = null;
		};

		const positionBar = () => {
			if (!this.isElementVisibleInActiveView(lastLine)) {
				bar.style.setProperty('display', 'none', 'important');
				if (!lastLine.isConnected) {
					bar.remove();
					cleanup();
				}
				return;
			}

			const lines: HTMLElement[] = (lastLine as any)._pakcliBlockLines || [lastLine];
			const lastLineRect = lastLine.getBoundingClientRect();
			const viewH = window.innerHeight;
			const blockBottom = lastLineRect.bottom;
			const isVisible = blockBottom >= BAR_H && blockBottom <= viewH + BAR_H;

			// Dynamically compute max scrollWidth across all lines
			let maxScrollWidth = 0;
			const lineW = lastLineRect.width;
			for (const l of lines) {
				if (l.scrollWidth > maxScrollWidth) maxScrollWidth = l.scrollWidth;
			}
			const hasOverflow = lineW > 0 && maxScrollWidth > lineW + 2;

			if (!isVisible || !hasOverflow) {
				bar.style.setProperty('display', 'none', 'important');
				return;
			}

			const barTop = blockBottom - BAR_H;

			bar.style.setProperty('display', 'block', 'important');
			bar.style.setProperty('left', `${lastLineRect.left}px`, 'important');
			bar.style.setProperty('width', `${lineW}px`, 'important');
			bar.style.setProperty('top', `${barTop}px`, 'important');
			inner.style.setProperty('width', `${maxScrollWidth}px`, 'important');
		};
		(lastLine as any)._pakcliStickyPositionBar = positionBar;

		// Two-way scroll sync with 50ms guard
		let isSyncing = false;
		let syncTimeout: number | null = null;
		const setSyncing = () => {
			isSyncing = true;
			if (syncTimeout !== null) window.clearTimeout(syncTimeout);
			syncTimeout = window.setTimeout(() => {
				isSyncing = false;
				syncTimeout = null;
			}, 50);
		};

		const syncLines = (scrollLeft: number) => {
			setSyncing();
			const lines: HTMLElement[] = (lastLine as any)._pakcliBlockLines || [];
			for (const l of lines) {
				if (l.scrollLeft !== scrollLeft) l.scrollLeft = scrollLeft;
			}
		};

		const filePath = this.plugin.app.workspace.getActiveFile()?.path || 'unknown';
		const snippet = (blockLines[0]?.textContent || '').trim().substring(0, 30).replace(/\s+/g, '_');
		const key = `${filePath}::cm::${snippet}`;

		// Restore saved scroll percentage
		const savedPct = this.getSavedScrollPct(key);
		if (savedPct > 0) {
			window.requestAnimationFrame(() => {
				const lines: HTMLElement[] = (lastLine as any)._pakcliBlockLines || [lastLine];
				let maxW = 0;
				for (const l of lines) if (l.scrollWidth > maxW) maxW = l.scrollWidth;
				const maxScroll = maxW - lastLine.getBoundingClientRect().width;
				if (maxScroll > 0) {
					const target = Math.round(savedPct * maxScroll);
					bar.scrollLeft = target;
					syncLines(target);
				}
			});
		}

		bar.addEventListener('scroll', () => {
			if (isSyncing) return;
			syncLines(bar.scrollLeft);
			const lines: HTMLElement[] = (lastLine as any)._pakcliBlockLines || [lastLine];
			let maxW = 0;
			for (const l of lines) if (l.scrollWidth > maxW) maxW = l.scrollWidth;
			const maxScroll = maxW - lastLine.getBoundingClientRect().width;
			if (maxScroll > 0) {
				this.saveScrollState(key, bar.scrollLeft / maxScroll);
			}
		}, { passive: true });

		const bindLineScroll = (line: HTMLElement) => {
			const oldHandler = (line as any)._pakcliScrollHandler;
			if (oldHandler) line.removeEventListener('scroll', oldHandler);
			const handler = () => {
				if (isSyncing) return;
				setSyncing();
				bar.scrollLeft = line.scrollLeft;
				const lines: HTMLElement[] = (lastLine as any)._pakcliBlockLines || [];
				for (const l of lines) {
					if (l !== line && l.scrollLeft !== line.scrollLeft) {
						l.scrollLeft = line.scrollLeft;
					}
				}
				const maxScroll = line.scrollWidth - line.clientWidth;
				if (maxScroll > 0) {
					this.saveScrollState(key, line.scrollLeft / maxScroll);
				}
			};
			(line as any)._pakcliScrollHandler = handler;
			line.addEventListener('scroll', handler, { passive: true });
		};
		(lastLine as any)._pakcliBindLineScroll = bindLineScroll;
		blockLines.forEach(bindLineScroll);

		const onWindowScroll = (e: Event) => {
			const t = e.target as HTMLElement;
			const lines: HTMLElement[] = (lastLine as any)._pakcliBlockLines || [];
			if (t === bar || lines.includes(t) || bar.contains(t)) return;
			positionBar();
		};

		window.addEventListener('scroll', onWindowScroll, { passive: true, capture: true });
		window.addEventListener('resize', positionBar, { passive: true });

		const io = new IntersectionObserver(() => positionBar(), { threshold: 0 });
		io.observe(lastLine);

		if (typeof ResizeObserver !== 'undefined') {
			const ro = new ResizeObserver(positionBar);
			ro.observe(lastLine);
			const scroller = lastLine.closest('.cm-scroller, .cm-content');
			if (scroller) ro.observe(scroller);
			(lastLine as any)._pakcliResizeObserver = ro;
		}

		bar.scrollLeft = blockLines.find((l) => l.scrollLeft > 0)?.scrollLeft || 0;
		positionBar();
		window.requestAnimationFrame(positionBar);
		window.setTimeout(positionBar, 150);
		window.setTimeout(positionBar, 700);
	}

	destroy(): void {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.cmStickyBars = [];
		// Clean up all sticky bar elements
		document.querySelectorAll('.pakcli-codeblock-flowclip-bar, .pakcli-cb-sticky-bar').forEach((el) => el.remove());
	}
}
