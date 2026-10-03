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
					const manifestId = this.manifest?.id;
					const isPakCli = manifestId === 'pakcli-panel' || this === (self.app as any).plugins?.plugins?.['pakcli-panel'];
					
					let pId: string;
					let pName: string;

					if (isPakCli) {
						pId = 'pakcli-panel';
						pName = 'PakCLI Table';
					} else if (manifestId) {
						pId = manifestId;
						pName = this.manifest?.name || manifestId;
					} else {
						// Called without a community plugin manifest -> It is Vanilla Obsidian / Core!
						pId = 'vanilla';
						pName = 'Vanilla Obsidian (Core)';
					}
					
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
	 * Vanilla (Core Obsidian & Core Plugins), PakCLI Table, or specific Community Plugins.
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

	private createVanillaItem(el: HTMLElement, ariaLabel: string, normalizedLabel: string, index: number): RibbonItemConfig {
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

	private createCommunityItem(el: HTMLElement, pluginId: string, pluginName: string, ariaLabel: string, normalizedLabel: string, index: number): RibbonItemConfig {
		el.setAttribute('data-plugin-id', pluginId);
		el.setAttribute('data-plugin-name', pluginName);
		const id = `${pluginId}::${normalizedLabel}`;
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

	/**
	 * Dynamic classifier that groups ribbon buttons into:
	 * 1. PakCLI Table
	 * 2. Community Plugins (dynamically verified against Obsidian community plugin manifests & instances)
	 * 3. Vanilla Obsidian (Core & Built-in Obsidian plugins all combined into a single group without hardcoding)
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
			return this.createCommunityItem(el, 'pakcli-panel', 'PakCLI Table', ariaLabel, normalizedLabel, index);
		}

		if (taggedId === 'vanilla') {
			return this.createVanillaItem(el, ariaLabel, normalizedLabel, index);
		}

		const manifests = (this.app as any).plugins?.manifests as Record<string, { id: string; name: string }> | undefined;
		const internalPlugins = (this.app as any).internalPlugins?.plugins as Record<string, any> | undefined;

		// Tagged with a recognized community plugin ID
		if (taggedId && taggedName && taggedId !== 'community-plugin' && manifests && manifests[taggedId]) {
			return this.createCommunityItem(el, taggedId, taggedName, ariaLabel, normalizedLabel, index);
		}

		// Layer 2: Inspect Obsidian workspace leftRibbon.items
		try {
			const leftRibbon = (this.app.workspace as any).leftRibbon;
			if (leftRibbon && Array.isArray(leftRibbon.items)) {
				for (const rItem of leftRibbon.items) {
					if (rItem && (rItem.actionEl === el || rItem.title === ariaLabel)) {
						if (rItem.id && typeof rItem.id === 'string') {
							const colonIdx = rItem.id.indexOf(':');
							const candId = colonIdx > -1 ? rItem.id.substring(0, colonIdx) : rItem.id;
							
							// If candId matches a community plugin manifest -> Community Plugin
							if (manifests && manifests[candId]) {
								return this.createCommunityItem(el, candId, manifests[candId].name, ariaLabel, normalizedLabel, index);
							}

							// If candId matches an internal plugin or known core namespace -> Vanilla
							if (
								(internalPlugins && internalPlugins[candId]) ||
								['app', 'workspace', 'vault', 'view', 'editor', 'window', 'graph', 'canvas', 'switcher', 'bases', 'base', 'audio-recorder', 'format-converter'].includes(candId)
							) {
								return this.createVanillaItem(el, ariaLabel, normalizedLabel, index);
							}
						}
					}
				}
			}
		} catch (e) {}

		// Layer 3: Inspect active plugin instances (both Community and Internal Core) for direct DOM ownership
		try {
			// 3a. Community plugins
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
								const pName = p.manifest?.name || manifests?.[pId]?.name || pId;
								return this.createCommunityItem(el, pId, pName, ariaLabel, normalizedLabel, index);
							}
							if (Array.isArray(val)) {
								for (const item of val) {
									if (item === el || (item && item.actionEl === el)) {
										const pName = p.manifest?.name || manifests?.[pId]?.name || pId;
										return this.createCommunityItem(el, pId, pName, ariaLabel, normalizedLabel, index);
									}
								}
							}
						} catch (err) {}
					}
				}
			}

			// 3b. Internal / Core plugins
			if (internalPlugins) {
				for (const coreId of Object.keys(internalPlugins)) {
					const cp = internalPlugins[coreId];
					const inst = cp?.instance;
					if (!inst) continue;

					if (inst.ribbonIconEl === el || inst.actionEl === el || inst.ribbonEl === el) {
						return this.createVanillaItem(el, ariaLabel, normalizedLabel, index);
					}

					const propNames = Object.getOwnPropertyNames(inst);
					for (const prop of propNames) {
						try {
							const val = inst[prop];
							if (val === el || (val && val instanceof HTMLElement && (val === el || val.contains(el)))) {
								return this.createVanillaItem(el, ariaLabel, normalizedLabel, index);
							}
							if (Array.isArray(val)) {
								for (const item of val) {
									if (item === el || (item && item.actionEl === el)) {
										return this.createVanillaItem(el, ariaLabel, normalizedLabel, index);
									}
								}
							}
						} catch (err) {}
					}
				}
			}
		} catch (e) {}

		// Layer 4: Match against Obsidian Command Palette commands
		try {
			const commands = (this.app as any).commands?.commands as Record<string, { id: string; name: string; icon?: string }> | undefined;
			if (commands) {
				for (const cmdId of Object.keys(commands)) {
					const cmd = commands[cmdId];
					if (!cmd || !cmd.name) continue;
					const cName = cmd.name.trim().toLowerCase();
					if (cName === normalizedLabel || (cName.length >= 4 && (normalizedLabel.includes(cName) || cName.includes(normalizedLabel)))) {
						const parts = cmdId.split(':');
						const prefix = parts[0];
						if (manifests && manifests[prefix]) {
							return this.createCommunityItem(el, prefix, manifests[prefix].name, ariaLabel, normalizedLabel, index);
						}
						if (
							(internalPlugins && internalPlugins[prefix]) ||
							['app', 'workspace', 'vault', 'editor', 'view', 'window', 'markdown', 'file-explorer', 'graph', 'canvas', 'switcher', 'bases', 'base', 'audio-recorder', 'format-converter'].includes(prefix)
						) {
							return this.createVanillaItem(el, ariaLabel, normalizedLabel, index);
						}
					}
				}
			}
		} catch (e) {}

		// Layer 5: Match against Community Plugin Manifest names & significant keywords
		if (manifests) {
			for (const pId of Object.keys(manifests)) {
				const m = manifests[pId];
				const pName = (m.name || '').toLowerCase();
				const pIdLower = (m.id || '').toLowerCase();

				if (normalizedLabel.includes(pName) || normalizedLabel.includes(pIdLower)) {
					return this.createCommunityItem(el, m.id, m.name, ariaLabel, normalizedLabel, index);
				}

				// Check significant words in plugin name (e.g. "Calendar", "Tasks", "Excalidraw", "Slides")
				const words = pName.split(/[\s\-_]+/).filter(w => w.length >= 4 && !['obsidian', 'plugin', 'tool', 'editor', 'view'].includes(w));
				for (const w of words) {
					if (normalizedLabel.includes(w)) {
						return this.createCommunityItem(el, m.id, m.name, ariaLabel, normalizedLabel, index);
					}
				}
			}
		}

		// Layer 6: Dynamic Obsidian Core Plugins & Built-in detection (No hardcoding)
		if (internalPlugins) {
			for (const coreId of Object.keys(internalPlugins)) {
				const cp = internalPlugins[coreId];
				const coreName = (cp?.name || cp?.instance?.name || '').toLowerCase();
				const coreCleanId = coreId.replace(/[-_]+/g, ' ').toLowerCase();

				if (
					(coreName && (normalizedLabel.includes(coreName) || coreName.includes(normalizedLabel))) ||
					normalizedLabel.includes(coreCleanId) ||
					coreCleanId.includes(normalizedLabel)
				) {
					return this.createVanillaItem(el, ariaLabel, normalizedLabel, index);
				}

				const words = `${coreId} ${coreName}`.split(/[\s\-_]+/).filter(w => w.length >= 4 && !['open', 'show', 'toggle', 'create', 'view', 'item'].includes(w));
				for (const w of words) {
					if (normalizedLabel.includes(w)) {
						return this.createVanillaItem(el, ariaLabel, normalizedLabel, index);
					}
				}
			}
		}

		// Layer 7: Safe Fallback to Vanilla Obsidian (Core)
		// Any button present in the ribbon that is not a community plugin or PakCLI belongs to Obsidian Core / Vanilla.
		// Grouped together into the single "Vanilla Obsidian (Core)" group without hardcoded lists.
		return this.createVanillaItem(el, ariaLabel, normalizedLabel, index);
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
