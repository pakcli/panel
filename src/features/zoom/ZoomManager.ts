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

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init(): void {
    this.registerWheelListener();
    this.initStatusBar();
    this.registerActiveLeafListener();
  }

  public destroy(): void {
    if (this.wheelListener) {
      window.removeEventListener('wheel', this.wheelListener, { capture: true });
      this.wheelListener = null;
    }
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
   * Listens for Ctrl + Wheel events strictly inside content viewports
   */
  private registerWheelListener(): void {
    this.wheelListener = (evt: WheelEvent) => {
      if (!evt.ctrlKey) return;
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

      // 2. Identify view content container
      const viewContent = target.closest('.view-content') as HTMLElement | null;
      if (!viewContent) return;

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
   * Applies CSS zoom & width overrides cleanly to the leaf's content
   */
  private applyZoomToLeafDOM(leaf: WorkspaceLeaf, zoom: number, mode: ZoomWidthMode): void {
    const view = leaf.view as any;
    const viewContent = (view?.contentEl || view?.containerEl?.querySelector('.view-content')) as HTMLElement | null;
    if (!viewContent) return;

    if (zoom !== 1.0) {
      // 1. Native Chromium layout zoom - scales text, tables, codeblocks, properties, images
      (viewContent.style as any).zoom = String(zoom);
      viewContent.style.setProperty('--pakcli-zoom-scale', String(zoom));

      // Clean up legacy fontSize to prevent double-scaling
      viewContent.style.fontSize = '';
    } else {
      (viewContent.style as any).zoom = '';
      viewContent.style.removeProperty('--pakcli-zoom-scale');
      viewContent.style.fontSize = '';
    }

    // 2. Width Mode toggle class
    if (mode === 'fill-width') {
      viewContent.classList.add('pakcli-zoom-full-width');
    } else {
      viewContent.classList.remove('pakcli-zoom-full-width');
    }

    // 3. Refresh CodeMirror 6 editor layout if active
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

    menu.addItem((item) => {
      item.setTitle(currentMode === 'fill-width' ? 'Switch to: Preserved Margins' : 'Switch to: Full Width')
        .setIcon('expand')
        .onClick(() => {
          this.toggleWidthMode(activeLeaf);
        });
    });

    menu.addSeparator();

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
      item.setTitle('Reset All Zooms to 100%')
        .setIcon('rotate-ccw')
        .onClick(() => {
          this.resetLeafZoom(activeLeaf);
        });
    });

    menu.showAtMouseEvent(e);
  }
}
