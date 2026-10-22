/**
 * TreeCascadingManager.ts
 *
 * Implements "panel-tree-cascading" (Cascading Sticky Tree Headers):
 * When scrolling down a long panel-tree codeblock in Obsidian:
 * 1. Pinned Active Hierarchy: Active directory path (e.g. data › asset › player) stickily pins at the top.
 * 2. Tidy Mobile Style: Compact 26px height, monospace tokens, subtle backdrop-blur.
 * 3. Quick Actions: [+File] and [+Folder] available directly from the sticky header.
 * 4. Click-to-Jump: Clicking any folder token smoothly navigates back up to that folder in the document.
 */

import { App, MarkdownView, Platform, Notice, TFile } from 'obsidian';
import type PakCLITablePlugin from '../../../main';
import { TreeGridNode } from '../types';
import { extractNameAndColumns, getRawLeadingWhitespace, isFileName, getExtension, isTreeBlockAlias } from '../treeParser';
import { TreeCascadingSettings, DEFAULT_TREE_CASCADING_SETTINGS, TreeCrumbItem } from './types';

interface TreeCascadingSession {
    view: MarkdownView;
    barEl: HTMLElement;
    boundScrollEl: HTMLElement | null;
    scrollListener: (() => void) | null;
    lastChainKey: string;
}

interface ParsedBlockTree {
    startLine: number; // 0-indexed document line of ```panel-tree
    endLine: number;   // 0-indexed document line of closing ```
    rootNodes: TreeGridNode[];
    nodesByLine: Map<number, TreeGridNode>;
    nodeLineMap: Map<TreeGridNode, number>;
}

export class TreeCascadingManager {
    private app: App;
    private plugin: PakCLITablePlugin;
    private sessions: Map<MarkdownView, TreeCascadingSession> = new Map();
    private isDestroyed: boolean = false;
    private tickingViews: WeakSet<MarkdownView> = new WeakSet();

    constructor(plugin: PakCLITablePlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    public init(): void {
        this.plugin.registerEvent(
            this.app.workspace.on('active-leaf-change', () => this.refreshAllViews())
        );
        this.plugin.registerEvent(
            this.app.workspace.on('layout-change', () => this.refreshAllViews())
        );
        this.plugin.registerEvent(
            this.app.workspace.on('file-open', () => this.refreshAllViews())
        );
        this.plugin.registerEvent(
            this.app.workspace.on('editor-change', (editor, view) => {
                if (view instanceof MarkdownView) {
                    this.scheduleUpdate(view);
                }
            })
        );

        this.app.workspace.onLayoutReady(() => {
            this.refreshAllViews();
        });
    }

    public destroy(): void {
        this.isDestroyed = true;
        for (const [, session] of this.sessions.entries()) {
            this.destroySession(session);
        }
        this.sessions.clear();
    }

    public setEnabled(enabled: boolean): void {
        if (!enabled) {
            for (const [, session] of this.sessions.entries()) {
                session.barEl.style.display = 'none';
                session.lastChainKey = '';
            }
        } else {
            this.refreshAllViews();
        }
    }

    private get settings(): TreeCascadingSettings {
        const s = (this.plugin.settings as any) || {};
        return {
            enableTreeCascading: s.enableTreeCascading !== false,
            treeCascadingStyle: s.treeCascadingStyle || DEFAULT_TREE_CASCADING_SETTINGS.treeCascadingStyle,
            treeCascadingMaxDepth: typeof s.treeCascadingMaxDepth === 'number' ? s.treeCascadingMaxDepth : DEFAULT_TREE_CASCADING_SETTINGS.treeCascadingMaxDepth,
            treeCascadingShowBadges: s.treeCascadingShowBadges !== false,
        };
    }

    public refreshAllViews(): void {
        if (this.isDestroyed) return;

        // Clean up detached sessions
        for (const [view, session] of this.sessions.entries()) {
            if (!view.containerEl.isConnected) {
                this.destroySession(session);
                this.sessions.delete(view);
            }
        }

        if (!this.settings.enableTreeCascading) {
            for (const [, session] of this.sessions.entries()) {
                session.barEl.style.display = 'none';
                session.lastChainKey = '';
            }
            return;
        }

        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            if (leaf.view instanceof MarkdownView && leaf.view.containerEl.isConnected) {
                this.attachToView(leaf.view);
            }
        }
    }

