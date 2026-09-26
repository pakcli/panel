import { App, Plugin, debounce } from 'obsidian';
import { RibbonDetector, DetectedRibbonElement } from './ribbonDetector';
import {
	RibbonItemConfig,
	RibbonGroupConfig,
	RibbonManagerSettings,
	RibbonGroupSpacing,
	RibbonDividerStyle,
	DEFAULT_RIBBON_MANAGER_SETTINGS
} from './types';

export class RibbonManager {
	private app: App;
	private plugin: Plugin;
	private detector: RibbonDetector;
	private observer: MutationObserver | null = null;
	private isApplyingLayout = false;
	private debouncedApplyLayout: () => void;
	private cachedDetectedItems: Map<string, RibbonItemConfig> = new Map();

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		this.detector = new RibbonDetector(app, () => {
			this.scheduleApplyLayout();
		});

		this.debouncedApplyLayout = debounce(() => {
			this.applyLayout();
		}, 250, false);
	}

	private get settings(): RibbonManagerSettings {
		const s = (this.plugin as any).settings as RibbonManagerSettings;
		return {
			enableRibbonGrouping: s?.enableRibbonGrouping ?? DEFAULT_RIBBON_MANAGER_SETTINGS.enableRibbonGrouping,
			ribbonGroupSpacing: s?.ribbonGroupSpacing ?? DEFAULT_RIBBON_MANAGER_SETTINGS.ribbonGroupSpacing,
			ribbonDividerStyle: s?.ribbonDividerStyle ?? DEFAULT_RIBBON_MANAGER_SETTINGS.ribbonDividerStyle,
			ribbonGroupSortOrder: s?.ribbonGroupSortOrder ?? DEFAULT_RIBBON_MANAGER_SETTINGS.ribbonGroupSortOrder,
			ribbonHiddenItemIds: s?.ribbonHiddenItemIds ?? DEFAULT_RIBBON_MANAGER_SETTINGS.ribbonHiddenItemIds,
			ribbonItemSortOrder: s?.ribbonItemSortOrder ?? DEFAULT_RIBBON_MANAGER_SETTINGS.ribbonItemSortOrder,
		};
	}

	private async saveSettings(): Promise<void> {
		if (typeof (this.plugin as any).saveSettings === 'function') {
			await (this.plugin as any).saveSettings();
		}
	}

	/**
	 * Initialize the Ribbon Manager: hook prototype, start observer, apply layout.
	 */
	public init(): void {
		this.detector.hookPluginPrototype();

		// Schedule layout after Obsidian layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.startObserver();
			this.applyLayout();
		});
	}

	/**
	 * Cleanup on plugin unload.
	 */
	public destroy(): void {
		this.stopObserver();
		this.detector.unhookPluginPrototype();
		this.restoreVanillaLayout();
	}

	/**
	 * Schedule a layout refresh (debounced).
	 */
	public scheduleApplyLayout(): void {
		this.debouncedApplyLayout();
	}

	/**
	 * Start observing the ribbon action container for dynamic button changes.
	 */
	private startObserver(): void {
		const container = this.detector.getRibbonActionsContainer();
		if (!container) return;

		this.stopObserver();
		this.observer = new MutationObserver((mutations) => {
			if (this.isApplyingLayout) return;

			let hasRelevantChange = false;
			for (const mut of mutations) {
				if (mut.type === 'childList') {
					for (let i = 0; i < mut.addedNodes.length; i++) {
						const node = mut.addedNodes[i] as HTMLElement;
						if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('pakcli-ribbon-injected')) {
							hasRelevantChange = true;
							break;
						}
					}
					if (hasRelevantChange) break;
					for (let i = 0; i < mut.removedNodes.length; i++) {
						const node = mut.removedNodes[i] as HTMLElement;
						if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('pakcli-ribbon-injected')) {
							hasRelevantChange = true;
							break;
						}
					}
					if (hasRelevantChange) break;
				}
			}

			if (hasRelevantChange) {
				this.scheduleApplyLayout();
			}
		});

		this.observer.observe(container, { childList: true });
	}

	private stopObserver(): void {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
	}

	/**
	 * Restore original ribbon appearance and remove all injected elements.
	 */
	private restoreVanillaLayout(): void {
		const container = this.detector.getRibbonActionsContainer();
		if (!container) return;

		// Remove all injected dividers & spacers
		container.querySelectorAll('.pakcli-ribbon-injected').forEach(el => el.remove());

		// Unhide all buttons
		container.querySelectorAll('.pakcli-ribbon-hidden').forEach(el => {
			el.classList.remove('pakcli-ribbon-hidden');
		});
	}

	/**
	 * Get structured detected groups and items for Settings UI rendering.
	 */
	public getDiscoveredGroups(): RibbonGroupConfig[] {
		const detected = this.detector.scanRibbonButtons();
		const currentSettings = this.settings;
		const hiddenSet = new Set(currentSettings.ribbonHiddenItemIds || []);

		// Update cached items
		detected.forEach(d => {
			d.itemConfig.visible = !hiddenSet.has(d.itemConfig.id);
			this.cachedDetectedItems.set(d.itemConfig.id, d.itemConfig);
		});

		// Group items by pluginId
		const groupMap: Map<string, RibbonGroupConfig> = new Map();

		detected.forEach(d => {
			const item = d.itemConfig;
			if (!groupMap.has(item.pluginId)) {
				groupMap.set(item.pluginId, {
					id: item.pluginId,
					name: item.pluginName,
					isVanilla: item.pluginId === 'vanilla',
					items: [],
					order: item.pluginId === 'vanilla' ? 0 : 999
				});
			}
			groupMap.get(item.pluginId)!.items.push(item);
		});

		// Sort items within each group
		groupMap.forEach((grp, grpId) => {
			const customOrder = currentSettings.ribbonItemSortOrder[grpId] || [];
			if (customOrder.length > 0) {
				const orderMap = new Map<string, number>();
				customOrder.forEach((id, idx) => orderMap.set(id, idx));

				grp.items.sort((a, b) => {
					const orderA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999;
					const orderB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999;
					return orderA - orderB;
				});
			}
		});

		// Sort groups according to ribbonGroupSortOrder
		const groups = Array.from(groupMap.values());
		const groupSortOrder = currentSettings.ribbonGroupSortOrder || [];
		if (groupSortOrder.length > 0) {
			const gOrderMap = new Map<string, number>();
			groupSortOrder.forEach((id, idx) => gOrderMap.set(id, idx));

			groups.sort((a, b) => {
				const defaultPosA = a.isVanilla ? -2 : (a.id === 'pakcli-panel' ? -1 : 999);
				const defaultPosB = b.isVanilla ? -2 : (b.id === 'pakcli-panel' ? -1 : 999);
				const posA = gOrderMap.has(a.id) ? gOrderMap.get(a.id)! : defaultPosA;
				const posB = gOrderMap.has(b.id) ? gOrderMap.get(b.id)! : defaultPosB;
				return posA - posB;
			});
		} else {
			// Default: Vanilla at top, then PakCLI Table, then alphabetical by plugin name
			groups.sort((a, b) => {
				if (a.isVanilla && !b.isVanilla) return -1;
				if (!a.isVanilla && b.isVanilla) return 1;
				if (a.id === 'pakcli-panel' && b.id !== 'pakcli-panel') return -1;
				if (a.id !== 'pakcli-panel' && b.id === 'pakcli-panel') return 1;
				return a.name.localeCompare(b.name);
			});
		}

		return groups;
	}

	/**
	 * Core DOM Layout Engine: Sorts and groups buttons, adds spacers/dividers, applies visibility.
	 */
	public applyLayout(): void {
		const container = this.detector.getRibbonActionsContainer();
		if (!container) return;

		const currentSettings = this.settings;

		// If grouping is completely disabled, revert to flat unspaced ribbon
		if (!currentSettings.enableRibbonGrouping) {
			this.restoreVanillaLayout();
			return;
		}

		this.isApplyingLayout = true;
		try {
			const detected = this.detector.scanRibbonButtons();
			if (detected.length === 0) return;

			const hiddenSet = new Set(currentSettings.ribbonHiddenItemIds || []);
			const elementMap = new Map<string, HTMLElement>();

			detected.forEach(d => {
				elementMap.set(d.itemConfig.id, d.element);
			});

			// Get ordered groups and items
			const groups = this.getDiscoveredGroups();

			// Build list of target visible action elements in desired order
			const targetActionElements: HTMLElement[] = [];
			groups.forEach(grp => {
				grp.items.forEach(item => {
					if (!hiddenSet.has(item.id)) {
						const el = elementMap.get(item.id);
						if (el) targetActionElements.push(el);
					}
				});
			});

			// Check current non-injected children in container
			const currentActionElements = Array.from(container.children).filter(
				(c) => !c.classList.contains('pakcli-ribbon-injected')
			) as HTMLElement[];

			let isAlreadyInOrder = currentActionElements.length === targetActionElements.length;
			if (isAlreadyInOrder) {
				for (let i = 0; i < targetActionElements.length; i++) {
					if (currentActionElements[i] !== targetActionElements[i]) {
						isAlreadyInOrder = false;
						break;
					}
				}
			}

			// Filter only visible groups (groups with at least 1 visible item)
			const visibleGroups = groups.filter(grp => grp.items.some(item => !hiddenSet.has(item.id)));
			const expectedDividerCount = Math.max(0, visibleGroups.length - 1);
			const existingDividers = container.querySelectorAll('.pakcli-ribbon-injected');

			// If already in exact target order and dividers match, DO NOT touch DOM (prevents dropped clicks!)
			if (isAlreadyInOrder && existingDividers.length === expectedDividerCount) {
				return;
			}

			// Remove old injected elements
			container.querySelectorAll('.pakcli-ribbon-injected').forEach(el => el.remove());

			groups.forEach(grp => {
				const isGrpVisible = grp.items.some(item => !hiddenSet.has(item.id));

				grp.items.forEach(item => {
					const el = elementMap.get(item.id);
					if (el) {
						if (hiddenSet.has(item.id)) {
							el.classList.add('pakcli-ribbon-hidden');
						} else {
							el.classList.remove('pakcli-ribbon-hidden');
						}
						// Move element to bottom of container in organized order
						container.appendChild(el);
					}
				});

				// Insert spacer/divider if this group is visible and not the last visible group
				if (isGrpVisible && visibleGroups.indexOf(grp) < visibleGroups.length - 1) {
					const divider = document.createElement('div');
					divider.className = `pakcli-ribbon-injected pakcli-ribbon-divider mod-${currentSettings.ribbonDividerStyle} mod-spacing-${currentSettings.ribbonGroupSpacing}`;
					divider.setAttribute('data-group-divider', grp.id);
					container.appendChild(divider);
				}
			});
		} catch (err) {
			console.error('[PakCLI Ribbon] Error applying ribbon layout:', err);
		} finally {
			this.isApplyingLayout = false;
		}
	}

	// ==================== Settings Manipulation Helpers ====================

	public async toggleItemVisibility(itemId: string, visible: boolean): Promise<void> {
		const pluginSettings = (this.plugin as any).settings as RibbonManagerSettings;
		const hiddenList = new Set(pluginSettings.ribbonHiddenItemIds || []);

		if (visible) {
			hiddenList.delete(itemId);
		} else {
			hiddenList.add(itemId);
		}

		pluginSettings.ribbonHiddenItemIds = Array.from(hiddenList);
		await this.saveSettings();
		this.applyLayout();
	}

	public async reorderGroups(newGroupIds: string[]): Promise<void> {
		const pluginSettings = (this.plugin as any).settings as RibbonManagerSettings;
		pluginSettings.ribbonGroupSortOrder = newGroupIds;
		await this.saveSettings();
		this.applyLayout();
	}

	public async reorderItemsInGroup(groupId: string, newItemIds: string[]): Promise<void> {
		const pluginSettings = (this.plugin as any).settings as RibbonManagerSettings;
		if (!pluginSettings.ribbonItemSortOrder) {
			pluginSettings.ribbonItemSortOrder = {};
		}
		pluginSettings.ribbonItemSortOrder[groupId] = newItemIds;
		await this.saveSettings();
		this.applyLayout();
	}

	public async setGroupSpacing(spacing: RibbonGroupSpacing): Promise<void> {
		const pluginSettings = (this.plugin as any).settings as RibbonManagerSettings;
		pluginSettings.ribbonGroupSpacing = spacing;
		await this.saveSettings();
		this.applyLayout();
	}

	public async setDividerStyle(style: RibbonDividerStyle): Promise<void> {
		const pluginSettings = (this.plugin as any).settings as RibbonManagerSettings;
		pluginSettings.ribbonDividerStyle = style;
		await this.saveSettings();
		this.applyLayout();
	}

	public async setEnableGrouping(enabled: boolean): Promise<void> {
		const pluginSettings = (this.plugin as any).settings as RibbonManagerSettings;
		pluginSettings.enableRibbonGrouping = enabled;
		await this.saveSettings();
		this.applyLayout();
	}

	public async resetToDefaults(): Promise<void> {
		const pluginSettings = (this.plugin as any).settings as RibbonManagerSettings;
		pluginSettings.enableRibbonGrouping = DEFAULT_RIBBON_MANAGER_SETTINGS.enableRibbonGrouping;
		pluginSettings.ribbonGroupSpacing = DEFAULT_RIBBON_MANAGER_SETTINGS.ribbonGroupSpacing;
		pluginSettings.ribbonDividerStyle = DEFAULT_RIBBON_MANAGER_SETTINGS.ribbonDividerStyle;
		pluginSettings.ribbonGroupSortOrder = [];
		pluginSettings.ribbonHiddenItemIds = [];
		pluginSettings.ribbonItemSortOrder = {};
		await this.saveSettings();
		this.applyLayout();
	}
}
