import { App } from 'obsidian';

export interface ParsedTierBlock {
    headerLine: string;       // e.g. "- <span style=\"background: #861d1d;\">S</span>" or "- To Rank"
    rawText: string;          // clean text: "S", "A", "To Rank", "Settings #tier-list"
    isSettings: boolean;
    isUnordered: boolean;
    items: string[];          // indented lines: ["\t- [[item1]]", "\t- [[item2]]"]
}

export interface ParsedTierListFile {
    prefixLines: string[];    // lines before the first tier (including headers, tags)
    tiers: ParsedTierBlock[]; // all tiers in file order
    suffixLines: string[];    // lines after the tier list (e.g. ---, trailing notes)
}

export interface TierTarget {
    tierName?: string;        // e.g. "A", "S", "B", "D"
    isUnordered?: boolean;    // true for "To Rank" / unranked bank
    isSettings?: boolean;     // true for Settings
}

let fileQueue: Promise<void> = Promise.resolve();

export function processFileSequentially(app: App, processor: (content: string) => string): Promise<void> {
    const file = app.workspace.getActiveFile();
    if (!file) return Promise.resolve();

    fileQueue = fileQueue.then(async () => {
        try {
            await app.vault.process(file, processor);
        } catch (e) {
            console.error('[TierList] File process error:', e);
        }
    });
    return fileQueue;
}

/**
 * Strips HTML tags and #tier-list tag to obtain clean tier name
 */
