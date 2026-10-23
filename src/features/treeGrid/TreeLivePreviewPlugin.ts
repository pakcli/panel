/**
 * TreeLivePreviewPlugin.ts
 *
 * Implements "Extra GUI" for panel-tree codeblocks in Obsidian Live Preview:
 * 1. Branch Rails: ASCII tree branch lines (│   , ├── , └── ) rendered cleanly via CodeMirror Decoration.
 * 2. Clickable Chevrons / Branch Prefix: Interactive fold/unfold for folders.
 * 3. Contextual Badges: '[+File]' and '[+Folder]' placed EXACTLY beside the folder name.
 * 4. Zero Footer: No stacked prompt lines or footer bloat at the bottom.
 *
 * Strictly adheres to:
 * - 100% Native CodeMirror lines (.cm-line.HyperMD-codeblock)
 * - Zero replacement widgets on codeblock container (no cm-embed-block, no contenteditable="false")
 * - 100% Native typing, selecting, and overwriting
 * - 100% Fail-safe: Any unexpected document state is caught and returns Decoration.none
 */

import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { Plugin, Notice } from 'obsidian';
import { isFileName, getExtension, extractNameAndColumns, getRawLeadingWhitespace, isLastChild, isTreeBlockAlias, alignTreeBlockNotes } from './treeParser';
import { TreeGridNode } from './types';

// Track collapsed folders by unique path (e.g. "data/asset/player")
const collapsedFolderPaths = new Set<string>();
let collapsedVersion = 0;

export function isGhostLine(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed) return true;
    if (trimmed.toLowerCase().includes('add item')) return true;

    // Strip leading ASCII branch symbols, pipes, chevrons, etc.
    const stripped = trimmed.replace(/^[├└│|L\s─\-+▼▶vV><]+/g, '').trim();
    if (!stripped || !/[a-zA-Z0-9_\.]/.test(stripped)) {
        return true;
    }
    return false;
}

export function getFolderPath(node: TreeGridNode): string {
    const parts: string[] = [];
    let curr: TreeGridNode | undefined = node;
    while (curr) {
        parts.unshift(curr.name);
        curr = curr.parent;
    }
    return parts.join('/');
}

export function isNodeHidden(node: TreeGridNode): boolean {
    let curr = node.parent;
    while (curr) {
        if (collapsedFolderPaths.has(getFolderPath(curr))) {
            return true;
        }
        curr = curr.parent;
    }
    return false;
}

export function getLastSubtreeNode(node: TreeGridNode): TreeGridNode {
    if (node.children && node.children.length > 0) {
        return getLastSubtreeNode(node.children[node.children.length - 1]);
    }
    return node;
}

function getRailsForNode(node: TreeGridNode, rootNodes: TreeGridNode[]): string {
    if (node.depth === 0) return '';

    const rails: string[] = [];
    let curr = node.parent;

    while (curr && curr.depth > 0) {
        const hasNext = !isLastChild(curr, rootNodes);
        rails.unshift(hasNext ? '│   ' : '    ');
        curr = curr.parent;
    }

    const isLast = isLastChild(node, rootNodes);
    const connector = isLast ? '└── ' : '├── ';
    rails.push(connector);

    return rails.join('');
}

class TreeBranchWidget extends WidgetType {
    constructor(
        readonly rails: string,
        readonly folder: TreeGridNode | null = null,
        readonly view: EditorView | null = null
    ) {
        super();
    }

    eq(other: TreeBranchWidget): boolean {
        const sameFolder = this.folder?.id === other.folder?.id;
        const sameCollapsed = this.folder ? collapsedFolderPaths.has(getFolderPath(this.folder)) : false;
        const otherCollapsed = other.folder ? collapsedFolderPaths.has(getFolderPath(other.folder)) : false;
        return other.rails === this.rails && sameFolder && sameCollapsed === otherCollapsed;
    }

    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'pakcli-tree-prefix';
        span.setAttribute('contenteditable', 'false');

        // Branch Rails
        if (this.rails) {
            const railSpan = document.createElement('span');
            railSpan.className = 'pakcli-tree-rails';
            railSpan.textContent = this.rails;
            span.appendChild(railSpan);
        }

