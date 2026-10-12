import { App } from 'obsidian';
import { normalizeToHex } from './graphBuilder';

export interface BubbleThemePalette {
    isDark: boolean;
    themeName: string;
    accent: string;
    textNormal: string;
    textMuted: string;
    textFaint: string;
    textAccent: string;
    bgPrimary: string;
    bgSecondary: string;
    border: string;
}

/**
 * Detect active theme in Obsidian and extract computed palette colors.
 * Reads customCss, vault configs, and computed CSS custom properties from document.body and :root.
 */
export function detectObsidianThemePalette(app?: App): BubbleThemePalette {
    const targetApp: any = app || (typeof window !== 'undefined' ? (window as any).app : undefined);
    const isDark = typeof document !== 'undefined' ? document.body.classList.contains('theme-dark') : true;

    // Detect theme name
    let themeName = 'default';
    try {
        if (targetApp?.customCss?.theme) {
            themeName = String(targetApp.customCss.theme);
        } else if (targetApp?.vault?.getConfig) {
            const cfgTheme = targetApp.vault.getConfig('cssTheme');
            if (cfgTheme) themeName = String(cfgTheme);
        }
    } catch {
        // ignore
    }

    // Default fallback colors based on dark / light mode
    let accent = isDark ? '#c084fc' : '#7e22ce';
    let textNormal = isDark ? '#f8fafc' : '#0f172a';
    let textMuted = isDark ? '#94a3b8' : '#64748b';
    let textFaint = isDark ? '#64748b' : '#94a3b8';
    let textAccent = accent;
    let bgPrimary = isDark ? '#0f172a' : '#ffffff';
    let bgSecondary = isDark ? '#1e293b' : '#f1f5f9';
    let border = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';

    if (typeof document !== 'undefined') {
        try {
            const bodyStyle = getComputedStyle(document.body);
            const rootStyle = getComputedStyle(document.documentElement);

            // 1. Accent color
            const rawAccent = 
                bodyStyle.getPropertyValue('--interactive-accent').trim() ||
                rootStyle.getPropertyValue('--interactive-accent').trim() ||
                bodyStyle.getPropertyValue('--color-accent').trim() ||
                rootStyle.getPropertyValue('--color-accent').trim() ||
                bodyStyle.getPropertyValue('--text-accent').trim();
            if (rawAccent) {
                const hex = normalizeToHex(rawAccent);
                if (hex) accent = hex;
            }

            // 2. Text Normal
            const rawTextNormal = 
                bodyStyle.getPropertyValue('--text-normal').trim() ||
                rootStyle.getPropertyValue('--text-normal').trim();
            if (rawTextNormal) {
                const hex = normalizeToHex(rawTextNormal);
                if (hex) textNormal = hex;
            }

            // 3. Text Muted
            const rawTextMuted = 
                bodyStyle.getPropertyValue('--text-muted').trim() ||
                rootStyle.getPropertyValue('--text-muted').trim();
            if (rawTextMuted) {
                const hex = normalizeToHex(rawTextMuted);
                if (hex) textMuted = hex;
            }

            // 4. Text Faint
            const rawTextFaint = 
                bodyStyle.getPropertyValue('--text-faint').trim() ||
                rootStyle.getPropertyValue('--text-faint').trim();
            if (rawTextFaint) {
                const hex = normalizeToHex(rawTextFaint);
                if (hex) textFaint = hex;
            }

            // 5. Text Accent
            const rawTextAccent = 
                bodyStyle.getPropertyValue('--text-accent').trim() ||
                rootStyle.getPropertyValue('--text-accent').trim();
            if (rawTextAccent) {
                const hex = normalizeToHex(rawTextAccent);
                if (hex) textAccent = hex;
            }

            // 6. Background Primary
            const rawBgPri = 
                bodyStyle.getPropertyValue('--background-primary').trim() ||
                rootStyle.getPropertyValue('--background-primary').trim();
            if (rawBgPri) {
                const hex = normalizeToHex(rawBgPri);
                if (hex) bgPrimary = hex;
            }

            // 7. Background Secondary
            const rawBgSec = 
                bodyStyle.getPropertyValue('--background-secondary').trim() ||
                rootStyle.getPropertyValue('--background-secondary').trim();
            if (rawBgSec) {
                const hex = normalizeToHex(rawBgSec);
                if (hex) bgSecondary = hex;
            }

            // 8. Border
            const rawBorder = 
                bodyStyle.getPropertyValue('--background-modifier-border').trim() ||
                rootStyle.getPropertyValue('--background-modifier-border').trim();
            if (rawBorder) {
                const hex = normalizeToHex(rawBorder);
                if (hex) border = hex;
            }
        } catch {
            // DOM query safety fallback
        }
    }

    return {
        isDark,
        themeName,
        accent,
        textNormal,
        textMuted,
        textFaint,
        textAccent,
        bgPrimary,
        bgSecondary,
        border,
    };
}