export function cleanTierName(raw: string): string {
    return raw
        .replace(/<[^>]*>/g, '') // strip HTML tags
        .replace(/#tier-list/gi, '')
        .trim();
}

/**
 * Parse lines of a markdown tier list into structured tiers and items.
 * Tolerates blank lines, recovers stray settings, and un-nests accidentally indented tier headers.
 */
export function parseTierListFromLines(
    lines: string[],
    settingsUnordered: string = 'To Rank',
    settingsTag: string = 'Settings'
): ParsedTierListFile {
    const prefixLines: string[] = [];
    const tiers: ParsedTierBlock[] = [];
    const suffixLines: string[] = [];
    const straySettingsLines: string[] = [];

    let currentTier: ParsedTierBlock | null = null;
    let inTierList = false;
    let finishedTierList = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (finishedTierList) {
            suffixLines.push(line);
            continue;
        }

        // Check if line is an accidentally indented tier header
        const isColorSpanTier = Boolean(
            trimmed.match(/^[-*]\s+<span[^>]*style=[^>]*background/i) ||
            trimmed.match(/^[-*]\s+<span[^>]*class=["']tier-list-tier["']/i) ||
            trimmed.match(/^[-*]\s+<span[^>]*>[^<]+<\/span>/i)
        );

        const isAccidentalTierHeader = inTierList && Boolean(
            isColorSpanTier ||
            trimmed.match(/^[-*]\s+(To Rank|Unranked|Settings)/i)
        );

        // Standard top-level bullet item starting with '- ' or '* ' without leading indentation
        const isTopLevelBullet =
            (line.startsWith('- ') || line.startsWith('* ')) &&
            !line.startsWith('  ') &&
            !line.startsWith('\t');

        const isTierHeader = isTopLevelBullet || isAccidentalTierHeader;

        if (isTierHeader) {
            inTierList = true;
            // Always normalize tier header line to top-level bullet without indentation!
            const normalizedHeader = '- ' + trimmed.substring(2).trim();
            const content = trimmed.substring(2).trim();
            const lower = content.toLowerCase();

            const isSettings =
                lower.startsWith(settingsTag.toLowerCase()) ||
                lower.startsWith('settings');

            const isUnordered =
                !isSettings &&
                (lower.includes(settingsUnordered.toLowerCase()) ||
                    lower.includes('to rank') ||
                    lower.includes('unranked') ||
                    content === '_');

            currentTier = {
                headerLine: normalizedHeader,
                rawText: content,
                isSettings,
                isUnordered,
                items: []
            };
            tiers.push(currentTier);
        } else if (
            currentTier &&
            (line.startsWith('\t') ||
                line.startsWith('  ') ||
                (line.startsWith(' -') && line.length > 2))
        ) {
            // Check if this is a displaced setting line (Mode: 0, Compare: ..., Title: ...)
            const isSettingLine = Boolean(
                trimmed.match(/^[-*]?\s*(Mode|Compare|Title|Versus|Ratio|Width|Slots|Animation|From|Where|Click|FontSize):\s*/i)
            );

            if (isSettingLine && !currentTier.isSettings) {
                // Collect setting to move to Settings tier
                straySettingsLines.push('\t- ' + trimmed.replace(/^[-*]\s*/, ''));
            } else if (trimmed.length > 0) {
                currentTier.items.push(line);
            }
        } else if (trimmed.length === 0) {
            // Blank line: ignore inside tier list so it doesn't break parsing!
            if (!inTierList) {
                prefixLines.push(line);
            }
        } else if (!inTierList) {
            prefixLines.push(line);
        } else {
            // Non-empty line that is NOT a tier item and NOT indented (e.g. "---", "## Header")
            // This marks the end of the tier list block
            finishedTierList = true;
            suffixLines.push(line);
        }
    }

    // Auto-heal: If any settings were stray inside regular tiers, attach them to Settings tier
    if (straySettingsLines.length > 0) {
        let settingsTier = tiers.find((t) => t.isSettings);
        if (!settingsTier) {
            settingsTier = {
                headerLine: `- ${settingsTag} #tier-list`,
                rawText: settingsTag,
                isSettings: true,
                isUnordered: false,
                items: []
            };
            tiers.push(settingsTier);
        }
        for (const setting of straySettingsLines) {
            const key = setting.split(':')[0].trim().toLowerCase();
            const alreadyExists = settingsTier.items.some((it) => it.toLowerCase().includes(key));
            if (!alreadyExists) {
                settingsTier.items.push(setting);
            }
        }
    }

    return { prefixLines, tiers, suffixLines };
}

/**
 * Reconstructs markdown lines from a ParsedTierListFile structure.
 */
export function serializeTierListToFile(parsed: ParsedTierListFile): string {
    const resultLines: string[] = [...parsed.prefixLines];

    for (const tier of parsed.tiers) {
        resultLines.push(tier.headerLine);
        for (const item of tier.items) {
            resultLines.push(item);
        }
    }

    resultLines.push(...parsed.suffixLines);
    return resultLines.join('\n');
}

/**
 * Find tier index in parsed.tiers matching a TierTarget descriptor.
 */
function findTierIndex(tiers: ParsedTierBlock[], target: TierTarget): number {
    if (target.isUnordered) {
        return tiers.findIndex((t) => t.isUnordered);
    }
    if (target.isSettings) {
        return tiers.findIndex((t) => t.isSettings);
    }
    if (target.tierName) {
        const targetClean = cleanTierName(target.tierName).toLowerCase();
        return tiers.findIndex((t) => {
            if (t.isSettings || t.isUnordered) return false;
            return cleanTierName(t.rawText).toLowerCase() === targetClean;
        });
    }
    return -1;
}

/**
 * Move a slot safely between tiers (or within the same tier) identified by name or unranked role.
 * Never guesses lines, never corrupts settings, and never nests tiers.
 */
export async function moveSlotBetweenTiers(
    app: App,
    fromTarget: TierTarget,
    oldSlotIndex: number,
    toTarget: TierTarget,
    newSlotIndex: number,
    settingsUnordered: string = 'To Rank',
    settingsTag: string = 'Settings'
): Promise<void> {
    await processFileSequentially(app, (content) => {
        const lines = content.split('\n');
        const parsed = parseTierListFromLines(lines, settingsUnordered, settingsTag);

        const fromTierIndex = findTierIndex(parsed.tiers, fromTarget);
        let toTierIndex = findTierIndex(parsed.tiers, toTarget);

        // If target is unranked ("To Rank") and does not exist in file yet, create it!
        if (toTierIndex === -1 && toTarget.isUnordered) {
            const newUnorderedTier: ParsedTierBlock = {
                headerLine: `- ${settingsUnordered}`,
                rawText: settingsUnordered,
                isSettings: false,
                isUnordered: true,
                items: []
            };
            const settingsIdx = parsed.tiers.findIndex((t) => t.isSettings);
            if (settingsIdx !== -1) {
                parsed.tiers.splice(settingsIdx, 0, newUnorderedTier);
                toTierIndex = settingsIdx;
            } else {
                parsed.tiers.push(newUnorderedTier);
                toTierIndex = parsed.tiers.length - 1;
            }
        }

        if (fromTierIndex === -1 || toTierIndex === -1) return content;

        const fromTier = parsed.tiers[fromTierIndex];
        const toTier = parsed.tiers[toTierIndex];

        // Never modify settings tier via slot drag
        if (fromTier.isSettings || toTier.isSettings) return content;

        if (oldSlotIndex < 0 || oldSlotIndex >= fromTier.items.length) return content;

        // Remove item from source tier
        const [movedItem] = fromTier.items.splice(oldSlotIndex, 1);
        if (!movedItem) return content;

        // CRITICAL GUARD: Ensure movedItem is NEVER a tier header!
        const trimmedMoved = movedItem.trim();
        const isTierHeader = Boolean(
            trimmedMoved.match(/^[-*]\s+<span[^>]*style=[^>]*background/i) ||
            trimmedMoved.match(/^[-*]\s+<span[^>]*class=["']tier-list-tier["']/i) ||
            trimmedMoved.match(/^[-*]\s+<span[^>]*>[^<]+<\/span>/i) ||
            trimmedMoved.match(/^[-*]\s+(To Rank|Unranked|Settings)/i)
        );
        if (isTierHeader) {
            console.warn('[TierList] Blocked tier header from being inserted as a slot item:', movedItem);
            return content;
        }

        // Format item with clean single-tab indentation
        let normalizedItem = movedItem.trim();
        if (!normalizedItem.startsWith('- ') && !normalizedItem.startsWith('* ')) {
            normalizedItem = '- ' + normalizedItem;
        }
        normalizedItem = '\t' + normalizedItem;

        // Insert into destination tier
        const targetIndex = Math.max(0, Math.min(newSlotIndex, toTier.items.length));
        toTier.items.splice(targetIndex, 0, normalizedItem);

        return serializeTierListToFile(parsed);
    });
}

/**
 * Reorder tiers based on actual DOM visual order.
 * Completely immune to index offset bugs, hidden elements, or race conditions.
 */
export async function reorderTiersByDOM(
    app: App,
    orderedTargets: TierTarget[],
    settingsUnordered: string = 'To Rank',
    settingsTag: string = 'Settings'
): Promise<void> {
    await processFileSequentially(app, (content) => {
        const lines = content.split('\n');
        const parsed = parseTierListFromLines(lines, settingsUnordered, settingsTag);

        const settingsTier = parsed.tiers.find((t) => t.isSettings);
        const nonSettingsTiers = parsed.tiers.filter((t) => !t.isSettings);

        const reorderedNonSettings: ParsedTierBlock[] = [];
        const usedTiers = new Set<ParsedTierBlock>();

        for (const target of orderedTargets) {
            if (target.isSettings) continue;
            const idx = findTierIndex(nonSettingsTiers, target);
            if (idx !== -1 && !usedTiers.has(nonSettingsTiers[idx])) {
                reorderedNonSettings.push(nonSettingsTiers[idx]);
                usedTiers.add(nonSettingsTiers[idx]);
            }
        }

        // Append any tiers that weren't present in orderedTargets (safety fallback)
        for (const tier of nonSettingsTiers) {
            if (!usedTiers.has(tier)) {
                reorderedNonSettings.push(tier);
            }
        }

        // Reassemble: keep settings at the beginning if originally there, or at the end
        if (settingsTier) {
            const originalSettingsIndex = parsed.tiers.findIndex((t) => t.isSettings);
            if (originalSettingsIndex === 0) {
                parsed.tiers = [settingsTier, ...reorderedNonSettings];
            } else {
                parsed.tiers = [...reorderedNonSettings, settingsTier];
            }
        } else {
            parsed.tiers = reorderedNonSettings;
        }

        return serializeTierListToFile(parsed);
    });
}