    private attachToView(view: MarkdownView): void {
        let session = this.sessions.get(view);

        if (!session) {
            view.contentEl.classList.add('pakcli-sticky-parent');

            const barEl = createDiv({ cls: 'pakcli-tree-cascading-bar' });
            if (Platform.isMobile) {
                barEl.addClass('is-mobile-style');
            }
            barEl.style.display = 'none';
            view.contentEl.prepend(barEl);

            session = {
                view,
                barEl,
                boundScrollEl: null,
                scrollListener: null,
                lastChainKey: '',
            };
            this.sessions.set(view, session);

            // Capture-phase scroll listener on view.contentEl guarantees ALL inner scroll events trigger update
            const captureListener = () => this.scheduleUpdate(view);
            view.contentEl.addEventListener('scroll', captureListener, { capture: true, passive: true });
        }

        this.bindScrollListener(view, session);
        this.scheduleUpdate(view);
    }

    private bindScrollListener(view: MarkdownView, session: StickyViewSessionLike): void {
        const mode = view.getMode();
        let scrollEl: HTMLElement | null = null;

        if (mode === 'source') {
            scrollEl = view.contentEl.querySelector('.cm-scroller');
        } else {
            const previewEl = view.previewMode?.containerEl;
            scrollEl = (previewEl?.querySelector('.markdown-preview-view') as HTMLElement) || previewEl || null;
        }

        if (session.boundScrollEl && session.boundScrollEl !== scrollEl && session.scrollListener) {
            session.boundScrollEl.removeEventListener('scroll', session.scrollListener);
            session.boundScrollEl = null;
            session.scrollListener = null;
        }

        if (scrollEl && !session.scrollListener) {
            const listener = () => this.scheduleUpdate(view);
            scrollEl.addEventListener('scroll', listener, { passive: true });
            session.boundScrollEl = scrollEl;
            session.scrollListener = listener;
        }
    }

    private scheduleUpdate(view: MarkdownView): void {
        if (this.tickingViews.has(view) || this.isDestroyed) return;

        this.tickingViews.add(view);
        window.requestAnimationFrame(() => {
            this.tickingViews.delete(view);
            if (!this.isDestroyed && view.containerEl.isConnected) {
                this.updateStickyBar(view);
            }
        });
    }

    private getEditorView(view: MarkdownView): any {
        return (view.editor as any)?.cm
            || (view as any)?.editMode?.editor?.cm
            || (view.contentEl.querySelector('.cm-editor') as any)?.cmView?.view
            || null;
    }

