export type TitleOverrideOption = 'inherit' | 'always' | 'never';

export type CaptainFolderOverrideMode =
	| 'none'
	| 'text_only'
	| 'text_icon'
	| 'text_icon_badge'
	| 'text_icon_badge_chevron'
	| 'all';

export interface FolderRule {
	path: string;            // Vault relative path (e.g. "folderb" or "folderb/*")
	isNested: boolean;       // If true, this is a Nested (Captain Folder)
	includeChildren: boolean;// If true, rules apply recursively to subfolders
	subCaptainMode?: boolean;// If true, each subfolder acts as a Sub-Captain with its own assets/ directory
	useNoteTitle: TitleOverrideOption; // 'inherit' from global, or force override
	enabled: boolean;        // Individual rule toggle
	color?: string;          // Hex color code for Captain Folder (defaults to dark gray #4a5568)
	explorerOverride?: CaptainFolderOverrideMode; // Explorer tree override mode
}

export interface AssetRouterSettings {
	centralAssetFolderEnabled: boolean;  // Toggle for centralized mode
	centralAssetFolder: string;          // e.g. "assets" at vault root
	useNoteTitleGlobalCentral: boolean;  // Global toggle for Centralized mode
	useNoteTitleGlobalNested: boolean;   // Global default toggle for Nested mode
	rules: FolderRule[];                 // List of folder overrides
	delimiter: string;                   // e.g. "-"
	assetExtensions: string[];           // e.g. ["png", "jpg", "jpeg", "pdf"]
	excludedFolders?: string[];          // Excluded directories from asset routing
}
