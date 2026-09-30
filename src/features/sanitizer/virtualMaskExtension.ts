import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type PakCLIPlugin from '../../main';
import { SanitizerEngine } from './SanitizerEngine';

export class VirtualMaskWidget extends WidgetType {
    constructor(readonly replacement: string, readonly ruleLabel: string) {
        super();
    }

    eq(other: VirtualMaskWidget): boolean {
        return other.replacement === this.replacement && other.ruleLabel === this.ruleLabel;
    }

    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'pakcli-virtual-mask';
        span.textContent = this.replacement;
        span.title = `Masked: ${this.ruleLabel} (PakCLI Virtual Sanitizer)`;
        return span;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

function buildDecorations(view: EditorView, plugin: PakCLIPlugin): DecorationSet {
    const sanitizerSettings = plugin.settings?.stringSanitizerSettings;
    if (sanitizerSettings?.masterEnabled === false || sanitizerSettings?.enableVirtualPreviewMasking === false) {
        return Decoration.none;
    }

    const rawRules = sanitizerSettings?.rules || [];
    const activeRules = rawRules.filter(
        (r) => r.enabled !== false && r.affectVirtualEditor !== false && r.searchPattern
    );
    if (activeRules.length === 0) {
        return Decoration.none;
    }

    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    if (doc.length === 0) return Decoration.none;

    const selection = view.state.selection.main;
    const viewport = view.viewport;
    const startLineNo = doc.lineAt(Math.max(0, viewport.from)).number;
    const endLineNo = doc.lineAt(Math.min(doc.length, viewport.to)).number;

    let totalMatches = 0;

    for (let l = startLineNo; l <= endLineNo; l++) {
        const line = doc.line(l);
        const lineText = line.text;
        if (!lineText) continue;

        interface MaskMatch {
            start: number;
            end: number;
            replacement: string;
            label: string;
        }
        const matches: MaskMatch[] = [];

        for (const rule of activeRules) {
            try {
                let patternStr = rule.searchPattern;
                if (!rule.isRegex && patternStr.includes('\\\\')) {
                    patternStr = patternStr.replace(/\\\\/g, '\\');
                }

                const flags = rule.caseSensitive ? 'g' : 'gi';
                let reg: RegExp;
                if (rule.isRegex) {
                    reg = new RegExp(patternStr, flags);
                } else {
                    reg = new RegExp(SanitizerEngine.escapeRegExp(patternStr), flags);
                }

                reg.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = reg.exec(lineText)) !== null) {
                    const matchStart = line.from + m.index;
                    const matchEnd = matchStart + m[0].length;
                    if (matchEnd <= matchStart) {
                        reg.lastIndex++;
                        continue;
                    }

                    // Only unmask when user's cursor is actively within this exact string
                    const isCursorInside = view.hasFocus && selection.head >= matchStart && selection.head <= matchEnd;
                    if (!isCursorInside) {
                        matches.push({
                            start: matchStart,
                            end: matchEnd,
                            replacement: rule.replacementText,
                            label: rule.label || rule.searchPattern
                        });
                    }
                }
            } catch (err) {
                console.warn('[PakCLI VirtualMask] Regex scan error on line ' + l + ':', err);
            }
        }

        if (matches.length > 0) {
            matches.sort((a, b) => a.start - b.start);

            let lastEnd = -1;
            for (const m of matches) {
                if (m.start >= lastEnd && m.start < m.end) {
                    builder.add(
                        m.start,
                        m.end,
                        Decoration.replace({
                            widget: new VirtualMaskWidget(m.replacement, m.label)
                        })
                    );
                    lastEnd = m.end;
                    totalMatches++;
                }
            }
        }
    }

    if (totalMatches > 0) {
        console.log(`[PakCLI VirtualMask] Active decorations applied: ${totalMatches} occurrence(s)`);
    }

    return builder.finish();
}

/**
 * Creates the CodeMirror 6 extension that dynamically masks strings on-screen
 * in Live Preview without modifying the underlying raw file.
 */
export function createVirtualMaskExtension(plugin: PakCLIPlugin) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildDecorations(view, plugin);
            }

            update(update: ViewUpdate) {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.selectionSet ||
                    update.focusChanged
                ) {
                    this.decorations = buildDecorations(update.view, plugin);
                }
            }
        },
        {
            decorations: (v) => v.decorations
        }
    );
}

/**
 * Registers a MarkdownPostProcessor for Reading View so rendered notes also
 * virtually mask sensitive strings visually.
 */
export function registerReadingViewSanitizer(plugin: PakCLIPlugin): void {
    plugin.registerMarkdownPostProcessor((element: HTMLElement) => {
        const settings = plugin.settings?.stringSanitizerSettings;
        if (settings?.masterEnabled === false || settings?.enableVirtualPreviewMasking === false) {
            return;
        }

        const activeRules = (settings?.rules || []).filter(
            (r) => r.enabled !== false && r.affectVirtualEditor !== false && r.searchPattern
        );
        if (activeRules.length === 0) return;

        const textNodes: Text[] = [];
        const walk = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                textNodes.push(node as Text);
            } else {
                if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') return;
                for (let child = node.firstChild; child; child = child.nextSibling) {
                    walk(child);
                }
            }
        };

        walk(element);

        for (const node of textNodes) {
            let val = node.nodeValue;
            if (!val) continue;

            const res = SanitizerEngine.sanitizeText(val, activeRules, (r) => r.affectVirtualEditor !== false);
            if (res.replacementsCount > 0) {
                node.nodeValue = res.text;
            }
        }
    });
}