    private updateStickyBar(view: MarkdownView): void {
        const session = this.sessions.get(view);
        if (!session || !view.containerEl.isConnected || !view.file) return;

        if (!this.settings.enableTreeCascading) {
            this.hideBar(session);
            return;
        }

        const editor = view.editor;
        if (!editor) {
            this.hideBar(session);
            return;
        }

        const fileContent = editor.getValue();
        const treeBlocks = this.parseAllTreeBlocks(fileContent);
        if (treeBlocks.length === 0) {
            this.hideBar(session);
            return;
        }

        const scroller = view.contentEl.querySelector('.cm-scroller') as HTMLElement | null;
        if (!scroller) {
            // Reading View fallback
            this.updateReadingView(view, session, treeBlocks);
            return;
        }

        const cm = this.getEditorView(view);
        if (!cm || !cm.state?.doc || typeof cm.lineBlockAt !== 'function') {
            this.hideBar(session);
            return;
        }

        const scrollerRect = scroller.getBoundingClientRect();
        let topOffset = 0;
        const headingBar = view.contentEl.querySelector('.pakcli-cascading-sticky-bar') as HTMLElement | null;
        if (headingBar && headingBar.style.display !== 'none' && headingBar.offsetHeight > 0) {
            topOffset = headingBar.offsetHeight;
        }

        const baseBoundaryY = scrollerRect.top + topOffset;
        let boundaryY = baseBoundaryY;
        if (session.barEl.style.display !== 'none' && session.barEl.offsetHeight > 0) {
            const barRect = session.barEl.getBoundingClientRect();
            if (barRect.height > 0) {
                boundaryY = Math.max(baseBoundaryY, barRect.bottom);
            }
        }

        const docTop = cm.documentTop;
        const totalDocLines = cm.state.doc.lines;

        // Find which tree block is currently in the active sticky viewport zone
        let activeBlock: ParsedBlockTree | null = null;
        for (const block of treeBlocks) {
            const startDocLine = Math.max(1, Math.min(totalDocLines, block.startLine + 1));
            const endDocLine = Math.max(1, Math.min(totalDocLines, block.endLine + 1));

            const startLb = cm.lineBlockAt(cm.state.doc.line(startDocLine).from);
            const endLb = cm.lineBlockAt(cm.state.doc.line(endDocLine).from);

            const startBottom = docTop + startLb.bottom;
            const endBottom = docTop + endLb.bottom;

            // Block is active if its opening line has reached/passed baseBoundaryY
            // and its closing line hasn't scrolled past boundaryY
            if (startBottom <= baseBoundaryY && endBottom > boundaryY) {
                activeBlock = block;
                break;
            }
        }

        if (!activeBlock) {
            this.hideBar(session);
            return;
        }

        // Find the FIRST visible line of the codeblock on the content page below boundaryY
        let firstVisibleLine = -1;
        for (let l = activeBlock.startLine; l <= activeBlock.endLine; l++) {
            const docLine = Math.max(1, Math.min(totalDocLines, l + 1));
            const lineInfo = cm.state.doc.line(docLine);
            const lb = cm.lineBlockAt(lineInfo.from);
            const lineBottom = docTop + lb.bottom;

            if (lineBottom > boundaryY + 1) {
                firstVisibleLine = l;
                break;
            }
        }

        if (firstVisibleLine === -1) {
            this.hideBar(session);
            return;
        }

        // If firstVisibleLine is still at or before the root folder line,
        // the root folder is visible on the content page -> no sticky bar yet
        const rootLine = activeBlock.rootNodes.length > 0
            ? (activeBlock.nodeLineMap.get(activeBlock.rootNodes[0]) ?? activeBlock.startLine + 1)
            : activeBlock.startLine + 1;

        if (firstVisibleLine <= rootLine) {
            this.hideBar(session);
            return;
        }

        // Find active node at or before firstVisibleLine
        let activeNode: TreeGridNode | null = null;
        for (let l = firstVisibleLine; l > activeBlock.startLine; l--) {
            if (activeBlock.nodesByLine.has(l)) {
                activeNode = activeBlock.nodesByLine.get(l)!;
                break;
            }
        }

        if (!activeNode) {
            this.hideBar(session);
            return;
        }

        // Build folder chain leading to active node
        const targetFolder = activeNode.isDirectory ? activeNode : activeNode.parent;
        if (!targetFolder) {
            this.hideBar(session);
            return;
        }

        const chain: TreeCrumbItem[] = [];
        let curr: TreeGridNode | undefined = targetFolder;
        while (curr) {
            const lineNo = activeBlock.nodeLineMap.get(curr) ?? activeBlock.startLine + 1;
            // STRICT ZERO DUPLICATION RULE:
            // Only include folder if its declaration line has completely scrolled out of view!
            // If lineNo >= firstVisibleLine, it is currently visible on the content page,
            // so it MUST NOT appear in the sticky bar!
            if (lineNo < firstVisibleLine) {
                chain.unshift({
                    name: curr.name,
                    node: curr,
                    lineNo,
                    depth: curr.depth,
                    isFolder: true,
                });
            }
            curr = curr.parent;
        }

        if (chain.length === 0) {
            this.hideBar(session);
            return;
        }

        const maxDepth = this.settings.treeCascadingMaxDepth;
        const visibleChain = (chain.length > maxDepth ? chain.slice(-maxDepth) : chain)
            .filter((c) => c && c.name && c.name.trim().length > 0);

        if (visibleChain.length === 0) {
            this.hideBar(session);
            return;
        }

        this.renderChain(session, visibleChain, view, activeBlock);
    }

