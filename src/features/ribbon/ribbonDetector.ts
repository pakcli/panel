import { App, Plugin } from 'obsidian';
import { RibbonItemConfig } from './types';

export interface DetectedRibbonElement {
	element: HTMLElement;
	itemConfig: RibbonItemConfig;
}

export class RibbonDetector {
	private app: App;
	private originalAddRibbonIcon: any = null;
	private onButtonDetected?: () => void;
	private static elementToPluginMap: WeakMap<HTMLElement, { pluginId: string; pluginName: string }> = new WeakMap();

	// Explicit Known Obsidian Core / Vanilla button signatures
	private static readonly VANILLA_CORE_KEYWORDS = [
		'graph view',
		'quick switcher',
		'canvas',
		'daily note',
		'template',
		'command palette',
		'record audio',
		'audio recorder',
		'file recovery',
		'workspace',
		'sync',
		'publish',
		'open another vault',
		'help',
		'bookmarks',
		'backlinks',
		'outgoing links',
		'outline',
		'tags',
		'file explorer'
	];

	// Explicit PakCLI Panel ribbon button signatures
	private static readonly PAKCLI_SIGNATURES = [
		'bubble graph',
		'audio & ambient',
		'pakcli audio',
		'dictionary navigator',
		'timeline narrative',
		'html snapshot',
		'ascii studio',
		'sqlseal'
	];

	constructor(app: App, onButtonDetected?: () => void) {
		this.app = app;
		this.onButtonDetected = onButtonDetected;
	}

	/**
	 * Hook Plugin.prototype.addRibbonIcon to automatically stamp new ribbon buttons
	 * with their originating plugin's ID and Name as they are created.
	 */
	public hookPluginPrototype(): void {
		if (this.originalAddRibbonIcon) return; // Already hooked

		const proto = Plugin.prototype as any;
		if (!proto || typeof proto.addRibbonIcon !== 'function') return;

		this.originalAddRibbonIcon = proto.addRibbonIcon;
		const self = this;

		proto.addRibbonIcon = function (icon: string, title: string, callback: (evt: MouseEvent) => any) {
			const el: HTMLElement = self.originalAddRibbonIcon.apply(this, arguments);
			try {
				if (el) {
					const pId = this.manifest?.id || (this === (self.app as any).plugins?.plugins?.['pakcli-panel'] ? 'pakcli-panel' : 'community-plugin');
					const pName = this.manifest?.name || (pId === 'pakcli-panel' ? 'PakCLI Table' : 'Community Plugin');
					
					el.setAttribute('data-plugin-id', pId);
					el.setAttribute('data-plugin-name', pName);
					el.setAttribute('data-ribbon-id', `${pId}::${(title || '').trim().toLowerCase()}`);
					RibDetectorRegistry.register(el, pId, pName);
				}
				if (self.onButtonDetected) {
					self.onButtonDetected();
				}
			} catch (e) {
				console.warn('[PakCLI Ribbon] Error tagging newly registered ribbon button:', e);
			}
			return el;
		};
	}

	/**
	 * Restore original Plugin.prototype.addRibbonIcon on unload.
	 */
	public unhookPluginPrototype(): void {
		if (this.originalAddRibbonIcon) {
			(Plugin.prototype as any).addRibbonIcon = this.originalAddRibbonIcon;
			this.originalAddRibbonIcon = null;
		}
	}

	/**
	 * Get the actions container element from the left ribbon.
	 */
	public getRibbonActionsContainer(): HTMLElement | null {
		const container = document.querySelector('.workspace-ribbon.mod-left .side-dock-actions') as HTMLElement;
		if (container) return container;
		return document.querySelector('.side-dock-ribbon .side-dock-actions') as HTMLElement;
	}

	/**
	 * Scan the DOM and identify all ribbon action buttons, classifying them into
	 * Vanilla (Core Obsidian), PakCLI Table, or specific Community Plugins.
	 */
	public scanRibbonButtons(): DetectedRibbonElement[] {
		const container = this.getRibbonActionsContainer();
		if (!container) return [];

		// Query actionable ribbon buttons (exclude spacers or divider elements we inject)
		const actionEls = Array.from(
			container.querySelectorAll('.side-dock-ribbon-action:not(.pakcli-ribbon-injected), .clickable-icon:not(.pakcli-ribbon-injected)')
		) as HTMLElement[];

		const validButtons = actionEls.filter(el => {
			if (el.classList.contains('pakcli-ribbon-divider') || el.classList.contains('pakcli-ribbon-spacer')) {
				return false;
			}
			return el.closest('.side-dock-actions') !== null;
		});

		const detected: DetectedRibbonElement[] = [];

		validButtons.forEach((el, index) => {
			const info = this.classifyButton(el, index);
			detected.push({
				element: el,
				itemConfig: info
			});
		});

		return detected;
	}