        // Folder Chevron (Single, clickable chevron)
        if (this.folder && this.folder.isDirectory) {
            const isCollapsed = collapsedFolderPaths.has(getFolderPath(this.folder));
            const chevronSpan = document.createElement('span');
            chevronSpan.className = 'pakcli-tree-chevron';
            chevronSpan.textContent = isCollapsed ? '> ' : 'v ';
            span.appendChild(chevronSpan);

            span.style.cursor = 'pointer';
            span.title = isCollapsed ? 'Click to expand' : 'Click to collapse';
            span.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            span.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const p = getFolderPath(this.folder!);
                if (collapsedFolderPaths.has(p)) {
                    collapsedFolderPaths.delete(p);
                } else {
                    collapsedFolderPaths.add(p);
                }
                collapsedVersion++;
                this.view?.dispatch({});
            });
        }

        return span;
    }

    ignoreEvent(e: Event): boolean {
        if (e.type === 'click' || e.type === 'mousedown') {
            return false;
        }
        return true;
    }
}

interface LinePositionInfo {
    lineNo: number;
    from: number;
    to: number;
}

interface BlockPositionInfo {
    startLine: number;
    endLine: number;
}

class TreeBadgesWidget extends WidgetType {
    constructor(
        readonly node: TreeGridNode,
        readonly view: EditorView,
        readonly insertPosProvider: () => number,
        readonly lineInfo: LinePositionInfo,
        readonly blockInfo: BlockPositionInfo,
        readonly noteSpacing?: string
    ) {
        super();
    }

    eq(other: TreeBadgesWidget): boolean {
        return (
            this.node.id === other.node.id &&
            this.node.columns.join('|') === other.node.columns.join('|') &&
            this.lineInfo.lineNo === other.lineInfo.lineNo
        );
    }

    toDOM(): HTMLElement {
        const container = document.createElement('span');
        container.className = 'pakcli-tree-badges';
        container.setAttribute('contenteditable', 'false');

        const isDir = this.node.isDirectory;
        const hasNote = Boolean(this.node.columns && this.node.columns.length > 0);

        let fileBadge: HTMLElement | null = null;
        let folderBadge: HTMLElement | null = null;
        let noteBadge: HTMLElement | null = null;

        if (isDir) {
            fileBadge = document.createElement('span');
            fileBadge.className = 'pakcli-tree-badge pakcli-badge-file';
            fileBadge.textContent = '+File';
            fileBadge.title = `Add file inside ${this.node.name}`;

            folderBadge = document.createElement('span');
            folderBadge.className = 'pakcli-tree-badge pakcli-badge-folder';
            folderBadge.textContent = '+Folder';
            folderBadge.title = `Add folder inside ${this.node.name}`;
        }

        // Only show +Note badge if note is NOT yet present
        if (!hasNote) {
            noteBadge = document.createElement('span');
            noteBadge.className = 'pakcli-tree-badge pakcli-badge-note';
            noteBadge.textContent = '+Note';
            noteBadge.title = `Add note to ${this.node.name}`;
        }

        let isClosing = false;
        const restoreBadges = () => {
            if (isClosing) return;
            isClosing = true;
            container.empty();
            if (fileBadge) container.appendChild(fileBadge);
            if (folderBadge) container.appendChild(folderBadge);
            if (noteBadge && !hasNote) container.appendChild(noteBadge);
        };

        const activateChildInput = (isFolderType: boolean) => {
            isClosing = false;
            container.empty();

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pakcli-tree-inline-input';
            input.placeholder = isFolderType ? 'folder-name' : 'file.webp';
            container.appendChild(input);
            input.focus();

            const handleCommit = (shouldKeepOpen: boolean) => {
                const val = input.value.trim();
                if (val) {
                    try {
                        const folderPath = getFolderPath(this.node);
                        if (collapsedFolderPaths.has(folderPath)) {
                            collapsedFolderPaths.delete(folderPath);
                            collapsedVersion++;
                        }

                        // Determine indentation for child
                        const childIndent = '\t'.repeat(this.node.depth + 1);
                        const textToInsert = '\n' + childIndent + val;

                        const insertPos = this.insertPosProvider();
                        const scroller = this.view.scrollDOM;
                        const savedScrollTop = scroller ? scroller.scrollTop : null;

                        this.view.dispatch({
                            changes: { from: insertPos, insert: textToInsert },
                        });

                        if (scroller && savedScrollTop !== null) {
                            scroller.scrollTop = savedScrollTop;
                        }

                        new Notice(`✓ Added ${isFolderType ? 'folder' : 'file'} ${val}`);

                        if (shouldKeepOpen) {
                            input.value = '';
                            input.focus();
                            input.select();
                        } else {
                            restoreBadges();
                            this.view.focus();
                        }
                    } catch (err) {
                        console.warn('[PakCLI Tree] Failed to insert item:', err);
                        restoreBadges();
                    }
                } else {
                    restoreBadges();
                    this.view.focus();
                }
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCommit(true);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    restoreBadges();
                    this.view.focus();
                }
            });

