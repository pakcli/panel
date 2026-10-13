import { App, TFile, Notice } from 'obsidian';
import { TierListItem } from '../views/comparison-view';

// ────────────────────────────────────────────────────────────────
//  Attribute extraction
// ────────────────────────────────────────────────────────────────

function normalizeList(val: any): string[] {
    if (!val) return [];
    if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
    if (typeof val === 'string') return val.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
    return [String(val).trim()].filter(Boolean);
}

export interface ComparePresetDef {
    id: string;
    name: string;
    icon: string;
    priorityKeys: string[];
}

export const DEFAULT_COMPARE_PRESETS: ComparePresetDef[] = [
    {
        id: 'all',
        name: 'All Frontmatter',
        icon: 'list',
        priorityKeys: []
    },
    {
        id: 'gadget',
        name: '📱 Gadget & Tech',
        icon: 'smartphone',
        priorityKeys: ['price', 'chipset', 'soc', 'processor', 'ram', 'storage', 'battery', 'display', 'screen', 'weight', 'camera', 'os']
    },
    {
        id: 'books',
        name: '📚 Books & Papers',
        icon: 'book-open',
        priorityKeys: ['author', 'rating', 'score', 'genre', 'pages', 'published', 'year', 'status', 'isbn', 'publisher']
    },
    {
        id: 'tasks',
        name: '💼 Tasks & Projects',
        icon: 'check-square',
        priorityKeys: ['status', 'priority', 'assignee', 'due', 'deadline', 'tags', 'estimate', 'milestone']
    }
];

/** Pull the comparable attribute set for a TierListItem.
 *  Supports preset scoping and frontmatter key filtering. */
export function getVennAttributes(item: TierListItem, allowedKeys?: string[]): string[] {
    const fm = item.frontmatter;
    if (!fm) return [];

    const seen = new Set<string>();
    const result: string[] = [];

    const addAttr = (v: string) => {
        const clean = String(v).trim();
        if (!clean) return;
        const key = clean.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(clean);
        }
    };

    // If allowedKeys specified, extract only those frontmatter properties
    if (allowedKeys && allowedKeys.length > 0) {
        for (const k of allowedKeys) {
            const val = fm[k] ?? fm[k.toLowerCase()];
            if (val !== undefined && val !== null) {
                const list = normalizeList(val);
                if (list.length > 1) {
                    list.forEach(item => addAttr(`${k}: ${item}`));
                } else if (list.length === 1) {
                    addAttr(`${k}: ${list[0]}`);
                }
            }
        }
    } else {
        // Default mode: dependencies, functions, specs, plus standard scalar properties
        const deps = normalizeList(fm.dependencies ?? fm.dependency ?? fm.deps ?? fm.requires);
        const funcs = normalizeList(fm.functions ?? fm.function ?? fm.techniques ?? fm.uses);
        [...deps, ...funcs].forEach(addAttr);

        if (typeof fm.specs === 'object' && fm.specs !== null && !Array.isArray(fm.specs)) {
            Object.entries(fm.specs).forEach(([k, v]) => addAttr(`${k}: ${v}`));
        }

        const skipKeys = new Set(['position', 'title', 'tags', 'tag', 'image', 'cover', 'thumbnail', 'dependencies', 'functions', 'specs']);
        for (const [k, v] of Object.entries(fm)) {
            if (skipKeys.has(k.toLowerCase())) continue;
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                addAttr(`${k}: ${v}`);
            }
        }
    }

    return result;
}

// ────────────────────────────────────────────────────────────────
//  Multi-Way Venn Computation (2 to N Items)
// ────────────────────────────────────────────────────────────────

export interface VennPartition {
    id: string; // e.g. "A", "B", "A_B", "A_B_C", etc.
    label: string;
    itemIndices: number[]; // Indices of items that share these attributes
    attributes: string[];
    isCenterAll: boolean;
}

export function computeMultiWayVenn(items: TierListItem[], allowedKeys?: string[]): VennPartition[] {
    if (!items || items.length === 0) return [];

    const itemAttrs: Array<{ item: TierListItem; attrs: Set<string> }> = items.map((it) => ({
        item: it,
        attrs: new Set(getVennAttributes(it, allowedKeys).map((s) => s.toLowerCase()))
    }));

    // Map each normalized attribute to the set of items that possess it
    const attrOwners = new Map<string, { original: string; owners: number[] }>();

    items.forEach((it, idx) => {
        const rawList = getVennAttributes(it, allowedKeys);
        rawList.forEach((raw) => {
            const key = raw.toLowerCase();
            if (!attrOwners.has(key)) {
                attrOwners.set(key, { original: raw, owners: [] });
            }
            const entry = attrOwners.get(key)!;
            if (!entry.owners.includes(idx)) {
                entry.owners.push(idx);
            }
        });
    });

    // Group attributes by owner signature (e.g. [0], [0,1], [0,1,2])
    const partitionMap = new Map<string, { itemIndices: number[]; attributes: string[] }>();

    attrOwners.forEach(({ original, owners }) => {
        owners.sort((a, b) => a - b);
        const sig = owners.join('_');
        if (!partitionMap.has(sig)) {
            partitionMap.set(sig, { itemIndices: [...owners], attributes: [] });
        }
        partitionMap.get(sig)!.attributes.push(original);
    });

    const partitions: VennPartition[] = [];
    partitionMap.forEach(({ itemIndices, attributes }, sig) => {
        const isCenterAll = itemIndices.length === items.length && items.length > 1;
        let label = '';
        if (isCenterAll) {
            label = 'Shared by All';
        } else if (itemIndices.length === 1) {
            label = `Only ${items[itemIndices[0]]?.name || 'Item'}`;
        } else {
            label = itemIndices.map((i) => items[i]?.name).join(' ∩ ');
        }

        partitions.push({
            id: sig,
            label,
            itemIndices,
            attributes,
            isCenterAll
        });
    });

    return partitions;
}

