import { App, normalizePath, Notice, setIcon, TAbstractFile, TFile, TFolder } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { ScrollbackAnchor, ScrollbackSettings } from './types';

export class ScrollbackManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private previousAnchor: ScrollbackAnchor | null = null;
  private currentAnchor: ScrollbackAnchor | null = null;
  private ribbonIconEl: HTMLElement | null = null;

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init(): void {
    this.initRibbonIcon();
    this.registerFileTracking();
    this.registerCommand();
  }

  public destroy(): void {
    if (this.ribbonIconEl) {
      this.ribbonIconEl.remove();
      this.ribbonIconEl = null;
    }
  }

  private get settings(): ScrollbackSettings {
    const s = this.plugin.settings as any;
    return {
      enableScrollbackRibbon: s.enableScrollbackRibbon !== false,
      scrollbackHighlightDurationMs: s.scrollbackHighlightDurationMs || 1600,
    };
  }

  /**
   * Registers Ribbon Icon on the left ribbon bar
   */
  private initRibbonIcon(): void {
    if (!this.settings.enableScrollbackRibbon) return;

    this.ribbonIconEl = this.plugin.addRibbonIcon(
      'history',
      'Scrollback: No previous location yet',
      () => {
        this.executeScrollback();
      }
    );

    this.ribbonIconEl.addClass('pakcli-scrollback-ribbon-btn');
    this.updateRibbonState();
  }

  /**
   * Tracks active files to record previous location anchor before user jumps
   */
  private registerFileTracking(): void {
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file) return;
        this.recordFileAccess(file);
      })
    );
  }

  private registerCommand(): void {
    this.plugin.addCommand({
      id: 'pakcli-scrollback-explorer',
      name: 'Scrollback: Return to Previous Tree Location in Explorer',
      callback: () => {
        this.executeScrollback();
      }
    });
  }

  /**
   * Records newly accessed file/folder as anchor, shifting old one to previous
   */
  public recordFileAccess(file: TAbstractFile): void {
    const norm = normalizePath(file.path);
    if (this.currentAnchor && this.currentAnchor.path === norm) {
      return;
    }

    if (this.currentAnchor) {
      this.previousAnchor = this.currentAnchor;
    }

    this.currentAnchor = {
      path: norm,
      name: file.name,
      isFolder: file instanceof TFolder,
      timestamp: Date.now()
    };

    this.updateRibbonState();
  }

  /**
   * Updates ribbon tooltip and visual state
   */
  private updateRibbonState(): void {
    if (!this.ribbonIconEl) return;

    if (this.previousAnchor) {
      this.ribbonIconEl.style.opacity = '1.0';
      this.ribbonIconEl.setAttribute(
        'aria-label',
        `⏪ Scrollback to: "${this.previousAnchor.name}"`
      );
    } else {
      this.ribbonIconEl.style.opacity = '0.5';
      this.ribbonIconEl.setAttribute(
        'aria-label',
        'Scrollback: No previous location yet'
      );
    }
  }

  /**
   * 1-Click Return: Unfolds folders, smooth scrolls, and pulses highlight
   */
  public async executeScrollback(): Promise<void> {
    if (!this.previousAnchor) {
      new Notice('No previous tree location to scroll back to yet.');
      return;
    }

    const targetPath = this.previousAnchor.path;
    const targetName = this.previousAnchor.name;

    // 1. Reveal and activate File Explorer leaf in left sidebar
    const explorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
    if (explorerLeaf) {
      this.app.workspace.revealLeaf(explorerLeaf);
    } else {
      new Notice('File Explorer is not active.');
      return;
    }

    // 2. Unfold parent folders if collapsed
    const fileExplorerView = explorerLeaf.view as any;
    if (!fileExplorerView || !fileExplorerView.fileItems) {
      return;
    }

    let parent = this.app.vault.getAbstractFileByPath(targetPath)?.parent;
    while (parent && !parent.isRoot()) {
      const parentItem = fileExplorerView.fileItems[parent.path];
      if (parentItem && parentItem.collapsed) {
        parentItem.setCollapsed(false);
      }
      parent = parent.parent;
    }

    // 3. Small timeout for DOM render if folders unfolded
    window.setTimeout(() => {
      const item = fileExplorerView.fileItems[targetPath];
      if (!item) {
        new Notice(`Item "${targetName}" not currently found in explorer tree.`);
        return;
      }

      const el = (item.el || item.selfEl) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('pakcli-scrollback-pulse');
        window.setTimeout(() => {
          el.classList.remove('pakcli-scrollback-pulse');
        }, this.settings.scrollbackHighlightDurationMs);

        new Notice(`⏪ Scrolled back to: "${targetName}"`);

        // Swap anchors so clicking again can return back!
        const temp = this.previousAnchor;
        this.previousAnchor = this.currentAnchor;
        this.currentAnchor = temp;
        this.updateRibbonState();
      }
    }, 60);
  }
}
