import { App, TFile } from 'obsidian';

export type DependencyTier = 'hard' | 'contextual' | 'soft' | 'unresolved';

export interface TriagedDependencyItem {
    raw: string;                 // e.g. "[[esp32-s3]]" or "https://youtu.be/..."
    cleanName: string;           // e.g. "esp32-s3"
    tier: DependencyTier;
    count: number;               // Frequency count (e.g. 3 mentions)
    lines: number[];             // Line numbers where link appears
    resolvedFile: TFile | null;  // null if phantom / unresolved
    isExternal: boolean;         // true if url
    targetSpecs?: Record<string, string>; // specs if target note has them
    orderIndex: number;          // Position of first appearance
}

export interface TriageResult {
    all: TriagedDependencyItem[];
    hard: TriagedDependencyItem[];
    contextual: TriagedDependencyItem[];
    soft: TriagedDependencyItem[];
    unresolved: TriagedDependencyItem[];
    stats: {
        total: number;
        hardCount: number;
        contextualCount: number;
        softCount: number;
        unresolvedCount: number;
    };
}

export interface TriageFilterOptions {
    scope: 'all' | 'hard' | 'contextual' | 'soft' | 'unresolved';
    sortBy: 'firstMention' | 'lastMention' | 'popular' | 'alphaAsc' | 'alphaDesc';
    collapseRepetitive: boolean;
    searchQuery?: string;
}

function toArray(val: any): string[] {
    if (!val) return [];
    if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
    if (typeof val === 'string') return val.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
    return [String(val).trim()];
}

function cleanLinkTarget(raw: string): string {
    return raw
        .replace(/^\[\[/, '')
        .replace(/\]\]$/, '')
        .split('|')[0]
        .split('#')[0]
        .trim();
}

/**
 * Membaca specs dari frontmatter note target
 */
export function extractSpecsFromFrontmatter(fm?: Record<string, any>): Record<string, string> {
    if (!fm) return {};
    const specs: Record<string, string> = {};

    if (typeof fm.specs === 'object' && !Array.isArray(fm.specs)) {
        Object.entries(fm.specs).forEach(([k, v]) => {
            specs[k] = String(v);
        });
    }

    const reserved = new Set([
        'title', 'id', 'category', 'tier', 'date', 'tags', 'tag',
        'dependencies', 'dependency', 'deps', 'requires', 'tools',
        'rules', 'rule', 'handling', 'specs', 'image', 'banner', 'permalink'
    ]);

    Object.entries(fm).forEach(([k, v]) => {
        if (!reserved.has(k.toLowerCase()) && v !== undefined && v !== null && typeof v !== 'object') {
            specs[k] = String(v);
        }
    });

    return specs;
}

/**
 * 4-Tier Dependency Triage Engine
 */
