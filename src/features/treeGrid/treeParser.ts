/**
 * treeParser.ts
 * Parses tab/space-indented tree structures with multi-column (#) comments.
 */

import { ParsedTreeGrid, TreeGridNode } from './types';

// Known dotfiles that should be treated as files even though they start with a dot
const KNOWN_DOTFILES = new Set([
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    '.gitignore',
    '.gitattributes',
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '.npmrc',
    '.prettierrc',
    '.eslintrc',
    '.publish-config.json',
    '.vaultpath',
]);

/**
 * Checks if a string has a file extension (e.g. .json, .csv, .webp, .md).
 * Rule: with extension = bukan column (file node), without = column (directory node).
 */
export function isFileName(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;

    // Explicit folder with trailing slash
    if (trimmed.endsWith('/') || trimmed.endsWith('\\')) {
        return false;
    }

    // Known dotfiles
    if (KNOWN_DOTFILES.has(trimmed)) {
        return true;
    }

    // Match file extensions like .json, .csv, .webp, .html, .css, .js, .ts
    // 1-8 alphanumeric chars after last dot
    const match = trimmed.match(/\.([a-zA-Z0-9_-]{1,8})$/);
    if (match) {
        return true;
    }

    return false;
}

/**
 * Detects if a codeblock language identifier represents a Tree Grid / Cascading Tree block.
 * Recognizes panel-tree, panel-tree-cascading, tree-cascading, tree-structure, tree-interactive,
 * or any custom alias configured in plugin settings.
 */
export function isTreeBlockAlias(rawTag: string, customAliases?: Set<string>): boolean {
    if (!rawTag) return false;
    const tag = rawTag.trim().toLowerCase();
    if (tag === 'panel-tree' || tag === 'tree') return true;
    if (tag.startsWith('panel-tree') || tag.startsWith('tree-') || tag.endsWith('-tree')) return true;
    if (tag.includes('cascad') || tag.includes('tree-interactive')) return true;
    if (customAliases && customAliases.has(tag)) return true;
    return false;
}

/**
 * Extracts file extension if any.
 */
export function getExtension(name: string): string | undefined {
    const trimmed = name.trim();
    if (KNOWN_DOTFILES.has(trimmed)) {
        return trimmed.replace(/^\./, '');
    }
    const match = trimmed.match(/\.([a-zA-Z0-9_-]{1,8})$/);
    return match ? match[1].toLowerCase() : undefined;
}

/**
 * Computes raw indentation width (spaces and tabs).
 */
export function getRawLeadingWhitespace(line: string): number {
    let spaces = 0;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '\t') {
            spaces += 4;
        } else if (c === ' ') {
            spaces += 1;
        } else {
            break;
        }
    }
    return spaces;
}

/**
 * Extracts node name and comment columns from a raw trimmed line.
 * Rule: any "space + #" or "| #" or 2+ spaces creates a column.
 * Also supports multiple columns: "#col1 #col2".
 */