    private updateReadingView(
        view: MarkdownView,
        session: TreeCascadingSession,
        treeBlocks: ParsedBlockTree[]
    ): void {
        const previewEl = (view.previewMode?.containerEl?.querySelector('.markdown-preview-view') as HTMLElement) || null;
        if (!previewEl || treeBlocks.length === 0) {
            this.hideBar(session);
            return;
        }

        const containerRect = previewEl.getBoundingClientRect();
        let topOffset = 0;
        const headingBar = view.contentEl.querySelector('.pakcli-cascading-sticky-bar') as HTMLElement | null;
        if (headingBar && headingBar.style.display !== 'none' && headingBar.offsetHeight > 0) {
            topOffset = headingBar.offsetHeight;
        }
        let boundaryY = containerRect.top + topOffset;
        if (session.barEl.style.display !== 'none' && session.barEl.offsetHeight > 0) {
            boundaryY = session.barEl.getBoundingClientRect().bottom;
        }

        const treePres = Array.from(previewEl.querySelectorAll('pre[class*="language-"]'));
        let activeBlock: ParsedBlockTree | null = null;
        let activePre: HTMLElement | null = null;

        for (let i = 0; i < treePres.length && i < treeBlocks.length; i++) {
            const pre = treePres[i] as HTMLElement;
            const cls = pre.className.toLowerCase();
            if (cls.includes('panel-tree') || cls.includes('tree')) {
                const preRect = pre.getBoundingClientRect();
                if (preRect.top <= boundaryY && preRect.bottom > boundaryY) {
                    activeBlock = treeBlocks[i];
                    activePre = pre;
                    break;
                }
            }
        }

        if (!activeBlock || !activePre) {
            this.hideBar(session);
            return;
        }

        const preRect = activePre.getBoundingClientRect();
        const scrolledPx = Math.max(0, boundaryY - preRect.top);
        const ratio = Math.min(1, Math.max(0, scrolledPx / preRect.height));
        const estimatedFirstVisible = activeBlock.startLine + Math.floor(ratio * (activeBlock.endLine - activeBlock.startLine));

        const rootLine = activeBlock.rootNodes.length > 0
            ? (activeBlock.nodeLineMap.get(activeBlock.rootNodes[0]) ?? activeBlock.startLine + 1)
            : activeBlock.startLine + 1;

        if (estimatedFirstVisible <= rootLine) {
            this.hideBar(session);
            return;
        }

        let activeNode: TreeGridNode | null = null;
        for (let l = estimatedFirstVisible; l > activeBlock.startLine; l--) {
            if (activeBlock.nodesByLine.has(l)) {
                activeNode = activeBlock.nodesByLine.get(l)!;
                break;
            }
        }

        if (!activeNode) {
            this.hideBar(session);
            return;
        }

        const targetFolder = activeNode.isDirectory ? activeNode : activeNode.parent;
        if (!targetFolder) {
            this.hideBar(session);
            return;
        }

        const chain: TreeCrumbItem[] = [];
        let curr: TreeGridNode | undefined = targetFolder;
        while (curr) {
            const lineNo = activeBlock.nodeLineMap.get(curr) ?? activeBlock.startLine + 1;
            if (lineNo < estimatedFirstVisible) {
                chain.unshift({
                    name: curr.name,
                    node: curr,
                    lineNo,
                    depth: curr.depth,
                    isFolder: true,
                });
            }
            curr = curr.parent;
        }

        if (chain.length === 0) {
            this.hideBar(session);
            return;
        }

        const maxDepth = this.settings.treeCascadingMaxDepth;
        const visibleChain = (chain.length > maxDepth ? chain.slice(-maxDepth) : chain)
            .filter((c) => c && c.name && c.name.trim().length > 0);

        if (visibleChain.length === 0) {
            this.hideBar(session);
            return;
        }

        this.renderChain(session, visibleChain, view, activeBlock);
    }

