export interface RibbonItemConfig {
	id: string; // Unique key: e.g. "pluginId::ariaLabel"
	title: string; // Button tooltip / aria-label
	pluginId: string; // "vanilla" or plugin manifest id
	pluginName: string; // Friendly display name (e.g. "Vanilla Obsidian", "Dataview")
	svgHtml?: string; // Cached icon SVG HTML for UI preview
	visible: boolean; // Show or hide toggle
	order: number; // Order index within group
}

export interface RibbonGroupConfig {
	id: string; // "vanilla" or plugin id
	name: string; // Display title of the group
	isVanilla: boolean; // Whether this is Obsidian core/vanilla
	items: RibbonItemConfig[];
	order: number; // Sort order of group
}

export type RibbonGroupSpacing = 'compact' | 'medium' | 'large';
export type RibbonDividerStyle = 'space' | 'hairline' | 'dot';

export interface RibbonManagerSettings {
	enableRibbonGrouping: boolean;
	ribbonGroupSpacing: RibbonGroupSpacing;
	ribbonDividerStyle: RibbonDividerStyle;
	ribbonGroupSortOrder: string[]; // Order of group IDs
	ribbonHiddenItemIds: string[]; // List of item IDs toggled OFF (hidden)
	ribbonItemSortOrder: Record<string, string[]>; // groupId -> array of item IDs in order
}

export const DEFAULT_RIBBON_MANAGER_SETTINGS: RibbonManagerSettings = {
	enableRibbonGrouping: true,
	ribbonGroupSpacing: 'medium',
	ribbonDividerStyle: 'hairline',
	ribbonGroupSortOrder: [],
	ribbonHiddenItemIds: [],
	ribbonItemSortOrder: {},
};
