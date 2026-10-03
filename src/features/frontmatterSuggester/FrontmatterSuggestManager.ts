import { App, EventRef, normalizePath, TFile, TFolder } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import {
  FrontmatterSuggestRule,
  FrontmatterSuggesterSettings
} from './types';

interface CachedValues {
  timestamp: number;
  values: string[];
}

export class FrontmatterSuggestManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private originalGetFrontmatterPropertyValues: ((key: string) => string[]) | null = null;
  private originalMetadataTypeGetValues: ((key: string) => string[]) | null = null;
  private originalMetadataTypeGetAssignedValues: ((key: string) => string[]) | null = null;
  private cacheByRuleId: Map<string, CachedValues> = new Map();
  private eventRefs: EventRef[] = [];

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init(): void {
    this.patchObsidianSuggesters();
    this.registerCacheInvalidation();
  }

  public destroy(): void {
    this.unpatchObsidianSuggesters();
    for (const ref of this.eventRefs) {
      this.app.metadataCache.offref(ref);
    }
    this.eventRefs = [];
    this.cacheByRuleId.clear();
  }

  /** Clears cache so next property lookup scans latest frontmatter */
  public invalidateCache(): void {
    this.cacheByRuleId.clear();
  }

  /** Resolves active markdown or .base file in workspace */
  public getActiveFileOrBase(): TFile | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) return activeFile;

    const activeLeaf = (this.app.workspace as any).activeLeaf;
    if (activeLeaf?.view?.file instanceof TFile) {
      return activeLeaf.view.file;
    }

    const mostRecent = this.app.workspace.getMostRecentLeaf();
    if (mostRecent && (mostRecent.view as any)?.file instanceof TFile) {
      return (mostRecent.view as any).file;
    }

    const leaves = this.app.workspace.getLeavesOfType('base');
    for (const leaf of leaves) {
      if ((leaf.view as any)?.file instanceof TFile) {
        return (leaf.view as any).file;
      }
    }

    return null;
  }

  /** Checks whether a folder path exists in the vault */
  public isFolderValid(folderPath: string): boolean {
    if (!folderPath || !folderPath.trim()) return false;
    const clean = normalizePath(folderPath.trim());
    if (clean === '' || clean === '/') return true;
    const abstract = this.app.vault.getAbstractFileByPath(clean);
    return abstract instanceof TFolder;
  }

  /**
   * Patches Obsidian's native property suggestion endpoints
   */
  private patchObsidianSuggesters(): void {
    const metaCache = this.app.metadataCache as any;
    if (metaCache && typeof metaCache.getFrontmatterPropertyValuesForKey === 'function') {
      this.originalGetFrontmatterPropertyValues = metaCache.getFrontmatterPropertyValuesForKey;
      metaCache.getFrontmatterPropertyValuesForKey = (key: string) => {
        const customValues = this.getCustomValuesForKey(key);
        if (customValues !== null) {
          return customValues;
        }
        return this.originalGetFrontmatterPropertyValues
          ? this.originalGetFrontmatterPropertyValues.call(metaCache, key)
          : [];
      };
    }

    const typeManager = (this.app as any).metadataTypeManager;
    if (typeManager && typeof typeManager.getPropertyValues === 'function') {
      this.originalMetadataTypeGetValues = typeManager.getPropertyValues;
      typeManager.getPropertyValues = (key: string) => {
        const customValues = this.getCustomValuesForKey(key);
        if (customValues !== null) {
          return customValues;
        }
        return this.originalMetadataTypeGetValues
          ? this.originalMetadataTypeGetValues.call(typeManager, key)
          : [];
      };
    }

    if (typeManager && typeof typeManager.getAssignedValues === 'function') {
      this.originalMetadataTypeGetAssignedValues = typeManager.getAssignedValues;
      typeManager.getAssignedValues = (key: string) => {
        const customValues = this.getCustomValuesForKey(key);
        if (customValues !== null) {
          return customValues;
        }
        return this.originalMetadataTypeGetAssignedValues
          ? this.originalMetadataTypeGetAssignedValues.call(typeManager, key)
          : [];
      };
    }
  }

  /**
   * Unpatches methods cleanly on plugin unload
   */
  private unpatchObsidianSuggesters(): void {
    const metaCache = this.app.metadataCache as any;
    if (this.originalGetFrontmatterPropertyValues && metaCache) {
      metaCache.getFrontmatterPropertyValuesForKey = this.originalGetFrontmatterPropertyValues;
      this.originalGetFrontmatterPropertyValues = null;
    }

    const typeManager = (this.app as any).metadataTypeManager;
    if (this.originalMetadataTypeGetValues && typeManager) {
      typeManager.getPropertyValues = this.originalMetadataTypeGetValues;
      this.originalMetadataTypeGetValues = null;
    }

    if (this.originalMetadataTypeGetAssignedValues && typeManager) {
      typeManager.getAssignedValues = this.originalMetadataTypeGetAssignedValues;
      this.originalMetadataTypeGetAssignedValues = null;
    }
  }

  /**
   * Invalidates cache when files change, rename, or are deleted
   */
  private registerCacheInvalidation(): void {
    const onVaultChange = () => {
      this.cacheByRuleId.clear();
    };

    this.eventRefs.push(this.app.metadataCache.on('changed', onVaultChange));
    this.eventRefs.push(this.app.vault.on('rename', onVaultChange));
    this.eventRefs.push(this.app.vault.on('delete', onVaultChange));
  }

  /**
   * Resolves custom suggestions for a given property key, or returns null to fallback
   */
  public getCustomValuesForKey(key: string): string[] | null {
    const settings = this.plugin.settings as any;
    if (settings.enableFrontmatterSuggester === false) {
      return null;
    }

    const rules: FrontmatterSuggestRule[] = settings.frontmatterSuggestRules || [];
    const lowerKey = (key || '').toLowerCase().trim();
    if (!lowerKey) return null;

    // Find enabled rule matching key or alias
    const matchedRule = rules.find((rule) => {
      if (!rule.enabled) return false;
      const keys = rule.propertyKey
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      return keys.includes(lowerKey);
    });

    if (!matchedRule) {
      return null;
    }

    // Check scope if applyToAllBases is false
    if (!matchedRule.applyToAllBases) {
      const activeFile = this.getActiveFileOrBase();
      if (!activeFile) return null;

      const activeDirPath = normalizePath(activeFile.parent?.path || '');
      const isInActiveDir = matchedRule.directories
        .filter((d) => d.active)
        .some((d) => {
          const normDir = normalizePath(d.path);
          return (
            activeDirPath === normDir ||
            activeDirPath.startsWith(normDir + '/')
          );
        });

      if (!isInActiveDir) {
        return null;
      }
    }

    // Return cached or compute
    const cached = this.cacheByRuleId.get(matchedRule.id);
    if (cached && Date.now() - cached.timestamp < 30000) {
      return cached.values;
    }

    const values = this.computeDiscoveredValues(matchedRule);
    this.cacheByRuleId.set(matchedRule.id, {
      timestamp: Date.now(),
      values
    });

    return values;
  }

  /**
   * Extracts unique values from vault notes respecting active directories in rule
   */
  public computeDiscoveredValues(rule: FrontmatterSuggestRule): string[] {
    const activeDirs = (rule.directories || [])
      .filter((d) => d.active)
      .map((d) => normalizePath(d.path.trim()));

    if (activeDirs.length === 0) {
      return [];
    }

    const targetKeys = rule.propertyKey
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    const uniqueSet = new Set<string>();
    const markdownFiles = this.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      const normFilePath = normalizePath(file.path);

      // Verify file is inside at least one active directory
      const matchedDir = activeDirs.find((dir) => {
        if (dir === '' || dir === '/') return true;
        return normFilePath.startsWith(dir + '/');
      });

      if (!matchedDir) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      // Extract values matching target keys
      for (const rawKey of Object.keys(fm)) {
        if (targetKeys.includes(rawKey.toLowerCase().trim())) {
          const rawVal = fm[rawKey];
          if (Array.isArray(rawVal)) {
            for (const item of rawVal) {
              if (item !== null && item !== undefined) {
                const s = String(item).trim();
                if (s.length > 0) uniqueSet.add(s);
              }
            }
          } else if (rawVal !== null && rawVal !== undefined) {
            const s = String(rawVal).trim();
            if (s.length > 0) uniqueSet.add(s);
          }
        }
      }
    }

    return Array.from(uniqueSet).sort((a, b) => a.localeCompare(b));
  }
}