    private parseAllTreeBlocks(content: string): ParsedBlockTree[] {
        const lines = content.split(/\r?\n/);
        const userAliases = (this.plugin.settings?.panelTreeAliases || '')
            .split(',')
            .map((a: string) => a.trim().toLowerCase())
            .filter(Boolean);
        const customAliases = new Set(userAliases);
        customAliases.add('panel-tree');
        customAliases.add('panel-tree-cascading');
        customAliases.add('tree-cascading');
        customAliases.add('tree-interactive');

        const blocks: ParsedBlockTree[] = [];

        let inBlock = false;
        let startLine = -1;
        let blockLines: { lineNo: number; text: string }[] = [];

        for (let l = 0; l < lines.length; l++) {
            const text = lines[l];
            if (!inBlock) {
                const m = text.match(/^```+\s*([a-zA-Z0-9_-]+)/);
                if (m && isTreeBlockAlias(m[1], customAliases)) {
                    inBlock = true;
                    startLine = l;
                    blockLines = [];
                }
            } else {
                if (text.match(/^```+\s*$/)) {
                    inBlock = false;
                    const parsed = this.parseTreeNodes(blockLines, startLine, l);
                    blocks.push(parsed);
                } else {
                    blockLines.push({ lineNo: l, text });
                }
            }
        }

        if (inBlock && blockLines.length > 0) {
            const parsed = this.parseTreeNodes(blockLines, startLine, lines.length - 1);
            blocks.push(parsed);
        }

