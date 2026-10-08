import { MarkdownView, Notice } from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type PakCLIPlugin from '../../main';
import { SanitizerEngine } from '../sanitizer';

export interface CodeblockLanguageRule {
	id: string;
	language: string;
	behavior: 'scalefit' | 'flowclip' | 'wrap';
	/** Whether this rule is currently enabled/active */
	enabled?: boolean;
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
				scaler.processContainer(view.dom, view);
			}
			update(update: ViewUpdate) {
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.geometryChanged ||
					update.heightChanged ||
					update.focusChanged ||
					update.selectionSet
				) {
					scaler.processContainer(update.view.dom, update.view);
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
	private queuedRescale = false;
	private debounceTimer: number | null = null;
	private observer: MutationObserver | null = null;
	private pendingClipboardTransform: { timestamp: number; lang: string; template: string; replaceExisting?: boolean } | null = null;
	private cmStickyBars: StickyBarEntry[] = [];
	private blockMaxScrollWidthCache = new Map<string, number>();
	private blockCurrentScrollLeft = new Map<string, number>();
	private activeCmBars = new Map<string, HTMLElement>();
	private isSyncingAllLines = false;

	constructor(private plugin: PakCLIPlugin) { }

	init(): void {
		// Clean up any stale/orphaned bars from previous reloads or hot module replacements
		document.querySelectorAll('.pakcli-codeblock-flowclip-bar, .pakcli-cb-sticky-bar, .pakcli-codeblock-slider-bar').forEach((el) => el.remove());
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
			this.plugin.app.workspace.on('layout-change', () => {
				this.hideOrCleanAllBars();
				this.scheduleRescale();
			})
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => {
				this.hideOrCleanAllBars();
				this.scheduleRescale();
			})
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', () => {
				this.hideOrCleanAllBars();
				this.scheduleRescale();
			})
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
		const clampedPct = Math.max(0, Math.min(1, pct || 0));
		this.plugin.settings.flowclipScrollStates[key] = Math.round(clampedPct * 1000) / 1000;
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

		// 2. Source Mode check: EDITMODE SOURCEMODE = NO NEED SLIDER
		const sourceViewEl = el.closest('.markdown-source-view');
		if (sourceViewEl && !sourceViewEl.classList.contains('is-live-preview')) {
			return false;
		}

		// 3. Find the owning leaf across all workspace leaves
		let ownerLeaf: any = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (!ownerLeaf && leaf.view?.containerEl?.contains(el)) {
				ownerLeaf = leaf;
			}
		});

		if (ownerLeaf) {
			// If this leaf has a tab header, it MUST be the active tab in its tab group
			if (ownerLeaf.tabHeaderEl && !ownerLeaf.tabHeaderEl.classList.contains('is-active')) {
				return false;
			}

			// If the leaf container itself is hidden (e.g. background tab), reject
			const leafContainer = ownerLeaf.containerEl || ownerLeaf.view?.containerEl;
			if (!leafContainer || leafContainer.offsetParent === null) return false;
			const csContainer = window.getComputedStyle(leafContainer);
			if (csContainer.display === 'none' || csContainer.visibility === 'hidden') return false;

			const ownerView = ownerLeaf.view;
			if (ownerView instanceof MarkdownView) {
				// If view is explicitly in source mode (raw markdown):
				if ((ownerView as any).currentMode?.sourceMode === true) {
					return false; // EDITMODE SOURCEMODE = NO NEED SLIDER
				}

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
			}
		} else {
			// Fallback: Check standard DOM hierarchy (e.g. popover preview)
			const popover = el.closest('.popover');
			if (!popover || (popover as HTMLElement).offsetParent === null) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Immediately hides or cleans up all floating bars (both reading-view and live-preview)
	 * whose anchor is detached, not visible, or belongs to an inactive tab.
	 */
	hideOrCleanAllBars(): void {
		document.querySelectorAll<HTMLElement>('.pakcli-cb-sticky-bar').forEach((bar) => {
			const anchor = (bar as any)._pakcliAnchor as HTMLElement | undefined;
			if (!anchor || !anchor.isConnected) {
				bar.remove();
			} else if (!this.isElementVisibleInActiveView(anchor)) {
				bar.style.setProperty('display', 'none', 'important');
			}
		});

		document.querySelectorAll<HTMLElement>('.pakcli-codeblock-slider-bar').forEach((bar) => {
			const anchor = (bar as any)._pakcliAnchorLine as HTMLElement | undefined;
			if (!anchor || !anchor.isConnected) {
				bar.remove();
			} else if (!this.isElementVisibleInActiveView(anchor)) {
				bar.style.setProperty('display', 'none', 'important');
			}
		});
	}

	rescaleAll(): void {
		if (this.isProcessing) {
			this.queuedRescale = true;
			return;
		}
		this.isProcessing = true;

		try {
			if (this.flowclipMode === 'per-line') {
				// In per-line mode, remove all floating sticky bars
				document.querySelectorAll<HTMLElement>('.pakcli-cb-sticky-bar, .pakcli-codeblock-slider-bar').forEach((bar) => bar.remove());
				this.activeCmBars.clear();
			} else {
				this.hideOrCleanAllBars();
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
			if (this.queuedRescale) {
				this.queuedRescale = false;
				setTimeout(() => this.rescaleAll(), 20);
			}
			if ((this.plugin.settings as any).codeblockDebug) this.dumpDebugInfo();
		}
	}

	/** Clears all element caches, marks all blocks dirty, and forces a full re-evaluation. */
	refreshAll(): void {
		this.clearCache();
		document.querySelectorAll('pre[data-pakcli-behavior]').forEach((pre) => {
			pre.removeAttribute('data-pakcli-behavior');
		});
		this.rescaleAll();
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

			const jsonStr = JSON.stringify(data, null, 2);

			// 1. Clean up legacy root debug_codeblock.json if it exists so it won't appear in root vault
			try {
				if (await this.plugin.app.vault.adapter.exists('debug_codeblock.json')) {
					await this.plugin.app.vault.adapter.remove('debug_codeblock.json');
				}
			} catch (_) {}

			// 2. Write to vault artifacts folder (ensure directory exists)
			try {
				if (!(await this.plugin.app.vault.adapter.exists('artifacts'))) {
					await this.plugin.app.vault.createFolder('artifacts').catch(() => {});
				}
				await this.plugin.app.vault.adapter.write('artifacts/debug_codeblock.json', jsonStr);
			} catch (_) {}
		} catch (err) {
			console.warn('[PakCLI Scaler] dumpDebugInfo error:', err);
		}
	}

	findMatchingRule(lang: string, rules: CodeblockLanguageRule[]): CodeblockLanguageRule | null {
		const activeRules = (rules || []).filter((r) => r.enabled !== false);
		const cleanLang = (lang || '').trim().toLowerCase();
		const wildcard = activeRules.find((r) => ['*', 'all', 'default'].includes((r.language || '').trim().toLowerCase())) || null;
		if (!cleanLang) return wildcard;
		const specific = this.findSpecificRule(cleanLang, activeRules);
		return specific || wildcard;
	}

	private findSpecificRule(cleanLang: string, rules: CodeblockLanguageRule[]): CodeblockLanguageRule | null {

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
			return matched.behavior;
		}

		// 3. If not configured in Per-Language Rules, strictly fallback to default codeblock wrap mode
		return defaultBehavior;
	}

	getLanguageFromElement(preEl: HTMLElement, codeEl: HTMLElement): string {
		const isIgnored = (l: string) => {
			const s = (l || '').trim().toLowerCase();
			return !s || s === 'hypermd' || s === 'none' || s === 'null' || s === 'undefined' || s === 'copy';
		};

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
		if (dataLang && !isIgnored(dataLang)) {
			return dataLang.trim().toLowerCase();
		}

		// 2. Check classes on preEl, parentElement, block-language wrapper, embed block, or codeEl
		// Priority: Check specific language tags on preEl and parent first (they hold the real block-language-xxx)
		const elementsToCheck = [
			preEl,
			preEl.parentElement,
			preEl.closest('[class*="block-language-"]'),
			preEl.closest('.cm-embed-block'),
			codeEl,
			preEl.closest('[class*="language-"]')
		].filter(Boolean) as HTMLElement[];

		for (const el of elementsToCheck) {
			for (const cls of Array.from(el.classList)) {
				const m = cls.match(/^(?:language|block-language|cm-lang)-([a-zA-Z0-9_-]+)$/i);
				if (m && !isIgnored(m[1])) {
					return m[1].toLowerCase();
				}
			}
		}

		// 3. Check any badge / flair / header element inside the block wrapper
		const wrapper = preEl.closest('.cm-embed-block, .block-language, [class*="block-language"]') || preEl.parentElement;
		const flair = wrapper?.querySelector('.code-block-flair, .code-block-language, .code-language, .code-block-header span');
		if (flair && flair.textContent) {
			const tag = flair.textContent.trim().toLowerCase();
			if (tag && tag.length < 40 && !isIgnored(tag)) {
				return tag;
			}
		}

		return '';
	}

	getBehaviorForElement(preEl: HTMLElement, codeEl: HTMLElement): 'scalefit' | 'flowclip' | 'wrap' {
		const lang = this.getLanguageFromElement(preEl, codeEl);
		return this.getBehaviorForLanguage(lang);
	}

	processContainer(container: HTMLElement, editorView?: EditorView): void {
		// If inside raw Source Mode, user requested: EDITMODE SOURCEMODE = NO NEED SLIDER
		const sourceViewEl = container.closest('.markdown-source-view') || (container.matches?.('.markdown-source-view') ? container : null);
		if (sourceViewEl && !sourceViewEl.classList.contains('is-live-preview')) {
			return;
		}

		if (!editorView) {
			const activeMdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeMdView && activeMdView.containerEl.contains(container)) {
				editorView = (activeMdView.editor as any)?.cm as EditorView | undefined;
			}
		}

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

			// Behavior changed since last pass (rule edit / default mode switch): wipe every inline style
			// the previous behavior set, otherwise stale !important styles override the new behavior.
			const prevBehavior = pre.getAttribute('data-pakcli-behavior');
			if (prevBehavior !== behavior) {
				this.resetPreInlineStyles(pre, codeEl);
				pre.setAttribute('data-pakcli-behavior', behavior);
			}
			if (behavior !== 'flowclip' && (pre as any)._pakcliStickyBar) {
				(pre as any)._pakcliStickyBar.remove();
				(pre as any)._pakcliStickyBar = null;
				(pre as any)._pakcliStickyPositionBar = null;
			}

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

		// 2. Live Preview CodeMirror lines
		const cmContents = container.matches?.('.cm-content')
			? [container]
			: Array.from(container.querySelectorAll?.('.cm-content') ?? []);

		if (cmContents.length > 0) {
			for (const content of cmContents) {
				const lines = Array.from(content.querySelectorAll('.cm-line')) as HTMLElement[];
				if (lines.length > 0) {
					const ev = editorView || (content.closest('.cm-editor') as any)?.cmView?.view;
					this.processCmLines(lines, ev);
				}
			}
		} else {
			const cmLine = container.closest?.('.cm-line') || (container.matches?.('.cm-line') ? container : null);
			if (cmLine) {
				const content = cmLine.closest('.cm-content');
				if (content) {
					const lines = Array.from(content.querySelectorAll('.cm-line')) as HTMLElement[];
					const ev = editorView || (content.closest('.cm-editor') as any)?.cmView?.view;
					this.processCmLines(lines, ev);
				}
			} else {
				const lines = Array.from(container.querySelectorAll('.cm-line')) as HTMLElement[];
				if (lines.length > 0) {
					this.processCmLines(lines, editorView);
				}
			}
		}
	}

	/** Removes every inline style the scaler may have set on a <pre> block (and its wrappers). */
	private resetPreInlineStyles(pre: HTMLElement, codeEl: HTMLElement): void {
		const props = [
			'white-space', 'word-break', 'word-wrap', 'overflow-wrap', 'overflow', 'overflow-x', 'overflow-y',
			'max-width', 'width', 'min-width', 'box-sizing', 'contain', 'display', 'padding-bottom',
			'scrollbar-width', '-ms-overflow-style', 'font-size'
		];
		const targets: Array<HTMLElement | null | undefined> = [
			pre,
			codeEl !== pre ? codeEl : null,
			pre.parentElement,
			pre.closest('.cm-embed-block') as HTMLElement | null
		];
		for (const t of targets) {
			if (!t) continue;
			for (const p of props) t.style.removeProperty(p);
		}
		pre.classList.remove('pakcli-codeblock-flowclip-native');
		const oldHandler = (pre as any)._pakcliPreNativeScroll;
		if (oldHandler) {
			pre.removeEventListener('scroll', oldHandler);
			(pre as any)._pakcliPreNativeScroll = null;
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
		if (this.flowclipMode === 'per-line') return;
		if (!pre || !pre.isConnected) return;

		// ONLY connected Reading View (.markdown-rendered) codeblocks get sticky bars for <pre>.
		// Live Preview codeblocks are handled exclusively by CodeMirror line logic.
		if (pre.closest('.markdown-source-view, .cm-editor') || !pre.closest('.markdown-rendered')) {
			if ((pre as any)._pakcliStickyBar) {
				(pre as any)._pakcliStickyBar.remove();
				(pre as any)._pakcliStickyBar = null;
			}
			return;
		}

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
			if (this.flowclipMode === 'per-line') {
				bar.style.setProperty('display', 'none', 'important');
				return;
			}
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
			const isVisible = rect.top < viewH && rect.bottom > 0;
			if (!hasOverflow || !isVisible) {
				bar.style.setProperty('display', 'none', 'important');
				return;
			}

			// Position at bottom of the codeblock (clamped to viewport bottom if block extends below)
			const barTop = Math.min(rect.bottom, viewH) - BAR_H;

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
	unwrapExistingWrapper(content: string, allowPlainBraces: boolean = true): string {
		const s = (content || '').replace(/\r\n/g, '\n').trim();
		if (!s) return content;

		// 1. .{\n ... \n} or .{ ... }
		const dotMatch = s.match(/^\.\s*\{([\s\S]*)\}\s*$/);
		if (dotMatch) {
			return this.unindentLines(dotMatch[1]);
		}

		// 2. @{\n ... \n} or @{ ... }
		const ampMatch = s.match(/^&\s*\{([\s\S]*)\}\s*$/);
		if (ampMatch) {
			return this.unindentLines(ampMatch[1]);
		}

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
		const braceMatch = allowPlainBraces ? s.match(/^\{([\s\S]*)\}\s*$/) : null;
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

		// Presets (`invoke`/`dot`/`at`) + replaceExisting: strip an existing .{} / @{} / {}.invoke() wrapper first.
		// For non-PowerShell languages plain `{ }` is NOT stripped (it is legitimate code, e.g. JS objects).
		const tl = (template || '').trim();
		const isPresetTemplate = ['invoke', 'dot', 'at', 'amp', '{}.invoke()', '{}.invoke', '.{}', '@{}', '&{}'].includes(tl) || /\{\s*\}\s*\.?\s*in[vc]oke/i.test(tl);
		if (replaceExisting && (isPowerShell || isPresetTemplate)) {
			raw = this.unwrapExistingWrapper(raw, isPowerShell);
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
		const isAmp = t === 'amp' || t === '&{}' || /^\s*&\s*\{\s*\}\s*$/i.test(t);
		const isAt = t === 'at' || t === '@{}' || t === '@ prefix' || /^\s*@\s*\{\s*\}\s*$/i.test(t) || t.includes("'@'");

		// Presets emit the script UNINDENTED (indenting would corrupt here-strings / multi-line literals)
		if (isInvoke) {
			return `{\n${raw}\n}.invoke()`;
		}
		if (isDot) {
			return `.{\n${raw}\n}`;
		}
		if (isAmp) {
			return `&{\n${raw}\n}`;
		}
		if (isAt) {
			return `@{\n${raw}\n}`;
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
		if (t === 'amp' || t === '&{}') return '&{}';
		if (t === 'at' || t === '@{}' || t.includes('@ prefix')) return '@{}';
		return t;
	}

	/** Sanitizes clipboard text according to active String Sanitizer rules */
	public applyClipboardSanitizer(text: string): { text: string; replacementsCount: number } {
		try {
			const settings = this.plugin?.settings?.stringSanitizerSettings;
			if (!settings?.masterEnabled || !settings?.enableClipboardSanitizer) {
				return { text, replacementsCount: 0 };
			}
			const rules = settings.rules || [];
			const res = SanitizerEngine.sanitizeText(text, rules, (r) => r.affectClipboard);
			return { text: res.text, replacementsCount: res.replacementsCount };
		} catch (err) {
			console.warn('[PakCLI] Error in applyClipboardSanitizer:', err);
			return { text, replacementsCount: 0 };
		}
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
					let finalText = text;
					const pending = this.pendingClipboardTransform;
					if (pending && (Date.now() - pending.timestamp < 3000)) {
						console.log(`[PakCLI] Intercepted navigator.clipboard.writeText for "${pending.lang}" (${pending.template})`);
						this.pendingClipboardTransform = null;
						finalText = this.transformClipboardContent(text, pending.template, pending.lang, pending.replaceExisting !== false);
						new Notice(`[PakCLI] Copied with ${pending.lang} (${this.formatTemplateNoticeLabel(pending.template)}) template!`, 2500);
					}
					const sanitized = this.applyClipboardSanitizer(finalText);
					if (sanitized.replacementsCount > 0) {
						new Notice(`🛡️ Sanitized ${sanitized.replacementsCount} string(s) in clipboard!`, 2500);
					}
					return originalWriteText(sanitized.text);
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
					let finalText = text;
					const pending = this.pendingClipboardTransform;
					if (pending && (Date.now() - pending.timestamp < 3000)) {
						console.log(`[PakCLI] Intercepted activeDoc writeText for "${pending.lang}" (${pending.template})`);
						this.pendingClipboardTransform = null;
						finalText = this.transformClipboardContent(text, pending.template, pending.lang, pending.replaceExisting !== false);
						new Notice(`[PakCLI] Copied with ${pending.lang} (${this.formatTemplateNoticeLabel(pending.template)}) template!`, 2500);
					}
					const sanitized = this.applyClipboardSanitizer(finalText);
					if (sanitized.replacementsCount > 0) {
						new Notice(`🛡️ Sanitized ${sanitized.replacementsCount} string(s) in clipboard!`, 2500);
					}
					return origDocWrite(sanitized.text);
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
					let finalText = text;
					const pending = this.pendingClipboardTransform;
					if (pending && (Date.now() - pending.timestamp < 3000)) {
						console.log(`[PakCLI] Intercepted electron.clipboard.writeText for "${pending.lang}" (${pending.template})`);
						this.pendingClipboardTransform = null;
						finalText = this.transformClipboardContent(text, pending.template, pending.lang, pending.replaceExisting !== false);
						new Notice(`[PakCLI] Copied with ${pending.lang} (${this.formatTemplateNoticeLabel(pending.template)}) template!`, 2500);
					}
					const sanitized = this.applyClipboardSanitizer(finalText);
					if (sanitized.replacementsCount > 0) {
						new Notice(`🛡️ Sanitized ${sanitized.replacementsCount} string(s) in clipboard!`, 2500);
					}
					return origElectronWrite(sanitized.text, type);
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

		const isIgnored = (l: string) => {
			const s = (l || '').trim().toLowerCase();
			return !s || s === 'hypermd' || s === 'none' || s === 'null' || s === 'undefined' || s === 'copy';
		};

		let detectedLang = '';
		let rawCode = '';

		// ─── A. Language Detection ───
		// 1. If copyBtn is or contains .code-block-flair (Obsidian Live Preview)
		const flair = (copyBtn.classList.contains('code-block-flair') ? copyBtn : copyBtn.closest('.code-block-flair')) as HTMLElement | null;
		if (flair && flair.textContent) {
			const tag = flair.textContent.trim().toLowerCase().split(/\s+/)[0];
			if (!isIgnored(tag)) detectedLang = tag;
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
					if (m && !isIgnored(m[1])) {
						detectedLang = m[1].toLowerCase();
						break;
					}
				}
				const f = line.querySelector('.code-block-flair');
				if (f?.textContent?.trim()) {
					const tag = f.textContent.trim().toLowerCase().split(/\s+/)[0];
					if (!isIgnored(tag)) {
						detectedLang = tag;
						break;
					}
				}
				if (!line.classList.contains('HyperMD-codeblock') && !line.querySelector('.HyperMD-codeblock') && !line.className.includes('codeblock')) {
					break;
				}
				line = line.previousElementSibling as HTMLElement | null;
			}
		}

		// 4. From container class list (e.g. language-powershell, block-language-powershell, cm-lang-powershell)
		if (!detectedLang) {
			const block = copyBtn.closest('[class*="language-"], [class*="block-language-"], [class*="cm-lang-"]') as HTMLElement | null;
			if (block) {
				for (const cls of Array.from(block.classList)) {
					const m = cls.match(/^(?:language|block-language|cm-lang)-([a-zA-Z0-9_-]+)$/i);
					if (m && !isIgnored(m[1])) {
						detectedLang = m[1].toLowerCase();
						break;
					}
				}
			}
		}

		// ─── B. Extract rawCode from DOM or Editor ───
		let beginLine = copyBtn.closest('.cm-line.HyperMD-codeblock-begin, .HyperMD-codeblock-begin') as HTMLElement | null;
		if (!beginLine && flair) {
			beginLine = (flair.closest('.cm-line.HyperMD-codeblock-begin') ||
				flair.previousElementSibling?.closest('.cm-line.HyperMD-codeblock-begin') ||
				flair.nextElementSibling?.closest('.cm-line.HyperMD-codeblock-begin') ||
				flair.parentElement?.querySelector('.cm-line.HyperMD-codeblock-begin')) as HTMLElement | null;
		}

		// Primary source: editor document (exact text, independent of virtualized DOM / flowclip styling)
		if (beginLine) {
			try {
				const cm = (this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor as any)?.cm as EditorView | undefined;
				if (cm?.state?.doc) {
					const doc = cm.state.doc;
					const startNo = doc.lineAt(cm.posAtDOM(beginLine)).number;
					const open = doc.line(startNo).text.trim().match(/^(`{3,}|~{3,})/);
					if (open) {
						const out: string[] = [];
						for (let i = startNo + 1; i <= doc.lines; i++) {
							const tt = doc.line(i).text;
							if (/^(`{3,}|~{3,})\s*$/.test(tt.trim()) && tt.trim().startsWith(open[1][0])) break;
							out.push(tt);
						}
						if (out.length > 0) rawCode = out.join('\n');
					}
				}
			} catch (err) {
				console.warn('[PakCLI] doc extraction failed, using DOM fallback', err);
			}
		}

		if (beginLine && !rawCode) {
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

		// ─── C. Heuristic language detection fallback ───
		if ((!detectedLang || detectedLang === 'hypermd') && rawCode) {
			if (/^\s*<#/m.test(rawCode) || /\b(Read-Host|Write-Host|Get-ChildItem|param\s*\(|\$targetFolder|\$true|\$false|Sort-Object|Test-Path)\b/i.test(rawCode)) {
				detectedLang = 'powershell';
			}
		}

		console.log(`[PakCLI Copy Click] detectedLang="${detectedLang}" rawCodeLength=${rawCode.length}`);

		const rules = this.plugin?.settings?.codeblockLanguageRules || [];
		let matchedRule = this.findMatchingRule(detectedLang, rules);

		// If no rule matches yet but code looks like PowerShell, check powershell rule specifically
		if (!matchedRule?.onClipboard?.trim() && rawCode && (detectedLang === 'powershell' || /^\s*<#/m.test(rawCode))) {
			matchedRule = this.findMatchingRule('powershell', rules);
			if (matchedRule?.onClipboard?.trim()) detectedLang = 'powershell';
		}

		if (!matchedRule?.onClipboard?.trim()) {
			this.pendingClipboardTransform = null;
			return; // Native copy without transform
		}

		const tpl = matchedRule.onClipboard.trim();
		const replaceEx = matchedRule.replaceExisting !== false;

		// Arm safety net for writeText: keeps active for 1500ms so even if Obsidian fires an async writeText, it is guaranteed intercepted!
		this.pendingClipboardTransform = {
			timestamp: Date.now(),
			lang: detectedLang || 'powershell',
			template: tpl,
			replaceExisting: replaceEx
		};

		// Visual feedback
		copyBtn.classList.add('pakcli-cb-copy-btn--done');
		setTimeout(() => copyBtn.classList.remove('pakcli-cb-copy-btn--done'), 1500);

		if (rawCode) {
			// We own the copy: stop Obsidian's native handler from overwriting our transformed text
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();

			let transformed = this.transformClipboardContent(rawCode, tpl, detectedLang || 'powershell', replaceEx);
			const sanitized = this.applyClipboardSanitizer(transformed);
			if (sanitized.replacementsCount > 0) {
				transformed = sanitized.text;
				new Notice(`🛡️ Sanitized ${sanitized.replacementsCount} string(s) in clipboard!`, 2500);
			}

			await this.writeToClipboard(transformed);
			new Notice(`[PakCLI] Copied with ${detectedLang || 'powershell'} (${this.formatTemplateNoticeLabel(tpl)}) template!`, 2500);
			return;
		}
	}

	/** Multi-tiered clipboard writer supporting Electron, Navigator, and DOM execCommand */
	async writeToClipboard(text: string): Promise<boolean> {
		let success = false;
		try {
			const electron = (window as any).require?.('electron');
			if (electron?.clipboard?.writeText) {
				electron.clipboard.writeText(text);
				success = true;
			}
		} catch (_) {}

		try {
			if (this.originalClipboardWriteText) {
				await this.originalClipboardWriteText(text);
				success = true;
			} else if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
				success = true;
			}
		} catch (_) {}

		if (!success) {
			try {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.focus();
				ta.select();
				document.execCommand('copy');
				ta.remove();
				success = true;
			} catch (_) {}
		}
		return success;
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

		// Hide native Obsidian copy button if present so they don't clip or overlap
		const nativeBtn = pre.querySelector('.copy-code-button') as HTMLElement | null;
		if (nativeBtn) {
			nativeBtn.style.display = 'none';
		}

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

			let transformed = curScript ? this.transformClipboardContent(content, curScript, lang, curRule?.replaceExisting !== false) : content;
			const sanitized = this.applyClipboardSanitizer(transformed);
			if (sanitized.replacementsCount > 0) {
				transformed = sanitized.text;
				new Notice(`🛡️ Sanitized ${sanitized.replacementsCount} string(s) in clipboard!`, 2500);
			}

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

	private getDocCodeblocks(doc: any): Array<{
		startLn: number;
		endLn: number;
		lang: string;
		behavior: 'scalefit' | 'flowclip' | 'wrap';
		maxLen: number;
	}> {
		const blocks: Array<{
			startLn: number;
			endLn: number;
			lang: string;
			behavior: 'scalefit' | 'flowclip' | 'wrap';
			maxLen: number;
		}> = [];

		let inBlock = false;
		let startLn = 0;
		let fenceChar = '`';
		let fenceLen = 3;
		let lang = '';
		let maxLen = 0;

		const totalLines = typeof doc?.lines === 'number' ? doc.lines : 0;
		for (let ln = 1; ln <= totalLines; ln++) {
			const lineText = doc.line(ln).text;
			const trimmed = lineText.trim();

			if (!inBlock) {
				const openMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
				if (openMatch) {
					inBlock = true;
					startLn = ln;
					fenceChar = openMatch[1][0];
					fenceLen = openMatch[1].length;
					lang = openMatch[2].trim().toLowerCase().split(/\s+/)[0];
					maxLen = lineText.length;
				}
			} else {
				if (lineText.length > maxLen) maxLen = lineText.length;
				const isClose = (
					(trimmed.startsWith('```') || trimmed.startsWith('~~~')) &&
					/^(`{3,}|~{3,})\s*$/.test(trimmed)
				) || (fenceChar === '`' && /^(`\s*){3,}$/.test(trimmed));
				if (isClose) {
					blocks.push({
						startLn,
						endLn: ln,
						lang,
						behavior: this.getBehaviorForLanguage(lang),
						maxLen
					});
					inBlock = false;
					lang = '';
					maxLen = 0;
				}
			}
		}

		if (inBlock) {
			blocks.push({
				startLn,
				endLn: totalLines,
				lang,
				behavior: this.getBehaviorForLanguage(lang),
				maxLen
			});
		}

		return blocks;
	}

	private processCmLines(cmLines: HTMLElement[], editorView?: EditorView): void {
		if (!editorView) {
			const firstEl = cmLines[0];
			editorView = (firstEl?.closest('.cm-editor') as any)?.cmView?.view as EditorView | undefined;
		}
		if (!editorView) {
			const activeMdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeMdView) {
				editorView = (activeMdView.editor as any)?.cm as EditorView | undefined;
			}
		}

		if (editorView && editorView.state?.doc) {
			const doc = editorView.state.doc;
			const docBlocks = this.getDocCodeblocks(doc);
			if (docBlocks.length === 0) return;

			const filePath = this.plugin.app.workspace.getActiveFile()?.path || 'unknown';

			// Group rendered DOM lines by docBlock index
			const blockLinesMap = new Map<number, Array<{ el: HTMLElement; lineNo: number }>>();
			for (let i = 0; i < docBlocks.length; i++) {
				blockLinesMap.set(i, []);
			}

			for (const el of cmLines) {
				let lineNo = 0;
				try {
					const pos = editorView.posAtDOM(el);
					lineNo = doc.lineAt(pos).number;
				} catch {
					try {
						const first = el.firstChild || el;
						const pos = editorView.posAtDOM(first);
						lineNo = doc.lineAt(pos).number;
					} catch {
						lineNo = 0;
					}
				}
				let inAnyBlock = false;
				if (lineNo > 0) {
					for (let i = 0; i < docBlocks.length; i++) {
						const b = docBlocks[i];
						if (lineNo >= b.startLn && lineNo <= b.endLn) {
							blockLinesMap.get(i)!.push({ el, lineNo });
							inAnyBlock = true;
							break;
						}
					}
				}
				if (!inAnyBlock && (el as any)._pakcliBlockKey) {
					(el as any)._pakcliBlockKey = null;
					(el as any)._pakcliNaturalScrollWidth = null;
					const oldSyncedScroll = (el as any)._pakcliAllSyncedScroll;
					if (oldSyncedScroll) {
						el.removeEventListener('scroll', oldSyncedScroll);
						(el as any)._pakcliAllSyncedScroll = null;
					}
					el.classList.remove(
						'pakcli-codeblock-line-flowclip',
						'pakcli-codeblock-line-all-synced',
						'pakcli-codeblock-line-per-line',
						'pakcli-codeblock-line-scalefit'
					);
					el.style.removeProperty('--codeblock-spacer-width');
					el.style.removeProperty('overflow-x');
					el.style.removeProperty('white-space');
					el.style.removeProperty('max-width');
					el.style.removeProperty('width');
					el.style.removeProperty('box-sizing');
					el.scrollLeft = 0;
				}
			}

			// Clean up any bars for deleted codeblocks or obsolete keys
			for (const [key, b] of this.activeCmBars.entries()) {
				if (key.startsWith(`${filePath}::cm::cb_idx_`)) {
					const idxStr = key.replace(`${filePath}::cm::cb_idx_`, '');
					const idx = parseInt(idxStr, 10);
					if (!isNaN(idx) && idx >= docBlocks.length) {
						b.remove();
						this.activeCmBars.delete(key);
					}
				} else {
					b.remove();
					this.activeCmBars.delete(key);
				}
			}

			// Clean up any rogue/orphan sticky bars on document.body
			const validBars = new Set(this.activeCmBars.values());
			document.querySelectorAll<HTMLElement>('.pakcli-cb-sticky-bar').forEach((b) => {
				if (validBars.has(b)) return;
				const anchor = (b as any)._pakcliAnchor;
				if (anchor && anchor.matches?.('pre') && anchor.isConnected && anchor.closest('.markdown-rendered')) {
					return; // Valid reading view bar
				}
				b.remove();
			});
			document.querySelectorAll<HTMLElement>('.pakcli-codeblock-slider-bar').forEach((b) => {
				if (validBars.has(b)) return;
				b.remove();
			});

			// Process each codeblock
			for (let i = 0; i < docBlocks.length; i++) {
				const b = docBlocks[i];
				const items = blockLinesMap.get(i)!;
				const blockKey = `${filePath}::cm::cb_idx_${i}`;
				if (items.length === 0) {
					const curBar = this.activeCmBars.get(blockKey);
					if (curBar) curBar.style.setProperty('display', 'none', 'important');
					continue;
				}

				items.sort((x, y) => x.lineNo - y.lineNo);
				const currentBlockLines = items.map((x) => x.el);
				// Anchor to closing fence line or bottom line of the codeblock
				let anchorItem = items.find((x) => x.el.classList.contains('HyperMD-codeblock-end')) || items[items.length - 1];
				const anchorLine = anchorItem.el;
				const anchorLineNo = anchorItem.lineNo;

				this.applyBehaviorToBlock(
					b.behavior,
					b.lang,
					currentBlockLines,
					anchorLine,
					anchorLineNo,
					b.startLn,
					b.endLn,
					b.maxLen,
					blockKey,
					editorView
				);
			}
			return;
		}

		// Fallback if editorView is somehow unavailable:
		// Group lines strictly without breaking on empty lines
		let currentBlockLines: HTMLElement[] = [];
		let currentLanguage = '';
		let blockIndex = 0;
		const filePath = this.plugin.app.workspace.getActiveFile()?.path || 'unknown';

		const flushFallbackBlock = () => {
			if (currentBlockLines.length === 0) return;
			const behavior = this.getBehaviorForLanguage(currentLanguage);
			const anchorLine = currentBlockLines[currentBlockLines.length - 1];
			const blockKey = `${filePath}::cm::fb_block_${blockIndex++}`;
			this.applyBehaviorToBlock(
				behavior,
				currentLanguage,
				currentBlockLines,
				anchorLine,
				currentBlockLines.length,
				1,
				currentBlockLines.length,
				80,
				blockKey
			);
			currentBlockLines = [];
			currentLanguage = '';
		};

		cmLines.forEach((el) => {
			const line = el as HTMLElement;
			if (line.classList.contains('HyperMD-codeblock-begin')) {
				flushFallbackBlock();
				const flair = line.querySelector('.code-block-flair, .code-block-language, .code-language');
				const flairText = flair?.textContent?.trim().toLowerCase() || '';
				const text = line.textContent?.trim() || '';
				let lang = '';
				if (text.startsWith('```')) {
					lang = text.replace(/^`+/, '').trim().toLowerCase();
				} else if (flairText && flairText !== 'copy') {
					lang = flairText;
				}
				currentLanguage = lang;
				currentBlockLines.push(line);
			} else if (line.classList.contains('HyperMD-codeblock-end')) {
				currentBlockLines.push(line);
				flushFallbackBlock();
			} else {
				currentBlockLines.push(line);
			}
		});

		flushFallbackBlock();
	}

	private applyBehaviorToBlock(
		behavior: 'scalefit' | 'flowclip' | 'wrap',
		lang: string,
		currentBlockLines: HTMLElement[],
		anchorLine: HTMLElement,
		anchorLineNo: number,
		startLn: number,
		endLn: number,
		docMaxLen: number,
		blockKey: string,
		editorView?: EditorView
	): void {
		// Clean up any old injected bars from previous versions, including legacy in-flow slider bars
		// (these were the cause of two sliders appearing for one codeblock).
		currentBlockLines.forEach((line) => {
			line.querySelectorAll('.pakcli-codeblock-flowclip-bar, :scope > .pakcli-codeblock-slider-bar').forEach((b) => b.remove());
			if (behavior !== 'flowclip') {
				const synced = (line as any)._pakcliAllSyncedScroll;
				if (synced) {
					line.removeEventListener('scroll', synced);
					(line as any)._pakcliAllSyncedScroll = null;
				}
				line.classList.remove('pakcli-codeblock-line-all-synced');
				line.style.removeProperty('--codeblock-spacer-width');
				line.style.removeProperty('scrollbar-width');
				line.style.removeProperty('padding-bottom');
				line.style.removeProperty('font-size');
			}
		});

		if (behavior === 'wrap') {
			const oldSticky = this.activeCmBars.get(blockKey);
			if (oldSticky) {
				oldSticky.remove();
				this.activeCmBars.delete(blockKey);
			}
			currentBlockLines.forEach((line) => {
				line.classList.remove('pakcli-codeblock-line-flowclip', 'pakcli-codeblock-line-scalefit', 'pakcli-codeblock-end-scroll', 'pakcli-codeblock-line-all-synced', 'pakcli-codeblock-line-per-line');
				line.classList.add('pakcli-codeblock-wrap');
				line.style.setProperty('contain', 'none', 'important');
				line.style.setProperty('white-space', 'pre-wrap', 'important');
				line.style.setProperty('word-break', 'break-all', 'important');
				line.style.setProperty('overflow-wrap', 'anywhere', 'important');
				line.style.setProperty('word-wrap', 'break-word', 'important');
				line.style.setProperty('overflow-x', 'hidden', 'important');
				if (line.classList.contains('HyperMD-codeblock-begin')) {
					line.style.setProperty('min-height', '38px', 'important');
					line.style.setProperty('line-height', '38px', 'important');
					line.style.setProperty('overflow-y', 'visible', 'important');
					line.style.setProperty('position', 'relative', 'important');
					line.style.setProperty('z-index', '1000', 'important');
				} else {
					line.style.setProperty('position', 'relative', 'important');
					line.style.setProperty('z-index', '1', 'important');
				}
				line.style.setProperty('max-width', '100%', 'important');
				line.style.setProperty('width', 'auto', 'important');
				line.style.setProperty('min-width', '0', 'important');
				line.style.setProperty('box-sizing', 'border-box', 'important');
				line.style.removeProperty('--codeblock-scroll-width');
				line.style.removeProperty('--codeblock-spacer-width');
				line.style.removeProperty('padding-right');
				line.style.removeProperty('padding-bottom');
				line.scrollLeft = 0;

				const oldHandler = (line as any)._pakcliScrollHandler;
				if (oldHandler) {
					line.removeEventListener('scroll', oldHandler);
					(line as any)._pakcliScrollHandler = null;
				}
			});
		} else if (behavior === 'scalefit') {
			const oldSticky = this.activeCmBars.get(blockKey);
			if (oldSticky) {
				oldSticky.remove();
				this.activeCmBars.delete(blockKey);
			}
			currentBlockLines.forEach((line) => {
				line.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-line-flowclip', 'pakcli-codeblock-end-scroll', 'pakcli-codeblock-line-all-synced', 'pakcli-codeblock-line-per-line');
				line.classList.add('pakcli-codeblock-line-scalefit');
				line.style.setProperty('contain', 'none', 'important');
				line.style.setProperty('white-space', 'pre', 'important');
				line.style.setProperty('font-size', 'min(var(--code-size, 13px), 2.2vw)', 'important');
				line.style.setProperty('overflow-x', 'auto', 'important');
				if (line.classList.contains('HyperMD-codeblock-begin')) {
					line.style.setProperty('min-height', '38px', 'important');
					line.style.setProperty('line-height', '38px', 'important');
					line.style.setProperty('overflow-y', 'visible', 'important');
					line.style.setProperty('position', 'relative', 'important');
					line.style.setProperty('z-index', '1000', 'important');
				} else {
					line.style.setProperty('position', 'relative', 'important');
					line.style.setProperty('z-index', '1', 'important');
				}
				line.style.setProperty('max-width', '100%', 'important');
				line.style.setProperty('width', 'auto', 'important');
				line.style.setProperty('min-width', '0', 'important');
				line.style.setProperty('box-sizing', 'border-box', 'important');
				line.style.removeProperty('--codeblock-scroll-width');
				line.style.removeProperty('--codeblock-spacer-width');
				line.style.removeProperty('padding-right');
				line.style.removeProperty('padding-bottom');
			});
		} else if (this.flowclipMode === 'per-line') {
			// Mode 3: 1 line flowing 1 slider bar (no sticky bar, native scrollbar on each flowing line)
			const oldSticky = this.activeCmBars.get(blockKey);
			if (oldSticky) {
				oldSticky.remove();
				this.activeCmBars.delete(blockKey);
			}
			currentBlockLines.forEach((line) => {
				if ((line as any)._pakcliStickyBar) {
					(line as any)._pakcliStickyBar.remove();
					(line as any)._pakcliStickyBar = null;
					(line as any)._pakcliStickyPositionBar = null;
					(line as any)._pakcliBindLineScroll = null;
				}
				const oldHandler = (line as any)._pakcliScrollHandler;
				if (oldHandler) {
					line.removeEventListener('scroll', oldHandler);
					(line as any)._pakcliScrollHandler = null;
				}

				line.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-line-scalefit', 'pakcli-codeblock-line-all-synced', 'pakcli-codeblock-line-flowclip', 'pakcli-codeblock-end-scroll');
				line.classList.add('pakcli-codeblock-line-per-line');
				line.style.setProperty('contain', 'none', 'important');
				line.style.setProperty('white-space', 'pre', 'important');
				line.style.setProperty('word-break', 'normal', 'important');
				line.style.setProperty('word-wrap', 'normal', 'important');
				line.style.setProperty('overflow-x', 'auto', 'important');
				if (line.classList.contains('HyperMD-codeblock-begin')) {
					line.style.setProperty('min-height', '38px', 'important');
					line.style.setProperty('line-height', '38px', 'important');
					line.style.setProperty('overflow-y', 'visible', 'important');
					line.style.setProperty('position', 'relative', 'important');
					line.style.setProperty('z-index', '1000', 'important');
				} else {
					line.style.setProperty('overflow-y', 'hidden', 'important');
					line.style.setProperty('position', 'relative', 'important');
					line.style.setProperty('z-index', '1', 'important');
				}
				line.style.setProperty('max-width', '100%', 'important');
				line.style.setProperty('width', 'auto', 'important');
				line.style.setProperty('min-width', '0', 'important');
				line.style.setProperty('box-sizing', 'border-box', 'important');
				line.style.setProperty('padding-bottom', '6px', 'important');
				line.style.removeProperty('--codeblock-spacer-width');
				line.style.removeProperty('--codeblock-scroll-width');
				line.style.removeProperty('padding-right');

				const filePath = this.plugin.app.workspace.getActiveFile()?.path || 'unknown';
				const snippet = (line.textContent || '').trim().substring(0, 30).replace(/\s+/g, '_');
				const key = `${filePath}::line::${snippet}`;
				const savedPct = this.getSavedScrollPct(key);
				if (savedPct > 0) {
					const maxScroll = line.scrollWidth - line.clientWidth;
					if (maxScroll > 0) line.scrollLeft = Math.round(savedPct * maxScroll);
				}
				const oldPerLine = (line as any)._pakcliPerLineScroll;
				if (oldPerLine) line.removeEventListener('scroll', oldPerLine);
				const handler = () => {
					const maxScroll = line.scrollWidth - line.clientWidth;
					if (maxScroll > 0) this.saveScrollState(key, line.scrollLeft / maxScroll);
				};
				(line as any)._pakcliPerLineScroll = handler;
				line.addEventListener('scroll', handler, { passive: true });
			});
		} else {
			// Mode 1 ('all-lines') or Mode 2 ('current'): 1 bottom slider bar
			const docMaxEstimatedWidth = Math.round(docMaxLen * 8.6) + 60;

			// Preserve block scroll offset or default to 0
			const existingScroll = this.blockCurrentScrollLeft.get(blockKey) ?? 0;
			this.blockCurrentScrollLeft.set(blockKey, existingScroll);

			// First apply white-space: pre !important to ALL lines so true scrollWidth can be measured
			currentBlockLines.forEach((l) => {
				l.classList.remove('pakcli-codeblock-wrap', 'pakcli-codeblock-line-scalefit', 'pakcli-codeblock-line-per-line');
				l.classList.add('pakcli-codeblock-line-flowclip');
				(l as any)._pakcliBlockKey = blockKey;
				l.style.setProperty('white-space', 'pre', 'important');
				l.style.setProperty('word-break', 'normal', 'important');
				l.style.setProperty('word-wrap', 'normal', 'important');
				l.style.overflowWrap = 'normal';
				l.style.setProperty('overflow-x', 'hidden', 'important');
				if (l.classList.contains('HyperMD-codeblock-begin')) {
					l.style.setProperty('min-height', '38px', 'important');
					l.style.setProperty('line-height', '38px', 'important');
					l.style.setProperty('overflow-y', 'visible', 'important');
					l.style.setProperty('position', 'relative', 'important');
					l.style.setProperty('z-index', '1000', 'important');
				} else {
					l.style.setProperty('overflow-y', 'hidden', 'important');
					l.style.setProperty('position', 'relative', 'important');
					l.style.setProperty('z-index', '1', 'important');
				}
				l.style.setProperty('max-width', '100%', 'important');
				l.style.setProperty('width', 'auto', 'important');
				l.style.setProperty('min-width', '0', 'important');
				l.style.setProperty('box-sizing', 'border-box', 'important');
				l.style.setProperty('scrollbar-width', 'none', 'important');
				(l.style as any)['-ms-overflow-style'] = 'none';
				l.style.removeProperty('--codeblock-scroll-width');
				l.style.removeProperty('padding-right');
				l.style.removeProperty('padding-bottom');

				const perLineHandler = (l as any)._pakcliPerLineScroll;
				if (perLineHandler) {
					l.removeEventListener('scroll', perLineHandler);
					(l as any)._pakcliPerLineScroll = null;
				}
			});

			let naturalMaxScrollWidth = 0;
			currentBlockLines.forEach((l) => {
				const isFence = l.classList.contains('HyperMD-codeblock-begin') || l.classList.contains('HyperMD-codeblock-end');
				if (isFence) {
					l.style.setProperty('overflow-x', 'hidden', 'important');
					if (l.classList.contains('HyperMD-codeblock-begin')) {
						l.style.setProperty('min-height', '38px', 'important');
						l.style.setProperty('line-height', '38px', 'important');
						l.style.setProperty('overflow-y', 'visible', 'important');
						l.style.setProperty('position', 'relative', 'important');
						l.style.setProperty('z-index', '1000', 'important');
					}
					return;
				}
				const currentSpacer = parseFloat(l.style.getPropertyValue('--codeblock-spacer-width')) || 0;
				const trueContentWidth = l.scrollWidth - currentSpacer;
				(l as any)._pakcliNaturalScrollWidth = trueContentWidth;
				if (trueContentWidth > naturalMaxScrollWidth) naturalMaxScrollWidth = trueContentWidth;
			});

			const currentMax = Math.max(naturalMaxScrollWidth, docMaxEstimatedWidth);
			if (currentMax > 0) {
				this.blockMaxScrollWidthCache.set(blockKey, currentMax);
			}

			const effectiveMax = currentMax + 60;
			const isAllLines = this.flowclipMode === 'all-lines';

			currentBlockLines.forEach((line) => {
				const isFence = line.classList.contains('HyperMD-codeblock-begin') || line.classList.contains('HyperMD-codeblock-end');
				if (isFence) {
					line.style.setProperty('overflow-x', 'hidden', 'important');
					if (line.classList.contains('HyperMD-codeblock-begin')) {
						line.style.setProperty('min-height', '38px', 'important');
						line.style.setProperty('line-height', '38px', 'important');
						line.style.setProperty('overflow-y', 'visible', 'important');
						line.style.setProperty('position', 'relative', 'important');
						line.style.setProperty('z-index', '1000', 'important');
					}
					line.style.removeProperty('--codeblock-spacer-width');
					line.style.removeProperty('padding-right');
					line.scrollLeft = 0;
					return;
				}

				if (isAllLines) {
					line.classList.add('pakcli-codeblock-line-all-synced');
					const sw = (line as any)._pakcliNaturalScrollWidth || line.scrollWidth;
					const spacerWidth = Math.max(0, effectiveMax - sw);
					line.style.setProperty('--codeblock-spacer-width', `${spacerWidth}px`);
					line.style.removeProperty('padding-right');
				} else {
					line.classList.remove('pakcli-codeblock-line-all-synced');
					line.style.removeProperty('--codeblock-spacer-width');
					line.style.removeProperty('padding-right');
					if (line.scrollWidth <= line.clientWidth) {
						line.scrollLeft = 0;
					}
				}
			});

			// Restore target horizontal scroll offset on live lines immediately
			const activeScroll = this.blockCurrentScrollLeft.get(blockKey) ?? 0;
			const targetScroll = activeScroll <= 3 ? 0 : activeScroll;
			currentBlockLines.forEach((line) => {
				const isFence = line.classList.contains('HyperMD-codeblock-begin') || line.classList.contains('HyperMD-codeblock-end');
				if (isFence) {
					if (line.scrollLeft !== 0) line.scrollLeft = 0;
					const oldSyncedScroll = (line as any)._pakcliAllSyncedScroll;
					if (oldSyncedScroll) {
						line.removeEventListener('scroll', oldSyncedScroll);
						(line as any)._pakcliAllSyncedScroll = null;
					}
					return;
				}
				if (isAllLines) {
					if (line.scrollLeft !== targetScroll) line.scrollLeft = targetScroll;

					// Real-time lockstep: if cursor navigation or typing scrolls this line, sync all lines instantly
					const oldSyncedScroll = (line as any)._pakcliAllSyncedScroll;
					if (oldSyncedScroll) {
						line.removeEventListener('scroll', oldSyncedScroll);
					}
					const lineScrollHandler = (evt: Event) => {
						if (this.isSyncingAllLines) return;
						const targetLine = evt.currentTarget as HTMLElement;
						const rawScroll = targetLine.scrollLeft;
						const newScroll = rawScroll <= 3 ? 0 : rawScroll;
						if (Math.abs(newScroll - (this.blockCurrentScrollLeft.get(blockKey) ?? 0)) < 1) return;

						this.blockCurrentScrollLeft.set(blockKey, newScroll);
						this.isSyncingAllLines = true;

						for (const sibling of currentBlockLines) {
							if (sibling !== targetLine) {
								const sibFence = sibling.classList.contains('HyperMD-codeblock-begin') || sibling.classList.contains('HyperMD-codeblock-end');
								if (sibFence) {
									if (sibling.scrollLeft !== 0) sibling.scrollLeft = 0;
								} else {
									if (sibling.scrollLeft !== newScroll) sibling.scrollLeft = newScroll;
								}
							}
						}

						const bar = anchorLine.querySelector(':scope > .pakcli-codeblock-slider-bar') as HTMLElement | null;
						if (bar && Math.abs(bar.scrollLeft - newScroll) > 1) {
							bar.scrollLeft = newScroll;
						}

						this.isSyncingAllLines = false;
					};
					(line as any)._pakcliAllSyncedScroll = lineScrollHandler;
					line.addEventListener('scroll', lineScrollHandler, { passive: true });
				} else {
					const oldSyncedScroll = (line as any)._pakcliAllSyncedScroll;
					if (oldSyncedScroll) {
						line.removeEventListener('scroll', oldSyncedScroll);
						(line as any)._pakcliAllSyncedScroll = null;
					}
					if (line.scrollWidth > line.clientWidth + 2) {
						if (line.scrollLeft !== targetScroll) line.scrollLeft = targetScroll;
					} else {
						if (line.scrollLeft !== 0) line.scrollLeft = 0;
					}
				}
			});

			(anchorLine as any)._pakcliNaturalMaxScrollWidth = effectiveMax;
			(anchorLine as any)._pakcliBlockKey = blockKey;
			this.injectInFlowBarForCmBlock(
				anchorLine,
				currentBlockLines,
				blockKey,
				anchorLineNo,
				startLn,
				endLn,
				editorView
			);
		}
	}

	/**
	 * Injects an in-flow horizontal slider bar at the bottom line of the codeblock.
	 * Directly part of the codeblock DOM (like Google <div class="rq1a2"> and VSCode).
	 * Never floats, never teleports, scrolls naturally with the document.
	 */
	private injectInFlowBarForCmBlock(
		anchorLine: HTMLElement,
		blockLines: HTMLElement[],
		blockKey: string,
		anchorLineNo: number,
		startLn: number,
		endLn: number,
		editorView?: EditorView
	): void {
		// Legacy in-flow bars (older builds appended the bar INSIDE the cm-line) -> always remove
		for (const l of blockLines) {
			l.querySelectorAll(':scope > .pakcli-codeblock-slider-bar').forEach((b) => b.remove());
		}

		if (this.flowclipMode === 'per-line') {
			const old = this.activeCmBars.get(blockKey);
			if (old) {
				old.remove();
				this.activeCmBars.delete(blockKey);
			}
			return;
		}

		// ONE fixed bar per block (lives on document.body, tracked in activeCmBars).
		// It sticks to the bottom of the visible part of the block and hides when the block is off-screen.
		let sliderBar: HTMLElement | null = this.activeCmBars.get(blockKey) || null;
		if (sliderBar && !sliderBar.isConnected) sliderBar = null;
		if (!sliderBar) {
			sliderBar = document.createElement('div');
			sliderBar.className = 'pakcli-codeblock-slider-bar';
			sliderBar.setAttribute('contenteditable', 'false');
			const newInner = document.createElement('div');
			newInner.className = 'pakcli-codeblock-slider-inner';
			sliderBar.appendChild(newInner);
			document.body.appendChild(sliderBar);
			this.activeCmBars.set(blockKey, sliderBar);
		}

		sliderBar.setAttribute('data-block-key', blockKey);
		(sliderBar as any)._pakcliAnchorLine = anchorLine;
		(sliderBar as any)._pakcliBlockLines = blockLines;

		const inner = sliderBar.firstElementChild as HTMLElement;
		const effectiveMax = (anchorLine as any)._pakcliNaturalMaxScrollWidth || (this.blockMaxScrollWidthCache.get(blockKey) || 0) + 60;
		const lineW = anchorLine.clientWidth;
		const hasOverflow = lineW > 0 && effectiveMax > lineW + 2;
		(sliderBar as any)._pakcliHasOverflow = hasOverflow;

		this.bindCmBarPositioning(editorView);

		if (!hasOverflow) {
			sliderBar.style.setProperty('display', 'none', 'important');
			return;
		}

		inner.style.setProperty('width', `${effectiveMax}px`, 'important');
		this.positionCmBar(sliderBar);

		const isAllLines = this.flowclipMode === 'all-lines';

		const syncLines = (scrollLeft: number) => {
			const target = scrollLeft <= 3 ? 0 : scrollLeft;
			this.isSyncingAllLines = true;
			for (const l of blockLines) {
				const isFence = l.classList.contains('HyperMD-codeblock-begin') || l.classList.contains('HyperMD-codeblock-end');
				if (isFence) {
					if (l.scrollLeft !== 0) l.scrollLeft = 0;
					continue;
				}

				if (isAllLines) {
					if (l.scrollLeft !== target) l.scrollLeft = target;
				} else {
					if (l.scrollWidth > l.clientWidth + 2) {
						if (l.scrollLeft !== target) l.scrollLeft = target;
					} else {
						if (l.scrollLeft !== 0) l.scrollLeft = 0;
					}
				}
			}
			this.isSyncingAllLines = false;
		};

		let isUpdatingSliderProgrammatically = false;
		let rafId: number | null = null;

		const onSliderScroll = () => {
			if (isUpdatingSliderProgrammatically) return;
			const rawTarget = sliderBar!.scrollLeft;
			const target = rawTarget <= 3 ? 0 : rawTarget;
			this.blockCurrentScrollLeft.set(blockKey, target);

			if (rafId !== null) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				rafId = null;
				syncLines(target);
				const maxScroll = effectiveMax - lineW;
				if (maxScroll > 0) {
					this.saveScrollState(blockKey, target === 0 ? 0 : target / maxScroll);
				}
			});
		};

		sliderBar.onscroll = onSliderScroll;

		const enforceZeroIfAtLeft = () => {
			if (sliderBar && sliderBar.scrollLeft <= 3) {
				if (sliderBar.scrollLeft !== 0) {
					isUpdatingSliderProgrammatically = true;
					sliderBar.scrollLeft = 0;
					isUpdatingSliderProgrammatically = false;
				}
				this.blockCurrentScrollLeft.set(blockKey, 0);
				syncLines(0);
				this.saveScrollState(blockKey, 0);
			}
		};

		if (!(sliderBar as any)._pakcliListenersBound) {
			(sliderBar as any)._pakcliListenersBound = true;
			sliderBar.addEventListener('scrollend', enforceZeroIfAtLeft);
			sliderBar.addEventListener('pointerup', enforceZeroIfAtLeft);
			sliderBar.addEventListener('mouseup', enforceZeroIfAtLeft);
			sliderBar.addEventListener('touchend', enforceZeroIfAtLeft);
		}

		// Restore or follow target scroll position
		let targetScroll = this.blockCurrentScrollLeft.get(blockKey);
		if (targetScroll === undefined || targetScroll === null) {
			const savedPct = this.getSavedScrollPct(blockKey);
			const maxScroll = Math.max(0, effectiveMax - lineW);
			if (savedPct > 0 && maxScroll > 0) {
				targetScroll = Math.round(savedPct * maxScroll);
			} else {
				targetScroll = 0;
			}
			this.blockCurrentScrollLeft.set(blockKey, targetScroll);
		}

		const finalScroll = (targetScroll && targetScroll > 3) ? targetScroll : 0;
		this.blockCurrentScrollLeft.set(blockKey, finalScroll);

		isUpdatingSliderProgrammatically = true;
		if (sliderBar.scrollLeft !== finalScroll) {
			sliderBar.scrollLeft = finalScroll;
		}
		isUpdatingSliderProgrammatically = false;

		syncLines(finalScroll);

		if (editorView && !(editorView as any)._pakcliWheelBound) {
			(editorView as any)._pakcliWheelBound = true;
			editorView.scrollDOM.addEventListener('wheel', (evt: WheelEvent) => {
				if (Math.abs(evt.deltaX) < 1) return;
				const target = evt.target as HTMLElement;
				const line = target.closest('.cm-line') as HTMLElement | null;
				if (!line) return;
				const bKey = (line as any)._pakcliBlockKey;
				if (!bKey) return;
				const b = this.activeCmBars.get(bKey) || null;
				if (b && b.style.display !== 'none') {
					const nextScroll = b.scrollLeft + evt.deltaX;
					if (nextScroll <= 3) {
						b.scrollLeft = 0;
					} else {
						b.scrollLeft = nextScroll;
					}
				}
			}, { passive: true });
		}
	}

	/** Re-positions every Live Preview slider on scroll / resize (bound once per editor). */
	private bindCmBarPositioning(editorView?: EditorView): void {
		if (!editorView || (editorView as any)._pakcliBarPosBound) return;
		(editorView as any)._pakcliBarPosBound = true;
		let raf = 0;
		const sched = () => {
			if (raf) return;
			raf = window.requestAnimationFrame(() => {
				raf = 0;
				this.activeCmBars.forEach((b) => this.positionCmBar(b));
			});
		};
		editorView.scrollDOM.addEventListener('scroll', sched, { passive: true });
		this.plugin.registerDomEvent(window, 'resize', sched);
	}

	/**
	 * Places the fixed slider at the bottom of the codeblock, clamped to the bottom of the editor
	 * viewport while the block extends below it. Hidden when the block is not visible on screen.
	 */
	private positionCmBar(bar: HTMLElement): void {
		const BAR_H = 12;
		const hide = () => bar.style.setProperty('display', 'none', 'important');
		const anchor = (bar as any)._pakcliAnchorLine as HTMLElement | undefined;
		const lines = (((bar as any)._pakcliBlockLines as HTMLElement[] | undefined) || []).filter((l) => l.isConnected);
		if (!anchor || !anchor.isConnected || lines.length === 0 || !(bar as any)._pakcliHasOverflow || this.flowclipMode === 'per-line') {
			hide();
			return;
		}
		if (anchor.offsetParent === null) {
			hide();
			return;
		}
		const view = anchor.closest('.markdown-source-view');
		if (view && !view.classList.contains('is-live-preview')) {
			hide();
			return;
		}
		if (!this.isElementVisibleInActiveView(anchor)) {
			hide();
			return;
		}
		const first = lines[0].getBoundingClientRect();
		const last = lines[lines.length - 1].getBoundingClientRect();
		const aRect = anchor.getBoundingClientRect();
		const scroller = anchor.closest('.cm-scroller') as HTMLElement | null;
		const sr = scroller ? scroller.getBoundingClientRect() : ({ top: 0, bottom: window.innerHeight } as DOMRect);

		// Block must be visible inside the editor viewport
		if (last.bottom <= sr.top || first.top >= sr.bottom) {
			hide();
			return;
		}
		const barTop = Math.min(last.bottom, sr.bottom, window.innerHeight) - BAR_H;
		if (barTop < Math.max(first.top, sr.top)) {
			hide();
			return;
		}
		bar.style.setProperty('display', 'block', 'important');
		bar.style.setProperty('left', `${aRect.left}px`, 'important');
		bar.style.setProperty('width', `${aRect.width}px`, 'important');
		bar.style.setProperty('top', `${barTop}px`, 'important');
	}

	clearCache(): void {
		this.blockMaxScrollWidthCache.clear();
		this.blockCurrentScrollLeft.clear();
		this.activeCmBars.forEach((bar) => bar.remove());
		this.activeCmBars.clear();
		document.querySelectorAll<HTMLElement>('.pakcli-codeblock-flowclip-bar, .pakcli-cb-sticky-bar, .pakcli-codeblock-slider-bar').forEach((el) => el.remove());
	}

	destroy(): void {
		this.clearCache();
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.cmStickyBars = [];
	}
}
