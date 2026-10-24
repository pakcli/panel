import { App, MarkdownView, Platform, TFile } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { StickyHeadingItem, StickyHeaderSettings, DEFAULT_STICKY_HEADER_SETTINGS } from './types';

interface StickyViewSession {
  view: MarkdownView;
  barEl: HTMLElement;
  boundScrollEl: HTMLElement | null;
  scrollListener: (() => void) | null;
  lastChainKey: string;
}

export class CascadingStickyHeaderManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private sessions: Map<MarkdownView, StickyViewSession> = new Map();
  private tickingViews: WeakSet<MarkdownView> = new WeakSet();
  private isDestroyed: boolean = false;

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init(): void {
    // 1. Hook into workspace events for view changes and navigation
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
      this.app.metadataCache.on('changed', (file: TFile) => this.onMetadataChanged(file))
    );

    // 2. Initialize across all currently open leaves once layout is ready
    this.app.workspace.onLayoutReady(() => {
      this.refreshAllViews();
    });
  }

  public destroy(): void {
    this.isDestroyed = true;
    for (const [view, session] of this.sessions.entries()) {
      this.destroySession(session);
    }
    this.sessions.clear();
  }

  public setEnabled(enabled: boolean): void {
    if (!enabled) {
      for (const [view, session] of this.sessions.entries()) {
        session.barEl.style.display = 'none';
        session.lastChainKey = '';
      }
    } else {
      this.refreshAllViews();
    }
  }

  public setMaxDepth(depth: number): void {
    this.refreshAllViews(true);
  }

  public setShowBadges(show: boolean): void {
    this.refreshAllViews(true);
  }

  private get settings(): StickyHeaderSettings {
    const s = this.plugin.settings as any;
    return {
      enableCascadingStickyHeaders: s?.enableCascadingStickyHeaders !== false,
      stickyHeaderMaxDepth: typeof s?.stickyHeaderMaxDepth === 'number' ? s.stickyHeaderMaxDepth : DEFAULT_STICKY_HEADER_SETTINGS.stickyHeaderMaxDepth,
      stickyHeaderShowBadges: s?.stickyHeaderShowBadges !== false,
    };
  }

  /**
   * Refreshes sticky bars on all active markdown leaves in the workspace
   */
  public refreshAllViews(forceRebuild = false): void {
    if (this.isDestroyed) return;

    // Prune detached or closed views
    for (const [view, session] of this.sessions.entries()) {
      if (!view.containerEl.isConnected) {
        this.destroySession(session);
        this.sessions.delete(view);
      }
    }

    if (!this.settings.enableCascadingStickyHeaders) {
      for (const [, session] of this.sessions.entries()) {
        session.barEl.style.display = 'none';
        session.lastChainKey = '';
      }
      return;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    for (const leaf of markdownLeaves) {
      if (leaf.view instanceof MarkdownView && leaf.view.containerEl.isConnected) {
        this.attachToView(leaf.view, forceRebuild);
      }
    }
  }

  /**
   * Handles metadataCache change to refresh sticky bar when headings are edited
   */
  private onMetadataChanged(file: TFile): void {
    if (!this.settings.enableCascadingStickyHeaders || this.isDestroyed) return;

    for (const [view] of this.sessions.entries()) {
      if (view.file && view.file.path === file.path) {
        this.scheduleUpdate(view, true);
      }
    }
  }

  /**
   * Attaches sticky bar and scroll listener to a MarkdownView instance
   */
  private attachToView(view: MarkdownView, forceRebuild = false): void {
    let session = this.sessions.get(view);

    if (!session) {
      // Ensure view.contentEl has relative positioning
      view.contentEl.classList.add('pakcli-sticky-parent');

      const barEl = createDiv({ cls: 'pakcli-cascading-sticky-bar' });
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
    }

    // Ensure scroll element listener is up-to-date (handling mode switches)
    const currentScrollEl = this.getScrollElement(view);
    if (session.boundScrollEl !== currentScrollEl) {
      if (session.boundScrollEl && session.scrollListener) {
        session.boundScrollEl.removeEventListener('scroll', session.scrollListener);
      }

      session.boundScrollEl = currentScrollEl;
      if (currentScrollEl) {
        session.scrollListener = () => this.scheduleUpdate(view);
        currentScrollEl.addEventListener('scroll', session.scrollListener, { passive: true });
      }
    }

    if (forceRebuild) {
      session.lastChainKey = '';
    }

    this.scheduleUpdate(view, forceRebuild);
  }

  /**
   * Resolves the scroll container for either Live Preview or Reading View
   */
  private getScrollElement(view: MarkdownView): HTMLElement | null {
    const mode = view.getMode();
    if (mode === 'source') {
      return view.contentEl.querySelector('.cm-scroller');
    } else {
      const preview = view.previewMode?.containerEl;
      if (!preview) return null;
      return preview.querySelector('.markdown-preview-view') || preview;
    }
  }

  /**
   * Schedules a debounced 60fps update via requestAnimationFrame
   */
  private scheduleUpdate(view: MarkdownView, force = false): void {
    if (this.isDestroyed || !this.settings.enableCascadingStickyHeaders) return;

    if (this.tickingViews.has(view)) return;
    this.tickingViews.add(view);

    requestAnimationFrame(() => {
      this.tickingViews.delete(view);
      this.updateStickyBar(view, force);
    });
  }

  /**
   * Core logic: calculates active heading hierarchy path and updates the sticky bar
   */
  private updateStickyBar(view: MarkdownView, force = false): void {
    const session = this.sessions.get(view);
    if (!session || !view.containerEl.isConnected || !view.file) return;

    const mode = view.getMode();
    const maxDepth = this.settings.stickyHeaderMaxDepth;

    if (mode === 'source') {
      this.updateLivePreviewStickyBar(view, session, maxDepth, force);
    } else {
      this.updateReadingViewStickyBar(view, session, maxDepth, force);
    }
  }

  /**
   * Live Preview / Source mode sticky header calculation
   */
  private updateLivePreviewStickyBar(view: MarkdownView, session: StickyViewSession, maxDepth: number, force: boolean): void {
    const fileCache = this.app.metadataCache.getFileCache(view.file!);
    const rawHeadings = fileCache?.headings;

    if (!rawHeadings || rawHeadings.length === 0) {
      this.hideBar(session);
      return;
    }

    const currentLine = this.getCurrentLineInLivePreview(view, session);

    // Find the last heading before or at currentLine
    let lastIndex = -1;
    for (let i = 0; i < rawHeadings.length; i++) {
      if (rawHeadings[i].position.start.line <= currentLine) {
        lastIndex = i;
      } else {
        break;
      }
    }

    // If before the first heading, hide the sticky bar
    if (lastIndex === -1) {
      this.hideBar(session);
      return;
    }

    const headingItems: StickyHeadingItem[] = rawHeadings.map(h => ({
      heading: this.cleanHeadingText(h.heading),
      level: h.level,
      line: h.position.start.line,
    }));

    const chain = this.buildHeadingChain(headingItems, lastIndex, maxDepth);
    this.renderChain(session, chain, view, force);
  }

  /**
   * Reading View mode sticky header calculation
   */
  private updateReadingViewStickyBar(view: MarkdownView, session: StickyViewSession, maxDepth: number, force: boolean): void {
    const previewEl = view.previewMode?.containerEl;
    if (!previewEl) {
      this.hideBar(session);
      return;
    }

    const scroller = previewEl.querySelector('.markdown-preview-view') as HTMLElement || previewEl;
    const scrollerRect = scroller.getBoundingClientRect();
    const threshold = scrollerRect.top + 4;

    const headingEls = Array.from(previewEl.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
    if (headingEls.length === 0) {
      this.hideBar(session);
      return;
    }

    let lastIndex = -1;
    for (let i = 0; i < headingEls.length; i++) {
      const elRect = headingEls[i].getBoundingClientRect();
      if (elRect.top <= threshold) {
        lastIndex = i;
      } else {
        break;
      }
    }

    if (lastIndex === -1) {
      this.hideBar(session);
      return;
    }

    const headingItems: StickyHeadingItem[] = headingEls.map((el, idx) => ({
      heading: this.cleanHeadingText(el.innerText),
      level: parseInt(el.tagName.substring(1), 10) || 1,
      line: idx,
      el,
    }));

    const chain = this.buildHeadingChain(headingItems, lastIndex, maxDepth);
    this.renderChain(session, chain, view, force);
  }

  /**
   * Computes the hierarchical ancestor chain (e.g. H1 -> H2 -> H3)
   */
  private buildHeadingChain(headings: StickyHeadingItem[], activeIndex: number, maxDepth: number): StickyHeadingItem[] {
    const chain: StickyHeadingItem[] = [];
    let targetLevel = headings[activeIndex].level;
    chain.unshift(headings[activeIndex]);

    for (let i = activeIndex - 1; i >= 0; i--) {
      if (headings[i].level < targetLevel) {
        chain.unshift(headings[i]);
        targetLevel = headings[i].level;
        if (targetLevel === 1) break;
      }
    }

    if (chain.length > maxDepth) {
      return chain.slice(-maxDepth);
    }
    return chain;
  }

  /**
   * Renders the cascading sticky rows with level badges and click navigation
   */
  private renderChain(session: StickyViewSession, chain: StickyHeadingItem[], view: MarkdownView, force: boolean): void {
    if (chain.length === 0) {
      this.hideBar(session);
      return;
    }

    const chainKey = chain.map(c => `${c.level}:${c.heading}:${c.line}`).join('|');
    if (!force && chainKey === session.lastChainKey && session.barEl.style.display !== 'none') {
      return;
    }

    session.lastChainKey = chainKey;
    session.barEl.empty();
    session.barEl.addClass('markdown-rendered');

    const innerEl = session.barEl.createDiv({ cls: 'pakcli-sticky-inner' });

    for (let i = 0; i < chain.length; i++) {
      const item = chain[i];
      const rowEl = innerEl.createDiv({
        cls: `pakcli-sticky-row level-${item.level}`
      });

      // Exact native heading tag: <h1>, <h2>, <h3>... (Same style as the document headers)
      const tag = `h${Math.min(6, Math.max(1, item.level))}` as keyof HTMLElementTagNameMap;
      rowEl.createEl(tag, {
        text: item.heading,
        cls: 'pakcli-sticky-heading'
      });

      // Click to Jump navigation
      rowEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.jumpToHeading(view, item);
      });
    }

    session.barEl.style.display = 'block';
  }

  /**
   * Hides the sticky bar when no headings are active
   */
  private hideBar(session: StickyViewSession): void {
    if (session.barEl.style.display !== 'none') {
      session.barEl.style.display = 'none';
      session.lastChainKey = '';
    }
  }

  /**
   * Smoothly navigates the viewport to the target heading
   */
  private jumpToHeading(view: MarkdownView, item: StickyHeadingItem): void {
    const mode = view.getMode();

    if (mode === 'source') {
      view.editor.scrollIntoView(
        {
          from: { line: item.line, ch: 0 },
          to: { line: item.line, ch: 0 }
        },
        true
      );
      view.editor.setCursor({ line: item.line, ch: 0 });
      view.editor.focus();
    } else {
      if (item.el && item.el.isConnected) {
        item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        const previewEl = view.previewMode?.containerEl;
        if (previewEl) {
          const headingEls = Array.from(previewEl.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
          const target = headingEls.find(h => this.cleanHeadingText(h.innerText).includes(item.heading));
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }
    }
  }

  /**
   * Resolves the current visible line number in Live Preview with 3-tier fallback
   */
  private getCurrentLineInLivePreview(view: MarkdownView, session: StickyViewSession): number {
    const scroller = view.contentEl.querySelector('.cm-scroller') as HTMLElement | null;
    if (!scroller) return 0;

    const barHeight = session.barEl.offsetHeight || 32;
    const cm = (view.editor as any)?.cm;

    // Strategy 1: Ultra-fast CodeMirror 6 lineBlockAtHeight (in-memory height map, zero DOM hit-testing)
    if (cm && typeof cm.lineBlockAtHeight === 'function' && cm.state?.doc) {
      try {
        const scrollerRect = scroller.getBoundingClientRect();
        const docTop = typeof cm.documentTop === 'number' ? cm.documentTop : (scrollerRect.top - scroller.scrollTop);
        const targetY = Math.max(0, (scrollerRect.top + 4) - docTop);
        const block = cm.lineBlockAtHeight(targetY);
        if (block && typeof block.from === 'number') {
          return cm.state.doc.lineAt(block.from).number - 1;
        }
      } catch {}
    }

    // Strategy 2: Fallback probe posAtCoords (CodeMirror 6 EditorView)
    if (cm && typeof cm.posAtCoords === 'function') {
      try {
        const scrollerRect = scroller.getBoundingClientRect();
        const testX = scrollerRect.left + Math.min(80, Math.max(30, scrollerRect.width / 4));
        const testY = scrollerRect.top + 4;
        const coordsPos = cm.posAtCoords({ x: testX, y: testY });
        if (coordsPos && typeof coordsPos.pos === 'number') {
          return view.editor.offsetToPos(coordsPos.pos).line;
        }
      } catch {}
    }

    // Strategy 3: Proportional scroll position fallback
    const totalLines = view.editor.lineCount();
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll <= 0) return 0;

    const ratio = Math.min(1, Math.max(0, scroller.scrollTop / maxScroll));
    return Math.floor(ratio * totalLines);
  }

  /**
   * Cleans heading text by removing leading Markdown hashes, wikilink syntax, and extra spaces
   */
  private cleanHeadingText(raw: string): string {
    if (!raw) return '';
    return raw
      .replace(/^#{1,6}\s+/, '')
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
  }

  /**
   * Unbinds listeners and removes DOM elements for a session
   */
  private destroySession(session: StickyViewSession): void {
    if (session.boundScrollEl && session.scrollListener) {
      session.boundScrollEl.removeEventListener('scroll', session.scrollListener);
    }
    if (session.barEl && session.barEl.parentNode) {
      session.barEl.remove();
    }
    session.view.contentEl.classList.remove('pakcli-sticky-parent');
  }
}