            input.addEventListener('blur', () => {
                setTimeout(() => {
                    if (isClosing) return;
                    handleCommit(false);
                }, 100);
            });
        };

        const activateNoteInput = () => {
            isClosing = false;
            container.empty();

            const existingNote = hasNote ? this.node.columns.join(' ') : '';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pakcli-tree-inline-input pakcli-note-input';
            input.placeholder = '# note...';
            input.value = existingNote;
            container.appendChild(input);
            input.focus();
            input.select();

            const handleCommit = () => {
                const val = input.value.trim();
                try {
                    const doc = this.view.state.doc;
                    const lineNo = this.lineInfo.lineNo;
                    if (lineNo < 1 || lineNo > doc.lines) {
                        restoreBadges();
                        return;
                    }

                    const targetLine = doc.line(lineNo);
                    const lineText = targetLine.text;

                    const leadMatch = lineText.match(/^[\t ]*/);
                    const indent = leadMatch ? leadMatch[0] : '';
                    const content = lineText.slice(indent.length);

                    const hashMatch = /(?:[ \t]+\|[ \t]*|[ \t]+)#|\s+##+\s*|(?<=\S)#/.exec(content);
                    const name = hashMatch ? content.slice(0, hashMatch.index).trim() : content.trim();

                    const cleanNote = val.replace(/^[#\s]+/, '').trim();
                    let updatedLine = indent + name;
                    if (cleanNote) {
                        updatedLine += `   # ${cleanNote}`;
                    }

                    // Collect all interior lines of this codeblock
                    const blockLines: string[] = [];
                    for (let l = this.blockInfo.startLine + 1; l < this.blockInfo.endLine; l++) {
                        const curText = doc.line(l).text;
                        blockLines.push(l === lineNo ? updatedLine : curText);
                    }

                    const aligned = alignTreeBlockNotes(blockLines, this.noteSpacing);

                    const blockStartPos = doc.line(this.blockInfo.startLine + 1).from;
                    const blockEndPos = doc.line(this.blockInfo.endLine - 1).to;

                    const scroller = this.view.scrollDOM;
                    const savedScrollTop = scroller ? scroller.scrollTop : null;

                    this.view.dispatch({
                        changes: {
                            from: blockStartPos,
                            to: blockEndPos,
                            insert: aligned.join('\n'),
                        },
                    });

                    if (scroller && savedScrollTop !== null) {
                        scroller.scrollTop = savedScrollTop;
                    }

                    new Notice(cleanNote ? `✓ Note saved & aligned` : `✓ Note cleared`);
                    restoreBadges();
                    this.view.focus();
                } catch (err) {
                    console.warn('[PakCLI Tree] Failed to save note:', err);
                    restoreBadges();
                }
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCommit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    restoreBadges();
                    this.view.focus();
                }
            });

            input.addEventListener('blur', () => {
                setTimeout(() => {
                    if (isClosing) return;
                    handleCommit();
                }, 100);
            });
        };

        if (fileBadge) {
            fileBadge.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            fileBadge.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                activateChildInput(false);
            });
            container.appendChild(fileBadge);
        }

        if (folderBadge) {
            folderBadge.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            folderBadge.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                activateChildInput(true);
            });
            container.appendChild(folderBadge);
        }

        if (noteBadge) {
            noteBadge.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            noteBadge.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                activateNoteInput();
            });
            container.appendChild(noteBadge);
        }

        return container;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

