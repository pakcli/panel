import { normalizePath } from 'obsidian';
import { AssetRouterSettings, FolderRule, TitleOverrideOption } from '../types';

export interface RoutingSimulationResult {
  mode: 'nested' | 'central' | 'excluded' | 'disabled';
  modeLabel: string;
  sourceNotePath: string;
  sampleAssetName: string;
  targetFolderPath: string;
  targetFileName: string;
  fullPath: string;
  appliedDelimiter: string;
  useTitle: boolean;
  subCaptainActive: boolean;
  explanation: string;
}

export interface RoutingSimulatorOptions {
  folderPath: string;
  sampleNoteName?: string;
  sampleAssetName?: string;
  settings: AssetRouterSettings;
  overrideMode?: 'nested' | 'central' | 'excluded';
  overrideUseTitle?: TitleOverrideOption;
  overrideDelimiter?: string;
  overrideRecursive?: boolean;
  overrideSubCaptain?: boolean;
}

/**
 * Pure simulation helper that dry-runs the Asset Router logic to preview exactly
 * how assets will be named and routed according to the rules and settings.
 */
export function simulateAssetRouting(options: RoutingSimulatorOptions): RoutingSimulationResult {
  const {
    folderPath,
    sampleNoteName = 'SampleNote',
    sampleAssetName = 'preview_image.png',
    settings,
    overrideMode,
    overrideUseTitle,
    overrideDelimiter,
    overrideRecursive,
    overrideSubCaptain,
  } = options;

  const cleanFolder = normalizePath(folderPath.trim());
  const delimiter = overrideDelimiter !== undefined && overrideDelimiter.trim().length > 0
    ? overrideDelimiter
    : (settings.delimiter || '_');

  const sourceNotePath = cleanFolder ? `${cleanFolder}/${sampleNoteName}.md` : `${sampleNoteName}.md`;

  // 1. Check Exclusion
  const isExcluded = overrideMode === 'excluded' || (
    overrideMode === undefined && (
      (settings.excludedFolders && settings.excludedFolders.includes(cleanFolder)) ||
      ((settings as any).excludedAssetDirectories && (settings as any).excludedAssetDirectories.includes(cleanFolder))
    )
  );

  if (isExcluded) {
    return {
      mode: 'excluded',
      modeLabel: '⛔ Excluded from Asset Router',
      sourceNotePath,
      sampleAssetName,
      targetFolderPath: cleanFolder || 'root',
      targetFileName: sampleAssetName,
      fullPath: cleanFolder ? `${cleanFolder}/${sampleAssetName}` : sampleAssetName,
      appliedDelimiter: delimiter,
      useTitle: false,
      subCaptainActive: false,
      explanation: 'Preserves native Obsidian behavior. Asset remains in note folder or default vault attachments without renaming.',
    };
  }

  // 2. Check Nested Captain Mode
  let isNested = overrideMode === 'nested';
  let matchedRule: FolderRule | null = null;

  if (overrideMode === undefined) {
    const activeRules = (settings.rules || []).filter(r => r.enabled && r.assetRouterEnabled !== false);
    for (const rule of activeRules) {
      const normRule = normalizePath(rule.path);
      if (cleanFolder === normRule || (rule.includeChildren && cleanFolder.startsWith(normRule + '/'))) {
        matchedRule = rule;
        isNested = rule.isNested;
        break;
      }
    }
  }

  if (isNested) {
    const subCaptain = overrideSubCaptain !== undefined
      ? overrideSubCaptain
      : (matchedRule?.subCaptainMode ?? false);

    const useTitleOpt: TitleOverrideOption = overrideUseTitle !== undefined
      ? overrideUseTitle
      : (matchedRule?.useNoteTitle ?? 'inherit');

    const useTitle = useTitleOpt === 'always'
      ? true
      : (useTitleOpt === 'never' ? false : settings.useNoteTitleGlobalNested);

    const targetFolder = cleanFolder ? `${cleanFolder}/assets` : 'assets';
    const noteId = sampleNoteName;
    const targetFileName = `${noteId}${delimiter}${sampleAssetName}`;
    const fullPath = `${targetFolder}/${targetFileName}`;

    return {
      mode: 'nested',
      modeLabel: '⭐ Nested Captain Folder',
      sourceNotePath,
      sampleAssetName,
      targetFolderPath: targetFolder,
      targetFileName,
      fullPath,
      appliedDelimiter: delimiter,
      useTitle,
      subCaptainActive: subCaptain,
      explanation: `Stored locally in "${targetFolder}". Prefixed with note name "${noteId}".`,
    };
  }

  // 3. Centralized Vault Mode
  if (!settings.centralAssetFolderEnabled) {
    return {
      mode: 'disabled',
      modeLabel: '⚪ Router Inactive (Default Obsidian)',
      sourceNotePath,
      sampleAssetName,
      targetFolderPath: cleanFolder || 'root',
      targetFileName: sampleAssetName,
      fullPath: cleanFolder ? `${cleanFolder}/${sampleAssetName}` : sampleAssetName,
      appliedDelimiter: delimiter,
      useTitle: false,
      subCaptainActive: false,
      explanation: 'Central asset folder is disabled and no nested captain rule matched.',
    };
  }

  const centralFolder = normalizePath(settings.centralAssetFolder || 'assets');
  const folderPrefix = cleanFolder ? cleanFolder.split('/').join(delimiter) : '';
  const noteId = sampleNoteName;
  const prefix = folderPrefix ? `${folderPrefix}${delimiter}${noteId}` : noteId;
  const targetFileName = `${prefix}${delimiter}${sampleAssetName}`;
  const fullPath = `${centralFolder}/${targetFileName}`;

  return {
    mode: 'central',
    modeLabel: '🏢 Central Vault Asset Folder',
    sourceNotePath,
    sampleAssetName,
    targetFolderPath: centralFolder,
    targetFileName,
    fullPath,
    appliedDelimiter: delimiter,
    useTitle: settings.useNoteTitleGlobalCentral,
    subCaptainActive: false,
    explanation: `Stored in root central folder "${centralFolder}/" with path prefix "${prefix}".`,
  };
}
