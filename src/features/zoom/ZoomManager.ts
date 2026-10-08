import { App, Menu, Notice, WorkspaceLeaf } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { ZoomSettings, ZoomWidthMode } from './types';

export class ZoomManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private leafZoomMap: WeakMap<WorkspaceLeaf, number> = new WeakMap();
  private leafModeMap: WeakMap<WorkspaceLeaf, ZoomWidthMode> = new WeakMap();
  private statusBarEl: HTMLElement | null = null;
  private wheelListener: ((evt: WheelEvent) => void) | null = null;
  private ctrlDownListener: ((evt: KeyboardEvent) => void) | null = null;
  private ctrlUpListener: ((evt: KeyboardEvent) => void) | null = null;
  private windowBlurListener: (() => void) | null = null;
  private boundWebviews: WeakSet<HTMLElement> = new WeakSet();
  private webviewObserver: MutationObserver | null = null;

  // In-guest capture script to intercept Ctrl+Wheel when webview has focus
  private static readonly GUEST_ZOOM_SCRIPT = `
(function() {
  if (window.__pakcli_zoom_injected) return;
  window.__pakcli_zoom_injected = true;

  window.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      var dir = e.deltaY < 0 ? 1 : -1;
      console.log('__PAKCLI_ZOOM_WHEEL__:' + dir);
    }
  }, { capture: true, passive: false });
})();
`;

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init(): void {
    this.registerWheelListener();
    this.registerCtrlKeyListeners();
    this.setupWebviewObserver();
    this.initStatusBar();
    this.registerActiveLeafListener();
  }

  public destroy(): void {
    if (this.wheelListener) {
      window.removeEventListener('wheel', this.wheelListener, { capture: true });
      this.wheelListener = null;
    }
    if (this.ctrlDownListener) {
      window.removeEventListener('keydown', this.ctrlDownListener, { capture: true });
      this.ctrlDownListener = null;
    }
    if (this.ctrlUpListener) {
      window.removeEventListener('keyup', this.ctrlUpListener, { capture: true });
      window.removeEventListener('pointerup', this.ctrlUpListener, { capture: true });
      this.ctrlUpListener = null;
    }
    if (this.windowBlurListener) {
      window.removeEventListener('blur', this.windowBlurListener, { capture: true });
      this.windowBlurListener = null;
    }
    if (this.webviewObserver) {
      this.webviewObserver.disconnect();
      this.webviewObserver = null;
    }
    document.body.classList.remove('pakcli-ctrl-pressed');
    if (this.statusBarEl) {
      this.statusBarEl.remove();
      this.statusBarEl = null;
    }
  }

  private get settings(): ZoomSettings {
    const s = this.plugin.settings as any;
    return {
      enablePaneZoom: s.enablePaneZoom !== false,
      zoomStep: typeof s.zoomStep === 'number' ? s.zoomStep : 0.1,
      minZoom: typeof s.minZoom === 'number' ? s.minZoom : 0.5,
      maxZoom: typeof s.maxZoom === 'number' ? s.maxZoom : 2.5,
      defaultWidthMode: s.defaultWidthMode || 'keep-margins',
      showZoomInStatusBar: s.showZoomInStatusBar !== false,
    };
  }

  /**
   * Tracks Control key state to enable pointer-events passthrough on webviews / iframes.
   * This allows the host window to intercept Ctrl+Wheel even when cursor is over an Electron webview.
   */
  private registerCtrlKeyListeners(): void {
    this.ctrlDownListener = (evt: KeyboardEvent) => {
      if (evt.key === 'Control' || evt.ctrlKey) {
        document.body.classList.add('pakcli-ctrl-pressed');
      }
    };

    this.ctrlUpListener = (evt: KeyboardEvent) => {
      if (evt.key === 'Control' || !evt.ctrlKey) {
        document.body.classList.remove('pakcli-ctrl-pressed');
      }
    };

    this.windowBlurListener = () => {
      document.body.classList.remove('pakcli-ctrl-pressed');
    };

    window.addEventListener('keydown', this.ctrlDownListener, { capture: true, passive: true });
    window.addEventListener('keyup', this.ctrlUpListener, { capture: true, passive: true });
    window.addEventListener('blur', this.windowBlurListener, { capture: true, passive: true });
    window.addEventListener('pointerup', this.ctrlUpListener, { capture: true, passive: true });
  }

  /**
   * Observes workspace for webview elements (e.g. core webviewer, WhatsApp, websites)
   * and binds lifecycle & IPC bridges.
   */
  private setupWebviewObserver(): void {
    this.scanAndBindWebviews();

    this.webviewObserver = new MutationObserver((mutations) => {
      let found = false;
      for (const m of mutations) {
        for (let i = 0; i < m.addedNodes.length; i++) {
          const n = m.addedNodes[i];
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n as HTMLElement;
            if (el.tagName === 'WEBVIEW' || el.querySelector?.('webview')) {
              found = true;
              break;
            }
          }
        }
        if (found) break;
      }
      if (found) {
        this.scanAndBindWebviews();
      }
    });

    this.webviewObserver.observe(document.body, { childList: true, subtree: true });
  }

  private scanAndBindWebviews(): void {
    const webviews = document.querySelectorAll('webview');
    webviews.forEach((wv) => {
      this.attachWebview(wv as HTMLElement);
    });
  }

  /**
   * Finds the WorkspaceLeaf associated with an element
   */
  private findLeafForElement(el: HTMLElement): WorkspaceLeaf | null {
    const leafEl = el.closest('.workspace-leaf') as HTMLElement | null;
    if (!leafEl) return null;

    let foundLeaf: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((l) => {
      if ((l as any).containerEl === leafEl || (l.view as any)?.containerEl === leafEl) {
        foundLeaf = l;
      }
    });
    return foundLeaf;
  }

  /**
   * Binds zoom listeners and guest script bridges to an Electron webview
   */
  private attachWebview(wv: HTMLElement, leaf?: WorkspaceLeaf): void {
    if (this.boundWebviews.has(wv)) return;
    this.boundWebviews.add(wv);

    const onReadyOrNavigate = () => {
      const targetLeaf = leaf || this.findLeafForElement(wv) || this.app.workspace.activeLeaf;
      if (targetLeaf) {
        const currentZoom = this.getLeafZoom(targetLeaf);
        try {
          if (typeof (wv as any).setZoomFactor === 'function') {
            (wv as any).setZoomFactor(currentZoom);
          }
        } catch {}
      }
      this.injectGuestZoomScript(wv);
    };

    wv.addEventListener('dom-ready', onReadyOrNavigate);
    wv.addEventListener('did-navigate', () => this.injectGuestZoomScript(wv));
    wv.addEventListener('did-frame-finish-load', () => this.injectGuestZoomScript(wv));

    // Listen for console-message forwarded from guest page when Ctrl+Wheel occurs inside webview
    wv.addEventListener('console-message', (evt: any) => {
      const msg = evt?.message;
      if (typeof msg === 'string' && msg.startsWith('__PAKCLI_ZOOM_WHEEL__:')) {
        const dir = parseInt(msg.split(':')[1], 10);
        const delta = dir > 0 ? this.settings.zoomStep : -this.settings.zoomStep;
        const target = leaf || this.findLeafForElement(wv) || this.app.workspace.activeLeaf;
        if (target) {
          this.adjustLeafZoom(target, delta);
        }
      }
    });

    // Execute immediately in case webview is already loaded
    onReadyOrNavigate();
  }

  private injectGuestZoomScript(wv: HTMLElement): void {
    try {
      if (typeof (wv as any).executeJavaScript === 'function') {
        (wv as any).executeJavaScript(ZoomManager.GUEST_ZOOM_SCRIPT);
      }
    } catch {}
  }

  /**
   * Listens for Ctrl + Wheel events inside content viewports
   */
  private registerWheelListener(): void {
    this.wheelListener = (evt: WheelEvent) => {
      if (!evt.ctrlKey) {
        document.body.classList.remove('pakcli-ctrl-pressed');
        return;
      }
      if (!this.settings.enablePaneZoom) return;

      const target = evt.target as HTMLElement | null;
      if (!target) return;

      // 1. Strictly EXCLUDE Top Header, Tabs, and Status Bar
      if (
        target.closest('.view-header') ||
        target.closest('.workspace-tab-header') ||
        target.closest('.workspace-tab-header-container') ||
        target.closest('.status-bar')
      ) {
        return;
      }

      // 2. Identify view content container or leaf container
      const contentEl = target.closest(
        '.view-content, .workspace-leaf-content, .workspace-leaf, webview, iframe, [data-type="webviewer"]'
      ) as HTMLElement | null;
      if (!contentEl) return;

      // Prevent Electron from zooming the entire window
      evt.preventDefault();
      evt.stopPropagation();

      // Resolve target leaf from hovered element or activeLeaf fallback
      let targetLeaf = this.app.workspace.activeLeaf;
      const leafEl = target.closest('.workspace-leaf') as HTMLElement | null;
      if (leafEl) {
        this.app.workspace.iterateAllLeaves((l) => {
          if ((l as any).containerEl === leafEl || (l.view as any)?.containerEl === leafEl) {
            targetLeaf = l;
          }
        });
      }

      if (!targetLeaf) return;

      // Ensure active leaf matches for immediate status bar sync
      if (targetLeaf !== this.app.workspace.activeLeaf) {
        try {
          (this.app.workspace as any).setActiveLeaf(targetLeaf, { focus: false });
        } catch {}
      }

      // Scroll Up = Zoom In, Scroll Down = Zoom Out
      const delta = evt.deltaY < 0 ? this.settings.zoomStep : -this.settings.zoomStep;
      this.adjustLeafZoom(targetLeaf, delta);
    };

    window.addEventListener('wheel', this.wheelListener, { capture: true, passive: false });
  }

  /**
   * Initializes the docked status bar element in Obsidian's footer
   */
  private initStatusBar(): void {
    if (!this.settings.showZoomInStatusBar) return;

    this.statusBarEl = this.plugin.addStatusBarItem();
    this.statusBarEl.addClass('pakcli-zoom-status-bar');
    this.statusBarEl.style.cssText =
      'cursor: pointer; display: inline-flex; align-items: center; gap: 6px; user-select: none; font-size: 11px; padding: 0 4px;';

    // Click on status bar: Reset Zoom
    this.statusBarEl.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      const activeLeaf = this.app.workspace.activeLeaf;
      if (activeLeaf) {
        this.resetLeafZoom(activeLeaf);
      }
    });

    // Right-click: Context menu with presets & toggle mode
    this.statusBarEl.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.showQuickZoomMenu(e);
    });

    this.updateStatusBar();
  }

  private registerActiveLeafListener(): void {
    this.plugin.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf) {
          this.applyStoredZoom(leaf);
        }
        this.updateStatusBar();
      })
    );

    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => {
        const active = this.app.workspace.activeLeaf;
        if (active) {
          this.applyStoredZoom(active);
        }
        this.scanAndBindWebviews();
      })
    );

    this.plugin.registerEvent(
      this.app.workspace.on('file-open', () => {
        const active = this.app.workspace.activeLeaf;
        if (active) {
          this.applyStoredZoom(active);
        }
      })
    );
  }

  /**
   * Updates the live zoom percentage and mode pill in footer
   */
  public updateStatusBar(): void {
    if (!this.statusBarEl) return;

    const activeLeaf = this.app.workspace.activeLeaf;
    const currentScale = activeLeaf ? this.getLeafZoom(activeLeaf) : 1.0;
    const currentMode = activeLeaf ? this.getLeafMode(activeLeaf) : this.settings.defaultWidthMode;

    const pct = Math.round(currentScale * 100);
    const isStandard = pct === 100;
    const isFullWidth = currentMode === 'fill-width';
    const isWebviewer =
      (activeLeaf?.view as any)?.getViewType?.() === 'webviewer' ||
      (activeLeaf as any)?.getViewState?.()?.type === 'webviewer';

    this.statusBarEl.empty();

    // Zoom badge
    const zoomSpan = this.statusBarEl.createSpan();
    zoomSpan.setText(`🔍 ${pct}%`);
    zoomSpan.style.cssText = `font-weight: ${isStandard ? '400' : '600'}; color: ${
      isStandard ? 'var(--text-muted)' : 'var(--text-accent)'
    };`;
    zoomSpan.title = 'Click to reset zoom (100%). Right-click for presets.';

    // Mode badge pill
    const modeSpan = this.statusBarEl.createSpan();
    if (isWebviewer) {
      modeSpan.setText('🌐 Web');
      modeSpan.style.cssText =
        'font-size: 9px; padding: 1px 4px; border-radius: 3px; background: var(--background-modifier-border); color: var(--text-muted); margin-left: 2px;';
      modeSpan.title = 'Website Viewer Page Zoom active';
    } else {
      modeSpan.setText(isFullWidth ? '↔ Full' : '↔ Margins');
      modeSpan.style.cssText = `font-size: 9px; padding: 1px 4px; border-radius: 3px; background: ${
        isFullWidth ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'
      }; color: ${isFullWidth ? '#ffffff' : 'var(--text-muted)'}; margin-left: 2px;`;
      modeSpan.title = 'Click to toggle Width Mode (Preserved Margins vs Full Width)';

      modeSpan.onclick = (e) => {
        e.stopPropagation();
        if (activeLeaf) {
          this.toggleWidthMode(activeLeaf);
        }
      };
    }
  }

  public getLeafZoom(leaf: WorkspaceLeaf): number {
    return this.leafZoomMap.get(leaf) ?? 1.0;
  }

  public getLeafMode(leaf: WorkspaceLeaf): ZoomWidthMode {
    return this.leafModeMap.get(leaf) ?? this.settings.defaultWidthMode;
  }

  public adjustLeafZoom(leaf: WorkspaceLeaf, delta: number): void {
    const current = this.getLeafZoom(leaf);
    const next = Math.min(
      this.settings.maxZoom,
      Math.max(this.settings.minZoom, Number((current + delta).toFixed(2)))
    );
    this.setLeafZoom(leaf, next);
  }

  public setLeafZoom(leaf: WorkspaceLeaf, zoom: number): void {
    this.leafZoomMap.set(leaf, zoom);
    this.applyZoomToLeafDOM(leaf, zoom, this.getLeafMode(leaf));
    this.updateStatusBar();
  }

  public resetLeafZoom(leaf: WorkspaceLeaf): void {
    this.setLeafZoom(leaf, 1.0);
    new Notice('View Zoom reset to 100%');
  }

  public toggleWidthMode(leaf: WorkspaceLeaf): void {
    const currentMode = this.getLeafMode(leaf);
    const nextMode: ZoomWidthMode = currentMode === 'keep-margins' ? 'fill-width' : 'keep-margins';
    this.leafModeMap.set(leaf, nextMode);
    this.applyZoomToLeafDOM(leaf, this.getLeafZoom(leaf), nextMode);
    this.updateStatusBar();
    new Notice(nextMode === 'fill-width' ? '↔ Full Width Mode: ON' : '↔ Preserved Margins Mode: ON');
  }

  /**
   * Applies CSS zoom & width overrides to normal leaves,
   * and native setZoomFactor to webview tags (websites/webviewer).
   */
  private applyZoomToLeafDOM(leaf: WorkspaceLeaf, zoom: number, mode: ZoomWidthMode): void {
    const view = leaf.view as any;
    const container = ((leaf as any).containerEl || view?.containerEl || view?.contentEl) as HTMLElement | null;
    const viewContent = (view?.contentEl || view?.containerEl?.querySelector('.view-content')) as HTMLElement | null;

    // 1. Electron Webview handling (e.g. core webviewer, WhatsApp Web, web pages)
    const webviews = container?.querySelectorAll?.('webview');
    const hasWebviews = !!(webviews && webviews.length > 0);

    if (hasWebviews) {
      webviews.forEach((wv: any) => {
        this.attachWebview(wv, leaf);
        try {
          if (typeof wv.setZoomFactor === 'function') {
            wv.setZoomFactor(zoom);
          }
        } catch {
          wv.addEventListener?.('dom-ready', () => {
            try { wv.setZoomFactor(zoom); } catch {}
          }, { once: true });
        }
      });

      // Clear container CSS zoom so the webview element's outer bounding box does not scale or clip
      if (viewContent) {
        (viewContent.style as any).zoom = '';
        viewContent.style.removeProperty('--pakcli-zoom-scale');
        viewContent.style.fontSize = '';
      }
    } else {
      // 2. Native Chromium layout zoom for standard views (Markdown, Canvas, Kanban, Tables)
      if (viewContent) {
        if (zoom !== 1.0) {
          (viewContent.style as any).zoom = String(zoom);
          viewContent.style.setProperty('--pakcli-zoom-scale', String(zoom));
          viewContent.style.fontSize = '';
        } else {
          (viewContent.style as any).zoom = '';
          viewContent.style.removeProperty('--pakcli-zoom-scale');
          viewContent.style.fontSize = '';
        }
      }
    }

    // 3. Embedded <iframe> zoom handling
    const iframes = container?.querySelectorAll?.('iframe');
    if (iframes && iframes.length > 0) {
      iframes.forEach((iframe: HTMLIFrameElement) => {
        try {
          if (iframe.contentDocument?.body) {
            (iframe.contentDocument.body.style as any).zoom = zoom === 1.0 ? '' : String(zoom);
          }
        } catch {}
        (iframe.style as any).zoom = zoom === 1.0 ? '' : String(zoom);
      });
    }

    // 4. Width Mode toggle class
    if (viewContent) {
      if (mode === 'fill-width') {
        viewContent.classList.add('pakcli-zoom-full-width');
      } else {
        viewContent.classList.remove('pakcli-zoom-full-width');
      }
    }

    // 5. Refresh CodeMirror 6 editor layout if active
    if (typeof view?.editor?.refresh === 'function') {
      view.editor.refresh();
    }
  }

  public applyStoredZoom(leaf: WorkspaceLeaf): void {
    const zoom = this.getLeafZoom(leaf);
    const mode = this.getLeafMode(leaf);
    this.applyZoomToLeafDOM(leaf, zoom, mode);
  }

  /**
   * Quick Zoom Preset Context Menu
   */
  private showQuickZoomMenu(e: MouseEvent): void {
    const menu = new Menu();
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) return;

    const currentScale = this.getLeafZoom(activeLeaf);
    const currentMode = this.getLeafMode(activeLeaf);
    const isWebviewer =
      (activeLeaf?.view as any)?.getViewType?.() === 'webviewer' ||
      (activeLeaf as any)?.getViewState?.()?.type === 'webviewer';

    if (!isWebviewer) {
      menu.addItem((item) => {
        item.setTitle(currentMode === 'fill-width' ? 'Switch to: Preserved Margins' : 'Switch to: Full Width')
          .setIcon('expand')
          .onClick(() => {
            this.toggleWidthMode(activeLeaf);
          });
      });
      menu.addSeparator();
    }

    const presets = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0];
    for (const p of presets) {
      const pct = Math.round(p * 100);
      menu.addItem((item) => {
        item.setTitle(`${pct}%${Math.abs(currentScale - p) < 0.01 ? ' ✔' : ''}`)
          .onClick(() => {
            this.setLeafZoom(activeLeaf, p);
          });
      });
    }

    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle('Reset Zoom to 100%')
        .setIcon('rotate-ccw')
        .onClick(() => {
          this.resetLeafZoom(activeLeaf);
        });
    });

    menu.showAtMouseEvent(e);
  }
}
