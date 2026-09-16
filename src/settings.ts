import { AssetRouterSettings } from './features/tree/types';
import { TablitePluginData as SQLSealSettings, DEFAULT_PLUGIN_DATA as DEFAULT_SQLSEAL_SETTINGS, CalcPreset, DEFAULT_CALC_PRESETS } from './features/sqlseal/types';
export type { CalcPreset };
export { DEFAULT_CALC_PRESETS };
import { BasesLeafletViewSettings } from './features/leaflet/types';
import { CodeblockLanguageRule } from './features/codeblock/scaler';
import { ExplorerSettings, DEFAULT_EXPLORER_SETTINGS, ExplorerSectionId } from './features/explorer/types';
export type { ExplorerSectionId, ExplorerSettings };

export type BubbleGraphIntegrationMode = 'deactivate' | 'replace' | 'second';
export type BubbleNodeGlyphOption = 'no-dot' | 'dot' | 'plus' | 'minus' | 'i' | 'square' | 'ring' | 'star';
export type BubbleNodeImageBorder = 'noborder' | 'thin' | 'thick';

export interface RelationshipTierConfig {
    id: string;
    name: string;
    min: number;
    max: number;
    color: string;
    folderName: string;
}

export type RelationshipMode = '1dir' | 'subfolders';
export type RelationshipViewStructure = 'flat' | 'range' | 'concentric';

export interface RelationshipFolderEntry {
    id: string;
    path: string;
    mode?: RelationshipMode;
    viewStructure?: RelationshipViewStructure;
    label?: string;
    createdAt?: number;
}

export const DEFAULT_RELATIONSHIP_TIERS: RelationshipTierConfig[] = [
    { id: 'household', name: 'Household', min: 0.81, max: 1.00, color: '#10b981', folderName: '1 - Household' },
    { id: 'family', name: 'Family', min: 0.61, max: 0.80, color: '#f59e0b', folderName: '2 - Family' },
    { id: 'close_friends', name: 'Close Friends', min: 0.41, max: 0.60, color: '#8b5cf6', folderName: '3 - Close Friends' },
    { id: 'friends', name: 'Friends', min: 0.21, max: 0.40, color: '#06b6d4', folderName: '4 - Friends' },
    { id: 'know', name: 'Know', min: 0.01, max: 0.20, color: '#64748b', folderName: '5 - Know' },
    { id: 'enemy', name: 'Enemy', min: 0.00, max: 0.00, color: '#ef4444', folderName: '6 - Enemy' },
];

export interface BubbleGraphSettings {
    bubbleGraphMode: BubbleGraphIntegrationMode;
    bubbleRibbonIcon: string;
    bubbleMaxDragDepth: number;
    bubbleSimulationLocked?: boolean;
    bubbleDefaultLayout: 'bubble' | 'default';
    bubbleHullOpacity: number;
    bubbleShowLines: boolean;
    bubbleShowLabels: boolean;
    bubbleLabelMode: 'all' | 'folder' | 'text' | 'custom' | 'off' | 'hide';
    bubbleLabelCustomFormats: string;
    bubbleShowVennBridges: boolean;
    bubbleIntraLinkOpacity: number;
    bubbleInterLinkGlow: boolean;
    bubbleClusterPadding: number;
    bubbleTimelapseMode: 'vanilla' | 'time' | 'filename' | 'title' | 'date';
    bubbleTimelapseVanillaSpeed: number;
    bubbleTimelapseDateFormat: string;
    bubbleUseCaptainColors: boolean;
    bubbleMaxClusterDepth: number;
    bubbleShowBreadcrumbs: boolean;
    bubbleDenseScale: number;
    bubbleLabelRangeLevel: number;
    bubbleLabelMinLevel: number;
    bubbleLabelMaxLevel: number;
    bubbleLabelFontSize: number;
    bubbleInspectorOpen: boolean;
    bubbleHeaderSettingsOpen?: boolean;
    bubbleFloatingToolsOpen?: boolean;
    bubbleFooterOpen?: boolean;
    bubbleAutoFitMode?: 'off' | 'fit' | 'center';
    bubbleAlwaysFit?: boolean;
    bubbleEnableSfx: boolean;
    bubbleSfxVolume: number;
    bubbleSfxThreshold: number;
    bubbleGlyphIsolated: BubbleNodeGlyphOption;
    bubbleGlyphOutgoing: BubbleNodeGlyphOption;
    bubbleGlyphIncoming: BubbleNodeGlyphOption;
    bubbleGlyphBoth: BubbleNodeGlyphOption;
    bubbleEnableNodeImageCover: boolean;
    bubbleNodeImageBorder: BubbleNodeImageBorder;
    familyCirclesRootFolder?: string;
    relationshipMode?: RelationshipMode;
    relationshipPropertyKey?: string;
    relationshipTiers?: RelationshipTierConfig[];
    explorerRelationshipVirtualFolders?: boolean;
    relationshipViewStructure?: RelationshipViewStructure;
    relationshipFolders?: RelationshipFolderEntry[];
}

