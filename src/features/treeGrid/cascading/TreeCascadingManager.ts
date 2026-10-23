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
import {
    extractNameAndColumns,
    getRawLeadingWhitespace,
    isFileName,
    getExtension,
    isTreeBlockAlias,
    getAsciiBranchPrefix
} from '../treeParser';
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
        const savedDepth = typeof s.treeCascadingMaxDepth === 'number' ? s.treeCascadingMaxDepth : DEFAULT_TREE_CASCADING_SETTINGS.treeCascadingMaxDepth;
        return {
            enableTreeCascading: s.enableTreeCascading !== false,
            treeCascadingStyle: s.treeCascadingStyle || DEFAULT_TREE_CASCADING_SETTINGS.treeCascadingStyle,
            treeCascadingMaxDepth: Math.max(12, savedDepth),
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

        const mode = view.getMode();
        if (mode === 'preview') {
            this.updateReadingView(view, session, treeBlocks);
            return;
        }

        const scroller = view.contentEl.querySelector('.cm-scroller') as HTMLElement | null;
        const cm = this.getEditorView(view);
        if (!scroller || !cm || !cm.state?.doc || typeof cm.lineBlockAt !== 'function') {
            this.hideBar(session);
            return;
        }

        const scrollerRect = scroller.getBoundingClientRect();
        let topOffset = 0;
        const headingBar = view.contentEl.querySelector('.pakcli-cascading-sticky-bar') as HTMLElement | null;
        if (headingBar && headingBar.style.display !== 'none' && headingBar.offsetHeight > 0) {
            topOffset = headingBar.offsetHeight;
        }

        // The top anchor where sticky cascading pins (Fixed viewport anchor, never oscillates)
        const anchorY = scrollerRect.top + topOffset;
        const docTop = cm.documentTop;
        const totalDocLines = cm.state.doc.lines;

        // Measure line height dynamically from CodeMirror
        let sampleLb: any = null;
        try {
            sampleLb = cm.lineBlockAt(cm.state.doc.line(1).from);
        } catch { /* fallback */ }
        const lineHeight = Math.max(18, Math.round(sampleLb ? (sampleLb.bottom - sampleLb.top) : 24));

        // Find which tree block is active at anchorY
        let activeBlock: ParsedBlockTree | null = null;
        for (const block of treeBlocks) {
            const startDocLine = Math.max(1, Math.min(totalDocLines, block.startLine + 1));
            const endDocLine = Math.max(1, Math.min(totalDocLines, block.endLine + 1));

            const startLb = cm.lineBlockAt(cm.state.doc.line(startDocLine).from);
            const endLb = cm.lineBlockAt(cm.state.doc.line(endDocLine).from);

            const startBottom = docTop + startLb.bottom;
            const endBottom = docTop + endLb.bottom;

            if (startBottom <= anchorY && endBottom > anchorY + lineHeight) {
                activeBlock = block;
                break;
            }
        }

        if (!activeBlock || activeBlock.rootNodes.length === 0) {
            this.hideBar(session);
            return;
        }

        // 1. Strict Zero Duplication: Check if root folder has scrolled past anchorY
        // If root folder is still visible on the content page, NO sticky bar!
        const rootNode = activeBlock.rootNodes[0];
        const rootLine = activeBlock.nodeLineMap.get(rootNode) ?? (activeBlock.startLine + 1);
        const rootDocLine = Math.max(1, Math.min(totalDocLines, rootLine + 1));
        const rootLb = cm.lineBlockAt(cm.state.doc.line(rootDocLine).from);
        const rootBottom = docTop + rootLb.bottom;

        if (rootBottom > anchorY) {
            this.hideBar(session);
            return;
        }

        // 2. Find the current deepest active node scrolling past anchorY
        let firstLineAtOrBelowAnchor = activeBlock.endLine;
        for (let l = rootLine; l <= activeBlock.endLine; l++) {
            const docLine = Math.max(1, Math.min(totalDocLines, l + 1));
            const lb = cm.lineBlockAt(cm.state.doc.line(docLine).from);
            if (docTop + lb.bottom > anchorY) {
                firstLineAtOrBelowAnchor = l;
                break;
            }
        }

        let activeNode: TreeGridNode | null = null;
        for (let l = firstLineAtOrBelowAnchor; l >= rootLine; l--) {
            if (activeBlock.nodesByLine.has(l)) {
                activeNode = activeBlock.nodesByLine.get(l)!;
                break;
            }
        }
        if (!activeNode) {
            activeNode = rootNode;
        }

        const targetFolder = activeNode.isDirectory ? activeNode : (activeNode.parent || activeNode);

        // Build ancestor path from root down to targetFolder
        const ancestors: TreeGridNode[] = [];
        let curr: TreeGridNode | undefined = targetFolder;
        while (curr) {
            ancestors.unshift(curr);
            curr = curr.parent;
        }

        // 3. Monotonic Level Thresholds (Zero-Jitter Architecture):
        // Level k pins only when that folder has scrolled above (anchorY + k * lineHeight).
        // Each level k occupies a fixed vertical slot of lineHeight.
        // Once a folder is above its threshold, it has scrolled under the header and pins.
        // If a folder's bottom is below its threshold, it is visible on the page, so it does NOT pin.
        const chain: TreeCrumbItem[] = [];
        for (let k = 0; k < ancestors.length; k++) {
            const node = ancestors[k];
            const thresholdK = anchorY + (k * lineHeight);
            const nodeLine = activeBlock.nodeLineMap.get(node) ?? (activeBlock.startLine + 1);
            const nodeDocLine = Math.max(1, Math.min(totalDocLines, nodeLine + 1));
            const nodeLb = cm.lineBlockAt(cm.state.doc.line(nodeDocLine).from);
            const nodeBottom = docTop + nodeLb.bottom;

            if (nodeBottom <= thresholdK) {
                chain.push({
                    name: node.name,
                    node: node,
                    lineNo: nodeLine,
                    depth: node.depth,
                    isFolder: true,
                });
            } else {
                // Folder is still visible on the content page below Level (k-1)'s sticky line.
                // Stop cascading here to guarantee zero duplication without layout feedback.
                break;
            }
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
        const anchorY = containerRect.top + topOffset;

        const treePres = Array.from(previewEl.querySelectorAll('pre[class*="language-"]'));
        let activeBlock: ParsedBlockTree | null = null;
        let activePre: HTMLElement | null = null;

        for (let i = 0; i < treePres.length && i < treeBlocks.length; i++) {
            const pre = treePres[i] as HTMLElement;
            const cls = pre.className.toLowerCase();
            if (cls.includes('panel-tree') || cls.includes('tree')) {
                const preRect = pre.getBoundingClientRect();
                if (preRect.top <= anchorY && preRect.bottom > anchorY) {
                    activeBlock = treeBlocks[i];
                    activePre = pre;
                    break;
                }
            }
        }

        if (!activeBlock || !activePre || activeBlock.rootNodes.length === 0) {
            this.hideBar(session);
            return;
        }

        const preRect = activePre.getBoundingClientRect();
        const totalBlockLines = Math.max(1, activeBlock.endLine - activeBlock.startLine);
        const lineHeight = Math.max(18, preRect.height / totalBlockLines);

        const rootNode = activeBlock.rootNodes[0];
        const rootLine = activeBlock.nodeLineMap.get(rootNode) ?? (activeBlock.startLine + 1);
        const rootBottom = preRect.top + ((rootLine - activeBlock.startLine + 1) * lineHeight);

        if (rootBottom > anchorY) {
            this.hideBar(session);
            return;
        }

        const scrolledPx = Math.max(0, anchorY - preRect.top);
        const ratio = Math.min(1, Math.max(0, scrolledPx / preRect.height));
        const estimatedFirstVisible = activeBlock.startLine + Math.floor(ratio * totalBlockLines);

        let activeNode: TreeGridNode | null = null;
        for (let l = estimatedFirstVisible; l >= rootLine; l--) {
            if (activeBlock.nodesByLine.has(l)) {
                activeNode = activeBlock.nodesByLine.get(l)!;
                break;
            }
        }

        if (!activeNode) {
            activeNode = rootNode;
        }

        const targetFolder = activeNode.isDirectory ? activeNode : (activeNode.parent || activeNode);
        const ancestors: TreeGridNode[] = [];
        let curr: TreeGridNode | undefined = targetFolder;
        while (curr) {
            ancestors.unshift(curr);
            curr = curr.parent;
        }

        const chain: TreeCrumbItem[] = [];
        for (let k = 0; k < ancestors.length; k++) {
            const node = ancestors[k];
            const thresholdK = anchorY + (k * lineHeight);
            const nodeLine = activeBlock.nodeLineMap.get(node) ?? (activeBlock.startLine + 1);
            const nodeBottom = preRect.top + ((nodeLine - activeBlock.startLine + 1) * lineHeight);

            if (nodeBottom <= thresholdK) {
                chain.push({
                    name: node.name,
                    node: node,
                    lineNo: nodeLine,
                    depth: node.depth,
                    isFolder: true,
                });
            } else {
                break;
            }
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
        // If an input is currently active in the sticky bar, do not destroy the DOM
        const activeInput = session.barEl.querySelector('input');
        if (activeInput && document.activeElement === activeInput) {
            this.updateBarVerticalPosition(session, view);
            return;
        }

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
                cls: `cm-line HyperMD-codeblock HyperMD-codeblock-bg pakcli-tree-line pakcli-tree-sticky-line${isCurrent ? ' is-current' : ''}`,
                attr: { title: `Jump to ${item.name} (Line ${item.lineNo + 1})` },
            });

            // Tree branch rails & chevron prefix (Exact authentic codeblock tree rails)
            const prefixEl = rowEl.createSpan({ cls: 'pakcli-tree-prefix' });
            const rails = getAsciiBranchPrefix(item.node, block.rootNodes);
            const chevron = 'v ';

            if (rails) {
                prefixEl.createSpan({ cls: 'pakcli-tree-rails', text: rails });
            }
            prefixEl.createSpan({ cls: 'pakcli-tree-chevron', text: chevron });

            // Folder Name
            rowEl.createSpan({ cls: 'pakcli-tree-node-name', text: item.name });

            // Trailing sentence content / columns if any (word word [badge])
            if (item.node.trailingContent) {
                rowEl.createSpan({ cls: 'pakcli-tree-node-trailing', text: item.node.trailingContent });
            } else if (item.node.columns && item.node.columns.length > 0) {
                rowEl.createSpan({ cls: 'pakcli-tree-node-trailing', text: ' ' + item.node.columns.join(' ') });
            }

            // Badges (+File and +Folder) directly at the end of the sentence/line
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

                    let isClosing = false;
                    const restoreBadges = () => {
                        if (isClosing) return;
                        isClosing = true;
                        badgesWrap.empty();
                        badgesWrap.appendChild(fileBadge);
                        badgesWrap.appendChild(folderBadge);
                    };

                    const handleCommit = (shouldKeepOpen: boolean) => {
                        const val = input.value.trim();
                        if (val) {
                            this.insertChildNode(view, item, val, isFolderType, block);
                            if (shouldKeepOpen) {
                                input.value = '';
                                input.focus();
                                input.select();
                            } else {
                                restoreBadges();
                            }
                        } else {
                            restoreBadges();
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
                        }
                    });

                    input.addEventListener('blur', () => {
                        setTimeout(() => {
                            if (isClosing) return;
                            handleCommit(false);
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

        const totalLines = editor.lineCount();
        const parentDepth = parentCrumb.depth;

        // 1. Locate the parent folder line in the editor around parentCrumb.lineNo
        let folderLine = -1;
        const searchRange = 50;
        const minL = Math.max(0, parentCrumb.lineNo - searchRange);
        const maxL = Math.min(totalLines - 1, parentCrumb.lineNo + searchRange);

        for (let l = minL; l <= maxL; l++) {
            const text = editor.getLine(l);
            const trimmed = text.trim().replace(/^(?:[Vv>▼▶]\s*)+/, '');
            const parsed = extractNameAndColumns(trimmed);
            const cleanName = parsed.name.replace(/^[├└│|L\s─\-+▼▶vV><]+/g, '').trim();
            if (cleanName === parentCrumb.name) {
                folderLine = l;
                break;
            }
        }
        if (folderLine === -1) {
            folderLine = Math.min(parentCrumb.lineNo, totalLines - 1);
        }

        // Measure folder's actual leading whitespace/indent
        const folderLineText = editor.getLine(folderLine);
        const folderIndent = getRawLeadingWhitespace(folderLineText);

        // 2. Scan downwards from folderLine: find the end of this folder's subtree
        let insertLine = folderLine;
        for (let l = folderLine + 1; l < totalLines; l++) {
            const lineText = editor.getLine(l);
            if (lineText.trim().startsWith('```')) {
                break;
            }
            if (!lineText.trim()) {
                continue;
            }
            const lineIndent = getRawLeadingWhitespace(lineText);
            if (lineIndent > folderIndent) {
                insertLine = l;
            } else {
                break;
            }
        }

        const childIndent = '\t'.repeat(parentDepth + 1);
        const textToInsert = childIndent + val;

        const mode = view.getMode();
        const scroller = view.contentEl.querySelector(mode === 'preview' ? '.markdown-preview-view' : '.cm-scroller') as HTMLElement | null;
        const savedScrollTop = scroller ? scroller.scrollTop : null;

        const lineLen = editor.getLine(insertLine)?.length ?? 0;
        editor.replaceRange('\n' + textToInsert, { line: insertLine, ch: lineLen });

        // Maintain exact scroll position to prevent viewport from jumping or scrolling upwards
        if (scroller && savedScrollTop !== null) {
            scroller.scrollTop = savedScrollTop;
            requestAnimationFrame(() => {
                if (scroller && Math.abs(scroller.scrollTop - savedScrollTop) > 1) {
                    scroller.scrollTop = savedScrollTop;
                }
            });
        }

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
