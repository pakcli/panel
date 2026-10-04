import { App, EventRef, Menu, MenuItem, normalizePath, TFile, TFolder } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import {
  FrontmatterSuggestRule,
  FrontmatterSuggesterSettings
} from './types';
import { QuickPropertyScoperModal } from './ui/QuickPropertyScoperModal';

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
  private originalMenuShowAtMouseEvent: ((evt: MouseEvent) => any) | null = null;
  private originalMenuShowAtPosition: ((pos: any) => any) | null = null;
  private lastContextMenuTarget: HTMLElement | null = null;
  private onWindowContextMenu = (evt: MouseEvent) => {
    this.lastContextMenuTarget = evt.target as HTMLElement | null;
  };
  private cacheByRuleId: Map<string, CachedValues> = new Map();
  private eventRefs: EventRef[] = [];

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init(): void {
    this.patchObsidianSuggesters();
    this.patchContextMenu();
    this.registerCacheInvalidation();
  }

  public destroy(): void {
    this.unpatchObsidianSuggesters();
    this.unpatchContextMenu();
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
   * Patches Obsidian's Menu prototype to hook into table column header & property context menus
   */
  private patchContextMenu(): void {
    const self = this;
    if (typeof window !== 'undefined') {
      window.addEventListener('contextmenu', this.onWindowContextMenu, true);
    }

    const proto = Menu.prototype as any;
    if (!proto.__pakcliScoperPatched) {
      proto.__pakcliScoperPatched = true;
      this.originalMenuShowAtMouseEvent = proto.showAtMouseEvent;
      this.originalMenuShowAtPosition = proto.showAtPosition;

      proto.showAtMouseEvent = function (evt: MouseEvent) {
        try {
          self.enhanceColumnContextMenu(this, (evt?.target as HTMLElement) || self.lastContextMenuTarget);
        } catch (err) {
          console.warn('[PakCLI PropertyScoper] Context menu enhance error:', err);
        }
        return self.originalMenuShowAtMouseEvent
          ? self.originalMenuShowAtMouseEvent.call(this, evt)
          : this;
      };

      proto.showAtPosition = function (pos: any) {
        try {
          if (self.lastContextMenuTarget) {
            self.enhanceColumnContextMenu(this, self.lastContextMenuTarget);
          }
        } catch (err) {
          console.warn('[PakCLI PropertyScoper] Context menu enhance at pos error:', err);
        }
        return self.originalMenuShowAtPosition
          ? self.originalMenuShowAtPosition.call(this, pos)
          : this;
      };
    }
  }

  private unpatchContextMenu(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('contextmenu', this.onWindowContextMenu, true);
    }
    const proto = Menu.prototype as any;
    if (proto && proto.__pakcliScoperPatched) {
      if (this.originalMenuShowAtMouseEvent) {
        proto.showAtMouseEvent = this.originalMenuShowAtMouseEvent;
        this.originalMenuShowAtMouseEvent = null;
      }
      if (this.originalMenuShowAtPosition) {
        proto.showAtPosition = this.originalMenuShowAtPosition;
        this.originalMenuShowAtPosition = null;
      }
      proto.__pakcliScoperPatched = false;
    }
  }

  /**
   * Adds "Scope Property Suggestions..." to Obsidian Base / Table column header context menus
   */
  private enhanceColumnContextMenu(menu: Menu, target: HTMLElement | null): void {
    if (!target) return;
    const settings = this.plugin.settings as any;
    if (settings.enableFrontmatterSuggester === false) return;

    // Guard against duplicate injections
    const items: any[] = (menu as any).items || [];
    const alreadyEnhanced = items.some((it: any) => {
      const title = (it.title || it.titleEl?.textContent || it.dom?.textContent || '').toLowerCase();
      return title.includes('scope suggestions') || title.includes('property scoper');
    });
    if (alreadyEnhanced) return;

    // Detect if this menu belongs to a column header or property key
    const isColumnMenu = items.some((it: any) => {
      const text = (it.title || it.titleEl?.textContent || it.dom?.textContent || '').toLowerCase();
      return (
        text.includes('hide column') ||
        text.includes('summarize') ||
        text.includes('group by') ||
        text.includes('sort a') ||
        text.includes('edit property') ||
        text.includes('property type') ||
        text.includes('insert column') ||
        text.includes('delete column')
      );
    });

    const isPropertyKey = !!target.closest(
      '.metadata-property-key, .metadata-property, [data-property], [data-property-name], th, [role="columnheader"]'
    );

    if (!isColumnMenu && !isPropertyKey) {
      return;
    }

    // Extract property / column name
    const propName = this.extractPropertyNameFromTarget(target);
    if (!propName) return;

    // Look for existing rule to provide dynamic status text
    const rules = settings.frontmatterSuggestRules || [];
    const existingRule = rules.find((r: any) => {
      const keys = (r.propertyKey || '').split(',').map((k: string) => k.trim().toLowerCase());
      return keys.includes(propName.toLowerCase());
    });

    menu.addSeparator();
    menu.addItem((item: MenuItem) => {
      if (existingRule && existingRule.enabled) {
        const activeCount = existingRule.directories?.filter((d: any) => d.active).length || 0;
        item.setTitle(`Scope Suggestions: Active (${activeCount} dirs)...`);
        item.setIcon('list-filter');
      } else if (existingRule && !existingRule.enabled) {
        item.setTitle(`Scope Suggestions: Disabled (${propName})...`);
        item.setIcon('list-filter');
      } else {
        item.setTitle(`Scope Suggestions (${propName})...`);
        item.setIcon('list-filter');
      }
      item.onClick(() => {
        new QuickPropertyScoperModal(this.app, this.plugin, propName).open();
      });
    });
  }

  private extractPropertyNameFromTarget(target: HTMLElement): string {
    const headerCell =
      target.closest(
        'th, [role="columnheader"], [class*="header"], [class*="column"], [class*="cell"], .metadata-property-key, .metadata-property'
      ) || target;

    // 1. Direct dataset / attributes
    let prop =
      headerCell.getAttribute('data-property-name') ||
      headerCell.getAttribute('data-property') ||
      headerCell.getAttribute('data-property-key') ||
      headerCell.getAttribute('data-field') ||
      headerCell.getAttribute('data-column-id') ||
      headerCell.getAttribute('data-col-id') ||
      '';

    if (prop) return prop.trim();

    // 2. Input element value if inside property editor
    const input = headerCell.querySelector('input') || (headerCell instanceof HTMLInputElement ? headerCell : null);
    if (input?.value?.trim()) {
      return input.value.trim();
    }

    // 3. Text content inspection
    const titleEl =
      headerCell.querySelector(
        '[class*="property-name"], [class*="column-name"], [class*="header-text"], [class*="title"], span:not(.svg-icon):not([class*="icon"])'
      ) || headerCell;
    let raw = (titleEl.textContent || target.textContent || '').trim();

    // Strip common leading list/property icons (e.g. ":=", "•", bullets)
    raw = raw.replace(/^[:=•\s\u2022\u25CF\u22EE\u205D\u2630\uF0C9]+/, '').trim();
    const firstLine = raw.split(/\r?\n/)[0]?.trim();

    if (firstLine && firstLine.length < 50 && !firstLine.toLowerCase().includes('hide column')) {
      return firstLine.replace(/^[:=•\s]+/, '').trim();
    }

    return '';
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
