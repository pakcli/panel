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
    // Theme Text Glow Detection
    hasTextGlow: boolean;
    textGlowColor: string;
    textGlowBlur: number;
    // Theme Container / Surface Styling for Bubbles
    containerBg: string;
    containerBorder: string;
}

/**
 * Helper to parse text-shadow CSS string and extract blur radius and color.
 * Supports syntax like: "0 0 10px #00f2ff", "rgba(0, 242, 255, 0.8) 0px 0px 8px", etc.
 */
function parseTextShadowGlow(textShadowStr: string): { hasGlow: boolean; glowColor: string; blur: number } {
    if (!textShadowStr || textShadowStr === 'none') {
        return { hasGlow: false, glowColor: '', blur: 0 };
    }

    // Extract length values (e.g. 0px 0px 8px or 0 0 10px)
    const pxMatches = textShadowStr.match(/-?\d+(?:\.\d+)?(?:px)?/g);
    let blur = 0;
    if (pxMatches && pxMatches.length >= 3) {
        // Typically: offsetX, offsetY, blurRadius
        const blurRaw = parseFloat(pxMatches[2]);
        if (!isNaN(blurRaw) && blurRaw > 0) {
            blur = blurRaw;
        }
    } else if (pxMatches && pxMatches.length === 2) {
        // Some formats: offsetX, offsetY (blur 0)
        blur = 0;
    }

    // Extract color part (hex, rgb, rgba, hsl, or named color)
    let color = '';
    const rgbaMatch = textShadowStr.match(/(?:rgba?|hsla?)\([^)]+\)/i);
    if (rgbaMatch) {
        color = rgbaMatch[0];
    } else {
        const hexMatch = textShadowStr.match(/#(?:[0-9a-fA-F]{3,8})/);
        if (hexMatch) {
            color = hexMatch[0];
        }
    }

    const hasGlow = blur >= 2 && Boolean(color);
    return { hasGlow, glowColor: color, blur: blur || 8 };
}

/**
 * Detect active theme in Obsidian and extract computed palette colors.
 * Reads customCss, vault configs, and computed CSS custom properties from document.body, :root, and DOM elements.
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

    let hasTextGlow = false;
    let textGlowColor = '';
    let textGlowBlur = 8;
    let containerBg = bgSecondary;
    let containerBorder = border;

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

            // 9. Container Surface & Border (Theme Container -> Bubble)
            const rawContainerBg = 
                bodyStyle.getPropertyValue('--background-secondary').trim() ||
                bodyStyle.getPropertyValue('--card-background').trim() ||
                bodyStyle.getPropertyValue('--background-secondary-alt').trim() ||
                rootStyle.getPropertyValue('--background-secondary').trim();
            if (rawContainerBg) {
                const hex = normalizeToHex(rawContainerBg);
                if (hex) containerBg = hex;
            }

            const rawContainerBorder = 
                bodyStyle.getPropertyValue('--background-modifier-border').trim() ||
                bodyStyle.getPropertyValue('--border-card').trim() ||
                rootStyle.getPropertyValue('--background-modifier-border').trim();
            if (rawContainerBorder) {
                const hex = normalizeToHex(rawContainerBorder);
                if (hex) containerBorder = hex;
            }

            // 10. Theme Text Glow Detection (Theme Text -> Node Glow)
            // Check direct CSS variables for glow: --text-glow, --glow-color, --accent-glow, --glow-blur
            const varGlowColor = 
                bodyStyle.getPropertyValue('--text-glow').trim() ||
                rootStyle.getPropertyValue('--text-glow').trim() ||
                bodyStyle.getPropertyValue('--glow-color').trim() ||
                rootStyle.getPropertyValue('--glow-color').trim() ||
                bodyStyle.getPropertyValue('--accent-glow').trim() ||
                rootStyle.getPropertyValue('--accent-glow').trim();

            if (varGlowColor && varGlowColor !== 'none') {
                const parsed = parseTextShadowGlow(varGlowColor);
                if (parsed.hasGlow) {
                    hasTextGlow = true;
                    textGlowColor = parsed.glowColor;
                    textGlowBlur = parsed.blur;
                } else {
                    const hexGlow = normalizeToHex(varGlowColor);
                    if (hexGlow) {
                        hasTextGlow = true;
                        textGlowColor = hexGlow;
                        textGlowBlur = 8;
                    }
                }
            }

            // If not found via variable, probe computed text-shadow on key text elements
            if (!hasTextGlow) {
                const textElements = document.querySelectorAll(
                    '.cm-content, .markdown-rendered, .nav-file-title, .workspace-leaf-content, h1, body'
                );
                for (let i = 0; i < textElements.length; i++) {
                    const elStyle = getComputedStyle(textElements[i]);
                    const shadow = elStyle.textShadow;
                    if (shadow && shadow !== 'none') {
                        const parsed = parseTextShadowGlow(shadow);
                        if (parsed.hasGlow) {
                            hasTextGlow = true;
                            textGlowColor = parsed.glowColor || textNormal;
                            textGlowBlur = parsed.blur || 8;
                            break;
                        }
                    }
                }
            }

            // Fallback glow color if glowing text detected without explicit color
            if (hasTextGlow && !textGlowColor) {
                textGlowColor = textAccent || textNormal;
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
        hasTextGlow,
        textGlowColor,
        textGlowBlur,
        containerBg,
        containerBorder,
    };
}
