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

import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType, keymap } from '@codemirror/view';
import { RangeSetBuilder, Prec, Extension } from '@codemirror/state';
import { Plugin, Notice } from 'obsidian';
import { isFileName, getExtension, extractNameAndColumns, getRawLeadingWhitespace, isLastChild, isTreeBlockAlias, alignTreeBlockNotes, getTreeBlockTargetCol } from './treeParser';
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

        // Folder Chevron (Single, clickable chevron) or 2-space spacer for files
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
        } else {
            // Non-directory item: 2 spaces spacer to maintain identical monospace column alignment with folder chevrons
            const spacerSpan = document.createElement('span');
            spacerSpan.className = 'pakcli-tree-chevron pakcli-tree-spacer';
            spacerSpan.textContent = '  ';
            span.appendChild(spacerSpan);
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
        readonly noteSpacing?: string,
        readonly isSelected: boolean = false
    ) {
        super();
    }

    eq(other: TreeBadgesWidget): boolean {
        return (
            this.node.id === other.node.id &&
            this.node.columns.join('|') === other.node.columns.join('|') &&
            this.lineInfo.lineNo === other.lineInfo.lineNo &&
            this.isSelected === other.isSelected
        );
    }

    toDOM(): HTMLElement {
        const container = document.createElement('span');
        container.className = this.isSelected ? 'pakcli-tree-badges is-selected' : 'pakcli-tree-badges';
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
                    if (!isFileName(parent.name)) {
                        parent.isDirectory = true;
                    } else {
                        parent.hasExtensionConflict = true;
                    }
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
                const isLineSelected = (selection.head >= bl.from && selection.head <= bl.to) ||
                    (selection.to >= bl.from && selection.from <= bl.to);
                const isCursorOnLine = view.hasFocus && isLineSelected;

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

                // 1. Visible line decoration: tag active/selected line for badge visibility
                const lineCls = isLineSelected ? 'pakcli-tree-line is-selected-line cm-active' : 'pakcli-tree-line';
                builder.add(
                    bl.from,
                    bl.from,
                    Decoration.line({ attributes: { class: lineCls } })
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
                } else if (rails || node) {
                    builder.add(
                        bl.from,
                        bl.from,
                        Decoration.widget({
                            widget: new TreeBranchWidget(rails, node, view),
                            side: -1,
                        })
                    );
                }

                // If node has extension conflict (is a file but has children indented beneath it),
                // mark name with red wavy underline
                const nameStart = Math.min(bl.to, bl.from + leadLen);
                const nameEnd = Math.min(bl.to, nameStart + node.rawName.length);
                if (node.hasExtensionConflict && nameEnd > nameStart) {
                    builder.add(
                        nameStart,
                        nameEnd,
                        Decoration.mark({
                            attributes: {
                                class: 'pakcli-tree-has-ext-conflict',
                                title: `Invalid hierarchy: "${node.name}" has an extension and cannot contain child items`,
                            },
                        })
                    );
                }

                const text = bl.text;
                const trimmedEndOffset = text.replace(/[\t ]+$/, '').length;

                // Position right at the end of the node name (word [badge] #note)
                const nameEndOffset = leadLen + node.rawName.length;
                const badgePos = Math.min(bl.to, bl.from + nameEndOffset);

                const hasNote = Boolean(node.columns && node.columns.length > 0);

                // Determine badges display mode: 'folder' (default), 'all', or 'none'
                let blockBadgesMode: 'folder' | 'all' | 'none' | undefined;
                for (const line of block.lines) {
                    const m = line.text.trim().match(/^(?:[-#]\s*(?:badges|badge-mode|badge|badges-mode)\s*:\s*)(all|none|folder|only-folder|only folder)/i);
                    if (m) {
                        const val = m[1].toLowerCase().trim();
                        if (val === 'all') blockBadgesMode = 'all';
                        else if (val === 'none') blockBadgesMode = 'none';
                        else blockBadgesMode = 'folder';
                        break;
                    }
                }
                const badgesMode = blockBadgesMode ?? (plugin?.settings?.treeBadgesDisplayMode || 'folder');

                let shouldRenderBadges = false;
                if (badgesMode === 'all') {
                    shouldRenderBadges = node.isDirectory || !hasNote;
                } else if (badgesMode === 'folder') {
                    shouldRenderBadges = node.isDirectory;
                } else {
                    shouldRenderBadges = false;
                }

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
                                noteSpacing,
                                isLineSelected
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

export function handleTreeTabTrigger(view: EditorView, plugin: Plugin): boolean {
    const sel = view.state.selection.main;
    if (!sel.empty) {
        return false;
    }

    const doc = view.state.doc;
    const line = doc.lineAt(sel.head);
    const lineText = line.text;
    const col = sel.head - line.from;
    const beforeCursor = lineText.slice(0, col);
    const afterCursor = lineText.slice(col);

    // 1. Leading indent extraction
    const leadMatch = beforeCursor.match(/^([\t ]*)/);
    const indent = leadMatch ? leadMatch[1] : '';
    const textBefore = beforeCursor.slice(indent.length);

    // If cursor is in the leading indent (before any text), allow default indentation
    if (textBefore.trim() === '') {
        return false;
    }

    // If cursor is already inside an existing '#' note comment, do not re-trigger
    const hashIdx = textBefore.indexOf('#');
    if (hashIdx >= 0 && hashIdx < textBefore.length - 1) {
        return false;
    }

    // 2. Verify cursor is inside a panel-tree block
    const userAliases: string[] = ((plugin as any).settings?.panelTreeAliases || '')
        .split(',')
        .map((a: string) => a.trim().toLowerCase())
        .filter(Boolean);
    const aliases = new Set<string>(userAliases);
    aliases.add('panel-tree');
    aliases.add('panel-tree-cascading');
    aliases.add('tree-cascading');
    aliases.add('tree-interactive');
    aliases.add('panel-tree-cascading-sticky-note');
    aliases.add('panel-tree-cascading-note-sticky');
    aliases.add('panel-tree-cascading-postit');
    aliases.add('panel-tree-postit-cascading');

    let inBlock = false;
    let blockStartLine = -1;
    for (let l = line.number; l >= 1; l--) {
        const text = doc.line(l).text.trim();
        if (text.startsWith('```')) {
            const m = text.match(/^```+\s*([a-zA-Z0-9_-]+)/);
            if (m && isTreeBlockAlias(m[1], aliases)) {
                inBlock = true;
                blockStartLine = l;
            }
            break;
        }
    }

    if (!inBlock || line.number <= blockStartLine) {
        return false;
    }

    let blockEndLine = doc.lines + 1;
    for (let l = line.number; l <= doc.lines; l++) {
        const text = doc.line(l).text.trim();
        if (l > blockStartLine && text.match(/^```+\s*$/)) {
            blockEndLine = l;
            break;
        }
    }

    if (line.number >= blockEndLine) {
        return false;
    }

    // 3. Extract name part and existing note
    let rawNamePart = '';
    let existingNote = '';

    const delimMatch = textBefore.match(/^(.*?)\s*([|#])\s*$/);
    if (delimMatch) {
        // Triggered via explicit delimiter | or # (e.g. "word|", "word |", "word #")
        rawNamePart = delimMatch[1];
        existingNote = afterCursor.replace(/^[|#\s]+/, '').trim();
    } else {
        // Triggered via Tab between words or at end of line
        // e.g. "name file" + Tab before "tambahan" -> turns "tambahan" into "# tambahan"
        // Or "name file" + Tab at end of line -> turns into "name file # "
        if (afterCursor.trim() !== '') {
            const atBoundary = /[\t\s|#]$/.test(textBefore) || /^[\t\s|#]/.test(afterCursor);
            if (!atBoundary) {
                // In the middle of a word without boundary spaces: do not trigger
                return false;
            }
            rawNamePart = textBefore;
            existingNote = afterCursor.replace(/^[|#\s]+/, '').trim();
        } else {
            rawNamePart = textBefore;
            existingNote = '';
        }
    }

    const cleanName = rawNamePart
        .replace(/^(?:[Vv>▼▶]\s*)+/, '')
        .replace(/^[├└│|L\s─\-+▼▶vV><]+/g, '')
        .trim();

    if (!cleanName || !/[a-zA-Z0-9_\.]/.test(cleanName)) {
        return false;
    }

    // 4. Normalize excessive indentation deeper than parentDepth + 1
    const indentStack: number[] = [0];
    let parentDepth = 0;
    for (let l = blockStartLine + 1; l < line.number; l++) {
        const text = doc.line(l).text;
        const trimmed = text.trim();
        if (!trimmed || trimmed.startsWith('<!--') || (trimmed.startsWith('-') && trimmed.includes(':'))) {
            continue;
        }
        const m = text.match(/^[\t ]*/);
        const ind = m ? m[0] : '';
        let indWidth = 0;
        for (const ch of ind) {
            indWidth += ch === '\t' ? 4 : 1;
        }
        if (indWidth > indentStack[indentStack.length - 1]) {
            indentStack.push(indWidth);
        } else {
            while (indentStack.length > 1 && indWidth < indentStack[indentStack.length - 1]) {
                indentStack.pop();
            }
        }
        parentDepth = indentStack.length - 1;
    }

    let normalizedIndent = indent;
    let rawIndentCount = 0;
    for (const ch of indent) {
        rawIndentCount += ch === '\t' ? 1 : 0.25;
    }
    if (rawIndentCount > parentDepth + 1) {
        normalizedIndent = '\t'.repeat(parentDepth + 1);
    }

    // 5. Collect block lines and align entire tree block
    const blockLines: string[] = [];
    const currentLineIdx = line.number - (blockStartLine + 1);

    for (let l = blockStartLine + 1; l < blockEndLine; l++) {
        if (l === line.number) {
            blockLines.push(`${normalizedIndent}${cleanName}   # ${existingNote}`);
        } else {
            blockLines.push(doc.line(l).text);
        }
    }

    const noteSpacing = (plugin as any)?.settings?.treeNoteSpacing || '1';
    const alignedLines = alignTreeBlockNotes(blockLines, noteSpacing);

    const blockStartPos = doc.line(blockStartLine + 1).from;
    const blockEndPos = doc.line(blockEndLine - 1).to;

    // Calculate cursor position right after "# " on the current line
    const currentAligned = alignedLines[currentLineIdx] || `${normalizedIndent}${cleanName} # ${existingNote}`;
    const noteHashIdx = currentAligned.indexOf('#');
    const newCursorInLine = noteHashIdx >= 0 ? noteHashIdx + 2 : currentAligned.length;

    let offsetInBlock = 0;
    for (let i = 0; i < currentLineIdx; i++) {
        offsetInBlock += alignedLines[i].length + 1; // + 1 for \n
    }
    const newCursorPos = blockStartPos + offsetInBlock + newCursorInLine;

    const scroller = view.scrollDOM;
    const savedScrollTop = scroller ? scroller.scrollTop : null;

    view.dispatch({
        changes: {
            from: blockStartPos,
            to: blockEndPos,
            insert: alignedLines.join('\n'),
        },
        selection: { anchor: newCursorPos, head: newCursorPos },
        scrollIntoView: true,
    });

    if (scroller && savedScrollTop !== null) {
        scroller.scrollTop = savedScrollTop;
    }

    return true;
}

export function createTreeTabKeymap(plugin: Plugin): Extension[] {
    return [
        Prec.highest(
            keymap.of([
                {
                    key: 'Tab',
                    run: (v) => handleTreeTabTrigger(v, plugin),
                },
            ])
        ),
        EditorView.domEventHandlers({
            keydown(event: KeyboardEvent, view: EditorView) {
                if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                    if (handleTreeTabTrigger(view, plugin)) {
                        event.preventDefault();
                        event.stopPropagation();
                        return true;
                    }
                }
                return false;
            },
        }),
    ];
}

export function createTreeLivePreviewPlugin(plugin: Plugin): Extension[] {
    const viewPlugin = ViewPlugin.fromClass(
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

    return [viewPlugin, ...createTreeTabKeymap(plugin)];
}