export interface VennSets {
    onlyA: string[];
    shared: string[];
    onlyB: string[];
}

export function computeVennSets(itemA: TierListItem, itemB: TierListItem, allowedKeys?: string[]): VennSets {
    const attrsA = getVennAttributes(itemA, allowedKeys);
    const attrsB = getVennAttributes(itemB, allowedKeys);
    const setB = new Set(attrsB.map((v) => v.toLowerCase()));
    const setA = new Set(attrsA.map((v) => v.toLowerCase()));

    const onlyA: string[] = [];
    const shared: string[] = [];
    attrsA.forEach((v) => {
        if (setB.has(v.toLowerCase())) shared.push(v);
        else onlyA.push(v);
    });
    const onlyB = attrsB.filter((v) => !setA.has(v.toLowerCase()));

    return { onlyA, shared, onlyB };
}

// ────────────────────────────────────────────────────────────────
//  SVG builder (2-circle Venn)
// ────────────────────────────────────────────────────────────────

export interface BuildSVGOptions {
    width?: number;
    height?: number;
    /** name shown in left circle (truncated) */
    labelA: string;
    /** name shown in right circle */
    labelB: string;
    onlyACount: number;
    sharedCount: number;
    onlyBCount: number;
    /** if true, the left zone is highlighted */
    highlightLeft?: boolean;
    /** if true, the shared zone is highlighted */
    highlightCenter?: boolean;
    /** if true, the right zone is highlighted */
    highlightRight?: boolean;
}

export function buildVennSVG(opts: BuildSVGOptions): string {
    const W = opts.width ?? 520;
    const H = opts.height ?? 220;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W * 0.3, H * 0.43);
    const overlap = r * 0.45; // how much circles overlap
    const lx = cx - overlap / 2;
    const rx = cx + overlap / 2;

    // Colors — using CSS vars where possible; fallback for SVG context
    const fill_A = opts.highlightLeft ? 'rgba(139,92,246,0.32)' : 'rgba(139,92,246,0.14)';
    const fill_B = opts.highlightRight ? 'rgba(236,72,153,0.32)' : 'rgba(236,72,153,0.14)';
    const fill_shared = opts.highlightCenter ? 'rgba(99,179,237,0.48)' : 'rgba(99,179,237,0.2)';
    const stroke_A = opts.highlightLeft ? '#8b5cf6' : 'rgba(139,92,246,0.6)';
    const stroke_B = opts.highlightRight ? '#ec4899' : 'rgba(236,72,153,0.6)';
    const strokeW = opts.highlightLeft || opts.highlightRight || opts.highlightCenter ? 2.5 : 1.8;

    function truncate(s: string, max = 12) {
        return s.length > max ? s.slice(0, max) + '…' : s;
    }

    // Count labels inside zones
    const countA = opts.onlyACount;
    const countS = opts.sharedCount;
    const countB = opts.onlyBCount;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="venn-svg" style="overflow:visible">
  <!-- Left circle fill (clipped to non-overlap) -->
  <circle cx="${lx}" cy="${cy}" r="${r}" fill="${fill_A}" stroke="${stroke_A}" stroke-width="${strokeW}" class="venn-zone venn-zone-left" />
  <!-- Right circle fill -->
  <circle cx="${rx}" cy="${cy}" r="${r}" fill="${fill_B}" stroke="${stroke_B}" stroke-width="${strokeW}" class="venn-zone venn-zone-right" />
  <!-- Shared / intersection overlay (drawn last to appear on top) -->
  <ellipse cx="${cx}" cy="${cy}" rx="${overlap * 0.62}" ry="${r * 0.72}" fill="${fill_shared}" class="venn-zone venn-zone-center" style="pointer-events:all" />

  <!-- Zone count labels -->
  <text x="${lx - r * 0.38}" y="${cy + 5}" text-anchor="middle" class="venn-count-text" font-size="22" font-weight="700" fill="rgba(139,92,246,0.9)" style="user-select:none">${countA > 0 ? countA : '∅'}</text>
  <text x="${cx}" y="${cy + 5}" text-anchor="middle" class="venn-count-text" font-size="22" font-weight="700" fill="rgba(99,179,237,0.95)" style="user-select:none">${countS > 0 ? countS : '∅'}</text>
  <text x="${rx + r * 0.38}" y="${cy + 5}" text-anchor="middle" class="venn-count-text" font-size="22" font-weight="700" fill="rgba(236,72,153,0.9)" style="user-select:none">${countB > 0 ? countB : '∅'}</text>

  <!-- Item name labels below circles -->
  <text x="${lx - r * 0.28}" y="${H - 8}" text-anchor="middle" class="venn-item-label" font-size="11" fill="rgba(139,92,246,0.9)" font-weight="600" style="user-select:none">${truncate(opts.labelA)}</text>
  <text x="${rx + r * 0.28}" y="${H - 8}" text-anchor="middle" class="venn-item-label" font-size="11" fill="rgba(236,72,153,0.9)" font-weight="600" style="user-select:none">${truncate(opts.labelB)}</text>