function buildDecorations(view: EditorView, plugin: any): DecorationSet {
    try {
        if (!view || !view.state || !view.state.doc || view.state.doc.length === 0) {
            return Decoration.none;
        }

        const rawAliases = plugin?.settings?.panelTreeAliases || 'panel-tree, panel-tree-cascading, tree-cascading, panel-tree-structure, tree-structure';
        const aliases = new Set<string>(
            rawAliases
                .split(',')
                .map((a: string) => a.trim().toLowerCase())
                .filter((a: string) => a.length > 0)
        );
        aliases.add('panel-tree');
        aliases.add('panel-tree-cascading');
        aliases.add('tree-cascading');
        aliases.add('tree-interactive');

        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;

        interface BlockLine {
            lineNo: number;
            from: number;
            to: number;
            text: string;
        }
        const blocks: { startLine: number; endLine: number; lines: BlockLine[] }[] = [];
        let inBlock = false;
        let currentBlock: { startLine: number; endLine: number; lines: BlockLine[] } | null = null;

        for (let l = 1; l <= doc.lines; l++) {
            const line = doc.line(l);
            const text = line.text;

            if (!inBlock) {
                const m = text.match(/^```+\s*([a-zA-Z0-9_-]+)/);
                if (m && isTreeBlockAlias(m[1], aliases)) {
                    inBlock = true;
                    currentBlock = { startLine: l, endLine: l, lines: [] };
                }
            } else {
                if (text.match(/^```+\s*$/)) {
                    if (currentBlock) {
                        currentBlock.endLine = l;
                        blocks.push(currentBlock);
                    }
                    inBlock = false;
                    currentBlock = null;
                } else {
                    if (currentBlock) {
                        currentBlock.lines.push({
                            lineNo: l,
                            from: line.from,
                            to: line.to,
                            text,
                        });
                    }
                }
            }
        }
        if (inBlock && currentBlock) {
            currentBlock.endLine = doc.lines;
            blocks.push(currentBlock);
        }

        if (blocks.length === 0) {
            return Decoration.none;
        }

        for (const block of blocks) {
            if (block.lines.length === 0) continue;

            interface ParsedLineInfo {
                blockLine: BlockLine;
                node: TreeGridNode | null;
                rawIndent: number;
                leadingWhitespace: string;
                isGhost: boolean;
            }

            const parsedLines: ParsedLineInfo[] = [];
            const rootNodes: TreeGridNode[] = [];
            const stack: { node: TreeGridNode; rawIndent: number }[] = [];

            for (const bl of block.lines) {
                const raw = bl.text;
                const trimmed = raw.trim();

                if (isGhostLine(raw)) {
                    parsedLines.push({
                        blockLine: bl,
                        node: null,
                        rawIndent: 0,
                        leadingWhitespace: '',
                        isGhost: true,
                    });
                    continue;
                }

                // Comments or metadata
                if (trimmed.startsWith('<!--') || (trimmed.startsWith('-') && trimmed.includes(':'))) {
                    parsedLines.push({
                        blockLine: bl,
                        node: null,
                        rawIndent: 0,
                        leadingWhitespace: '',
                        isGhost: false,
                    });
                    continue;
                }

                const rawIndent = getRawLeadingWhitespace(raw);
                const leadMatch = raw.match(/^[\t ]*(?:[Vv>▼▶]\s*)?/);
                const leadingWhitespace = leadMatch ? leadMatch[0] : '';

                // Clean name and columns (also strips repeated v, >, etc.)
                const cleanTrimmed = trimmed.replace(/^(?:[Vv>▼▶]\s*)+/, '');
                const parsedCols = extractNameAndColumns(cleanTrimmed);

                // Double check parsedCols.name has valid word characters
                const strippedName = parsedCols.name.replace(/^[├└│|L\s─\-+▼▶vV><]+/g, '').trim();
                if (!strippedName || !/[a-zA-Z0-9_\.]/.test(strippedName)) {
                    parsedLines.push({
                        blockLine: bl,
                        node: null,
                        rawIndent: 0,
                        leadingWhitespace: '',
                        isGhost: true,
                    });
                    continue;
                }

                while (stack.length > 0 && rawIndent <= stack[stack.length - 1].rawIndent) {
                    stack.pop();
                }

                const parent = stack.length > 0 ? stack[stack.length - 1].node : null;
                const depth = stack.length;

                const isDir = !isFileName(parsedCols.name);
                const node: TreeGridNode = {
                    id: `tree-node-${bl.lineNo}`,
                    name: parsedCols.name,
                    rawName: parsedCols.rawName,
                    depth,
                    isDirectory: isDir,
                    extension: isDir ? undefined : getExtension(parsedCols.name),
                    columns: parsedCols.columns,
                    children: [],
                    parent: parent || undefined,
                    isExpanded: true,
                };

                if (parent) {
                    parent.children.push(node);
                    parent.isDirectory = true;
                } else {
                    rootNodes.push(node);
                }

                stack.push({ node, rawIndent });

                parsedLines.push({
                    blockLine: bl,
                    node,
                    rawIndent,
                    leadingWhitespace,
                    isGhost: false,
                });
            }

            // Map node to line for subtree insertion pos
            const lineByNode = new Map<TreeGridNode, BlockLine>();
            for (const pl of parsedLines) {
                if (pl.node) {
                    lineByNode.set(pl.node, pl.blockLine);
                }
            }

            const selection = view.state.selection.main;

            // Add decorations strictly per-line in monotonic ascending position order
            for (let i = 0; i < parsedLines.length; i++) {
                const pl = parsedLines[i];
                const bl = pl.blockLine;
                const isCursorOnLine = view.hasFocus && selection.head >= bl.from && selection.head <= bl.to;

                const shouldHide = (pl.isGhost && !isCursorOnLine) || (pl.node && isNodeHidden(pl.node));

                if (shouldHide) {
                    builder.add(
                        bl.from,
                        bl.from,
                        Decoration.line({ attributes: { class: 'pakcli-tree-line-hidden' } })
                    );
                    continue;
                }

                if (!pl.node) {
                    // Blank or comment line: keep normal
                    continue;
                }

                const node = pl.node;

                // 1. Visible line decoration
                builder.add(
                    bl.from,
                    bl.from,
                    Decoration.line({ attributes: { class: 'pakcli-tree-line' } })
                );

                // 2. Compute rails
                const rails = getRailsForNode(node, rootNodes);

                // Replace leading whitespace with branch rails widget
                const leadLen = pl.leadingWhitespace.length;
                if (leadLen > 0) {
                    builder.add(
                        bl.from,
                        bl.from + leadLen,
                        Decoration.replace({
                            widget: new TreeBranchWidget(rails, node, view),
                        })
                    );
                } else if (rails || (node && node.isDirectory)) {
                    builder.add(
                        bl.from,
                        bl.from,
                        Decoration.widget({
                            widget: new TreeBranchWidget(rails, node, view),
                            side: -1,
                        })
                    );
                }

                const text = bl.text;
                const trimmedEndOffset = text.replace(/[\t ]+$/, '').length;

                // Position right at the end of the node name (word [badge] #note)
                const nameEndOffset = leadLen + node.rawName.length;
                const badgePos = Math.min(bl.to, bl.from + nameEndOffset);

                const hasNote = Boolean(node.columns && node.columns.length > 0);
                const shouldRenderBadges = node.isDirectory || !hasNote;

                // 3. Badges widget right beside the word: word [badge] #note
                if (shouldRenderBadges) {
                    const insertPosProvider = () => {
                        const last = getLastSubtreeNode(node);
                        const info = lineByNode.get(last);
                        return info ? info.to : bl.to;
                    };

                    const noteSpacing = plugin?.settings?.treeNoteSpacing || '1';

                    builder.add(
                        badgePos,
                        badgePos,
                        Decoration.widget({
                            widget: new TreeBadgesWidget(
                                node,
                                view,
                                insertPosProvider,
                                { lineNo: pl.blockLine.lineNo, from: pl.blockLine.from, to: pl.blockLine.to },
                                { startLine: block.startLine, endLine: block.endLine },
                                noteSpacing
                            ),
                            side: 1,
                        })
                    );
                }
            }
        }

        return builder.finish();
    } catch (err) {
        console.warn('[PakCLI Tree] buildDecorations caught error:', err);
        return Decoration.none;
    }
}

export function createTreeLivePreviewPlugin(plugin: Plugin) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            private lastCollapsedVersion = 0;

            constructor(view: EditorView) {
                try {
                    this.decorations = buildDecorations(view, plugin);
                } catch (err) {
                    console.warn('[PakCLI Tree] constructor error:', err);
                    this.decorations = Decoration.none;
                }
            }

            update(update: ViewUpdate) {
                try {
                    if (
                        update.docChanged ||
                        update.viewportChanged ||
                        update.selectionSet ||
                        update.geometryChanged ||
                        update.heightChanged ||
                        this.lastCollapsedVersion !== collapsedVersion
                    ) {
                        this.lastCollapsedVersion = collapsedVersion;
                        this.decorations = buildDecorations(update.view, plugin);
                    }
                } catch (err) {
                    console.warn('[PakCLI Tree] update error:', err);
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );
}
