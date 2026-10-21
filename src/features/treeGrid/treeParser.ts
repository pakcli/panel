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
 * Computes indentation level from leading tabs and spaces.
 */
function getIndentationLevel(line: string): number {
    let tabs = 0;
    let spaces = 0;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '\t') {
            tabs++;
        } else if (c === ' ') {
            spaces++;
        } else {
            break;
        }
    }
    // 2 or 4 spaces per tab equivalent
    return tabs + Math.floor(spaces / 2);
}

/**
 * Parses up to 10 columns from comment text after '#'.
 * Supports '# col1 ## col2 ### col3 ...' or comma/hash splits.
 */
export function parseCommentColumns(rawComment: string): string[] {
    if (!rawComment) return [];

    // Split on ' ##', ' ###', etc. or sequential '#'
    const parts = rawComment.split(/\s+##+\s*/);
    const cols: string[] = [];

    for (const part of parts) {
        const cleaned = part.trim();
        if (cleaned) {
            cols.push(cleaned);
        }
    }

    return cols.slice(0, 10);
}

/**
 * Main parser: converts raw markdown codeblock source to a hierarchical TreeGridNode structure.
 */
export function parseTreeGrid(source: string): ParsedTreeGrid {
    const lines = source.split(/\r?\n/);
    const rootNodes: TreeGridNode[] = [];
    const stack: { node: TreeGridNode; depth: number }[] = [];
    let maxCols = 0;
    let idCounter = 0;

    for (const rawLine of lines) {
        if (!rawLine.trim()) continue;

        // Skip markdown comments or metadata tags if any
        if (rawLine.trim().startsWith('<!--')) continue;

        const depth = getIndentationLevel(rawLine);
        const trimmedLine = rawLine.trim();

        // Separate node name from comment columns
        // e.g. "player.csv # Roster atlet ## Tabular"
        let namePart = trimmedLine;
        let commentPart = '';

        const hashIndex = trimmedLine.indexOf('#');
        if (hashIndex !== -1) {
            namePart = trimmedLine.slice(0, hashIndex).trim();
            commentPart = trimmedLine.slice(hashIndex + 1).trim();
        }

        // If line is just a pure comment without name
        if (!namePart && commentPart) {
            namePart = `# ${commentPart}`;
            commentPart = '';
        }

        const isDir = !isFileName(namePart);
        const extension = isDir ? undefined : getExtension(namePart);
        const columns = parseCommentColumns(commentPart);

        if (columns.length > maxCols) {
            maxCols = columns.length;
        }

        const node: TreeGridNode = {
            id: `tree-node-${++idCounter}`,
            name: namePart.replace(/[\/\\]$/, ''), // strip trailing slash for clean title
            rawName: namePart,
            rawLine,
            depth,
            isDirectory: isDir,
            extension,
            columns,
            children: [],
            isExpanded: true,
        };

        // Stack-based hierarchical tree assembly
        while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
            stack.pop();
        }

        if (stack.length === 0) {
            rootNodes.push(node);
        } else {
            const parent = stack[stack.length - 1].node;
            node.parent = parent;
            parent.children.push(node);
        }

        if (isDir) {
            stack.push({ node, depth });
        }
    }

    // Total columns = Name column (0) + comment columns
    const totalColumns = Math.max(1, maxCols + 1);
    const columnTitles: string[] = ['Name / Path'];

    for (let i = 1; i < totalColumns; i++) {
        if (i === 1) columnTitles.push('Description (#)');
        else if (i === 2) columnTitles.push('Category (##)');
        else if (i === 3) columnTitles.push('Details (###)');
        else columnTitles.push(`Column ${i + 1}`);
    }

    return {
        rootNodes,
        totalColumns,
        columnTitles,
    };
}
