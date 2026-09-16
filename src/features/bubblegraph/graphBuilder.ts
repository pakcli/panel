import { App, TFile, normalizePath } from 'obsidian';
import { BubbleNode, BubbleEdge, BubbleCluster, NodeGlyphType, GraphStats } from './types';
import { computeClusterRadius } from './simulation';
import { FolderRule } from '../tree/types';
import { BubbleNodeGlyphOption, RelationshipTierConfig, RelationshipFolderEntry, DEFAULT_RELATIONSHIP_TIERS } from '../../settings';

export interface RelationshipGraphSettings {
    rootFolder?: string;
    mode?: '1dir' | 'subfolders';
    propertyKey?: string;
    tiers?: RelationshipTierConfig[];
    viewStructure?: 'flat' | 'range' | 'concentric';
    folders?: RelationshipFolderEntry[];
    allScopeState?: boolean;
}

/**
 * Returns the effective chronological birth timestamp of a note.
 * On Windows, ctime is often set to the copy/clone date, while mtime retains original creation.
 * Returns Math.min(ctime, mtime) to reflect the earliest known date the note existed.
 */
export function getNodeEffectiveTime(node: { ctime?: number; mtime?: number }): number {
    const c = (node.ctime && node.ctime > 946684800000) ? node.ctime : 0;
    const m = (node.mtime && node.mtime > 946684800000) ? node.mtime : 0;
    if (c > 0 && m > 0) return Math.min(c, m);
    return c || m || Date.now();
}

/**
 * Returns the latest timestamp (either creation or last write/edit date).
 */
export function getNodeLatestTime(node: { ctime?: number; mtime?: number }): number {
    const c = (node.ctime && node.ctime > 946684800000) ? node.ctime : 0;
    const m = (node.mtime && node.mtime > 946684800000) ? node.mtime : 0;
    return Math.max(c, m) || Date.now();
}

export interface NodeGlyphSettings {
    bubbleGlyphIsolated?: BubbleNodeGlyphOption;
    bubbleGlyphOutgoing?: BubbleNodeGlyphOption;
    bubbleGlyphIncoming?: BubbleNodeGlyphOption;
    bubbleGlyphBoth?: BubbleNodeGlyphOption;
}

/**
 * Resolves the node glyph based on 4 link conditions:
 * 1. inDeg === 0 && outDeg === 0  => Isolated (no link, not mentioned anywhere) -> default: 'no-dot'
 * 2. outDeg > 0 && inDeg === 0   => Has wikilink (outgoing only) -> default: 'plus'
 * 3. inDeg > 0 && outDeg === 0   => Mentioned anywhere (incoming only) -> default: 'minus'
 * 4. inDeg > 0 && outDeg > 0     => Both linked and mentioned -> default: 'i'
 */
export function resolveNodeGlyph(
    inDeg: number,
    outDeg: number,
    settings?: NodeGlyphSettings
): NodeGlyphType {
    if (inDeg === 0 && outDeg === 0) {
        return settings?.bubbleGlyphIsolated || 'no-dot';
    } else if (outDeg > 0 && inDeg === 0) {
        return settings?.bubbleGlyphOutgoing || 'plus';
    } else if (inDeg > 0 && outDeg === 0) {
        return settings?.bubbleGlyphIncoming || 'minus';
    } else {
        return settings?.bubbleGlyphBoth || 'i';
    }
}

/**
 * Resolves an image URL for a node based on frontmatter property waterfall:
 * 1. img
 * 2. image
 * 3. img-preview
 * 4. icon
 * 5. image-preview
 *
 * Supports:
 * - External URLs: https://... or http://...
 * - Data URLs: data:image/...
 * - Obsidian Wikilinks: [[cover.png]], [[attachments/image.jpg|alt]]
 * - Vault Paths: "attachments/cover.png", "covers/hero.webp"
 * - Fallback: returns undefined if not found or invalid
 */
