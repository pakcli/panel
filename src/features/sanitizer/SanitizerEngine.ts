import { StringSanitizerRule } from './types';

export class SanitizerEngine {
    /**
     * Escapes special characters for literal string matching in RegExp.
     */
    public static escapeRegExp(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Sanitizes a given text by running active rules sequentially.
     */
    public static sanitizeText(
        text: string,
        rules: StringSanitizerRule[],
        filterPredicate?: (rule: StringSanitizerRule) => boolean
    ): { text: string; replacementsCount: number; appliedRules: string[] } {
        if (!text || !rules || rules.length === 0) {
            return { text, replacementsCount: 0, appliedRules: [] };
        }

        let currentText = text;
        let totalCount = 0;
        const appliedRules: string[] = [];

        for (const rule of rules) {
            if (!rule.enabled) continue;
            if (filterPredicate && !filterPredicate(rule)) continue;
            if (!rule.searchPattern) continue;

            try {
                let pattern: RegExp;
                const flags = rule.caseSensitive ? 'g' : 'gi';

                if (rule.isRegex) {
                    pattern = new RegExp(rule.searchPattern, flags);
                } else {
                    pattern = new RegExp(this.escapeRegExp(rule.searchPattern), flags);
                }

                let ruleMatchCount = 0;
                const nextText = currentText.replace(pattern, (match) => {
                    ruleMatchCount++;
                    return rule.replacementText;
                });

                if (ruleMatchCount > 0) {
                    totalCount += ruleMatchCount;
                    appliedRules.push(rule.label || rule.searchPattern);
                    currentText = nextText;
                }
            } catch (err) {
                console.warn(`[SanitizerEngine] Invalid rule pattern "${rule.searchPattern}":`, err);
            }
        }

        return {
            text: currentText,
            replacementsCount: totalCount,
            appliedRules
        };
    }

    /**
     * Scans a single line and checks if any active rules match.
     */
    public static processLine(
        line: string,
        rules: StringSanitizerRule[]
    ): { changed: boolean; newLine: string; matchedRules: string[] } {
        const result = this.sanitizeText(line, rules);
        return {
            changed: result.replacementsCount > 0,
            newLine: result.text,
            matchedRules: result.appliedRules
        };
    }
}