</svg>`;
}

// ────────────────────────────────────────────────────────────────
//  Save to File
// ────────────────────────────────────────────────────────────────

export interface VennPage {
    leftIdx: number;
    rightIdx: number;
}

export async function saveVennToFile(
    app: App,
    pages: VennPage[],
    allItems: TierListItem[],
    sourcePath: string
): Promise<void> {
    if (allItems.length < 2) {
        new Notice('Need at least 2 items to save comparison.');
        return;
    }

    // Fallback: auto-generate pages if empty
    if (!pages || pages.length === 0) {
        pages = [];
        for (let i = 0; i < allItems.length - 1; i++) {
            pages.push({ leftIdx: i, rightIdx: i + 1 });
        }
    }

    const now = new Date();
    const capturedDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const capturedTime = now.toTimeString().slice(0, 5);  // HH:MM

    // Collect unique items across all pages
    const uniqueItemIdxs = new Set<number>();
    pages.forEach((p) => {
        uniqueItemIdxs.add(p.leftIdx);
        uniqueItemIdxs.add(p.rightIdx);
    });
    const involvedItems = [...uniqueItemIdxs].map((i) => allItems[i]).filter(Boolean);

    // Build title
    const itemNames = involvedItems.map((it) => it.name);
    const titleStr = 'comparing ' + itemNames.map((n) => `[[${n}]]`).join(' vs ');

    // Build deps list (yaml)
    const depsYaml = involvedItems.map((it) => `  - "[[${it.name}]]"`).join('\n');

    // Build frontmatter
    const frontmatter = [
        '---',
        `title: "${titleStr}"`,
        `dependencies:`,
        depsYaml,
        `captured-date: ${capturedDate}`,
        `captured-time: "${capturedTime}"`,
        '---',
        ''
    ].join('\n');

    // Build body
    const bodyLines: string[] = [`# 🌀 ${itemNames.join(' vs ')}\n`];

    pages.forEach((page, i) => {
        const itemA = allItems[page.leftIdx];
        const itemB = allItems[page.rightIdx];
        if (!itemA || !itemB) return;

        const { onlyA, shared, onlyB } = computeVennSets(itemA, itemB);
        bodyLines.push(`## Page ${i + 1}: [[${itemA.name}]] vs [[${itemB.name}]]`);

        if (onlyA.length)
            bodyLines.push(`- **Only [[${itemA.name}]]**: ${onlyA.join(', ')}`);
        else
            bodyLines.push(`- **Only [[${itemA.name}]]**: *(none)*`);

        if (shared.length)
            bodyLines.push(`- **Shared**: ${shared.join(', ')}`);
        else
            bodyLines.push(`- **Shared**: *(none)*`);

        if (onlyB.length)
            bodyLines.push(`- **Only [[${itemB.name}]]**: ${onlyB.join(', ')}`);
        else
            bodyLines.push(`- **Only [[${itemB.name}]]**: *(none)*`);

        bodyLines.push('');
    });

    const content = frontmatter + bodyLines.join('\n');

    // Choose file name — base on first pair + date
    const firstA = allItems[pages[0]?.leftIdx]?.name ?? 'Item';
    const firstB = allItems[pages[0]?.rightIdx]?.name ?? 'Item';
    const safeName = `Venn - ${firstA} vs ${firstB} - ${capturedDate}.md`.replace(/[\\/:*?"<>|]/g, '-');

    try {
        const existing = app.vault.getAbstractFileByPath(safeName);
        if (existing instanceof TFile) {
            // Overwrite with new content
            await app.vault.modify(existing, content);
        } else {
            await app.vault.create(safeName, content);
        }

        // Open the note
        const created = app.vault.getAbstractFileByPath(safeName);
        if (created instanceof TFile) {
            await app.workspace.openLinkText(safeName, sourcePath, true);
        }
        new Notice(`💾 Saved comparison note: ${safeName}`);
    } catch (err) {
        console.error('Failed to save comparison note:', err);
        new Notice(`❌ Error saving comparison note: ${String(err)}`);
    }
}