export function extractNameAndColumns(rawTrimmed: string): {
    name: string;
    rawName: string;
    trailingContent: string;
    columns: string[];
} {
    let trimmed = rawTrimmed.trim();

    // Strip leading ASCII symbols if user wrote V, >, L, ├──, └──, │
    trimmed = trimmed.replace(/^(?:[Vv>▼▶]\s*)+/, '');
    trimmed = trimmed.replace(/^[L├└│]\s*/, '');
    trimmed = trimmed.replace(/^[│\s]*[├└]──\s*/, '');

    // Check if line has columns marked by:
    // 1. "space + #" or "| #" or "##" or attached "#"
    const hashMatch = /(?:[ \t]+\|[ \t]*|[ \t]+)#|\s+##+\s*|(?<=\S)#/.exec(trimmed);
    if (hashMatch) {
        const namePart = trimmed.slice(0, hashMatch.index).trim().replace(/\|\s*$/, '').trim();
        const trailing = trimmed.slice(namePart.length);
        const rest = trimmed.slice(hashMatch.index).trim();

        // Split all columns by (space + #) or (| + #) or (##) only if followed by content
        const rawCols = rest.split(/(?:[ \t]+\|[ \t]*|[ \t]+)#(?=\s*\S)|\s+##+\s*/);
        const columns: string[] = [];

        for (const col of rawCols) {
            const cleaned = col.replace(/^[|#\s]+/, '').trim();
            if (cleaned) {
                columns.push(cleaned);
            }
        }

        return {
            name: namePart.replace(/[\/\\]$/, ''),
            rawName: namePart,
            trailingContent: trailing,
            columns: columns.slice(0, 10),
        };
    }

    // 2. Check for pipe delimited columns without # (e.g. name | col1 | col2)
    if (trimmed.includes('|')) {
        const parts = trimmed.split(/\s*\|\s*/);
        const namePart = parts[0].trim();
        const trailing = trimmed.slice(namePart.length);
        const columns: string[] = [];
        for (let i = 1; i < parts.length; i++) {
            const c = parts[i].trim().replace(/^[|#\s]+/, '').trim();
            if (c) columns.push(c);
        }
        return {
            name: namePart.replace(/[\/\\]$/, ''),
            rawName: namePart,
            trailingContent: trailing,
            columns: columns.slice(0, 10),
        };
    }

    return {
        name: trimmed.replace(/[\/\\]$/, ''),
        rawName: trimmed,
        trailingContent: '',
        columns: [],
    };
}

/**
 * Parses tab/space-indented tree structures with multi-column (#) comments.
 */
export function parseTreeGrid(source: string): ParsedTreeGrid {
    const lines = source.split(/\r?\n/);
    const rootNodes: TreeGridNode[] = [];
    const nodeStack: { node: TreeGridNode; depth: number }[] = [];
    const indentStack: number[] = [0];
    let maxCols = 0;
    let idCounter = 0;

    for (const rawLine of lines) {
        if (!rawLine.trim()) continue;

        // Skip markdown comments, legacy diagram flags or metadata tags if any
        if (rawLine.trim().startsWith('<!--')) continue;
        if (rawLine.trim().startsWith('-') && rawLine.includes(':')) continue;
        if (rawLine.toLowerCase().includes('add item')) continue;

        const rawIndent = getRawLeadingWhitespace(rawLine);

        // Normalize depth via indentStack so any indentation style (2-space, 4-space, 6-space, tabs) works seamlessly
        if (rawIndent > indentStack[indentStack.length - 1]) {
            indentStack.push(rawIndent);
        } else {
            while (indentStack.length > 1 && rawIndent < indentStack[indentStack.length - 1]) {
                indentStack.pop();
            }
        }
        const depth = indentStack.length - 1;

        const leadingMatch = rawLine.match(/^[\t ]*/);
        const leadingWhitespace = leadingMatch ? leadingMatch[0] : '';
        const trimmedLine = rawLine.slice(leadingWhitespace.length);

        const { name, rawName, trailingContent, columns } = extractNameAndColumns(trimmedLine);

        if (columns.length > maxCols) {
            maxCols = columns.length;
        }

        const isDir = !isFileName(name);
        const extension = isDir ? undefined : getExtension(name);

        const node: TreeGridNode = {
            id: `tree-node-${++idCounter}`,
            name,
            rawName,
            rawLine,
            leadingWhitespace,
            trailingContent,
            depth,
            isDirectory: isDir,
            extension,
            columns,
            children: [],
            isExpanded: true,
        };

        // Stack-based hierarchical tree assembly
        while (nodeStack.length > 0 && nodeStack[nodeStack.length - 1].depth >= depth) {
            nodeStack.pop();
        }

        if (nodeStack.length === 0) {
            rootNodes.push(node);
        } else {
            const parent = nodeStack[nodeStack.length - 1].node;
            node.parent = parent;
            parent.children.push(node);
            if (!isFileName(parent.name)) {
                parent.isDirectory = true;
            } else {
                parent.hasExtensionConflict = true;
            }
        }

        nodeStack.push({ node, depth });
    }

    // Total columns = Name column (0) + comment columns
    const totalColumns = Math.max(1, maxCols + 1);
    const columnTitles: string[] = ['NAME / PATH'];

    for (let i = 1; i < totalColumns; i++) {
        columnTitles.push('#'.repeat(i));
    }

    return {
        rootNodes,
        totalColumns,
        columnTitles,
    };
}

/**
 * Checks if a node is the last child among its siblings.
 */
export function isLastChild(node: TreeGridNode, rootNodes: TreeGridNode[]): boolean {
    if (!node.parent) {
        const idx = rootNodes.indexOf(node);
        return idx === rootNodes.length - 1;
    }
    const siblings = node.parent.children;
    const idx = siblings.indexOf(node);
    return idx === siblings.length - 1;
}

/**
 * Computes authentic ASCII branching prefix (├──, └──, │   ) for rendering.
 */
export function getAsciiBranchPrefix(node: TreeGridNode, rootNodes: TreeGridNode[]): string {
    if (node.depth === 0) {
        return '';
    }

    const rails: string[] = [];
    let curr = node.parent;

    while (curr && curr.depth > 0) {
        const hasNext = !isLastChild(curr, rootNodes);
        rails.unshift(hasNext ? '│   ' : '    ');
        curr = curr.parent;
    }

    const isLast = isLastChild(node, rootNodes);
    const branch = isLast ? '└── ' : '├── ';

    return rails.join('') + branch;
}

/**
 * Computes maximum visual character length of Column 0 across all nodes.
 */
export function getMaxCol0Length(nodes: TreeGridNode[]): number {
    let max = 0;
    const traverse = (list: TreeGridNode[]) => {
        for (const n of list) {
            const prefix = getAsciiBranchPrefix(n, nodes);
            const chevronLen = n.isDirectory ? 2 : (n.depth === 0 ? 2 : 0);
            const len = prefix.length + chevronLen + n.name.length;
            if (len > max) max = len;
            if (n.children && n.children.length > 0) {
                traverse(n.children);
            }
        }
    };
    traverse(nodes);
    return max;
}

/**
 * Serializes TreeGridNodes back to clean plain-text source without any pipe symbols.
 * Pure indentation, item names, and padded spaces aligning the # comments.
 */
export function serializeTreeToSource(
    nodes: TreeGridNode[],
    col0Target = 0,
    colWidthsTarget: number[] = []
): string[] {
    const lines: string[] = [];
    const maxCol0 = getMaxCol0Length(nodes);
    const effectiveCol0 = Math.max(maxCol0 + 2, col0Target);

    const serializeNode = (node: TreeGridNode) => {
        const indent = '\t'.repeat(node.depth);
        let line = indent + node.name;
        if (node.isDirectory && node.rawName.endsWith('/')) {
            line += '/';
        }

        if (node.columns && node.columns.length > 0) {
            const itemVisualLength = (node.depth * 4) + 2 + node.name.length;
            const spacesCount = Math.max(2, effectiveCol0 - itemVisualLength);
            line += ' '.repeat(spacesCount);

            for (let c = 0; c < node.columns.length; c++) {
                const colVal = node.columns[c];
                const clean = colVal.replace(/^#+\s*/, '').trim();
                const formattedCol = `#${clean}`;

                if (c > 0) {
                    const colPad = colWidthsTarget[c] ? Math.max(4, colWidthsTarget[c]) : 6;
                    line += ' '.repeat(colPad);
                }
                line += formattedCol;
            }
        }

        lines.push(line);

        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                serializeNode(child);
            }
        }
    };

    for (const root of nodes) {
        serializeNode(root);
    }

    return lines;
}

/**
 * Resolves note spacing/gap from a number or sentence string.
 * - Pure number or numeric string (e.g. 1, 4, "4 spaces"): returns the numeric value (min 1).
 * - Sentence input (e.g. "satu dua tiga"): calculates the word count (min 1).
 * Default is 1 space (longest word length + 1 space).
 */
export function resolveNoteSpacing(input: unknown, defaultGap = 1): number {
    if (input === undefined || input === null) return defaultGap;
    if (typeof input === 'number') {
        return Math.max(1, Math.round(input));
    }
    const str = String(input).trim();
    if (!str) return defaultGap;

    const numMatch = str.match(/^(\d+)/);
    if (numMatch) {
        return Math.max(1, parseInt(numMatch[1], 10));
    }

    const words = str.split(/\s+/).filter((w) => w.length > 0);
    if (words.length > 0) {
        return Math.max(1, words.length);
    }

    return defaultGap;
}

/**
 * Calculates the target note column ruler for an entire panel-tree block.
 * Respects in-block -spacing parameters, longest node visual width + gap,
 * and existing aligned comment columns in the document.
 */
export function getTreeBlockTargetCol(lines: string[], customGap?: unknown): number {
    let detectedGap = customGap;
    if (detectedGap === undefined) {
        for (const line of lines) {
            const m = line.trim().match(/^(?:[-#]\s*(?:spacing|gap|note-gap|note-spacing)\s*:\s*)(.+)$/i);
            if (m) {
                detectedGap = m[1].trim();
                break;
            }
        }
    }
    const gap = resolveNoteSpacing(detectedGap, 1);

    let maxPreWidth = 0;
    let maxExistingCol = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('<!--') || (trimmed.startsWith('-') && trimmed.includes(':'))) {
            continue;
        }

        const leadMatch = line.match(/^[\t ]*/);
        const indent = leadMatch ? leadMatch[0] : '';
        const content = line.slice(indent.length);

        let indentVisualWidth = 0;
        for (const ch of indent) {
            indentVisualWidth += ch === '\t' ? 4 : 1;
        }

        const hashMatch = /(?:[ \t]+\|[ \t]*|[ \t]+)#|\s+##+\s*|(?<=\S)#/.exec(content);
        let name = content;
        if (hashMatch) {
            name = content.slice(0, hashMatch.index).trim();
            const colBeforeHash = indentVisualWidth + hashMatch.index;
            if (colBeforeHash > maxExistingCol) {
                maxExistingCol = colBeforeHash;
            }
        } else if (content.includes('|')) {
            const pipeIdx = content.indexOf('|');
            name = content.slice(0, pipeIdx).trim();
            const colBeforePipe = indentVisualWidth + pipeIdx;
            if (colBeforePipe > maxExistingCol) {
                maxExistingCol = colBeforePipe;
            }
        } else {
            name = content.trim();
        }

        const preVisualWidth = indentVisualWidth + name.length;
        if (preVisualWidth > maxPreWidth) {
            maxPreWidth = preVisualWidth;
        }
    }

    return Math.max(maxPreWidth + gap, maxExistingCol);
}

/**
 * Aligns all "#" comment notes across tree block lines into a uniform vertical column.
 * - Default spacing: Longest word length + 1 space.
 * - Supports customGap as a number (e.g. 2, 4) or sentence input (checks word count).
 * - Also checks in-block metadata (e.g. "-spacing: 4" or "-spacing: word word").
 * Preserves indentation, empty lines, and metadata.
 */
export function alignTreeBlockNotes(lines: string[], customGap?: unknown): string[] {
    interface LineInfo {
        raw: string;
        isTreeLine: boolean;
        indent: string;
        name: string;
        comment: string | null;
        preVisualWidth: number;
    }

    const targetCol = getTreeBlockTargetCol(lines, customGap);

    const parsedLines: LineInfo[] = [];
    let hasAnyComment = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('<!--') || (trimmed.startsWith('-') && trimmed.includes(':'))) {
            parsedLines.push({
                raw: line,
                isTreeLine: false,
                indent: '',
                name: '',
                comment: null,
                preVisualWidth: 0,
            });
            continue;
        }

        const leadMatch = line.match(/^[\t ]*/);
        const indent = leadMatch ? leadMatch[0] : '';
        const content = line.slice(indent.length);

        // Check for comment separator
        const hashMatch = /(?:[ \t]+\|[ \t]*|[ \t]+)#|\s+##+\s*|(?<=\S)#/.exec(content);
        let name = content;
        let comment: string | null = null;

        if (hashMatch) {
            name = content.slice(0, hashMatch.index).trim();
            const rest = content.slice(hashMatch.index).trim();
            // Clean comment: strip leading # and spaces
            const cleanComment = rest.replace(/^[#\s]+/, '').trim();
            if (cleanComment.length > 0) {
                comment = cleanComment;
                hasAnyComment = true;
            }
        } else if (content.includes('|')) {
            const pipeIdx = content.indexOf('|');
            name = content.slice(0, pipeIdx).trim();
            const rest = content.slice(pipeIdx + 1).trim();
            const cleanComment = rest.replace(/^[#\s]+/, '').trim();
            if (cleanComment.length > 0) {
                comment = cleanComment;
                hasAnyComment = true;
            }
        } else {
            name = content.trim();
        }

        // Compute visual width of indent + name (expanding \t to 4 spaces)
        let indentVisualWidth = 0;
        for (const ch of indent) {
            indentVisualWidth += ch === '\t' ? 4 : 1;
        }
        const preVisualWidth = indentVisualWidth + name.length;

        parsedLines.push({
            raw: line,
            isTreeLine: true,
            indent,
            name,
            comment,
            preVisualWidth,
        });
    }

    if (!hasAnyComment) {
        return lines;
    }

    return parsedLines.map((pl) => {
        if (!pl.isTreeLine || pl.comment === null) {
            return pl.raw;
        }

        const spacesCount = Math.max(1, targetCol - pl.preVisualWidth);
        const pad = ' '.repeat(spacesCount);
        return `${pl.indent}${pl.name}${pad}# ${pl.comment}`;
    });
}