        return blocks;
    }

    private parseTreeNodes(lines: { lineNo: number; text: string }[], startLine: number, endLine: number): ParsedBlockTree {
        const rootNodes: TreeGridNode[] = [];
        const nodesByLine = new Map<number, TreeGridNode>();
        const nodeLineMap = new Map<TreeGridNode, number>();
        const stack: { node: TreeGridNode; rawIndent: number }[] = [];

        for (const item of lines) {
            const raw = item.text;
            const trimmed = raw.trim();
            if (!trimmed || trimmed.toLowerCase().includes('add item') || trimmed.startsWith('<!--')) {
                continue;
            }

            const cleanTrimmed = trimmed.replace(/^(?:[Vv>▼▶]\s*)+/, '');
            const parsedCols = extractNameAndColumns(cleanTrimmed);
            const strippedName = parsedCols.name.replace(/^[├└│|L\s─\-+▼▶vV><]+/g, '').trim();
            if (!strippedName || !/[a-zA-Z0-9_\.]/.test(strippedName)) {
                continue;
            }

            const rawIndent = getRawLeadingWhitespace(raw);
            while (stack.length > 0 && rawIndent <= stack[stack.length - 1].rawIndent) {
                stack.pop();
            }

            const parent = stack.length > 0 ? stack[stack.length - 1].node : null;
            const depth = stack.length;
            const isDir = !isFileName(parsedCols.name);

            const node: TreeGridNode = {
                id: `tree-node-${item.lineNo}`,
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
            nodesByLine.set(item.lineNo, node);
            nodeLineMap.set(node, item.lineNo);
        }

        return { startLine, endLine, rootNodes, nodesByLine, nodeLineMap };
    }

    private renderChain(
        session: TreeCascadingSession,
        chain: TreeCrumbItem[],
        view: MarkdownView,
        block: ParsedBlockTree
    ): void {
        const chainKey = chain.map((c) => `${c.lineNo}:${c.name}`).join('>');
        if (chainKey === session.lastChainKey && session.barEl.style.display !== 'none') {
            this.updateBarVerticalPosition(session, view);
            return;
        }

        session.lastChainKey = chainKey;
        session.barEl.empty();
        session.barEl.style.height = 'auto';
        session.barEl.style.minHeight = '0px';

        const innerEl = session.barEl.createDiv({ cls: 'pakcli-tree-cascading-inner' });

        for (let i = 0; i < chain.length; i++) {
            const item = chain[i];
            const isCurrent = i === chain.length - 1;

            const rowEl = innerEl.createDiv({
                cls: `pakcli-tree-sticky-line${isCurrent ? ' is-current' : ''}`,
                attr: { title: `Jump to ${item.name} (Line ${item.lineNo + 1})` },
            });

            // Tree branch rails & chevron prefix (Line = Line with codeblock)
            const prefixEl = rowEl.createSpan({ cls: 'pakcli-tree-prefix' });
            const { rails, chevron } = this.buildRowPrefix(item.depth, i === 0);

            if (rails) {
                prefixEl.createSpan({ cls: 'pakcli-tree-rails', text: rails });
            }
            prefixEl.createSpan({ cls: 'pakcli-tree-chevron', text: chevron });

            // Folder Name
            rowEl.createSpan({ cls: 'pakcli-tree-node-name', text: item.name });

            // Badges (+File and +Folder) directly beside folder name
            if (this.settings.treeCascadingShowBadges) {
                const badgesWrap = rowEl.createSpan({ cls: 'pakcli-tree-badges' });

                const fileBadge = badgesWrap.createSpan({
                    cls: 'pakcli-tree-badge pakcli-badge-file',
                    text: '+File',
                    attr: { title: `Add file inside ${item.name}` },
                });

                const folderBadge = badgesWrap.createSpan({
                    cls: 'pakcli-tree-badge pakcli-badge-folder',
                    text: '+Folder',
                    attr: { title: `Add folder inside ${item.name}` },
                });

                const activateInput = (isFolderType: boolean) => {
                    badgesWrap.empty();
                    const input = badgesWrap.createEl('input', {
                        cls: 'pakcli-tree-inline-input',
                        type: 'text',
                        placeholder: isFolderType ? 'folder-name' : 'file.webp',
                    });
                    input.focus();

                    let committed = false;
                    const commit = () => {
                        if (committed) return;
                        committed = true;
                        const val = input.value.trim();
                        restoreBadges();

                        if (val) {
                            this.insertChildNode(view, item, val, isFolderType, block);
                        }
                    };

                    const restoreBadges = () => {
                        badgesWrap.empty();
                        badgesWrap.appendChild(fileBadge);
                        badgesWrap.appendChild(folderBadge);
                    };

                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            commit();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            committed = true;
                            restoreBadges();
                        }
                    });

                    input.addEventListener('blur', () => {
                        setTimeout(() => {
                            if (!committed) restoreBadges();
                        }, 120);
                    });
                };

                fileBadge.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    activateInput(false);
                });

                folderBadge.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    activateInput(true);
                });
            }

            // Click on row (outside badges) to jump
            rowEl.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('.pakcli-tree-badges, input')) return;
                e.preventDefault();
                e.stopPropagation();
                this.jumpToLine(view, item.lineNo, block);
            });
        }

        this.updateBarVerticalPosition(session, view);
        session.barEl.style.display = 'block';
    }

    private buildRowPrefix(depth: number, isRoot: boolean): { rails: string; chevron: string } {
        if (isRoot || depth <= 0) {
            return { rails: '', chevron: 'v ' };
        }
        const leading = '│   '.repeat(Math.max(0, depth - 1));
        const branch = '└── ';
        return { rails: leading + branch, chevron: 'v ' };
    }

    private updateBarVerticalPosition(session: TreeCascadingSession, view: MarkdownView): void {
        const contentRect = view.contentEl.getBoundingClientRect();
        const headingBar = view.contentEl.querySelector('.pakcli-cascading-sticky-bar') as HTMLElement | null;

        let topPx = 0;
        if (headingBar && headingBar.style.display !== 'none' && headingBar.offsetHeight > 0) {
            const headingRect = headingBar.getBoundingClientRect();
            topPx = Math.max(0, Math.ceil(headingRect.bottom - contentRect.top));
        } else {
            // Check if scroller or content starts with an offset (e.g. in themes with floating/absolute pane headers)
            const scroller = view.contentEl.querySelector('.cm-scroller, .markdown-preview-view') as HTMLElement | null;
            if (scroller) {
                const scrollerRect = scroller.getBoundingClientRect();
                const offset = Math.round(scrollerRect.top - contentRect.top);
                if (offset > 0 && offset < 100) {
                    topPx = offset;
                }
            }
        }

        session.barEl.style.top = `${topPx}px`;
    }

    private insertChildNode(
        view: MarkdownView,
        parentCrumb: TreeCrumbItem,
        val: string,
        isFolderType: boolean,
        block: ParsedBlockTree
    ): void {
        const editor = view.editor;
        if (!editor) return;

        // Find last child line of parentCrumb.node
        let insertLine = parentCrumb.lineNo;
        const parentDepth = parentCrumb.depth;

        // Scan downwards while items belong to this subtree
        const totalLines = editor.lineCount();
        for (let l = parentCrumb.lineNo + 1; l < block.endLine && l < totalLines; l++) {
            const node = block.nodesByLine.get(l);
            if (node && node.depth > parentDepth) {
                insertLine = l;
            } else if (node && node.depth <= parentDepth) {
                break;
            }
        }

        const childIndent = '\t'.repeat(parentDepth + 1);
        const textToInsert = childIndent + val;

        const lineLen = editor.getLine(insertLine)?.length ?? 0;
        editor.replaceRange('\n' + textToInsert, { line: insertLine, ch: lineLen });

        const targetNewLine = insertLine + 1;
        editor.setCursor({ line: targetNewLine, ch: textToInsert.length });
        editor.scrollIntoView({ from: { line: targetNewLine, ch: 0 }, to: { line: targetNewLine, ch: 0 } }, true);
        view.contentEl.focus();

        new Notice(`✓ Added ${isFolderType ? 'folder' : 'file'} ${val}`);
    }

    private jumpToLine(view: MarkdownView, lineNo: number, block?: ParsedBlockTree): void {
        const editor = view.editor;
        if (!editor) return;

        let topOffset = 0;
        const headingBar = view.contentEl.querySelector('.pakcli-cascading-sticky-bar') as HTMLElement | null;
        if (headingBar && headingBar.style.display !== 'none' && headingBar.offsetHeight > 0) {
            topOffset = headingBar.offsetHeight;
        }

        const session = this.sessions.get(view);
        const barHeight = session?.barEl?.offsetHeight || 26;
        const totalTopHeaderHeight = topOffset + barHeight;

        const scroller = view.contentEl.querySelector('.cm-scroller') as HTMLElement | null;
        const cm = this.getEditorView(view);

        if (cm && scroller && typeof cm.lineBlockAt === 'function' && cm.state?.doc) {
            try {
                const totalLines = cm.state.doc.lines;
                const targetDocLine = Math.max(1, Math.min(totalLines, lineNo + 1));
                const lineInfo = cm.state.doc.line(targetDocLine);
                const lineBlock = cm.lineBlockAt(lineInfo.from);

                if (lineBlock && typeof lineBlock.top === 'number') {
                    // Align folder line directly to the top of the panel window (below sticky bars)
                    const targetScrollTop = Math.max(0, lineBlock.top - (totalTopHeaderHeight + 6));
                    scroller.scrollTo({ top: targetScrollTop, behavior: 'smooth' });

                    editor.setCursor({ line: lineNo, ch: 0 });
                    editor.focus();
                    return;
                }
            } catch (err) {
                console.warn('[PakCLI Tree] jumpToLine cm alignment error:', err);
            }
        }

        // Reading View alignment
        const previewEl = (view.previewMode?.containerEl?.querySelector('.markdown-preview-view') as HTMLElement) || null;
        if (previewEl && block) {
            const pre = previewEl.querySelector('pre[class*="language-"]') as HTMLElement | null;
            if (pre) {
                const lineFraction = Math.max(0, Math.min(1, (lineNo - block.startLine) / Math.max(1, block.endLine - block.startLine)));
                const targetY = pre.offsetTop + lineFraction * pre.offsetHeight;
                previewEl.scrollTo({ top: Math.max(0, targetY - (totalTopHeaderHeight + 6)), behavior: 'smooth' });
                return;
            }
        }

        // Fallback: non-centered scroll into view
        editor.setCursor({ line: lineNo, ch: 0 });
        editor.scrollIntoView({ from: { line: lineNo, ch: 0 }, to: { line: lineNo, ch: 0 } }, false);
    }

    private hideBar(session: TreeCascadingSession): void {
        if (session.barEl.style.display !== 'none') {
            session.barEl.style.display = 'none';
            session.lastChainKey = '';
        }
    }

    private destroySession(session: TreeCascadingSession): void {
        if (session.boundScrollEl && session.scrollListener) {
            session.boundScrollEl.removeEventListener('scroll', session.scrollListener);
        }
        if (session.barEl && session.barEl.parentNode) {
            session.barEl.remove();
        }
    }
}

type StickyViewSessionLike = TreeCascadingSession;