export function resolveNodeImageUrl(app: App, file: TFile): string | undefined {
    const fileCache = app.metadataCache.getFileCache(file);
    const fm = fileCache?.frontmatter;
    if (!fm) return undefined;

    // Waterfall keys priority: img |> image |> img-preview |> icon |> image-preview
    const rawVal = 
        fm.img ?? fm.Img ??
        fm.image ?? fm.Image ??
        fm['img-preview'] ?? fm['img_preview'] ?? fm.imgPreview ??
        fm.icon ?? fm.Icon ??
        fm['image-preview'] ?? fm['image_preview'] ?? fm.imagePreview;

    if (rawVal === undefined || rawVal === null) return undefined;

    let targetStr = '';
    if (Array.isArray(rawVal)) {
        if (rawVal.length === 0) return undefined;
        targetStr = String(rawVal[0]).trim();
    } else {
        targetStr = String(rawVal).trim();
    }

    if (!targetStr) return undefined;

    // External URL or Data URL
    if (targetStr.startsWith('http://') || targetStr.startsWith('https://') || targetStr.startsWith('data:image/')) {
        return targetStr;
    }

    // Clean Obsidian Wikilink brackets [[ ... ]] and remove alias | ...
    let cleanPath = targetStr.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
    if (cleanPath.includes('|')) {
        cleanPath = cleanPath.split('|')[0].trim();
    }

    // Try resolving link via metadataCache (respects link resolver & attachments settings)
    let matchedFile = app.metadataCache.getFirstLinkpathDest(cleanPath, file.path);

    // If not found, try direct vault path lookup
    if (!matchedFile) {
        const normalized = normalizePath(cleanPath.replace(/^\.?\//, ''));
        const abstract = app.vault.getAbstractFileByPath(normalized);
        if (abstract instanceof TFile) {
            matchedFile = abstract;
        }
    }

    // Check if matched file is an image file
    if (matchedFile instanceof TFile) {
        const ext = matchedFile.extension ? matchedFile.extension.toLowerCase() : '';
        const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
        if (IMAGE_EXTENSIONS.has(ext)) {
            return app.vault.getResourcePath(matchedFile);
        }
    }

    return undefined;
}

// Default fallback color
export const DARK_GRAY_COLOR = '#4a5568';

/**
 * Resolves the theme-adaptive accent color for default nodes and clusters.
 * In Dark Theme: Lighter shade of the accent color for high contrast & luminosity on dark backgrounds.
 * In Light Theme: Darker shade of the accent color for rich readability on light backgrounds.
 */
export function getDefaultNodeColor(): string {
    const isDark = typeof document !== 'undefined' ? document.body.classList.contains('theme-dark') : true;

    let rawAccent = '';
    if (typeof document !== 'undefined') {
        const cs = getComputedStyle(document.body);
        rawAccent = (
            cs.getPropertyValue('--interactive-accent').trim() ||
            cs.getPropertyValue('--text-accent').trim() ||
            cs.getPropertyValue('--color-accent').trim()
        );
    }

    if (!rawAccent) {
        return isDark ? '#a78bfa' : '#5b21b6';
    }

    return adjustAccentLightness(rawAccent, isDark);
}

export function adjustAccentLightness(colorStr: string, isDark: boolean): string {
    const hexMatch = colorStr.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    let r = 124, g = 58, b = 237;

    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    } else {
        const rgbMatch = colorStr.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
        if (rgbMatch) {
            r = parseInt(rgbMatch[1], 10);
            g = parseInt(rgbMatch[2], 10);
            b = parseInt(rgbMatch[3], 10);
        }
    }

    // Convert RGB to HSL
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    let h = 0;
    let s = 0;
    let l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
            case gNorm: h = (bNorm - rNorm) / d + 2; break;
            case bNorm: h = (rNorm - gNorm) / d + 4; break;
        }
        h /= 6;
    }

    // Adaptive lightness:
    // Dark theme: Lighter accent (high contrast on dark background, target ~68%-75% lightness)
    // Light theme: Darker accent (high contrast on light background, target ~30%-38% lightness)
    if (isDark) {
        l = Math.min(0.82, Math.max(l + 0.18, 0.70));
        s = Math.min(1.0, Math.max(s, 0.65));
    } else {
        l = Math.max(0.24, Math.min(l - 0.20, 0.35));
        s = Math.min(1.0, Math.max(s, 0.70));
    }

    // Convert back to RGB
    const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const finalR = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const finalG = Math.round(hue2rgb(p, q, h) * 255);
    const finalB = Math.round(hue2rgb(p, q, h - 1/3) * 255);

    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(finalR)}${toHex(finalG)}${toHex(finalB)}`;
}

export function matchFolderRule(folderPath: string, rules: FolderRule[]): FolderRule | null {
    if (!rules || rules.length === 0 || !folderPath) return null;
    const activeRules = rules.filter(r => r.enabled);
    const matches: FolderRule[] = [];
    const normalizedPath = normalizePath(folderPath);

    for (const rule of activeRules) {
        const normalizedRulePath = normalizePath(rule.path || '');
        if (normalizedRulePath.includes('*')) {
            const regexParts = normalizedRulePath.split('/').map(part => {
                if (part === '*') return '[^/]+';
                if (part === '**') return '.*';
                return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]+');
            });
            const regexString = regexParts.join('/');
            const fullRegex = rule.includeChildren ? new RegExp(`^${regexString}(?:/.*)?$`) : new RegExp(`^${regexString}$`);
            if (fullRegex.test(normalizedPath)) {
                matches.push(rule);
            }
        } else if (rule.includeChildren) {
            if (normalizedRulePath === "" || normalizedRulePath === ".") {
                matches.push(rule);
            } else if (normalizedPath === normalizedRulePath || normalizedPath.startsWith(normalizedRulePath + '/')) {
                matches.push(rule);
            }
        } else {
            if (normalizedPath === normalizedRulePath) {
                matches.push(rule);
            }
        }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => (b.path || '').length - (a.path || '').length);
    return matches[0];
}

export function getFolderColor(
    folderPath: string,
    captainRules?: FolderRule[],
    useCaptainColors: boolean = false
): string {
    if (useCaptainColors && captainRules && captainRules.length > 0 && folderPath && folderPath !== '/') {
        const matchedRule = matchFolderRule(folderPath, captainRules);
        if (matchedRule && matchedRule.color) {
            return matchedRule.color;
        }
    }
    return getDefaultNodeColor();
}

export interface BuiltGraph {
    nodes: BubbleNode[];
    edges: BubbleEdge[];
    clusters: BubbleCluster[];
    stats: GraphStats;
    nodeMap: Map<string, BubbleNode>;
    clusterMap: Map<string, BubbleCluster>;
}

export function buildVaultGraph(
    app: App, 
    activeFilePath: string | null = null,
    captainRules?: FolderRule[],
    useCaptainColors: boolean = false,
    maxClusterDepth: number = 3,
    scopedFolder: string | null = null,
    glyphSettings?: NodeGlyphSettings,
    relationshipSettings?: RelationshipGraphSettings
): BuiltGraph {
    const BINARY_EXTENSIONS = new Set([
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico',
        'mp3', 'wav', 'ogg', 'm4a', 'flac',
        'mp4', 'webm', 'mov', 'mkv', 'avi',
        'pdf', 'zip', 'tar', 'gz', '7z', 'rar'
    ]);

    let files: TFile[] = app.vault.getFiles().filter(file => {
        if (file.path.startsWith('.') || file.path.includes('/.')) return false;
        const ext = file.extension ? file.extension.toLowerCase() : '';
        return !BINARY_EXTENSIONS.has(ext);
    });
    const resolvedLinks = app.metadataCache.resolvedLinks || {};

    const normalizedScoped = scopedFolder && scopedFolder !== '/' ? normalizePath(scopedFolder) : null;

    if (normalizedScoped) {
        files = files.filter(file => {
            const folderPath = file.parent && file.parent.path !== '/' ? normalizePath(file.parent.path) : '';
            return folderPath === normalizedScoped || folderPath.startsWith(normalizedScoped + '/');
        });
    }

    // 1. Calculate In/Out Degrees
    const outDegrees = new Map<string, number>();
    const inDegrees = new Map<string, number>();
    const rawEdges: Array<{ source: string; target: string }> = [];

    for (const sourcePath in resolvedLinks) {
        const targets = resolvedLinks[sourcePath];
        let outCount = 0;
        for (const targetPath in targets) {
            outCount++;
            inDegrees.set(targetPath, (inDegrees.get(targetPath) || 0) + 1);
            rawEdges.push({ source: sourcePath, target: targetPath });
        }
        outDegrees.set(sourcePath, outCount);
    }

    // 2. Map Folders and Hierarchies
    const folderToFiles = new Map<string, TFile[]>();
    for (const file of files) {
        const folder = file.parent ? file.parent.path : '';
        if (!folderToFiles.has(folder)) {
            folderToFiles.set(folder, []);
        }
        folderToFiles.get(folder)!.push(file);
    }

    // 3. Build Nodes
    const nodes: BubbleNode[] = [];
    const nodeMap = new Map<string, BubbleNode>();

    for (const file of files) {
        const path = file.path;
        const name = file.basename;
        const ext = file.extension ? file.extension.toLowerCase() : 'md';
        const fileCache = app.metadataCache.getFileCache(file);
        const rawTitle = fileCache?.frontmatter?.title ?? fileCache?.frontmatter?.Title;
        const title = (rawTitle !== undefined && rawTitle !== null && String(rawTitle).trim().length > 0)
            ? String(rawTitle).trim()
            : undefined;
        const folderPath = file.parent && file.parent.path !== '/' ? normalizePath(file.parent.path) : '';

        let topLevelFolder = '/';
        let subFolder = '';
        let clusterId = '/';
        let subClusterId = '/';

        const relRoot = relationshipSettings?.rootFolder ? normalizePath(relationshipSettings.rootFolder) : 'Relationships';
        const relFolders = new Set<string>();
        relFolders.add(relRoot);
        if (relationshipSettings?.folders && relationshipSettings.folders.length > 0) {
            for (const f of relationshipSettings.folders) {
                if (f.path) relFolders.add(normalizePath(f.path));
            }
        }

        const allScopeState = relationshipSettings?.allScopeState ?? false;
        const isRelVirtualActive = Boolean(normalizedScoped && relFolders.has(normalizedScoped)) || allScopeState;

        let matchedRelFolder: string | null = null;
        if (isRelVirtualActive) {
            for (const rf of relFolders) {
                if (folderPath === rf || folderPath.startsWith(rf + '/')) {
                    matchedRelFolder = rf;
                    break;
                }
            }
        }

        const rawTiers = (relationshipSettings?.tiers && relationshipSettings.tiers.length > 0)
            ? relationshipSettings.tiers
            : DEFAULT_RELATIONSHIP_TIERS;
        const relTiers = rawTiers
            .filter(t => t.id !== 'know')
            .map(t => (t.id === 'friends' ? { ...t, min: 0.01, max: 0.40 } : { ...t }));
        const propKey = relationshipSettings?.propertyKey || 'closeness';

        let matchedRelTier: RelationshipTierConfig | null = null;
        if (matchedRelFolder) {
            if (folderPath.startsWith(matchedRelFolder + '/')) {
                const subPath = folderPath.slice(matchedRelFolder.length + 1);
                const subName = subPath.split('/')[0].toLowerCase();
                matchedRelTier = relTiers.find(t => 
                    subName === t.folderName.toLowerCase() || 
                    subName === t.name.toLowerCase() || 
                    subName === t.id.toLowerCase() ||
                    subName.includes(t.name.toLowerCase())
                ) || null;
            }

            if (!matchedRelTier) {
                let closenessVal = 0.25;
                const rawCloseness = fileCache?.frontmatter?.[propKey] ?? 
                                     fileCache?.frontmatter?.closeness ?? 
                                     fileCache?.frontmatter?.score ??
                                     fileCache?.frontmatter?.affinity;
                
                const lowerName = name.toLowerCase();
                const lowerRole = String(fileCache?.frontmatter?.role || '').toLowerCase();
                const isMeNote = lowerName === 'me' || lowerRole.includes('self') || lowerRole.includes('me') || lowerName.includes('myself');

                if (rawCloseness !== undefined && rawCloseness !== null && !isNaN(Number(rawCloseness))) {
                    closenessVal = Math.max(-1, Math.min(1, Number(rawCloseness)));
                } else if (isMeNote) {
                    closenessVal = 1.0;
                }

                matchedRelTier = relTiers.find(t => closenessVal >= Math.min(t.min, t.max) && closenessVal <= Math.max(t.min, t.max)) || null;
                if (!matchedRelTier) {
                    let minDiff = Infinity;
                    for (const t of relTiers) {
                        const mid = (t.min + t.max) / 2;
                        const diff = Math.abs(closenessVal - mid);
                        if (diff < minDiff) {
                            minDiff = diff;
                            matchedRelTier = t;
                        }
                    }
                }
            }
            if (!matchedRelTier) matchedRelTier = relTiers[0];

            topLevelFolder = matchedRelFolder;
            subFolder = matchedRelTier.name;
            clusterId = matchedRelFolder;
            subClusterId = `${matchedRelFolder}/${matchedRelTier.id}`;
        } else if (normalizedScoped) {
            if (folderPath === normalizedScoped) {
                topLevelFolder = normalizedScoped;
                subFolder = '';
                clusterId = normalizedScoped;
                subClusterId = normalizedScoped;
            } else if (folderPath.startsWith(normalizedScoped + '/')) {
                const relPath = folderPath.slice(normalizedScoped.length + 1);
                const relParts = relPath.split('/');
                topLevelFolder = normalizedScoped + '/' + relParts[0];
                subFolder = relParts.length > 1 ? relParts.slice(1).join('/') : '';
                clusterId = normalizedScoped;
                subClusterId = normalizedScoped + '/' + relParts.slice(0, Math.min(relParts.length, Math.max(1, maxClusterDepth - 1))).join('/');
            }
        } else {
            if (folderPath && folderPath !== '/') {
                const parts = folderPath.split('/');
                topLevelFolder = parts[0];
                subFolder = parts.length > 1 ? parts.slice(1).join('/') : '';
                clusterId = topLevelFolder;
                subClusterId = folderPath.split('/').slice(0, Math.min(parts.length, maxClusterDepth)).join('/');
            }
        }

        const outDeg = outDegrees.get(path) || 0;
        const inDeg = inDegrees.get(path) || 0;
        const totalDeg = inDeg + outDeg;

        // Check if index note of folder
        const folderFiles = folderToFiles.get(folderPath) || [];
        const isMaxDegreeInFolder = folderFiles.length > 1 && 
            folderFiles.every(f => (outDegrees.get(f.path) || 0) + (inDegrees.get(f.path) || 0) <= totalDeg);
        const folderNameForMatch = subFolder ? subFolder.split('/').pop() : topLevelFolder.split('/').pop();
        const isNamedAfterFolder = name.toLowerCase() === (folderNameForMatch || '').toLowerCase();
        const isIndexNote = isNamedAfterFolder || isMaxDegreeInFolder || name.toLowerCase() === 'readme' || name.toLowerCase() === 'index';

        const isActive = activeFilePath === path;

        // Condition-based Glyph assignment:
        // 1. inDeg === 0 && outDeg === 0  => Isolated (default 'no-dot')
        // 2. outDeg > 0 && inDeg === 0   => Has wikilink (default 'plus')
        // 3. inDeg > 0 && outDeg === 0   => Mentioned anywhere (default 'minus')
        // 4. inDeg > 0 && outDeg > 0     => Both linked and mentioned (default 'i')
        const glyph = resolveNodeGlyph(inDeg, outDeg, glyphSettings);
        const imageUrl = resolveNodeImageUrl(app, file);
        let radius: number;

        if (isIndexNote && totalDeg >= 2) {
            radius = Math.round(6 + Math.sqrt(inDeg + outDeg));
        } else if (totalDeg === 0) {
            radius = imageUrl ? 5.5 : 3.5;
        } else {
            radius = Math.round(3.5 + Math.sqrt(totalDeg));
            if (imageUrl && radius < 5.5) {
                radius = 5.5;
            }
        }

        let color = getFolderColor(folderPath || topLevelFolder, captainRules, useCaptainColors);
        if (matchedRelTier) {
            color = matchedRelTier.color;
        }

        const node: BubbleNode = {
            id: path,
            name,
            title,
            extension: ext,
            folderPath,
            topLevelFolder,
            subFolder,
            ctime: file.stat.ctime || file.stat.mtime || Date.now(),
            mtime: file.stat.mtime || file.stat.ctime || Date.now(),
            inDegree: inDeg,
            outDegree: outDeg,
            totalDegree: totalDeg,
            glyph,
            imageUrl,
            radius,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            fx: null,
            fy: null,
            color,
            isActive,
            clusterId,
            subClusterId
        };

        nodes.push(node);
        nodeMap.set(path, node);
    }

    // 4. Build Edges & Classify 3-Tier Hierarchy
    const edges: BubbleEdge[] = [];
    let totalVennBridges = 0;

    for (const raw of rawEdges) {
        const srcNode = nodeMap.get(raw.source);
        const tgtNode = nodeMap.get(raw.target);

        if (!srcNode || !tgtNode) continue;

        const isIntra = normalizedScoped
            ? (srcNode.folderPath === tgtNode.folderPath)
            : (srcNode.topLevelFolder === tgtNode.topLevelFolder);
        const tier = isIntra ? 'tier1_intra' : 'tier2_inter';

        if (tier === 'tier2_inter') {
            totalVennBridges++;
        }

        edges.push({
            source: raw.source,
            target: raw.target,
            sourceNode: srcNode,
            targetNode: tgtNode,
            tier,
            isIntraFolder: isIntra,
            color: isIntra ? srcNode.color : '#00f2ff' // Neon cyan for inter-cluster Venn bridge
        });
    }

    // 5. Build Clusters — N-depth recursive folder hierarchy
    const clusters: BubbleCluster[] = [];
    const clusterMap = new Map<string, BubbleCluster>();

    const allFolderPaths = new Set<string>();

    if (normalizedScoped) {
        allFolderPaths.add(normalizedScoped);
        for (const node of nodes) {
            if (!node.folderPath || !node.folderPath.startsWith(normalizedScoped)) continue;
            if (node.folderPath === normalizedScoped) continue;
            const relPath = node.folderPath.slice(normalizedScoped.length + 1);
            const relParts = relPath.split('/');
            const maxParts = Math.min(relParts.length, Math.max(1, maxClusterDepth - 1));
            for (let d = 1; d <= maxParts; d++) {
                allFolderPaths.add(normalizedScoped + '/' + relParts.slice(0, d).join('/'));
            }
        }
    } else {
        for (const node of nodes) {
            if (!node.folderPath || node.topLevelFolder === '/') continue;
            const parts = node.folderPath.split('/');
            const maxParts = Math.min(parts.length, maxClusterDepth);
            for (let d = 1; d <= maxParts; d++) {
                allFolderPaths.add(parts.slice(0, d).join('/'));
            }
        }
    }

    const clusterDirectNodeIds = new Map<string, string[]>();
    const clusterAllNodeIds = new Map<string, string[]>();

    for (const folderPath of allFolderPaths) {
        clusterDirectNodeIds.set(folderPath, []);
        clusterAllNodeIds.set(folderPath, []);
    }

    if (normalizedScoped) {
        for (const node of nodes) {
            if (!node.folderPath) continue;
            if (clusterAllNodeIds.has(normalizedScoped)) {
                clusterAllNodeIds.get(normalizedScoped)!.push(node.id);
            }
            if (node.folderPath === normalizedScoped) {
                if (clusterDirectNodeIds.has(normalizedScoped)) {
                    clusterDirectNodeIds.get(normalizedScoped)!.push(node.id);
                }
            } else if (node.folderPath.startsWith(normalizedScoped + '/')) {
                const relParts = node.folderPath.slice(normalizedScoped.length + 1).split('/');
                const maxParts = Math.min(relParts.length, Math.max(1, maxClusterDepth - 1));
                for (let d = 1; d <= maxParts; d++) {
                    const ancestorPath = normalizedScoped + '/' + relParts.slice(0, d).join('/');
                    if (clusterAllNodeIds.has(ancestorPath)) {
                        clusterAllNodeIds.get(ancestorPath)!.push(node.id);
                    }
                }
                const cappedPath = normalizedScoped + '/' + relParts.slice(0, Math.max(1, maxClusterDepth - 1)).join('/');
                if (clusterDirectNodeIds.has(cappedPath)) {
                    clusterDirectNodeIds.get(cappedPath)!.push(node.id);
                }
            }
        }
    } else {
        for (const node of nodes) {
            if (!node.folderPath || node.topLevelFolder === '/') continue;
            const parts = node.folderPath.split('/');
            const maxParts = Math.min(parts.length, maxClusterDepth);
            for (let d = 1; d <= maxParts; d++) {
                const ancestorPath = parts.slice(0, d).join('/');
                if (clusterAllNodeIds.has(ancestorPath)) {
                    clusterAllNodeIds.get(ancestorPath)!.push(node.id);
                }
            }
            const cappedPath = parts.slice(0, maxClusterDepth).join('/');
            if (clusterDirectNodeIds.has(cappedPath)) {
                clusterDirectNodeIds.get(cappedPath)!.push(node.id);
            }
        }
    }

    function buildRelationshipClusters(
        targetRelRoot: string,
        parentClusterId: string | null,
        baseDepth: number,
        graphNodes: BubbleNode[],
        tiers: RelationshipTierConfig[],
        viewStruct: 'flat' | 'range' | 'concentric',
        clusterMapRef: Map<string, BubbleCluster>
    ): BubbleCluster[] {
        const relClusters: BubbleCluster[] = [];
        const relNodes = graphNodes.filter(n => n.folderPath === targetRelRoot || n.folderPath.startsWith(targetRelRoot + '/'));
        if (relNodes.length === 0) return [];

        const sortedTiers = [...tiers].sort((a, b) => Math.max(b.min, b.max) - Math.max(a.min, a.max));
        const tierDirectNodeMap = new Map<string, string[]>();
        for (const t of sortedTiers) {
            tierDirectNodeMap.set(`${targetRelRoot}/${t.id}`, []);
        }
        tierDirectNodeMap.set(targetRelRoot, []);

        for (const node of relNodes) {
            if (tierDirectNodeMap.has(node.subClusterId)) {
                tierDirectNodeMap.get(node.subClusterId)!.push(node.id);
            } else {
                tierDirectNodeMap.get(targetRelRoot)!.push(node.id);
            }
        }

        const allRelNodeIds = relNodes.map(n => n.id);
        const rootDirectIds = tierDirectNodeMap.get(targetRelRoot) || [];
        const rootColor = getFolderColor(targetRelRoot, captainRules, useCaptainColors);

        const rootCluster: BubbleCluster = {
            id: targetRelRoot,
            name: targetRelRoot.split('/').pop() || targetRelRoot,
            parentClusterId,
            depth: baseDepth,
            nodeIds: allRelNodeIds,
            directNodeIds: viewStruct === 'flat' ? allRelNodeIds : rootDirectIds,
            centroid: { x: 0, y: 0 },
            radius: computeClusterRadius(allRelNodeIds.length, baseDepth),
            color: rootColor,
            hullPolygon: [],
            smoothedHull: [],
            boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
        };
        relClusters.push(rootCluster);
        clusterMapRef.set(targetRelRoot, rootCluster);

        if (viewStruct === 'flat') {
            return relClusters;
        }

        if (viewStruct === 'range') {
            for (let i = 0; i < sortedTiers.length; i++) {
                const tier = sortedTiers[i];
                const clusterId = `${targetRelRoot}/${tier.id}`;
                const directIds = tierDirectNodeMap.get(clusterId) || [];
                const tierCluster: BubbleCluster = {
                    id: clusterId,
                    name: tier.name,
                    parentClusterId: targetRelRoot,
                    depth: baseDepth + 1,
                    nodeIds: directIds,
                    directNodeIds: directIds,
                    centroid: { x: 0, y: 0 },
                    radius: computeClusterRadius(Math.max(1, directIds.length), baseDepth + 1),
                    color: tier.color,
                    hullPolygon: [],
                    smoothedHull: [],
                    boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
                };
                relClusters.push(tierCluster);
                clusterMapRef.set(clusterId, tierCluster);
            }
            return relClusters;
        }

        // Concentric Russian Doll View (Russian Doll Matryoshka nesting):
        // Outer boundary is targetRelRoot.
        // targetRelRoot branches directly into:
        //   1. Friends [0.01 - 0.40] (nests Close Friends [0.41 - 0.60] ➔ Family [0.61 - 0.80] ➔ Household [0.81 - 1.00])
        //   2. Unsure [0.00 - 0.00] (direct child of targetRelRoot)
        //   3. Bad [-1.00 - -0.01] (direct child of targetRelRoot)

        const sortedAsc = [...tiers].sort((a, b) => Math.min(a.min, a.max) - Math.min(b.min, b.max));
        const positiveTiers = sortedAsc.filter(t => Math.max(t.min, t.max) > 0.0);
        const unsureTiers = sortedAsc.filter(t => t.min === 0.0 && t.max === 0.0);
        const badTiers = sortedAsc.filter(t => Math.max(t.min, t.max) < 0.0);
        const otherNeutralOrBad = sortedAsc.filter(t => Math.max(t.min, t.max) <= 0.0 && !unsureTiers.includes(t) && !badTiers.includes(t));
        const sideBranches = [...unsureTiers, ...badTiers, ...otherNeutralOrBad];

        const friendsTier = positiveTiers.length > 0 ? positiveTiers[0] : null;
        const innerChainTiers = positiveTiers.length > 0 ? positiveTiers.slice(1) : [];

        if (friendsTier) {
            const friendsClusterId = `${targetRelRoot}/${friendsTier.id}`;
            const friendsDirectIds = tierDirectNodeMap.get(friendsClusterId) || [];

            const innerChainAllNodeIds: string[] = [];
            for (const tier of innerChainTiers) {
                const cId = `${targetRelRoot}/${tier.id}`;
                innerChainAllNodeIds.push(...(tierDirectNodeMap.get(cId) || []));
            }

            const friendsAllNodeIds = [...friendsDirectIds, ...innerChainAllNodeIds];

            const friendsCluster: BubbleCluster = {
                id: friendsClusterId,
                name: friendsTier.name,
                parentClusterId: targetRelRoot,
                depth: baseDepth + 1,
                nodeIds: friendsAllNodeIds,
                directNodeIds: friendsDirectIds,
                centroid: { x: 0, y: 0 },
                radius: computeClusterRadius(Math.max(1, friendsAllNodeIds.length), baseDepth + 1),
                color: friendsTier.color,
                hullPolygon: [],
                smoothedHull: [],
                boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
            };
            relClusters.push(friendsCluster);
            clusterMapRef.set(friendsClusterId, friendsCluster);

            for (let i = 0; i < innerChainTiers.length; i++) {
                const tier = innerChainTiers[i];
                const clusterId = `${targetRelRoot}/${tier.id}`;
                const parentId = i === 0 ? friendsClusterId : `${targetRelRoot}/${innerChainTiers[i - 1].id}`;
                const directIds = tierDirectNodeMap.get(clusterId) || [];

                const allDescendantIds: string[] = [...directIds];
                for (let j = i + 1; j < innerChainTiers.length; j++) {
                    const subDirects = tierDirectNodeMap.get(`${targetRelRoot}/${innerChainTiers[j].id}`) || [];
                    allDescendantIds.push(...subDirects);
                }

                const chainCluster: BubbleCluster = {
                    id: clusterId,
                    name: tier.name,
                    parentClusterId: parentId,
                    depth: baseDepth + 2 + i,
                    nodeIds: allDescendantIds,
                    directNodeIds: directIds,
                    centroid: { x: 0, y: 0 },
                    radius: computeClusterRadius(Math.max(1, allDescendantIds.length), baseDepth + 2 + i),
                    color: tier.color,
                    hullPolygon: [],
                    smoothedHull: [],
                    boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
                };
                relClusters.push(chainCluster);
                clusterMapRef.set(clusterId, chainCluster);
            }
        }

        for (const tier of sideBranches) {
            const clusterId = `${targetRelRoot}/${tier.id}`;
            const directIds = tierDirectNodeMap.get(clusterId) || [];
            const sideCluster: BubbleCluster = {
                id: clusterId,
                name: tier.name,
                parentClusterId: targetRelRoot,
                depth: baseDepth + 1,
                nodeIds: directIds,
                directNodeIds: directIds,
                centroid: { x: 0, y: 0 },
                radius: computeClusterRadius(Math.max(1, directIds.length), baseDepth + 1),
                color: tier.color,
                hullPolygon: [],
                smoothedHull: [],
                boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
            };
            relClusters.push(sideCluster);
            clusterMapRef.set(clusterId, sideCluster);
        }

        return relClusters;
    }

    const relRoot = relationshipSettings?.rootFolder ? normalizePath(relationshipSettings.rootFolder) : 'Relationships';
    const relFolders = new Set<string>();
    relFolders.add(relRoot);
    if (relationshipSettings?.folders && relationshipSettings.folders.length > 0) {
        for (const f of relationshipSettings.folders) {
            if (f.path) relFolders.add(normalizePath(f.path));
        }
    }

    const rawTiers = (relationshipSettings?.tiers && relationshipSettings.tiers.length > 0)
        ? relationshipSettings.tiers
        : DEFAULT_RELATIONSHIP_TIERS;
    const relTiers = rawTiers
        .filter(t => t.id !== 'know')
        .map(t => (t.id === 'friends' ? { ...t, min: 0.01, max: 0.40 } : { ...t }));

    const defaultViewStruct = relationshipSettings?.viewStructure || 'concentric';
    const allScopeState = relationshipSettings?.allScopeState ?? false;

    // If scoped directly to a relationship folder:
    if (normalizedScoped && relFolders.has(normalizedScoped)) {
        const folderEntry = relationshipSettings?.folders?.find(f => normalizePath(f.path) === normalizedScoped);
        const folderViewStruct = folderEntry?.viewStructure || defaultViewStruct;
        const relClusters = buildRelationshipClusters(
            normalizedScoped,
            null,
            1,
            nodes,
            relTiers,
            folderViewStruct,
            clusterMap
        );
        return {
            nodes,
            edges,
            clusters: relClusters,
            stats: {
                totalNodes: nodes.length,
                totalEdges: edges.length,
                totalClusters: relClusters.length,
                intraEdges: edges.filter(e => e.tier === 'tier1_intra').length,
                interEdges: edges.filter(e => e.tier === 'tier2_inter').length,
                totalVennBridges
            },
            nodeMap,
            clusterMap
        };
    }

    // If unscoped, allScopeState enabled, AND all nodes in the graph belong to relationship folders:
    if (allScopeState && !normalizedScoped && nodes.length > 0 && nodes.every(n => {
        const fp = n.folderPath || '';
        for (const rf of relFolders) {
            if (fp === rf || fp.startsWith(rf + '/')) return true;
        }
        return false;
    })) {
        const relClusters: BubbleCluster[] = [];
        for (const rf of relFolders) {
            const folderEntry = relationshipSettings?.folders?.find(f => normalizePath(f.path) === rf);
            const folderViewStruct = folderEntry?.viewStructure || defaultViewStruct;
            const subRelClusters = buildRelationshipClusters(
                rf,
                null,
                1,
                nodes,
                relTiers,
                folderViewStruct,
                clusterMap
            );
            relClusters.push(...subRelClusters);
        }
        return {
            nodes,
            edges,
            clusters: relClusters,
            stats: {
                totalNodes: nodes.length,
                totalEdges: edges.length,
                totalClusters: relClusters.length,
                intraEdges: edges.filter(e => e.tier === 'tier1_intra').length,
                interEdges: edges.filter(e => e.tier === 'tier2_inter').length,
                totalVennBridges
            },
            nodeMap,
            clusterMap
        };
    }

    // Ensure all relationship folders that have notes are in allFolderPaths
    for (const rf of relFolders) {
        if (nodes.some(n => n.folderPath === rf || n.folderPath.startsWith(rf + '/'))) {
            allFolderPaths.add(rf);
        }
    }

    // Create cluster objects sorted by depth (shallowest first)
    const sortedFolderPaths = [...allFolderPaths].sort((a, b) => {
        const da = a.split('/').length;
        const db = b.split('/').length;
        return da !== db ? da - db : a.localeCompare(b);
    });

    for (const folderPath of sortedFolderPaths) {
        // Skip physical subfolders inside relationship folders when allScopeState handles relationship tiers
        let isInsideRel = false;
        for (const rf of relFolders) {
            if (folderPath.startsWith(rf + '/')) {
                isInsideRel = true;
                break;
            }
        }
        if (isInsideRel && allScopeState) continue;

        let depth = 1;
        let parentPath: string | null = null;
        let name = '';

        if (normalizedScoped) {
            if (folderPath === normalizedScoped) {
                depth = 1;
                parentPath = null;
                name = normalizedScoped.split('/').pop() || normalizedScoped;
            } else {
                const relParts = folderPath.slice(normalizedScoped.length + 1).split('/');
                depth = 1 + relParts.length;
                if (depth > maxClusterDepth && !relFolders.has(folderPath)) continue;
                parentPath = relParts.length === 1
                    ? normalizedScoped
                    : normalizedScoped + '/' + relParts.slice(0, -1).join('/');
                name = relParts[relParts.length - 1];
            }
        } else {
            const parts = folderPath.split('/');
            depth = parts.length;
            if (depth > maxClusterDepth && !relFolders.has(folderPath)) continue;
            parentPath = depth > 1 ? parts.slice(0, depth - 1).join('/') : null;
            name = parts[parts.length - 1];
        }

        // If folderPath is a registered relationship folder:
        if (relFolders.has(folderPath)) {
            if (allScopeState) {
                const folderEntry = relationshipSettings?.folders?.find(f => normalizePath(f.path) === folderPath);
                const folderViewStruct = folderEntry?.viewStructure || defaultViewStruct;
                const folderRelClusters = buildRelationshipClusters(
                    folderPath,
                    parentPath,
                    depth,
                    nodes,
                    relTiers,
                    folderViewStruct,
                    clusterMap
                );
                clusters.push(...folderRelClusters);
                continue;
            }
            // If !allScopeState, treat as normal folder cluster at root!
        }

        const allIds = [...new Set(clusterAllNodeIds.get(folderPath) || [])];
        if (allIds.length === 0) continue;

        const directIds = [...new Set(clusterDirectNodeIds.get(folderPath) || [])];
        const initialRadius = directIds.length > 0
            ? computeClusterRadius(directIds.length, depth)
            : computeClusterRadius(allIds.length, depth);

        const cluster: BubbleCluster = {
            id: folderPath,
            name,
            parentClusterId: parentPath,
            depth,
            nodeIds: allIds,
            directNodeIds: directIds,
            centroid: { x: 0, y: 0 },
            radius: initialRadius,
            color: getFolderColor(folderPath, captainRules, useCaptainColors),
            hullPolygon: [],
            smoothedHull: [],
            boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
        };
        clusters.push(cluster);
        clusterMap.set(folderPath, cluster);
    }

    return {
        nodes,
        edges,
        clusters,
        stats: {
            totalNodes: nodes.length,
            totalClusters: clusters.length,
            totalVennBridges
        },
        nodeMap,
        clusterMap
    };
}