export interface PakCLITableSettings extends 
    AssetRouterSettings, 
    SQLSealSettings, 
    BasesLeafletViewSettings,
    BubbleGraphSettings,
    ExplorerSettings 
{
    dateFormat: string;
    codeblockWrapMode: 'flowclip' | 'wrap' | 'scalefit';
    codeblockLanguageRules: CodeblockLanguageRule[];
    enableAssetDrag: boolean;
    enableCsvEditor?: boolean;
    gridTheme?: string;
    csvArtifactFolderPath: string;
    enableTreeProcessor?: boolean;
    defaultTreeLayout?: string;
    fileConfigs?: Record<string, unknown>;
    carouselOrientation?: 'horizontal' | 'vertical';
    carouselVisibleSideCards?: number;
    carouselCursorFollow?: boolean;
    carouselDirection?: 'left-right' | 'left' | 'right';
    carouselAnimationCurve?: 'linear' | 'exponential';
    carouselSwitchDuration?: number;
    carouselHoldDuration?: number;
    carouselAutoPlay?: boolean;
    [key: string]: unknown;
}

export const DEFAULT_ASSET_ROUTER_SETTINGS: AssetRouterSettings = {
	centralAssetFolderEnabled: true,
	centralAssetFolder: "assets",
	useNoteTitleGlobalCentral: false,
	useNoteTitleGlobalNested: false,
	rules: [],
	delimiter: "_",
	assetExtensions: ["png", "jpg", "jpeg", "gif", "svg", "pdf", "mp3", "mp4", "wav", "webm", "ogg", "m4a", "xls", "xlsx", "doc", "docx", "zip", "tar", "gz"]
};

export const DEFAULT_LEAFLET_SETTINGS: BasesLeafletViewSettings = {
    enableMeasureTool: true,
    enableCopyTool: true,
    iconData: [],
    defaultOsm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileTheme: "auto"
};

export const DEFAULT_BUBBLE_GRAPH_SETTINGS: BubbleGraphSettings = {
    bubbleGraphMode: 'second',
    bubbleRibbonIcon: 'circle-dot',
    bubbleMaxDragDepth: 2,
    bubbleSimulationLocked: false,
    bubbleDefaultLayout: 'bubble',
    bubbleHullOpacity: 0.12,
    bubbleShowLabels: true,
    bubbleLabelMode: 'all',
    bubbleLabelCustomFormats: 'md, canvas, json, base, csv, folder',
    bubbleShowLines: true,
    bubbleShowVennBridges: true,
    bubbleIntraLinkOpacity: 0.2,
    bubbleInterLinkGlow: true,
    bubbleClusterPadding: 40,
    bubbleTimelapseMode: 'vanilla',
    bubbleTimelapseVanillaSpeed: 0.025,
    bubbleTimelapseDateFormat: 'DD - MM - YYYY',
    bubbleUseCaptainColors: false,
    bubbleMaxClusterDepth: 3,
    bubbleShowBreadcrumbs: true,
    bubbleDenseScale: 1.15,
    bubbleLabelRangeLevel: 2,
    bubbleLabelMinLevel: 1,
    bubbleLabelMaxLevel: 2,
    bubbleLabelFontSize: 11,
    bubbleInspectorOpen: true,
    bubbleHeaderSettingsOpen: true,
    bubbleFloatingToolsOpen: true,
    bubbleFooterOpen: true,
    bubbleAutoFitMode: 'off',
    bubbleAlwaysFit: false,
    bubbleEnableSfx: true,
    bubbleSfxVolume: 0.35,
    bubbleSfxThreshold: 1.0,
    bubbleGlyphIsolated: 'no-dot',
    bubbleGlyphOutgoing: 'plus',
    bubbleGlyphIncoming: 'minus',
    bubbleGlyphBoth: 'i',
    bubbleEnableNodeImageCover: true,
    bubbleNodeImageBorder: 'thick',
    familyCirclesRootFolder: 'Relationships',
    relationshipMode: '1dir',
    relationshipPropertyKey: 'closeness',
    relationshipTiers: DEFAULT_RELATIONSHIP_TIERS,
    explorerRelationshipVirtualFolders: false,
    relationshipViewStructure: 'flat',
    relationshipFolders: [
        { id: 'rel_default', path: 'Relationships', mode: '1dir', viewStructure: 'flat', label: 'Primary Relationships' }
    ],
};

export const DEFAULT_TABLE_SETTINGS: PakCLITableSettings = {
    ...DEFAULT_ASSET_ROUTER_SETTINGS,
    ...DEFAULT_SQLSEAL_SETTINGS,
    ...DEFAULT_LEAFLET_SETTINGS,
    ...DEFAULT_BUBBLE_GRAPH_SETTINGS,
    ...DEFAULT_EXPLORER_SETTINGS,
    dateFormat: '_{yyyy}{mm}{dd}',
    codeblockWrapMode: 'flowclip',
    codeblockLanguageRules: [
        { id: '1', language: 'ascii', behavior: 'scalefit' }
    ],
    enableAssetDrag: true,
    carouselOrientation: 'horizontal',
    carouselVisibleSideCards: 5,
    carouselCursorFollow: false,
    carouselDirection: 'left-right',
    carouselAnimationCurve: 'exponential',
    carouselSwitchDuration: 0.5,
    carouselHoldDuration: 1.0,
    carouselAutoPlay: true,
};

