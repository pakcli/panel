export interface FrontmatterSuggestDirectory {
  path: string;                // Vault directory path (e.g., "Dictionary" or "IT/Networking")
  active: boolean;             // true = 1, false = 0
  includeSubfolders?: boolean; // default true: recursively include subfolders
}

export interface FrontmatterSuggestRule {
  id: string;
  propertyKey: string;         // e.g. "category" or "category, categori"
  enabled: boolean;            // Master switch for this rule
  applyToAllBases: boolean;    // true = global across all .base in vault; false = only when active file is inside scoped dirs
  directories: FrontmatterSuggestDirectory[];
  viewMode?: 'card' | 'string';
}

export interface FrontmatterSuggesterSettings {
  enableFrontmatterSuggester: boolean;
  frontmatterSuggestRules: FrontmatterSuggestRule[];
}

export const DEFAULT_FRONTMATTER_SUGGEST_RULES: FrontmatterSuggestRule[] = [
  {
    id: 'rule_category_default',
    propertyKey: 'category',
    enabled: true,
    applyToAllBases: true,
    directories: [
      { path: 'Dictionary', active: true, includeSubfolders: true }
    ],
    viewMode: 'card'
  }
];

export const DEFAULT_FRONTMATTER_SUGGESTER_SETTINGS: FrontmatterSuggesterSettings = {
  enableFrontmatterSuggester: true,
  frontmatterSuggestRules: DEFAULT_FRONTMATTER_SUGGEST_RULES,
};

/**
 * Serializes FrontmatterSuggestDirectory[] into line-delimited "= path:1" format
 */
export function serializeDirectoryRules(dirs: FrontmatterSuggestDirectory[]): string {
  return dirs.map(d => `${d.path}:${d.active ? '1' : '0'}`).join('\n');
}

/**
 * Deserializes line-delimited "path:1" or "path:0" text into FrontmatterSuggestDirectory[]
 */
export function deserializeDirectoryRules(raw: string): FrontmatterSuggestDirectory[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.includes(':'))
    .map(line => {
      // Strip leading "= " if present
      const cleanLine = line.replace(/^=\s*/, '');
      const lastColon = cleanLine.lastIndexOf(':');
      const path = cleanLine.substring(0, lastColon).trim();
      const flag = cleanLine.substring(lastColon + 1).trim();
      return {
        path,
        active: flag === '1',
        includeSubfolders: true
      };
    });
}