export function triageDependencies(app: App, file: TFile): TriageResult {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    // 1. Ekstrak Hard Dependencies dari Frontmatter
    const hardRawList = toArray(
        fm?.dependencies || fm?.dependency || fm?.deps || fm?.requires
    );
    const hardCleanSet = new Set<string>();
    hardRawList.forEach((r) => {
        const c = cleanLinkTarget(r);
        if (c) hardCleanSet.add(c.toLowerCase());
    });

    // 2. Kumpulkan semua body links dari native Obsidian cache
    const bodyLinks = cache?.links || [];
    const itemMap = new Map<string, TriagedDependencyItem>();
    let orderSeq = 0;

    // Masukkan entri frontmatter hard terlebih dahulu
    hardRawList.forEach((raw) => {
        const clean = cleanLinkTarget(raw);
        if (!clean) return;
        const key = clean.toLowerCase();
        const isExt = raw.startsWith('http://') || raw.startsWith('https://');
        const resolved = isExt ? null : app.metadataCache.getFirstLinkpathDest(clean, file.path);

        let specs: Record<string, string> | undefined = undefined;
        if (resolved) {
            const destCache = app.metadataCache.getFileCache(resolved);
            specs = extractSpecsFromFrontmatter(destCache?.frontmatter);
        }

        itemMap.set(key, {
            raw: isExt ? raw : `[[${clean}]]`,
            cleanName: clean,
            tier: 'hard',
            count: 1,
            lines: [1],
            resolvedFile: resolved,
            isExternal: isExt,
            targetSpecs: specs,
            orderIndex: orderSeq++
        });
    });

    // Proses semua body links
    bodyLinks.forEach((linkObj) => {
        const clean = cleanLinkTarget(linkObj.link);
        if (!clean) return;
        const key = clean.toLowerCase();
        const line = linkObj.position ? linkObj.position.start.line + 1 : 1;
        const isExt = linkObj.link.startsWith('http://') || linkObj.link.startsWith('https://');
        const resolved = isExt ? null : app.metadataCache.getFirstLinkpathDest(clean, file.path);

        if (itemMap.has(key)) {
            const existing = itemMap.get(key)!;
            existing.count += 1;
            if (!existing.lines.includes(line)) {
                existing.lines.push(line);
            }
            return;
        }

        // Tentukan Tier untuk item baru
        let tier: DependencyTier = 'soft';

        if (hardCleanSet.has(key)) {
            tier = 'hard';
        } else if (!isExt && !resolved) {
            tier = 'unresolved';
        } else if (resolved) {
            const destPath = resolved.path.toLowerCase();
            const isInToolsOrRules =
                destPath.startsWith('tools/') ||
                destPath.startsWith('rules/') ||
                destPath.startsWith('workflows/');

            const destCache = app.metadataCache.getFileCache(resolved);
            const specs = extractSpecsFromFrontmatter(destCache?.frontmatter);
            const hasSpecs = Object.keys(specs).length > 0;

            if (isInToolsOrRules || hasSpecs) {
                tier = 'contextual';
            } else {
                tier = 'soft';
            }
        }

        let specs: Record<string, string> | undefined = undefined;
        if (resolved) {
            const destCache = app.metadataCache.getFileCache(resolved);
            specs = extractSpecsFromFrontmatter(destCache?.frontmatter);
        }

        itemMap.set(key, {
            raw: isExt ? linkObj.link : `[[${clean}]]`,
            cleanName: clean,
            tier,
            count: 1,
            lines: [line],
            resolvedFile: resolved,
            isExternal: isExt,
            targetSpecs: specs,
            orderIndex: orderSeq++
        });
    });

    const allItems = Array.from(itemMap.values());
    const hard = allItems.filter((it) => it.tier === 'hard');
    const contextual = allItems.filter((it) => it.tier === 'contextual');
    const soft = allItems.filter((it) => it.tier === 'soft');
    const unresolved = allItems.filter((it) => it.tier === 'unresolved');

    return {
        all: allItems,
        hard,
        contextual,
        soft,
        unresolved,
        stats: {
            total: allItems.length,
            hardCount: hard.length,
            contextualCount: contextual.length,
            softCount: soft.length,
            unresolvedCount: unresolved.length
        }
    };
}

/**
 * Filter & Sort Processor
 */
export function filterAndSortDependencies(
    items: TriagedDependencyItem[],
    options: TriageFilterOptions
): TriagedDependencyItem[] {
    let result = [...items];

    // 1. Scope Filtering
    if (options.scope !== 'all') {
        result = result.filter((it) => it.tier === options.scope);
    }

    // 2. Search Query Filtering
    if (options.searchQuery && options.searchQuery.trim()) {
        const q = options.searchQuery.toLowerCase().trim();
        result = result.filter(
            (it) =>
                it.cleanName.toLowerCase().includes(q) ||
                (it.targetSpecs && Object.values(it.targetSpecs).some((v) => v.toLowerCase().includes(q)))
        );
    }

    // 3. Sorting
    switch (options.sortBy) {
        case 'firstMention':
            result.sort((a, b) => a.orderIndex - b.orderIndex);
            break;
        case 'lastMention':
            result.sort((a, b) => {
                const lastA = a.lines[a.lines.length - 1] || 0;
                const lastB = b.lines[b.lines.length - 1] || 0;
                return lastB - lastA;
            });
            break;
        case 'popular':
            result.sort((a, b) => b.count - a.count);
            break;
        case 'alphaAsc':
            result.sort((a, b) => a.cleanName.localeCompare(b.cleanName));
            break;
        case 'alphaDesc':
            result.sort((a, b) => b.cleanName.localeCompare(a.cleanName));
            break;
    }

    return result;
}