	/**
	 * Highly robust multi-layer classifier that resolves each button's originating plugin:
	 * Layer 0: Registry / Prototype Tag
	 * Layer 1: PakCLI Panel Known Signatures
	 * Layer 2: app.workspace.leftRibbon internal registry
	 * Layer 3: Plugin instance property ownership in app.plugins.plugins
	 * Layer 4: Command Palette command cross-referencing
	 * Layer 5: Plugin manifests keyword matching
	 * Layer 6: Obsidian Core / Vanilla matching
	 * Layer 7: Isolated community plugin fallback (never mixed into Vanilla)
	 */
	private classifyButton(el: HTMLElement, index: number): RibbonItemConfig {
		const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || `Button ${index + 1}`;
		const normalizedLabel = ariaLabel.trim().toLowerCase();

		// Layer 0: Check in-memory registry or element attributes
		const regInfo = RibDetectorRegistry.get(el);
		let taggedId = regInfo?.pluginId || el.getAttribute('data-plugin-id');
		let taggedName = regInfo?.pluginName || el.getAttribute('data-plugin-name');

		// Layer 1: Check PakCLI Panel signatures
		const isPakCli = 
			taggedId === 'pakcli-panel' ||
			RibbonDetector.PAKCLI_SIGNATURES.some(sig => normalizedLabel.includes(sig));

		if (isPakCli) {
			const pId = 'pakcli-panel';
			const pName = 'PakCLI Table';
			el.setAttribute('data-plugin-id', pId);
			el.setAttribute('data-plugin-name', pName);
			const id = `${pId}::${normalizedLabel}`;
			el.setAttribute('data-ribbon-id', id);
			RibDetectorRegistry.register(el, pId, pName);
			return {
				id,
				title: ariaLabel,
				pluginId: pId,
				pluginName: pName,
				svgHtml: el.querySelector('svg')?.outerHTML,
				visible: !el.classList.contains('pakcli-ribbon-hidden'),
				order: index
			};
		}

		if (taggedId && taggedName && taggedId !== 'vanilla' && taggedId !== 'community-plugin') {
			const id = `${taggedId}::${normalizedLabel}`;
			el.setAttribute('data-ribbon-id', id);
			return {
				id,
				title: ariaLabel,
				pluginId: taggedId,
				pluginName: taggedName,
				svgHtml: el.querySelector('svg')?.outerHTML,
				visible: !el.classList.contains('pakcli-ribbon-hidden'),
				order: index
			};
		}

		const manifests = (this.app as any).plugins?.manifests as Record<string, { id: string; name: string }> | undefined;
		let matchedPluginId: string | null = null;
		let matchedPluginName: string | null = null;

		// Layer 2: Check leftRibbon.items in Obsidian workspace
		try {
			const leftRibbon = (this.app.workspace as any).leftRibbon;
			if (leftRibbon && Array.isArray(leftRibbon.items)) {
				for (const rItem of leftRibbon.items) {
					if (rItem && (rItem.actionEl === el || rItem.title === ariaLabel)) {
						if (rItem.id && typeof rItem.id === 'string') {
							const colonIdx = rItem.id.indexOf(':');
							const candId = colonIdx > -1 ? rItem.id.substring(0, colonIdx) : rItem.id;
							if (manifests && manifests[candId]) {
								matchedPluginId = candId;
								matchedPluginName = manifests[candId].name;
								break;
							}
						}
					}
				}
			}
		} catch (e) {}

		// Layer 3: Inspect enabled plugin instances for direct DOM element ownership
		if (!matchedPluginId) {
			try {
				const plugins = (this.app as any).plugins?.plugins as Record<string, any> | undefined;
				if (plugins) {
					for (const pId of Object.keys(plugins)) {
						const p = plugins[pId];
						if (!p) continue;
						const propNames = Object.getOwnPropertyNames(p);
						for (const prop of propNames) {
							try {
								const val = p[prop];
								if (val === el || (val && val instanceof HTMLElement && (val === el || val.contains(el)))) {
									matchedPluginId = pId;
									matchedPluginName = p.manifest?.name || pId;
									break;
								}
								if (Array.isArray(val)) {
									for (const item of val) {
										if (item === el || (item && item.actionEl === el)) {
											matchedPluginId = pId;
											matchedPluginName = p.manifest?.name || pId;
											break;
										}
									}
									if (matchedPluginId) break;
								}
							} catch (err) {}
						}
						if (matchedPluginId) break;
					}
				}
			} catch (e) {}
		}

		// Layer 4: Match against Obsidian Command Palette commands
		if (!matchedPluginId) {
			try {
				const commands = (this.app as any).commands?.commands as Record<string, { id: string; name: string; icon?: string }> | undefined;
				if (commands && manifests) {
					// 4a. Exact command name match
					for (const cmdId of Object.keys(commands)) {
						const cmd = commands[cmdId];
						if (!cmd || !cmd.name) continue;
						const cName = cmd.name.trim().toLowerCase();
						if (cName === normalizedLabel) {
							const parts = cmdId.split(':');
							if (parts.length > 1 && manifests[parts[0]]) {
								matchedPluginId = parts[0];
								matchedPluginName = manifests[parts[0]].name;
								break;
							}
						}
					}

					// 4b. Substring command name match
					if (!matchedPluginId) {
						for (const cmdId of Object.keys(commands)) {
							const cmd = commands[cmdId];
							if (!cmd || !cmd.name) continue;
							const cName = cmd.name.trim().toLowerCase();
							if (cName.length >= 4 && (normalizedLabel.includes(cName) || cName.includes(normalizedLabel))) {
								const parts = cmdId.split(':');
								if (parts.length > 1 && manifests[parts[0]]) {
									matchedPluginId = parts[0];
									matchedPluginName = manifests[parts[0]].name;
									break;
								}
							}
						}
					}
				}
			} catch (e) {}
		}

		// Layer 5: Match against Plugin Manifest names & significant keywords
		if (!matchedPluginId && manifests) {
			for (const pId of Object.keys(manifests)) {
				const m = manifests[pId];
				const pName = m.name.toLowerCase();
				const pIdLower = m.id.toLowerCase();

				if (normalizedLabel.includes(pName) || normalizedLabel.includes(pIdLower)) {
					matchedPluginId = m.id;
					matchedPluginName = m.name;
					break;
				}

				// Check significant words in plugin name (e.g. "Calendar", "Tasks", "Excalidraw", "Omnisearch", "Whisper", "Dice", "Pet")
				const words = pName.split(/[\s\-_]+/).filter(w => w.length >= 4 && !['obsidian', 'plugin', 'tool', 'editor', 'view'].includes(w));
				for (const w of words) {
					if (normalizedLabel.includes(w)) {
						matchedPluginId = m.id;
						matchedPluginName = m.name;
						break;
					}
				}
				if (matchedPluginId) break;
			}
		}

		// If matched a community plugin
		if (matchedPluginId && matchedPluginName) {
			el.setAttribute('data-plugin-id', matchedPluginId);
			el.setAttribute('data-plugin-name', matchedPluginName);
			const id = `${matchedPluginId}::${normalizedLabel}`;
			el.setAttribute('data-ribbon-id', id);
			RibDetectorRegistry.register(el, matchedPluginId, matchedPluginName);
			return {
				id,
				title: ariaLabel,
				pluginId: matchedPluginId,
				pluginName: matchedPluginName,
				svgHtml: el.querySelector('svg')?.outerHTML,
				visible: !el.classList.contains('pakcli-ribbon-hidden'),
				order: index
			};
		}

		// Layer 6: Check known Obsidian Vanilla / Core keywords
		const isVanilla = RibbonDetector.VANILLA_CORE_KEYWORDS.some(kw => normalizedLabel.includes(kw));
		if (isVanilla) {
			const pluginId = 'vanilla';
			const pluginName = 'Vanilla Obsidian (Core)';
			const id = `${pluginId}::${normalizedLabel}`;
			el.setAttribute('data-plugin-id', pluginId);
			el.setAttribute('data-plugin-name', pluginName);
			el.setAttribute('data-ribbon-id', id);
			RibDetectorRegistry.register(el, pluginId, pluginName);
			return {
				id,
				title: ariaLabel,
				pluginId,
				pluginName,
				svgHtml: el.querySelector('svg')?.outerHTML,
				visible: !el.classList.contains('pakcli-ribbon-hidden'),
				order: index
			};
		}

		// Layer 7: Unmatched Community Plugin
		// Never pollute Vanilla: isolate into its own group derived from its action or title
		const actionCleaned = normalizedLabel.replace(/^(open|create|toggle|show|insert|new|start|view)\s+/i, '').trim();
		const pId = `plugin-${actionCleaned.replace(/[^a-z0-9]+/g, '-').slice(0, 24) || `item-${index}`}`;
		const pName = actionCleaned ? (actionCleaned.charAt(0).toUpperCase() + actionCleaned.slice(1)) : `Plugin Button (${index + 1})`;
		const id = `${pId}::${normalizedLabel}`;

		el.setAttribute('data-plugin-id', pId);
		el.setAttribute('data-plugin-name', pName);
		el.setAttribute('data-ribbon-id', id);
		RibDetectorRegistry.register(el, pId, pName);

		return {
			id,
			title: ariaLabel,
			pluginId: pId,
			pluginName: pName,
			svgHtml: el.querySelector('svg')?.outerHTML,
			visible: !el.classList.contains('pakcli-ribbon-hidden'),
			order: index
		};
	}
}

/**
 * Global Registry helper to retain detection mappings across DOM operations
 */
class RibDetectorRegistry {
	private static map = new WeakMap<HTMLElement, { pluginId: string; pluginName: string }>();

	static register(el: HTMLElement, pluginId: string, pluginName: string): void {
		this.map.set(el, { pluginId, pluginName });
	}

	static get(el: HTMLElement): { pluginId: string; pluginName: string } | undefined {
		return this.map.get(el);
	}
}
