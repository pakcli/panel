import { App, Menu, Notice, setIcon, TFile, TFolder, TAbstractFile, WorkspaceLeaf, Keymap, HoverParent, HoverPopover, FuzzySuggestModal } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { ExplorerSectionId, RecentTimeFilter, RECENT_TIME_FILTER_OPTIONS, ExplorerRowBgMode, CaptainFolderOverrideMode } from './types';
import { ensureFolderExists } from '../sqlseal/utils/views';
import { DictionaryPopupModal } from '../dictionary/dictionaryPopupModal';
import { matchFolderRule } from '../bubblegraph/graphBuilder';

export class SplitViewManager implements HoverParent {
  public hoverPopover: HoverPopover | null = null;
  private app: App;
  private plugin: PakCLITablePlugin;
  private splitBtnEl: HTMLElement | null = null;
  private baseBtnEl: HTMLElement | null = null;
  private showIndexBtnEl: HTMLElement | null = null;
  private dictVirtualFolderBtnEl: HTMLElement | null = null;
  private recentPaneEl: HTMLElement | null = null;
  private splitterEl: HTMLElement | null = null;
  private attachedLeaf: WorkspaceLeaf | null = null;
  private recentFilesList: TFile[] = [];
  private openTimes: Map<string, number> = new Map();
  private isDragging = false;
  private mutationObserver: MutationObserver | null = null;
  private baseExplorerObserver: MutationObserver | null = null;
  private baseExplorerDebounce: number | null = null;
  private badgeDebounce: number | null = null;
  private saveCsvTimeout: ReturnType<typeof setTimeout> | null = null;
  private onFolderClickBound: ((e: MouseEvent) => void) | null = null;
  private explorerResizeObserver: ResizeObserver | null = null;

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init() {
    this.registerEvents();
    // Defer init until vault is fully indexed so getAbstractFileByPath works reliably
    this.app.workspace.onLayoutReady(() => {
      this.initRecentFiles().catch((err) => {
        console.error('[PakCLI] Error initializing recent files:', err);
      });
      this.attachToFileExplorer();
    });
  }

  public destroy() {
    if (this.saveCsvTimeout) {
      clearTimeout(this.saveCsvTimeout);
      this.saveCsvTimeout = null;
    }
    // Flush: save history immediately on destroy so it survives exit/reload
    if (this.recentFilesList.length > 0) {
      this.saveRecentsCsvArtifact().catch(() => { });
    }
    if (this.explorerResizeObserver) {
      this.explorerResizeObserver.disconnect();
      this.explorerResizeObserver = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.baseExplorerObserver) {
      this.baseExplorerObserver.disconnect();
      this.baseExplorerObserver = null;
    }
    if (this.baseExplorerDebounce !== null) {
      cancelAnimationFrame(this.baseExplorerDebounce);
      this.baseExplorerDebounce = null;
    }
    if (this.badgeDebounce !== null) {
      cancelAnimationFrame(this.badgeDebounce);
      this.badgeDebounce = null;
    }
    if (this.hoverPopover) {
      this.hoverPopover = null;
    }
    this.detach();
  }

  private registerEvents() {
    // 1. Listen to active file changes
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file instanceof TFile && !this.isArtifactFile(file.path)) {
          this.openTimes.set(file.path, Date.now());
          this.addRecentFile(file);
        }
      })
    );

    // 2. Listen to workspace layout changes to reattach if leaf moves or recreates
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.attachToFileExplorer();
        this.applyBaseExplorerFilter();
        this.refreshFolderBadges();
        this.applyCaptainFolderTextColors();
      })
    );

    // 3. Listen to file renames and deletes
    this.plugin.registerEvent(
      this.app.vault.on('rename', () => {
        this.refreshRecentFiles();
        this.applyBaseExplorerFilter();
        this.refreshFolderBadges();
        this.applyCaptainFolderTextColors();
      })
    );

    this.plugin.registerEvent(
      this.app.vault.on('delete', () => {
        this.refreshRecentFiles();
        this.applyBaseExplorerFilter();
        this.refreshFolderBadges();
        this.applyCaptainFolderTextColors();
      })
    );

    this.plugin.registerEvent(
      this.app.vault.on('create', () => {
        if (this.plugin.settings.baseExplorerActive) {
          this.applyBaseExplorerFilter();
        }
        this.refreshFolderBadges();
        this.applyCaptainFolderTextColors();
      })
    );

    // 5. Listen to theme and snippet changes (css-change) to dynamically adapt modular row styling
    this.plugin.registerEvent(
      this.app.workspace.on('css-change', () => {
        this.applyCaptainFolderTextColors();
      })
    );

    // 6. Listen to workspace resize to dynamically adapt [base] vs [b] badge width limit
    this.plugin.registerEvent(
      this.app.workspace.on('resize', () => {
        this.recheckAllBaseBadges();
      })
    );

    // 7. Enable Ctrl+Click multi-select in File Explorer & Recent list
    this.initCtrlMultiSelect();
  }

  private initCtrlMultiSelect() {
    const isCtrlModifier = (e: MouseEvent): boolean => {
      return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.button === 0;
    };

    // 1. Intercept pointerdown and mousedown to prevent Obsidian from:
    //    - Opening note in a new tab / leaf
    //    - Clearing existing multi-selection
    //    - Initiating drag-and-drop
    const stopCtrlDown = (e: MouseEvent) => {
      if (!e.isTrusted) return;
      if (!isCtrlModifier(e)) return;

      const target = e.target as HTMLElement;
      if (!target) return;

      if (target.closest('.nav-buttons-container, .nav-action-button, .nav-folder-collapse-indicator, .pakcli-recent-item-remove, button, input, select')) {
        return;
      }

      const fileRow = target.closest(
        '.workspace-leaf-content[data-type="file-explorer"] .nav-file-title, ' +
        '.workspace-leaf-content[data-type="file-explorer"] .nav-folder-title, ' +
        '.workspace-leaf-content[data-type="file-explorer"] .tree-item-self, ' +
        '.pakcli-recent-item .tree-item-self'
      ) as HTMLElement;

      if (!fileRow) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    this.plugin.registerDomEvent(window, 'pointerdown', stopCtrlDown, { capture: true });
    this.plugin.registerDomEvent(window, 'mousedown', stopCtrlDown, { capture: true });

    // 2. Intercept click to perform discrete toggle of selection
    this.plugin.registerDomEvent(
      window,
      'click',
      (e: MouseEvent) => {
        if (!e.isTrusted) return;
        if (!isCtrlModifier(e)) return;

        const target = e.target as HTMLElement;
        if (!target) return;

        if (target.closest('.nav-buttons-container, .nav-action-button, .nav-folder-collapse-indicator, .pakcli-recent-item-remove, button, input, select')) {
          return;
        }

        const fileRow = target.closest(
          '.workspace-leaf-content[data-type="file-explorer"] .nav-file-title, ' +
          '.workspace-leaf-content[data-type="file-explorer"] .nav-folder-title, ' +
          '.workspace-leaf-content[data-type="file-explorer"] .tree-item-self, ' +
          '.pakcli-recent-item .tree-item-self'
        ) as HTMLElement;

        if (!fileRow) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        this.handleExplorerCtrlClick(fileRow, target);
      },
      { capture: true }
    );
  }

  private handleExplorerCtrlClick(fileRow: HTMLElement, target: HTMLElement) {
    // A. Handle Recent Files Pane item
    if (fileRow.closest('.pakcli-recent-item')) {
      fileRow.toggleClass('is-selected', !fileRow.hasClass('is-selected'));
      return;
    }

    // B. Handle File Explorer leaf
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    const leaf = leaves.find((l) => l.view?.containerEl?.contains(fileRow)) || leaves[0];
    const view = leaf?.view as any;
    if (!view) return;

    // 1. Locate TreeItem and TAbstractFile for clicked row
    let clickedItem: any = null;
    let clickedFile: TAbstractFile | null = null;

    if (view.fileItems) {
      for (const p in view.fileItems) {
        const item = view.fileItems[p];
        if (
          item.selfEl === fileRow ||
          item.el === fileRow ||
          item.selfEl?.contains(target) ||
          item.titleEl?.contains(target) ||
          item.selfEl?.contains(fileRow)
        ) {
          clickedItem = item;
          clickedFile = item.file;
          break;
        }
      }
    }

    if (!clickedFile) {
      const p = fileRow.getAttribute('data-path') ||
                fileRow.closest('[data-path]')?.getAttribute('data-path') ||
                fileRow.querySelector('[data-path]')?.getAttribute('data-path') ||
                fileRow.getAttribute('aria-label');
      if (p) {
        clickedFile = this.app.vault.getAbstractFileByPath(p);
        if (view.fileItems && view.fileItems[p]) {
          clickedItem = view.fileItems[p];
        }
      }
    }

    const tree = view.tree;
    if (tree && !tree.selectedDoms) {
      tree.selectedDoms = new Set();
    }
    if (!view.selectedFiles || !(view.selectedFiles instanceof Set)) {
      view.selectedFiles = new Set();
    }

    const selectedDoms: Set<any> | null = tree?.selectedDoms || null;

    // 2. Check if a multi-selection is currently active
    const currentSelectedEls = view.containerEl.querySelectorAll(
      '.nav-file-title.is-selected, .nav-folder-title.is-selected, .tree-item-self.is-selected'
    );
    const isSelectionActive = (selectedDoms && selectedDoms.size > 0) || currentSelectedEls.length > 0;

    // If starting multi-selection when nothing was selected, but an item was active/focused:
    if (!isSelectionActive) {
      const prevFocused = tree?.focusedItem || tree?.activeDom;
      if (prevFocused && prevFocused !== clickedItem && prevFocused.file) {
        prevFocused.selfEl?.classList.add('is-selected');
        prevFocused.el?.classList.add('is-selected');
        prevFocused.selfEl?.setAttribute('aria-selected', 'true');
        selectedDoms?.add(prevFocused);
        view.selectedFiles.add(prevFocused.file);
      }
    }

    // 3. Toggle clicked item
    const isCurrentlySelected = fileRow.classList.contains('is-selected') ||
      (clickedItem?.selfEl?.classList.contains('is-selected')) ||
      (selectedDoms && clickedItem && selectedDoms.has(clickedItem));

    if (isCurrentlySelected) {
      // Deselect
      fileRow.classList.remove('is-selected');
      clickedItem?.selfEl?.classList.remove('is-selected');
      clickedItem?.el?.classList.remove('is-selected');
      fileRow.removeAttribute('aria-selected');
      clickedItem?.selfEl?.removeAttribute('aria-selected');

      if (selectedDoms && clickedItem) {
        selectedDoms.delete(clickedItem);
      }
      if (clickedFile) {
        view.selectedFiles.delete(clickedFile);
      }

      if (selectedDoms && selectedDoms.size === 0) {
        if (tree) tree.activeDom = null;
      }
    } else {
      // Select
      fileRow.classList.add('is-selected');
      clickedItem?.selfEl?.classList.add('is-selected');
      clickedItem?.el?.classList.add('is-selected');
      fileRow.setAttribute('aria-selected', 'true');
      clickedItem?.selfEl?.setAttribute('aria-selected', 'true');

      if (selectedDoms && clickedItem) {
        selectedDoms.add(clickedItem);
      }
      if (clickedFile) {
        view.selectedFiles.add(clickedFile);
      }

      // Update anchor for subsequent Shift+Click
      if (tree && clickedItem) {
        tree.activeDom = clickedItem;
        tree.focusedItem = clickedItem;
      }
    }
  }

  private async initRecentFiles() {
    const rawPaths = this.app.workspace.getLastOpenFiles?.() || [];
    const files: TFile[] = [];
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile && !this.isArtifactFile(activeFile.path)) {
      files.push(activeFile);
      this.openTimes.set(activeFile.path, Date.now());
    }
    for (const path of rawPaths) {
      const abstract = this.app.vault.getAbstractFileByPath(path);
      if (abstract instanceof TFile && !files.some((f) => f.path === abstract.path)) {
        if (this.isArtifactFile(abstract.path)) continue;
        files.push(abstract);
        this.openTimes.set(abstract.path, abstract.stat.mtime || Date.now());
      }
    }

    // Load and merge history from recents.csv artifact if it exists
    await this.loadRecentsFromCsvArtifact(files);

    // Check available artifacts in the vault so they are included and never disappear
    const allVaultFiles = this.app.vault.getFiles();
    const availableArtifacts = allVaultFiles.filter((f) => f.path.startsWith('artifacts/'));
    for (const af of availableArtifacts) {
      if (!files.some((f) => f.path === af.path)) {
        files.push(af);
        if (!this.openTimes.has(af.path)) {
          this.openTimes.set(af.path, af.stat.mtime || Date.now());
        }
      }
    }

    // Sort combined list by most recent open time (descending)
    files.sort((a, b) => {
      const tA = this.openTimes.get(a.path) || 0;
      const tB = this.openTimes.get(b.path) || 0;
      return tB - tA;
    });

    const max = this.plugin.settings.explorerMaxRecentFiles || 20;
    this.recentFilesList = files.slice(0, max);
    this.renderRecentList();
    // Only save if we actually have files to persist (avoid overwriting history with an empty list)
    if (this.recentFilesList.length > 0) {
      this.scheduleSaveRecentsCsv();
    }
  }

  /**
   * Checks if a file path should be excluded.
   * All available vault files and artifacts are tracked; nothing disappears unless deleted from the vault.
   */
  private isArtifactFile(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') return true;
    return false;
  }

  public addRecentFile(file: TFile) {
    if (!file || !(file instanceof TFile)) return;
    // Skip invalid paths
    if (this.isArtifactFile(file.path)) return;
    this.recentFilesList = [
      file,
      ...this.recentFilesList.filter((f) => f.path !== file.path),
    ].slice(0, this.plugin.settings.explorerMaxRecentFiles || 20);
    this.renderRecentList();
    this.scheduleSaveRecentsCsv();
  }

  private refreshRecentFiles() {
    this.recentFilesList = this.recentFilesList.filter((f) => {
      return (
        f instanceof TFile &&
        !this.isArtifactFile(f.path) &&
        this.app.vault.getAbstractFileByPath(f.path) instanceof TFile
      );
    });
    this.renderRecentList();
    this.scheduleSaveRecentsCsv();
  }

  public attachToFileExplorer() {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const leaf = leaves[0];
    this.attachedLeaf = leaf;

    const view = leaf.view as any;
    if (!view || !view.containerEl) return;

    const containerEl = view.containerEl as HTMLElement;
    this.injectHeaderButton(containerEl);
    this.applyLayout(containerEl);
    this.attachFolderClickListener(containerEl);
    this.applyBaseExplorerFilter();
    this.refreshFolderBadges(containerEl);
    this.applyCaptainFolderTextColors(containerEl);
    if (this.plugin.dictionaryExplorerManager) {
      this.plugin.dictionaryExplorerManager.scheduleRefresh();
    }
    if (this.plugin.relationshipExplorerManager) {
      this.plugin.relationshipExplorerManager.scheduleRefresh();
    }
  }

  private injectHeaderButton(containerEl: HTMLElement) {
    const navButtons = containerEl.querySelector('.nav-buttons-container') as HTMLElement;
    if (!navButtons) return;

    if (
      this.splitBtnEl &&
      navButtons.contains(this.splitBtnEl) &&
      this.baseBtnEl &&
      navButtons.contains(this.baseBtnEl) &&
      this.showIndexBtnEl &&
      navButtons.contains(this.showIndexBtnEl) &&
      this.dictVirtualFolderBtnEl &&
      navButtons.contains(this.dictVirtualFolderBtnEl)
    ) {
      this.updateButtonState();
      return;
    }

    if (this.splitBtnEl) {
      this.splitBtnEl.remove();
      this.splitBtnEl = null;
    }
    if (this.baseBtnEl) {
      this.baseBtnEl.remove();
      this.baseBtnEl = null;
    }
    if (this.showIndexBtnEl) {
      this.showIndexBtnEl.remove();
      this.showIndexBtnEl = null;
    }
    if (this.dictVirtualFolderBtnEl) {
      this.dictVirtualFolderBtnEl.remove();
      this.dictVirtualFolderBtnEl = null;
    }

    // 1. Split View Toggle Button
    const splitBtn = document.createElement('div');
    splitBtn.className = 'clickable-icon nav-action-button pakcli-explorer-split-btn';
    splitBtn.setAttribute('aria-label', 'Toggle Explorer Split View (Recent Files)');
    setIcon(splitBtn, 'rows-2');

    splitBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const current = this.plugin.settings.explorerSplitEnabled;
      this.plugin.settings.explorerSplitEnabled = !current;
      await this.plugin.saveSettings();
      this.updateButtonState();
      this.applyLayout();
      new Notice(`Explorer Split View: ${!current ? 'Enabled' : 'Disabled'}`);
    });

    // 2. Base Explorer Mode Filter Toggle Button (Beside Split Toggle)
    const baseBtn = document.createElement('div');
    baseBtn.className = 'clickable-icon nav-action-button pakcli-explorer-base-btn';
    baseBtn.setAttribute('aria-label', 'Toggle Base Explorer Mode (Base files & affected folders only)');
    setIcon(baseBtn, 'filter');

    baseBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = !this.plugin.settings.baseExplorerActive;
      this.plugin.settings.baseExplorerActive = next;
      await this.plugin.saveSettings();
      this.updateButtonState();
      this.applyBaseExplorerFilter();
      this.renderRecentList();
      new Notice(`Base Explorer Mode: ${next ? 'ON (Base files & affected folders only)' : 'OFF (All files visible)'}`);
    });

    // 3. Show Index & Base Rows Toggle Button (Beside Filter Toggle)
    const showIndexBtn = document.createElement('div');
    showIndexBtn.className = 'clickable-icon nav-action-button pakcli-explorer-show-index-btn';
    showIndexBtn.setAttribute('aria-label', 'Toggle Show Index & Base Rows (index.md, index.base)');
    setIcon(showIndexBtn, 'file-text');

    showIndexBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = !this.plugin.settings.showMergedIndexRows;
      this.plugin.settings.showMergedIndexRows = next;
      await this.plugin.saveSettings();
      this.updateButtonState();
      this.refreshFolderBadges();
      this.applyBaseExplorerFilter();
      new Notice(`Index Rows (index.md & index.base): ${next ? 'Shown' : 'Hidden'}`);
    });

    // 4. Virtual Folders Toggle Button (A-Z virtual grouping in explorer)
    const dictVFBtn = document.createElement('div');
    dictVFBtn.className = 'clickable-icon nav-action-button pakcli-explorer-dict-vf-btn';
    dictVFBtn.setAttribute('aria-label', 'Toggle Virtual A–Z Folders in Explorer');
    setIcon(dictVFBtn, 'folder-tree');

    dictVFBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const current = (this.plugin.settings.enableDictionaryVirtualFolders !== false) ||
                      (this.plugin.settings.explorerRelationshipVirtualFolders !== false);
      const next = !current;
      this.plugin.settings.enableDictionaryVirtualFolders = next;
      this.plugin.settings.explorerRelationshipVirtualFolders = next;

      this.updateButtonState();

      // Transform DOM immediately without waiting for disk I/O
      if (this.plugin.dictionaryExplorerManager) {
        if (!next) {
          this.plugin.dictionaryExplorerManager.removeVirtualFolders();
        } else {
          this.plugin.dictionaryExplorerManager.refreshVirtualFolders();
        }
      }
      if (this.plugin.relationshipExplorerManager) {
        if (!next) {
          this.plugin.relationshipExplorerManager.removeVirtualFolders();
        } else {
          this.plugin.relationshipExplorerManager.refreshVirtualFolders();
        }
      }

      await this.plugin.saveSettings();
      new Notice(`Virtual Folders in Explorer: ${next ? 'Enabled' : 'Disabled'}`);
    });

    navButtons.appendChild(splitBtn);
    navButtons.appendChild(baseBtn);
    navButtons.appendChild(showIndexBtn);
    navButtons.appendChild(dictVFBtn);

    this.splitBtnEl = splitBtn;
    this.baseBtnEl = baseBtn;
    this.showIndexBtnEl = showIndexBtn;
    this.dictVirtualFolderBtnEl = dictVFBtn;
    this.updateButtonState();
  }

  public updateButtonState() {
    if (this.splitBtnEl) {
      const isSplitEnabled = this.plugin.settings.explorerSplitEnabled;
      if (isSplitEnabled) {
        this.splitBtnEl.addClass('is-active');
        this.splitBtnEl.setAttribute('aria-label', 'Explorer Split View: Enabled (Click to Disable)');
      } else {
        this.splitBtnEl.removeClass('is-active');
        this.splitBtnEl.setAttribute('aria-label', 'Explorer Split View: Disabled (Click to Enable)');
      }
    }

    if (this.baseBtnEl) {
      const isBaseActive = this.plugin.settings.baseExplorerActive;
      if (isBaseActive) {
        this.baseBtnEl.addClass('is-active');
        this.baseBtnEl.setAttribute('aria-label', 'Base Explorer Mode: Active (Click to Disable)');
      } else {
        this.baseBtnEl.removeClass('is-active');
        this.baseBtnEl.setAttribute('aria-label', 'Base Explorer Mode: Inactive (Click to Enable)');
      }
    }

    if (this.showIndexBtnEl) {
      const isShowIndex = !!this.plugin.settings.showMergedIndexRows;
      if (isShowIndex) {
        this.showIndexBtnEl.addClass('is-active');
        this.showIndexBtnEl.setAttribute('aria-label', 'Index & Base Rows: Shown (Click to Hide index.md & index.base rows)');
      } else {
        this.showIndexBtnEl.removeClass('is-active');
        this.showIndexBtnEl.setAttribute('aria-label', 'Index & Base Rows: Hidden (Click to Show index.md & index.base rows)');
      }
    }

    if (this.dictVirtualFolderBtnEl) {
      const isVFEnabled = (this.plugin.settings.enableDictionaryVirtualFolders !== false) ||
                          (this.plugin.settings.explorerRelationshipVirtualFolders !== false);
      if (isVFEnabled) {
        this.dictVirtualFolderBtnEl.addClass('is-active');
        this.dictVirtualFolderBtnEl.setAttribute('aria-label', 'Virtual Folders in Explorer: Enabled (Click to Disable)');
      } else {
        this.dictVirtualFolderBtnEl.removeClass('is-active');
        this.dictVirtualFolderBtnEl.setAttribute('aria-label', 'Virtual Folders in Explorer: Disabled (Click to Enable)');
      }
    }
  }

  public applyLayout(customContainer?: HTMLElement) {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const containerEl = customContainer || ((leaves[0].view as any)?.containerEl as HTMLElement);
    if (!containerEl) return;

    const isEnabled = this.plugin.settings.explorerSplitEnabled;
    const navHeader = containerEl.querySelector('.nav-header') as HTMLElement;
    const navFiles = containerEl.querySelector('.nav-files-container') as HTMLElement;

    if (!isEnabled) {
      // Revert to original explorer layout
      containerEl.removeClass('pakcli-explorer-split-active');
      if (this.recentPaneEl) {
        this.recentPaneEl.style.display = 'none';
      }
      if (navHeader) {
        navHeader.style.removeProperty('order');
      }
      if (navFiles) {
        navFiles.style.removeProperty('order');
        navFiles.style.removeProperty('flex');
        navFiles.style.removeProperty('overflow');
      }
      this.updateButtonState();
      return;
    }

    // Split mode is enabled
    containerEl.addClass('pakcli-explorer-split-active');
    this.updateButtonState();

    // Ensure recent pane element exists
    if (!this.recentPaneEl || !containerEl.contains(this.recentPaneEl)) {
      this.createRecentPane(containerEl);
    }

    if (this.recentPaneEl) {
      this.recentPaneEl.style.display = 'flex';
      const initialHeight = this.plugin.settings.explorerSplitHeight || 180;
      this.recentPaneEl.style.height = `${initialHeight}px`;
    }

    // Configure Section Ordering based on explorerSectionOrder
    const order = this.plugin.settings.explorerSectionOrder || [
      'header-control',
      'recent',
      'explorer-original',
    ];

    const headerOrder = order.indexOf('header-control');
    const recentOrder = order.indexOf('recent');
    const originalOrder = order.indexOf('explorer-original');

    if (navHeader) {
      navHeader.style.order = String(headerOrder !== -1 ? headerOrder : 0);
    }
    if (this.recentPaneEl) {
      this.recentPaneEl.style.order = String(recentOrder !== -1 ? recentOrder : 1);
    }
    if (navFiles) {
      navFiles.style.order = String(originalOrder !== -1 ? originalOrder : 2);
      navFiles.style.flex = '1 1 0';
      navFiles.style.overflowY = 'auto';
    }

    this.renderRecentList();
  }

  private createRecentPane(containerEl: HTMLElement) {
    if (this.recentPaneEl) {
      this.recentPaneEl.remove();
      this.recentPaneEl = null;
    }

    const pane = document.createElement('div');
    pane.className = 'pakcli-explorer-recent-pane';

    // Header bar
    const headerEl = document.createElement('div');
    headerEl.className = 'pakcli-recent-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'pakcli-recent-title-wrap';

    const iconEl = document.createElement('span');
    iconEl.className = 'pakcli-recent-icon';
    setIcon(iconEl, 'clock');

    const titleText = document.createElement('span');
    titleText.className = 'pakcli-recent-title-text';
    titleText.textContent = 'Recent';

    const countBadge = document.createElement('span');
    countBadge.className = 'pakcli-recent-count-badge';
    countBadge.textContent = '0';

    titleWrap.appendChild(iconEl);
    titleWrap.appendChild(titleText);
    titleWrap.appendChild(countBadge);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'pakcli-recent-actions';

    // Time filter & folder filter dropdown
    const filterSelect = document.createElement('select');
    filterSelect.className = 'dropdown pakcli-recent-time-select';
    filterSelect.setAttribute('aria-label', 'Filter recent files by timeframe or folder');
    this.populateFilterDropdown(filterSelect);

    filterSelect.addEventListener('change', async (e) => {
      e.stopPropagation();
      const val = filterSelect.value;
      if (val.startsWith('folder:')) {
        this.plugin.settings.activeRecentFolderFilter = val.replace('folder:', '');
      } else {
        this.plugin.settings.activeRecentFolderFilter = '';
        this.plugin.settings.explorerRecentTimeFilter = val as RecentTimeFilter;
      }
      await this.plugin.saveSettings();
      this.renderRecentList();
    });

    const csvBtn = document.createElement('div');
    csvBtn.className = 'clickable-icon pakcli-recent-csv-btn';
    csvBtn.setAttribute('aria-label', 'Open Recents as CSV Table (path, time last open, date last open)');
    setIcon(csvBtn, 'file-spreadsheet');
    csvBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const file = await this.saveRecentsCsvArtifact();
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        new Notice('Opened Recents CSV artifact');
      } else {
        new Notice('Unable to open Recents CSV artifact');
      }
    });

    const clearBtn = document.createElement('div');
    clearBtn.className = 'clickable-icon pakcli-recent-clear-btn';
    clearBtn.setAttribute('aria-label', 'Clear recent files list');
    setIcon(clearBtn, 'trash-2');
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.recentFilesList = [];
      this.openTimes.clear();
      this.plugin.settings.activeRecentFolderFilter = '';
      await this.plugin.saveSettings();
      this.updateDropdownOptions();
      this.renderRecentList();
      await this.saveRecentsCsvArtifact();
      new Notice('Recent files list cleared.');
    });

    actionsEl.appendChild(filterSelect);
    actionsEl.appendChild(csvBtn);
    actionsEl.appendChild(clearBtn);

    headerEl.appendChild(titleWrap);
    headerEl.appendChild(actionsEl);
    pane.appendChild(headerEl);

    // List container
    const listEl = document.createElement('div');
    listEl.className = 'pakcli-recent-list nav-files-container';
    pane.appendChild(listEl);

    // Drag & Drop listener on pane
    this.initDragAndDrop(pane);

    // Splitter Bar (for drag-resizing height)
    const splitter = document.createElement('div');
    splitter.className = 'pakcli-explorer-splitter';
    const grip = document.createElement('div');
    grip.className = 'pakcli-splitter-grip';
    splitter.appendChild(grip);

    this.initSplitterDrag(splitter, pane);
    pane.appendChild(splitter);

    containerEl.appendChild(pane);
    this.recentPaneEl = pane;
    this.splitterEl = splitter;
  }

  public populateFilterDropdown(filterSelect: HTMLSelectElement) {
    filterSelect.empty();

    // Timeframe options group
    const timeGroup = filterSelect.createEl('optgroup', { label: 'Timeframe' });
    for (const opt of RECENT_TIME_FILTER_OPTIONS) {
      timeGroup.createEl('option', { value: opt.id, text: opt.label });
    }

    // Folder Filters group
    const folderGroup = filterSelect.createEl('optgroup', { label: 'Folder Filters' });
    folderGroup.createEl('option', { value: 'folder:', text: 'All Folders' });

    const customPaths = this.plugin.settings.customRecentPaths || [];
    for (const p of customPaths) {
      folderGroup.createEl('option', { value: `folder:${p}`, text: `📁 ${p}` });
    }

    const activeFolder = this.plugin.settings.activeRecentFolderFilter;
    if (activeFolder) {
      filterSelect.value = `folder:${activeFolder}`;
    } else {
      filterSelect.value = this.plugin.settings.explorerRecentTimeFilter || 'all';
    }
  }

  public updateDropdownOptions() {
    if (!this.recentPaneEl) return;
    const select = this.recentPaneEl.querySelector('.pakcli-recent-time-select') as HTMLSelectElement;
    if (select) {
      this.populateFilterDropdown(select);
    }
  }

  public async addFolderToRecentFilter(folderPath: string, activate: boolean = false) {
    const set = new Set(this.plugin.settings.customRecentPaths || []);
    set.add(folderPath);
    this.plugin.settings.customRecentPaths = Array.from(set);

    if (activate) {
      this.plugin.settings.activeRecentFolderFilter = folderPath;
    }

    await this.plugin.saveSettings();
    this.updateDropdownOptions();
    this.renderRecentList();
    new Notice(`Folder "${folderPath}" added to recent filter dropdown${activate ? ' and activated' : ''}.`);
  }

  public async removeFolderFromRecentFilter(folderPath: string) {
    this.plugin.settings.customRecentPaths = (this.plugin.settings.customRecentPaths || []).filter((p) => p !== folderPath);
    if (this.plugin.settings.activeRecentFolderFilter === folderPath) {
      this.plugin.settings.activeRecentFolderFilter = '';
    }
    await this.plugin.saveSettings();
    this.updateDropdownOptions();
    this.renderRecentList();
    new Notice(`Removed "${folderPath}" from recent filter dropdown.`);
  }

  private initDragAndDrop(paneEl: HTMLElement) {
    paneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      paneEl.addClass('is-drag-over');
    });

    paneEl.addEventListener('dragleave', () => {
      paneEl.removeClass('is-drag-over');
    });

    paneEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      paneEl.removeClass('is-drag-over');

      const rawPath = e.dataTransfer?.getData('text/plain');
      if (!rawPath) return;

      const abstract = this.app.vault.getAbstractFileByPath(rawPath);
      if (abstract instanceof TFile) {
        this.addRecentFile(abstract);
        new Notice(`Added "${abstract.name}" to Recents`);
      } else if (abstract instanceof TFolder) {
        await this.addFolderToRecentFilter(abstract.path, true);
      }
    });
  }

  private initSplitterDrag(splitter: HTMLElement, pane: HTMLElement) {
    splitter.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      this.isDragging = true;
      splitter.addClass('is-dragging');
      document.body.addClass('pakcli-resizing-y');

      const startY = e.clientY;
      const startHeight = pane.getBoundingClientRect().height;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!this.isDragging) return;
        const delta = moveEvent.clientY - startY;
        const newHeight = Math.max(70, Math.min(600, Math.round(startHeight + delta)));
        pane.style.height = `${newHeight}px`;
      };

      const onPointerUp = async () => {
        if (!this.isDragging) return;
        this.isDragging = false;
        splitter.removeClass('is-dragging');
        document.body.removeClass('pakcli-resizing-y');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);

        const finalHeight = Math.max(70, Math.min(600, Math.round(pane.getBoundingClientRect().height)));
        this.plugin.settings.explorerSplitHeight = finalHeight;
        await this.plugin.saveSettings();
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  }

  private getFilesForTimeFilter(filterId: RecentTimeFilter): TFile[] {
    const folderFilter = this.plugin.settings.activeRecentFolderFilter || '';
    let list = [...this.recentFilesList];

    if (filterId !== 'all') {
      const now = Date.now();
      const opt = RECENT_TIME_FILTER_OPTIONS.find((o) => o.id === filterId) || RECENT_TIME_FILTER_OPTIONS[0];
      let cutoff = 0;
      if (opt.id === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        cutoff = today.getTime();
      } else if (typeof opt.durationMs === 'number') {
        cutoff = now - opt.durationMs;
      }

      const allVaultFiles = this.app.vault.getFiles();
      list = allVaultFiles.filter((f) => {
        if (!(f instanceof TFile)) return false;
        if (this.isArtifactFile(f.path)) return false;
        const fileTime = Math.max(f.stat.mtime || 0, this.openTimes.get(f.path) || 0);
        return fileTime >= cutoff;
      });

      list.sort((a, b) => {
        const tA = Math.max(a.stat.mtime || 0, this.openTimes.get(a.path) || 0);
        const tB = Math.max(b.stat.mtime || 0, this.openTimes.get(b.path) || 0);
        return tB - tA;
      });
    }

    // Apply active folder filter if set
    if (folderFilter) {
      const normalizedFolder = folderFilter.trim().replace(/\/+$/, '');
      list = list.filter((f) => f.path.startsWith(`${normalizedFolder}/`) || f.path === normalizedFolder);
    }

    const maxFiles = this.plugin.settings.explorerMaxRecentFiles || 20;
    return list.slice(0, maxFiles);
  }

  public renderRecentList() {
    if (!this.recentPaneEl) return;
    const listEl = this.recentPaneEl.querySelector('.pakcli-recent-list') as HTMLElement;
    const countBadge = this.recentPaneEl.querySelector('.pakcli-recent-count-badge') as HTMLElement;
    if (!listEl) return;

    listEl.empty();

    const currentFilter = this.plugin.settings.explorerRecentTimeFilter || 'all';
    const filesToDisplay = this.getFilesForTimeFilter(currentFilter);

    if (countBadge) {
      countBadge.textContent = String(filesToDisplay.length);
    }

    if (filesToDisplay.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'pakcli-recent-empty-state';
      emptyEl.textContent = currentFilter === 'all' && !this.plugin.settings.activeRecentFolderFilter
        ? 'No recent files opened'
        : 'No files in this timeframe/folder';
      listEl.appendChild(emptyEl);
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();

    for (const file of filesToDisplay) {
      const itemEl = document.createElement('div');
      itemEl.className = 'tree-item nav-file pakcli-recent-item';
      if (activeFile && activeFile.path === file.path) {
        itemEl.addClass('is-active');
      }

      const itemSelf = document.createElement('div');
      itemSelf.className = 'tree-item-self is-clickable nav-file-title';

      // Title container
      const titleContainer = document.createElement('div');
      titleContainer.className = 'tree-item-inner nav-file-title-content pakcli-recent-title-container';

      const formatted = this.formatFileTitle(file);

      if (formatted.isIndexFolder) {
        const folderSpan = document.createElement('span');
        folderSpan.className = 'pakcli-recent-folder-prefix';
        folderSpan.textContent = formatted.folderPrefix ? `${formatted.folderPrefix}/` : '';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'pakcli-recent-file-name is-index-file';
        nameSpan.textContent = formatted.fileName;

        titleContainer.appendChild(folderSpan);
        titleContainer.appendChild(nameSpan);
      } else {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'pakcli-recent-file-name';
        nameSpan.textContent = formatted.fileName;
        titleContainer.appendChild(nameSpan);

        if (formatted.folderPrefix) {
          const subSpan = document.createElement('span');
          subSpan.className = 'pakcli-recent-subfolder-hint';
          subSpan.textContent = ` (${formatted.folderPrefix})`;
          titleContainer.appendChild(subSpan);
        }
      }

      itemSelf.appendChild(titleContainer);

      // Remove single item button on hover
      const removeBtn = document.createElement('div');
      removeBtn.className = 'pakcli-recent-item-remove';
      removeBtn.setAttribute('aria-label', 'Remove from recent files');
      setIcon(removeBtn, 'x');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.recentFilesList = this.recentFilesList.filter((f) => f.path !== file.path);
        this.renderRecentList();
        this.scheduleSaveRecentsCsv();
      });
      itemSelf.appendChild(removeBtn);

      // Tooltip with full path
      itemSelf.setAttribute('aria-label', file.path);

      // Click to open file or toggle multi-selection
      itemSelf.addEventListener('click', async (e: MouseEvent) => {
        const isMulti = e.ctrlKey || e.metaKey || e.altKey;
        if (isMulti) {
          e.preventDefault();
          e.stopPropagation();
          itemSelf.toggleClass('is-selected', !itemSelf.hasClass('is-selected'));
          return;
        }

        if (e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          const allItems = Array.from(listEl.querySelectorAll('.pakcli-recent-item .tree-item-self')) as HTMLElement[];
          const lastIdx = allItems.findIndex(el => el.hasClass('is-selected'));
          const curIdx = allItems.indexOf(itemSelf);
          if (lastIdx !== -1 && curIdx !== -1) {
            const start = Math.min(lastIdx, curIdx);
            const end = Math.max(lastIdx, curIdx);
            for (let i = start; i <= end; i++) {
              allItems[i].addClass('is-selected');
            }
          } else {
            itemSelf.addClass('is-selected');
          }
          return;
        }

        // Normal click: clear recent selection and open file
        Array.from(listEl.querySelectorAll('.pakcli-recent-item .tree-item-self.is-selected')).forEach(el => el.removeClass('is-selected'));
        e.preventDefault();
        const modKey = Keymap.isModEvent(e);
        const leaf = this.app.workspace.getLeaf(modKey);
        await leaf.openFile(file);
        this.renderRecentList();
      });

      // Context menu
      itemSelf.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        const selectedEls = Array.from(listEl.querySelectorAll('.pakcli-recent-item .tree-item-self.is-selected')) as HTMLElement[];
        const isThisSelected = itemSelf.hasClass('is-selected');

        if (isThisSelected && selectedEls.length > 1) {
          // Multi-file context menu
          const selectedFiles = selectedEls.map(el => {
            const p = el.getAttribute('aria-label');
            return p ? this.app.vault.getAbstractFileByPath(p) : null;
          }).filter((f): f is TFile => f instanceof TFile);

          const menu = new Menu();
          this.app.workspace.trigger('files-menu', menu, selectedFiles, 'file-explorer');
          menu.addItem((item) => {
            item.setTitle(`Remove ${selectedFiles.length} files from Recent Files`)
              .setIcon('x')
              .onClick(() => {
                const pathsToRemove = new Set(selectedFiles.map(f => f.path));
                this.recentFilesList = this.recentFilesList.filter(f => !pathsToRemove.has(f.path));
                this.renderRecentList();
                this.scheduleSaveRecentsCsv();
              });
          });
          menu.showAtMouseEvent(e);
          return;
        }

        // Single file context menu
        const menu = new Menu();
        this.app.workspace.trigger('file-menu', menu, file, 'file-explorer');
        menu.addItem((item) => {
          item.setTitle('Remove from Recent Files')
            .setIcon('x')
            .onClick(() => {
              this.recentFilesList = this.recentFilesList.filter((f) => f.path !== file.path);
              this.renderRecentList();
              this.scheduleSaveRecentsCsv();
            });
        });
        menu.showAtMouseEvent(e);
      });

      itemEl.appendChild(itemSelf);
      listEl.appendChild(itemEl);
    }
  }

  private formatFileTitle(file: TFile): {
    fileName: string;
    folderPrefix: string;
    isIndexFolder: boolean;
  } {
    const isIndex = file.name.toLowerCase() === 'index.md';
    const parentFolder = file.parent && file.parent.path && file.parent.path !== '/' ? file.parent.name : '';

    if (isIndex && parentFolder) {
      return {
        fileName: 'index.md',
        folderPrefix: parentFolder,
        isIndexFolder: true,
      };
    }

    return {
      fileName: file.name,
      folderPrefix: parentFolder,
      isIndexFolder: false,
    };
  }

  public isBaseFile(filePath: string): boolean {
    if (!filePath) return false;
    const normalized = filePath.replace(/\\/g, '/');
    const fileName = normalized.split('/').pop()?.toLowerCase().trim() || '';
    if (!fileName) return false;

    // Direct exact or variant matches:
    // thebase.base, *.base, thebase.md, thebase.json, *.base.md, *.base.json, etc.
    return (
      fileName === 'thebase.base' ||
      fileName.startsWith('thebase.') ||
      fileName.endsWith('.base') ||
      fileName.endsWith('.base.json') ||
      fileName.endsWith('.base.md') ||
      fileName.endsWith('.base.yaml') ||
      fileName.endsWith('.base.canvas') ||
      fileName.includes('.base.') ||
      fileName === 'index.md'
    );
  }

  private updateExplorerObserver(containerEl: HTMLElement) {
    if (this.baseExplorerObserver) {
      this.baseExplorerObserver.disconnect();
      this.baseExplorerObserver = null;
    }

    const isActive = !!this.plugin.settings.baseExplorerActive;
    const isMergeEnabled = this.plugin.settings.enableMergeFolderIndex !== false;
    const isCaptainColorEnabled = this.plugin.settings.enableCaptainFolderExplorerColor !== false;
    if (!isActive && !isMergeEnabled && !isCaptainColorEnabled) return;

    const targetEl = containerEl.querySelector('.nav-files-container:not(.pakcli-recent-list)') || containerEl;
    if (!targetEl) return;

    this.baseExplorerObserver = new MutationObserver((mutations) => {
      let shouldReapply = false;
      for (const m of mutations) {
        const t = m.target as HTMLElement;
        if (t && (t.classList?.contains('pakcli-virtual-folder') || t.closest?.('.pakcli-virtual-folder'))) continue;

        if (m.addedNodes.length > 0) {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const n = m.addedNodes[i] as HTMLElement;
            if (n.nodeType !== Node.ELEMENT_NODE) continue;
            if (n.classList?.contains('pakcli-virtual-folder') || n.closest?.('.pakcli-virtual-folder')) continue;
            if (n.classList?.contains('pakcli-folder-index-badges')) continue;
            shouldReapply = true;
            break;
          }
        }
        if (shouldReapply) break;
      }
      if (shouldReapply) {
        // Check both: focused element AND any rename input present anywhere in the explorer DOM
        const isRenaming = () => {
          const activeEl = document.activeElement;
          if (activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.getAttribute('contenteditable') === 'true' ||
            activeEl.closest('[contenteditable="true"]') ||
            activeEl.closest('.nav-folder-title') ||
            activeEl.closest('.nav-file-title')
          )) return true;
          // Also check if any inline rename input or contenteditable exists in the DOM (may not be focused yet)
          if (targetEl.querySelector('.nav-folder-title input, .nav-file-title input, [contenteditable="true"]')) return true;
          return false;
        };

        if (isRenaming()) return;

        if (this.baseExplorerDebounce !== null) {
          cancelAnimationFrame(this.baseExplorerDebounce);
        }
        this.baseExplorerDebounce = requestAnimationFrame(() => {
          this.baseExplorerDebounce = null;
          // Re-check after frame — Obsidian may still be finishing rename DOM rebuild
          if (isRenaming()) return;
          // Extra safety: defer badge injection one more tick to let Obsidian settle
          setTimeout(() => {
            if (isRenaming()) return;
            if (this.plugin.settings.baseExplorerActive) {
              this.applyBaseExplorerFilter();
            }
            if (this.plugin.settings.enableMergeFolderIndex !== false) {
              this.refreshFolderBadges();
            }
            this.applyCaptainFolderTextColors();
          }, 50);
        });
      }
    });

    this.baseExplorerObserver.observe(targetEl, {
      childList: true,
      subtree: true,
    });
  }

  public applyBaseExplorerFilter() {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const view = leaves[0].view as any;
    if (!view) return;

    const isActive = !!this.plugin.settings.baseExplorerActive;
    const containerEl = view.containerEl as HTMLElement;

    if (containerEl) {
      if (isActive) {
        containerEl.addClass('pakcli-base-explorer-active');
      } else {
        containerEl.removeClass('pakcli-base-explorer-active');
      }
      this.updateExplorerObserver(containerEl);
    }

    const normalize = (p: string) => (p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();

    // 1. Scan vault files for base files and determine affected folder ancestry across all level ranges
    const allFiles = this.app.vault.getFiles();
    const baseFiles = allFiles.filter((f) => this.isBaseFile(f.path));
    const foldersWithBase = new Set<string>();
    const foldersWithDirectBase = new Set<string>(); // only the folder that directly owns a base file

    for (const file of baseFiles) {
      // Mark the direct parent folder
      if (file.parent) {
        const norm = normalize(file.parent.path);
        if (norm && norm !== '') foldersWithDirectBase.add(norm);
      }
      // Mark all ancestors so they stay visible
      let curr = file.parent;
      while (curr) {
        const norm = normalize(curr.path);
        if (norm && norm !== '') {
          foldersWithBase.add(norm);
        }
        curr = curr.parent;
      }
    }

    // Also scan all loaded folders across all level ranges to check getFolderIndexFiles
    const allFolders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
    for (const folder of allFolders) {
      const { baseFile } = this.getFolderIndexFiles(folder);
      if (baseFile) {
        const norm = normalize(folder.path);
        if (norm && norm !== '') foldersWithDirectBase.add(norm);
        let curr: TFolder | null = folder;
        while (curr) {
          const normA = normalize(curr.path);
          if (normA && normA !== '') {
            foldersWithBase.add(normA);
          }
          curr = curr.parent;
        }
      }
    }

    // Approach 1: Use Obsidian native view.fileItems if available
    if (view.fileItems && typeof view.fileItems === 'object') {
      const fileItemsMap = view.fileItems as Record<string, {
        el?: HTMLElement;
        file?: TAbstractFile;
        collapsed?: boolean;
        setCollapsed?: (collapsed: boolean) => Promise<void> | void;
      }>;

      for (const [path, item] of Object.entries(fileItemsMap)) {
        if (!item || !item.el) continue;
        if (item.el.closest('.pakcli-explorer-recent-pane')) continue;

        if (!isActive) {
          item.el.style.removeProperty('display');
          item.el.removeClass('pakcli-base-file');
          item.el.removeClass('pakcli-base-hidden');
          item.el.removeClass('pakcli-folder-hidden');
          // Check if merged folder file should still be hidden
          const shouldHideMerged = this.plugin.settings.enableMergeFolderIndex !== false && !this.plugin.settings.showMergedIndexRows;
          if (shouldHideMerged && item.file instanceof TFile && this.isMergedFolderFile(item.file)) {
            item.el.style.display = 'none';
            item.el.addClass('pakcli-merged-child-hidden');
          } else {
            item.el.removeClass('pakcli-merged-child-hidden');
          }
          continue;
        }

        // When isActive is true:
        if (item.file instanceof TFile) {
          const isMerged = this.isMergedFolderFile(item.file);
          const shouldHideMerged = this.plugin.settings.enableMergeFolderIndex !== false && !this.plugin.settings.showMergedIndexRows;
          if (shouldHideMerged && isMerged) {
            item.el.style.display = 'none';
            item.el.addClass('pakcli-merged-child-hidden');
            continue;
          }
          const isBase = this.isBaseFile(item.file.path || path);
          if (isBase || (this.plugin.settings.showMergedIndexRows && isMerged)) {
            item.el.style.removeProperty('display');
            item.el.addClass('pakcli-base-file');
            item.el.removeClass('pakcli-base-hidden');
            item.el.removeClass('pakcli-merged-child-hidden');
          } else {
            item.el.style.display = 'none';
            item.el.removeClass('pakcli-base-file');
            item.el.addClass('pakcli-base-hidden');
          }
        } else if (item.file instanceof TFolder) {
          const norm = normalize(item.file.path || path);
          const hasDirectBase = foldersWithDirectBase.has(norm);
          const isAncestorOfBase = foldersWithBase.has(norm);
          const showBaseless = this.plugin.settings.showBaselessFolderBadge === true;

          if (!showBaseless && !hasDirectBase && !isAncestorOfBase) {
            // Hide: folder has no base file and no descendant with base file
            item.el.style.display = 'none';
            item.el.addClass('pakcli-folder-hidden');
          } else if (!showBaseless && !hasDirectBase && isAncestorOfBase) {
            // Show ancestor folders so user can navigate to base-file subfolder
            item.el.style.removeProperty('display');
            item.el.removeClass('pakcli-folder-hidden');
          } else {
            // showBaseless=true OR has direct base → always visible
            item.el.style.removeProperty('display');
            item.el.removeClass('pakcli-folder-hidden');
          }
          // NOTE: Do NOT call setCollapsed() here — it fights user expand clicks
        }
      }

      if (this.plugin.settings.enableMergeFolderIndex !== false) {
        this.refreshFolderBadges(containerEl);
      }
      return;
    }

    // Approach 2: DOM fallback query selector
    if (!containerEl) return;
    const originalTreeContainer = containerEl.querySelector('.nav-files-container:not(.pakcli-recent-list)') || containerEl;

    const fileElements = originalTreeContainer.querySelectorAll('.nav-file');
    fileElements.forEach((fileEl) => {
      if (fileEl.closest('.pakcli-explorer-recent-pane')) return;
      const titleEl = fileEl.querySelector('.nav-file-title') as HTMLElement;
      const path = normalize(titleEl?.getAttribute('data-path') || fileEl.getAttribute('data-path') || titleEl?.textContent || '');

      const abstract = this.app.vault.getAbstractFileByPath(path);
      const isMerged = abstract instanceof TFile && this.isMergedFolderFile(abstract);
      const shouldHideMerged = this.plugin.settings.enableMergeFolderIndex !== false && !this.plugin.settings.showMergedIndexRows;

      if (shouldHideMerged && isMerged) {
        (fileEl as HTMLElement).style.display = 'none';
        fileEl.addClass('pakcli-merged-child-hidden');
        return;
      }
      fileEl.removeClass('pakcli-merged-child-hidden');

      if (!isActive) {
        (fileEl as HTMLElement).style.removeProperty('display');
        fileEl.removeClass('pakcli-base-file');
        fileEl.removeClass('pakcli-base-hidden');
      } else {
        if (this.isBaseFile(path) || (this.plugin.settings.showMergedIndexRows && isMerged)) {
          (fileEl as HTMLElement).style.removeProperty('display');
          fileEl.addClass('pakcli-base-file');
          fileEl.removeClass('pakcli-base-hidden');
        } else {
          (fileEl as HTMLElement).style.display = 'none';
          fileEl.removeClass('pakcli-base-file');
          fileEl.addClass('pakcli-base-hidden');
        }
      }
    });

    const folderElements = originalTreeContainer.querySelectorAll('.nav-folder');
    folderElements.forEach((folderEl) => {
      if (folderEl.closest('.pakcli-explorer-recent-pane')) return;
      if (folderEl.classList.contains('mod-root')) return;
      if (folderEl.classList.contains('pakcli-virtual-folder') || folderEl.closest('.pakcli-virtual-folder')) return;

      const titleEl = folderEl.querySelector('.nav-folder-title') as HTMLElement;
      const path = normalize(titleEl?.getAttribute('data-path') || folderEl.getAttribute('data-path') || '');

      if (!isActive) {
        (folderEl as HTMLElement).style.removeProperty('display');
        folderEl.removeClass('pakcli-folder-hidden');
        return;
      }

      const hasDirectBase = foldersWithDirectBase.has(path);
      const isAncestorOfBase = foldersWithBase.has(path);
      const showBaseless = this.plugin.settings.showBaselessFolderBadge === true;

      if (!showBaseless && !hasDirectBase && !isAncestorOfBase) {
        (folderEl as HTMLElement).style.display = 'none';
        folderEl.addClass('pakcli-folder-hidden');
      } else {
        (folderEl as HTMLElement).style.removeProperty('display');
        folderEl.removeClass('pakcli-folder-hidden');
      }
      // NOTE: Do NOT manipulate is-collapsed here — it fights user expand clicks
    });

    if (this.plugin.settings.enableMergeFolderIndex !== false) {
      this.refreshFolderBadges(containerEl);
    }
  }

  public getFolderIndexFiles(folder: TFolder): { indexMd: TFile | null; baseFile: TFile | null } {
    let indexMd: TFile | null = null;
    let baseFile: TFile | null = null;

    if (!folder || !Array.isArray(folder.children)) {
      return { indexMd: null, baseFile: null };
    }

    for (const child of folder.children) {
      if (child instanceof TFile) {
        const lower = child.name.toLowerCase();
        if (lower === 'index.md') {
          indexMd = child;
        } else if (
          lower === 'index.base' ||
          lower === 'thebase.base' ||
          lower === `${folder.name.toLowerCase()}.base` ||
          this.isBaseFile(child.path)
        ) {
          if (!baseFile) {
            baseFile = child;
          } else if (lower === 'index.base') {
            baseFile = child;
          } else if (lower === 'thebase.base' && baseFile.name.toLowerCase() !== 'index.base') {
            baseFile = child;
          }
        }
      }
    }
    return { indexMd, baseFile };
  }

  public isMergedFolderFile(file: TFile): boolean {
    if (!file || !(file instanceof TFile)) return false;
    if (!file.parent || !file.parent.path || file.parent.path === '/') return false;

    const lower = file.name.toLowerCase();
    if (lower === 'index.md') return true;
    if (lower === 'index.base' || lower === 'thebase.base') return true;
    if (lower === `${file.parent.name.toLowerCase()}.base`) return true;
    return false;
  }

  public async handleIndexBadgeClick(folder: TFolder, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const isMod = Keymap.isModEvent(e);
    const { indexMd } = this.getFolderIndexFiles(folder);

    if (indexMd) {
      const leaf = this.app.workspace.getLeaf(isMod);
      await leaf.openFile(indexMd);
      return;
    }

    // index.md doesn't exist yet: create with template and open
    const folderPath = folder.path === '/' ? '' : folder.path;
    const indexPath = `${folderPath}/index.md`.replace(/^\/+/, '');
    const prefix = this.plugin.settings.folderIndexPrefix || '';
    const suffix = this.plugin.settings.folderIndexSuffix || '';
    const useTs = this.plugin.settings.folderIndexUseTimestamp === true;
    const tsPrefix = useTs ? this.getTimestampPrefix() : '';

    const title = `${tsPrefix}${prefix}${folder.name}${suffix}`;
    const content = this.getFolderIndexContent(title);

    try {
      const created = await this.app.vault.create(indexPath, content);
      const leaf = this.app.workspace.getLeaf(isMod);
      await leaf.openFile(created);
      new Notice(`Created & opened index: ${created.name}`);
      this.refreshFolderBadges();
      this.applyBaseExplorerFilter();
    } catch (err) {
      console.error('[PakCLI] Failed to create index.md:', err);
      new Notice(`Failed to create index.md: ${String(err)}`);
    }
  }

  public async handleBaseBadgeClick(folder: TFolder, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const isMod = Keymap.isModEvent(e);
    const { baseFile } = this.getFolderIndexFiles(folder);

    if (baseFile) {
      const leaf = this.app.workspace.getLeaf(isMod);
      await leaf.openFile(baseFile);
      return;
    }

    // Base file doesn't exist yet: create index.base and open
    const folderPath = folder.path === '/' ? '' : folder.path;
    const basePath = `${folderPath}/index.base`.replace(/^\/+/, '');

    const useDefaultFilter = this.plugin.settings.enableBaseDefaultFilter !== false;
    const rawFormula = (this.plugin.settings.baseDefaultFilterFormula || 'file.folder == this.file.folder && !file.name.contains("index")').trim();

    // In YAML, if formula starts with special chars like ! or @, quote it so YAML parser doesn't throw a tag error
    const formattedFormula = (rawFormula.startsWith('!') || rawFormula.startsWith('&') || rawFormula.startsWith('*') || rawFormula.startsWith('@') || rawFormula.startsWith('`'))
      ? `'${rawFormula.replace(/'/g, "''")}'`
      : rawFormula;

    let initialContent: string;
    if (useDefaultFilter && formattedFormula) {
      initialContent = `filters: ${formattedFormula}
views:
  - type: table
    name: Table
  - type: list
    name: List
`;
    } else {
      initialContent = `views:
  - type: table
    name: Table
  - type: list
    name: List
`;
    }

    try {
      const created = await this.app.vault.create(basePath, initialContent);
      const leaf = this.app.workspace.getLeaf(isMod);
      await leaf.openFile(created);
      new Notice(`Created & opened base file: ${created.name}`);
      this.refreshFolderBadges();
      this.applyBaseExplorerFilter();
    } catch (err) {
      console.error('[PakCLI] Failed to create index.base:', err);
      new Notice(`Failed to create index.base: ${String(err)}`);
    }
  }

  public removeFolderBadges(customContainer?: HTMLElement) {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const container = customContainer || ((leaves[0].view as any)?.containerEl as HTMLElement);
    if (!container) return;

    container.removeClass('pakcli-merge-index-active');
    container.removeClass('pakcli-affect-count-badge');
    const badges = container.querySelectorAll('.pakcli-folder-index-badges');
    badges.forEach((b) => b.remove());

    const titles = container.querySelectorAll('.nav-folder-title');
    titles.forEach((t) => {
      t.removeClass('pakcli-title-badge-left');
      t.removeClass('pakcli-title-badge-right-inline');
      t.removeClass('pakcli-title-badge-right-align');
      t.removeClass('pakcli-affect-count-badge');
    });

    const hiddenChildren = container.querySelectorAll('.pakcli-merged-child-hidden');
    hiddenChildren.forEach((el) => {
      el.removeClass('pakcli-merged-child-hidden');
      if (!this.plugin.settings.baseExplorerActive) {
        (el as HTMLElement).style.removeProperty('display');
      }
    });
  }

  public refreshFolderBadges(customContainer?: HTMLElement) {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const view = leaves[0].view as any;
    if (!view || !view.containerEl) return;
    const containerEl = customContainer || (view.containerEl as HTMLElement);
    if (!containerEl) return;

    const isEnabled = this.plugin.settings.enableMergeFolderIndex !== false;

    if (!isEnabled) {
      this.removeFolderBadges(containerEl);
      return;
    }

    const affectCount = this.plugin.settings.affectExternalCountBadge === true;
    containerEl.addClass('pakcli-merge-index-active');
    if (affectCount) {
      containerEl.addClass('pakcli-affect-count-badge');
    } else {
      containerEl.removeClass('pakcli-affect-count-badge');
    }

    // 1. Inject or update badges on all folder title rows
    const folderTitleElements = containerEl.querySelectorAll('.nav-folder-title, .tree-item-self.nav-folder-title');
    folderTitleElements.forEach((titleEl) => {
      if (titleEl.closest('.pakcli-explorer-recent-pane')) return;
      if (titleEl.closest('.mod-root:not(.nav-folder)')) return;
      if (titleEl.closest('.pakcli-virtual-folder')) return;

      // Skip this specific folder row if user is currently renaming it
      if (titleEl.querySelector('input, [contenteditable="true"]') || titleEl.getAttribute('contenteditable') === 'true') {
        return;
      }

      if (affectCount) {
        titleEl.addClass('pakcli-affect-count-badge');
      } else {
        titleEl.removeClass('pakcli-affect-count-badge');
      }

      const path = titleEl.getAttribute('data-path') || titleEl.closest('.nav-folder')?.getAttribute('data-path') || '';
      if (!path || path === '/') return;

      const abstract = this.app.vault.getAbstractFileByPath(path);
      if (!(abstract instanceof TFolder)) return;

      const folder = abstract;
      const { indexMd, baseFile } = this.getFolderIndexFiles(folder);

      const contentEl = (titleEl.querySelector('.nav-folder-title-content, .tree-item-inner') as HTMLElement) || titleEl;

      // CRITICAL: Ensure contentEl NEVER contains badges!
      // This guarantees contentEl.textContent only ever contains the pure folder name,
      // preventing Obsidian from appending "i" or "base" when initiating a rename.
      if (contentEl && contentEl !== titleEl) {
        contentEl.querySelectorAll('.pakcli-folder-index-badges').forEach((b) => b.remove());
      }

      const badgePosition = this.plugin.settings.folderBadgePosition ?? 'right-inline';
      const showI = this.plugin.settings.showFolderBadgeI !== false;
      const showBase = this.plugin.settings.showFolderBadgeBase !== false;

      // If hidden, remove any existing badges on titleEl and skip
      if (badgePosition === 'hidden') {
        titleEl.querySelector('.pakcli-folder-index-badges')?.remove();
        titleEl.removeClass('pakcli-title-badge-left');
        titleEl.removeClass('pakcli-title-badge-right-inline');
        titleEl.removeClass('pakcli-title-badge-right-align');
        return;
      }

      // Badges ALWAYS live directly on titleEl (flex row parent), NEVER inside contentEl!
      let badgesWrap = titleEl.querySelector(':scope > .pakcli-folder-index-badges') as HTMLElement;
      if (!badgesWrap) {
        badgesWrap = document.createElement('span');
        badgesWrap.className = 'pakcli-folder-index-badges';
        badgesWrap.contentEditable = 'false'; // prevents text insertion during contenteditable rename
        badgesWrap.addEventListener('click', (e) => e.stopPropagation());
      }

      // Apply position class for CSS targeting to both badgesWrap and titleEl
      badgesWrap.removeClass('pakcli-badge-pos-left');
      badgesWrap.removeClass('pakcli-badge-pos-right-inline');
      badgesWrap.removeClass('pakcli-badge-pos-right-align');
      badgesWrap.addClass(`pakcli-badge-pos-${badgePosition}`);

      titleEl.removeClass('pakcli-title-badge-left');
      titleEl.removeClass('pakcli-title-badge-right-inline');
      titleEl.removeClass('pakcli-title-badge-right-align');
      titleEl.addClass(`pakcli-title-badge-${badgePosition}`);

      // Place in correct position within titleEl (flex row) relative to contentEl
      if (badgePosition === 'left') {
        if (contentEl !== titleEl && titleEl.contains(contentEl)) {
          if (contentEl.previousElementSibling !== badgesWrap) {
            contentEl.insertAdjacentElement('beforebegin', badgesWrap);
          }
        } else {
          if (titleEl.firstElementChild !== badgesWrap) {
            titleEl.prepend(badgesWrap);
          }
        }
      } else if (badgePosition === 'right-inline') {
        if (contentEl !== titleEl && titleEl.contains(contentEl)) {
          if (contentEl.nextElementSibling !== badgesWrap) {
            contentEl.insertAdjacentElement('afterend', badgesWrap);
          }
        } else {
          if (!titleEl.contains(badgesWrap)) {
            titleEl.appendChild(badgesWrap);
          }
        }
      } else if (badgePosition === 'right-align') {
        if (titleEl.lastElementChild !== badgesWrap) {
          titleEl.appendChild(badgesWrap);
        }
      }

      // 1. [i] badge box (i first!)
      let badgeI = badgesWrap.querySelector('.pakcli-badge-i') as HTMLElement;
      if (!badgeI) {
        badgeI = document.createElement('span');
        badgeI.className = 'pakcli-folder-badge pakcli-badge-i';
        badgeI.setText('i');
        badgeI.contentEditable = 'false';
        badgeI.addEventListener('click', (e) => this.handleIndexBadgeClick(folder, e));
        badgeI.addEventListener('mouseover', (e: MouseEvent) => {
          if (this.plugin.settings.enableFolderIndexHoverPreview === false) return;
          const { indexMd: currentMd } = this.getFolderIndexFiles(folder);
          if (!currentMd) return;
          this.app.workspace.trigger('hover-link', {
            event: e,
            source: 'preview',
            hoverParent: this,
            targetEl: badgeI,
            linktext: currentMd.path,
            sourcePath: currentMd.path,
          });
        });
        badgeI.addEventListener('contextmenu', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const { indexMd: currentMd } = this.getFolderIndexFiles(folder);
          const menu = new Menu();
          if (currentMd) {
            menu.addItem((item) => {
              item.setTitle(`Open ${currentMd.name}`)
                .setIcon('file-text')
                .onClick(async () => {
                  const leaf = this.app.workspace.getLeaf(false);
                  await leaf.openFile(currentMd);
                });
            });
            menu.addItem((item) => {
              item.setTitle('Open in new tab')
                .setIcon('file-plus')
                .onClick(async () => {
                  const leaf = this.app.workspace.getLeaf(true);
                  await leaf.openFile(currentMd);
                });
            });
          } else {
            menu.addItem((item) => {
              item.setTitle('Create index.md')
                .setIcon('plus')
                .onClick(() => this.handleIndexBadgeClick(folder, e));
            });
          }
          menu.showAtMouseEvent(e);
        });
        badgesWrap.appendChild(badgeI);
      } else {
        badgeI.setText('i');
      }

      // 2. [base] badge box (base second!)
      let badgeBase = badgesWrap.querySelector('.pakcli-badge-base') as HTMLElement;
      if (!badgeBase) {
        badgeBase = document.createElement('span');
        badgeBase.className = 'pakcli-folder-badge pakcli-badge-base';
        badgeBase.setText('base');
        badgeBase.contentEditable = 'false';
        badgeBase.addEventListener('click', (e) => this.handleBaseBadgeClick(folder, e));
        badgeBase.addEventListener('mouseover', (e: MouseEvent) => {
          if (this.plugin.settings.enableFolderIndexHoverPreview === false) return;
          const { baseFile: currentBase } = this.getFolderIndexFiles(folder);
          if (!currentBase) return;
          this.app.workspace.trigger('hover-link', {
            event: e,
            source: 'preview',
            hoverParent: this,
            targetEl: badgeBase,
            linktext: currentBase.path,
            sourcePath: currentBase.path,
          });
        });
        badgeBase.addEventListener('contextmenu', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const { baseFile: currentBase } = this.getFolderIndexFiles(folder);
          const menu = new Menu();
          if (currentBase) {
            menu.addItem((item) => {
              item.setTitle(`Open ${currentBase.name}`)
                .setIcon('database')
                .onClick(async () => {
                  const leaf = this.app.workspace.getLeaf(false);
                  await leaf.openFile(currentBase);
                });
            });
            menu.addItem((item) => {
              item.setTitle('Open in new tab')
                .setIcon('file-plus')
                .onClick(async () => {
                  const leaf = this.app.workspace.getLeaf(true);
                  await leaf.openFile(currentBase);
                });
            });
          } else {
            menu.addItem((item) => {
              item.setTitle('Create index.base')
                .setIcon('plus')
                .onClick(() => this.handleBaseBadgeClick(folder, e));
            });
          }
          menu.showAtMouseEvent(e);
        });
        badgesWrap.appendChild(badgeBase);
      }
      this.updateBaseBadgeWidthAdaptive(titleEl, contentEl, badgeBase);

      // Ensure i is positioned before base
      if (badgeI && badgeBase && badgeI.nextSibling !== badgeBase) {
        badgesWrap.insertBefore(badgeI, badgeBase);
      }

      // Show/hide individual badges per setting
      badgeI.style.display = showI ? '' : 'none';
      badgeBase.style.display = showBase ? '' : 'none';

      const previewHint = this.plugin.settings.enableFolderIndexHoverPreview !== false ? ' (Hover to preview)' : '';

      if (baseFile) {
        badgeBase.removeClass('is-missing');
        badgeBase.addClass('has-file');
        badgeBase.setAttribute('aria-label', `Open ${baseFile.name}${previewHint} (Ctrl+click for new tab)`);
      } else {
        badgeBase.removeClass('has-file');
        badgeBase.addClass('is-missing');
        badgeBase.setAttribute('aria-label', 'Create & open index.base');
      }

      if (indexMd) {
        badgeI.removeClass('is-missing');
        badgeI.addClass('has-file');
        badgeI.setAttribute('aria-label', `Open ${indexMd.name}${previewHint} (Ctrl+click for new tab)`);
      } else {
        badgeI.removeClass('has-file');
        badgeI.addClass('is-missing');
        badgeI.setAttribute('aria-label', 'Create & open index.md');
      }
    });

    // 2. Hide merged child files from the children list (only if showMergedIndexRows is false)
    const shouldHideMerged = this.plugin.settings.enableMergeFolderIndex !== false && !this.plugin.settings.showMergedIndexRows;
    if (view.fileItems && typeof view.fileItems === 'object') {
      const fileItemsMap = view.fileItems as Record<string, { el?: HTMLElement; file?: TAbstractFile }>;
      for (const [_, item] of Object.entries(fileItemsMap)) {
        if (!item || !item.el || !(item.file instanceof TFile)) continue;
        if (item.el.closest('.pakcli-explorer-recent-pane')) continue;

        if (this.isMergedFolderFile(item.file)) {
          if (shouldHideMerged) {
            item.el.style.display = 'none';
            item.el.addClass('pakcli-merged-child-hidden');
          } else {
            item.el.style.removeProperty('display');
            item.el.removeClass('pakcli-merged-child-hidden');
          }
        }
      }
    } else {
      const fileElements = containerEl.querySelectorAll('.nav-file');
      fileElements.forEach((fileEl) => {
        if (fileEl.closest('.pakcli-explorer-recent-pane')) return;
        const titleEl = fileEl.querySelector('.nav-file-title') as HTMLElement;
        const path = titleEl?.getAttribute('data-path') || fileEl.getAttribute('data-path') || '';
        const abstract = this.app.vault.getAbstractFileByPath(path);
        if (abstract instanceof TFile && this.isMergedFolderFile(abstract)) {
          if (shouldHideMerged) {
            (fileEl as HTMLElement).style.display = 'none';
            fileEl.addClass('pakcli-merged-child-hidden');
          } else {
            (fileEl as HTMLElement).style.removeProperty('display');
            fileEl.removeClass('pakcli-merged-child-hidden');
          }
        }
      });
    }

    this.applyCaptainFolderTextColors(containerEl);

    // Adaptive check on next animation frame to catch post-reflow layout widths
    requestAnimationFrame(() => {
      this.recheckAllBaseBadges(containerEl);
    });

    // Ensure ResizeObserver is actively watching the container to adapt badges dynamically
    if (containerEl) {
      if (!this.explorerResizeObserver) {
        this.explorerResizeObserver = new ResizeObserver(() => {
          this.recheckAllBaseBadges();
        });
      }
      this.explorerResizeObserver.observe(containerEl);
    }
  }

  /**
   * Adaptive base badge width: Automatically shortens [base] to [b]
   * when the row hits the width limit before sacrificing/truncating the folder name text.
   */
  private updateBaseBadgeWidthAdaptive(
    titleEl: HTMLElement,
    contentEl: HTMLElement,
    badgeBase: HTMLElement
  ): void {
    if (!badgeBase || !contentEl || badgeBase.style.display === 'none') return;

    // Must be attached to DOM and visible with non-zero dimensions to measure accurately
    const titleRect = titleEl.getBoundingClientRect();
    if (titleRect.width === 0 || titleRect.height === 0) return;

    const badgesWrap = (badgeBase.closest('.pakcli-folder-index-badges') as HTMLElement) || badgeBase;
    const badgesRect = badgesWrap.getBoundingClientRect();
    const contentRect = contentEl.getBoundingClientRect();

    // Determine the usable inner right boundary of the folder row
    const titleStyle = window.getComputedStyle(titleEl);
    const paddingRight = parseFloat(titleStyle.paddingRight || '0') || 0;
    const borderRight = parseFloat(titleStyle.borderRightWidth || '0') || 0;
    let usableRight = titleRect.right - paddingRight - borderRight;

    // If an external flair (note count badge, etc.) sits at the right edge, account for it
    const flair = titleEl.querySelector<HTMLElement>(
      '.tree-item-flair, .tree-item-flair-outer, .nav-folder-title-extra'
    );
    if (flair && flair.style.display !== 'none' && flair.offsetParent !== null) {
      const flairRect = flair.getBoundingClientRect();
      if (flairRect.width > 0 && flairRect.left < usableRight && flairRect.left > badgesRect.left) {
        usableRight = flairRect.left - 2;
      }
    }

    // Check if folder name text is currently being truncated by CSS (scrollWidth > rendered width)
    const textDeficit = Math.max(0, contentEl.scrollWidth - Math.ceil(contentRect.width));
    const isTextTruncated = textDeficit > 1;

    // Remaining free space between the badges and the row's usable right boundary
    const freeSpace = usableRight - badgesRect.right;
    const isShortened = badgeBase.classList.contains('is-shortened');

    if (!isShortened) {
      // Currently [base] (min-width: 30px).
      // Shorten to [b] (min-width: 16px) only when it hits the limit (freeSpace <= 1px)
      // or when the folder text is already being truncated by flex compression.
      if (freeSpace <= 1 || isTextTruncated) {
        badgeBase.setText('b');
        badgeBase.addClass('is-shortened');
        badgeBase.setAttribute('title', badgeBase.getAttribute('aria-label') || 'index.base');
      }
    } else {
      // Currently [b] (min-width: 16px). The delta to [base] is 14px.
      // Only expand back to [base] if:
      // 1. Folder text is completely untruncated (textDeficit <= 1)
      // 2. There is ample free space to the right (>= 18px = 14px delta + 4px safety buffer)
      // This prevents any oscillating/flickering layout loop.
      if (!isTextTruncated && freeSpace >= 18) {
        badgeBase.setText('base');
        badgeBase.removeClass('is-shortened');
        badgeBase.removeAttribute('title');
      }
    }
  }

  public recheckAllBaseBadges(customContainer?: HTMLElement): void {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const containers: HTMLElement[] = customContainer
      ? [customContainer]
      : leaves.map((l) => (l.view as any)?.containerEl).filter(Boolean);

    for (const container of containers) {
      const folderTitleElements = container.querySelectorAll<HTMLElement>(
        '.nav-folder-title, .tree-item-self.nav-folder-title'
      );
      folderTitleElements.forEach((titleEl) => {
        const badgeBase = titleEl.querySelector<HTMLElement>('.pakcli-badge-base');
        if (!badgeBase || badgeBase.style.display === 'none') return;

        const contentEl = (titleEl.querySelector('.nav-folder-title-content, .tree-item-inner') as HTMLElement) || titleEl;
        this.updateBaseBadgeWidthAdaptive(titleEl, contentEl, badgeBase);
      });
    }
  }

  public removeCaptainFolderTextColors(customContainer?: HTMLElement) {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const containers: HTMLElement[] = customContainer
      ? [customContainer]
      : leaves.map((l) => (l.view as any)?.containerEl).filter(Boolean);

    const bgClasses = ['pakcli-row-bg-desaturated', 'pakcli-row-bg-transparent', 'pakcli-row-bg-subtle', 'pakcli-row-bg-none'];
    document.body.removeClass('pakcli-desaturate-explorer-bg', ...bgClasses);

    for (const container of containers) {
      container.removeClass('pakcli-desaturate-row-bg', ...bgClasses);
      const navFiles = container.querySelector('.nav-files-container');
      if (navFiles) {
        navFiles.removeClass('pakcli-desaturate-row-bg', ...bgClasses);
      }

      const colored = container.querySelectorAll<HTMLElement>(
        '.pakcli-captain-folder-colored, .pakcli-captain-colored-text, .pakcli-captain-colored-icon'
      );
      colored.forEach((el) => {
        el.style.removeProperty('color');
        el.style.removeProperty('-webkit-text-fill-color');
        el.style.removeProperty('--nav-item-color');
        el.style.removeProperty('--nav-item-color-hover');
        el.style.removeProperty('--nav-item-color-active');
        el.style.removeProperty('--captain-folder-color');
        el.style.removeProperty('--folder-color');
        el.style.removeProperty('--folder-icon-color');
        el.style.removeProperty('--nav-folder-icon-color');
        el.style.removeProperty('--tree-item-icon-color');
        el.style.removeProperty('--icon-color');
        el.style.removeProperty('--icon-color-hover');
        el.style.removeProperty('--icon-color-active');
        el.style.removeProperty('fill');
        el.style.removeProperty('stroke');
        el.style.removeProperty('background-color');
        el.style.removeProperty('background');
        el.removeClass('pakcli-captain-folder-colored');
        el.removeClass('pakcli-captain-colored-text');
        el.removeClass('pakcli-captain-colored-icon');
        el.querySelectorAll<SVGElement>('path, circle, rect, polygon, line, svg').forEach((s) => {
          if (s.closest('.collapse-icon, .nav-folder-collapse-indicator, [class*="collapse"], .right-triangle')) return;
          s.style.removeProperty('fill');
          s.style.removeProperty('stroke');
          s.style.removeProperty('color');
        });
      });
    }
  }

  public applyCaptainFolderTextColors(customContainer?: HTMLElement) {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;

    const containers: HTMLElement[] = customContainer
      ? [customContainer]
      : leaves.map((l) => (l.view as any)?.containerEl).filter(Boolean);

    for (const containerEl of containers) {
      this.applyCaptainFolderTextColorsToContainer(containerEl);
    }
  }

  private applyCaptainFolderTextColorsToContainer(containerEl: HTMLElement) {
    const isDesaturateEnabled = this.plugin.settings.enableDesaturateExplorerRowBg === true;
    const rowBgMode: ExplorerRowBgMode = isDesaturateEnabled
      ? (this.plugin.settings.explorerRowBgMode || 'desaturated')
      : 'none';

    // Modular multi-theme row background management
    const bgClasses = ['pakcli-row-bg-desaturated', 'pakcli-row-bg-transparent', 'pakcli-row-bg-subtle', 'pakcli-row-bg-none'];
    containerEl.removeClass('pakcli-desaturate-row-bg', ...bgClasses);
    document.body.removeClass('pakcli-desaturate-explorer-bg', ...bgClasses);

    const navFilesContainer = containerEl.querySelector('.nav-files-container');
    if (navFilesContainer) {
      navFilesContainer.removeClass('pakcli-desaturate-row-bg', ...bgClasses);
    }

    if (rowBgMode !== 'none') {
      containerEl.addClass('pakcli-desaturate-row-bg', `pakcli-row-bg-${rowBgMode}`);
      document.body.addClass('pakcli-desaturate-explorer-bg', `pakcli-row-bg-${rowBgMode}`);
      if (navFilesContainer) {
        navFilesContainer.addClass('pakcli-desaturate-row-bg', `pakcli-row-bg-${rowBgMode}`);
      }
    }

    const globalMode: CaptainFolderOverrideMode = this.plugin.settings.captainFolderExplorerOverrideMode ||
      (this.plugin.settings.enableCaptainFolderExplorerColor === false ? 'none' : 'text_icon');

    const folderTitleElements = containerEl.querySelectorAll<HTMLElement>('.nav-folder-title, .tree-item-self.nav-folder-title');

    folderTitleElements.forEach((titleEl) => {
      if (titleEl.closest('.pakcli-explorer-recent-pane')) return;
      if (titleEl.closest('.mod-root:not(.nav-folder)')) return;

      // Skip this folder row if user is currently renaming it
      if (titleEl.querySelector('input, [contenteditable="true"]') || titleEl.getAttribute('contenteditable') === 'true') {
        return;
      }

      const contentEl = (titleEl.querySelector('.nav-folder-title-content, .tree-item-inner') as HTMLElement) || titleEl;

      const cleanup = () => {
        if (contentEl && contentEl !== titleEl) {
          contentEl.style.removeProperty('color');
          contentEl.style.removeProperty('-webkit-text-fill-color');
          contentEl.removeClass('pakcli-captain-colored-text');
        }
        titleEl.style.removeProperty('color');
        titleEl.style.removeProperty('-webkit-text-fill-color');
        titleEl.style.removeProperty('--nav-item-color');
        titleEl.style.removeProperty('--nav-item-color-hover');
        titleEl.style.removeProperty('--nav-item-color-active');
        titleEl.style.removeProperty('--captain-folder-color');
        titleEl.style.removeProperty('--folder-color');
        titleEl.style.removeProperty('--folder-icon-color');
        titleEl.style.removeProperty('--nav-folder-icon-color');
        titleEl.style.removeProperty('--tree-item-icon-color');
        titleEl.style.removeProperty('--icon-color');
        titleEl.style.removeProperty('--icon-color-hover');
        titleEl.style.removeProperty('--icon-color-active');
        titleEl.style.removeProperty('background-color');
        titleEl.style.removeProperty('background');
        titleEl.style.removeProperty('--nav-item-background');
        titleEl.removeClass(
          'pakcli-captain-folder-colored',
          'pakcli-mode-text-only',
          'pakcli-mode-text-icon',
          'pakcli-mode-text-icon-badge',
          'pakcli-mode-text-icon-badge-chevron',
          'pakcli-mode-all'
        );

        const icons = titleEl.querySelectorAll<HTMLElement>('.pakcli-captain-colored-icon');
        icons.forEach((ic) => {
          ic.style.removeProperty('color');
          ic.style.removeProperty('fill');
          ic.style.removeProperty('stroke');
          ic.style.removeProperty('background-color');
          ic.style.removeProperty('-webkit-text-fill-color');
          ic.removeClass('pakcli-captain-colored-icon');
          ic.querySelectorAll<SVGElement>('path, circle, rect, polygon, line, svg').forEach((s) => {
            s.style.removeProperty('fill');
            s.style.removeProperty('stroke');
            s.style.removeProperty('color');
          });
        });

        const badges = titleEl.querySelectorAll<HTMLElement>('.pakcli-folder-index-badges .pakcli-folder-badge');
        badges.forEach((b) => {
          b.style.removeProperty('color');
          b.style.removeProperty('-webkit-text-fill-color');
          b.style.removeProperty('border-color');
          b.style.removeProperty('background-color');
          b.style.removeProperty('background');
        });

        const chevrons = titleEl.querySelectorAll<HTMLElement>('.collapse-icon, .nav-folder-collapse-indicator');
        chevrons.forEach((c) => {
          c.style.removeProperty('color');
          c.style.removeProperty('stroke');
          c.querySelectorAll<SVGElement>('svg, path, polygon').forEach((s) => {
            s.style.removeProperty('color');
            s.style.removeProperty('stroke');
          });
        });

        const flairs = titleEl.querySelectorAll<HTMLElement>('.tree-item-flair, .nav-folder-title-extra');
        flairs.forEach((f) => {
          f.style.removeProperty('color');
          f.style.removeProperty('-webkit-text-fill-color');
        });
      };

      const path = titleEl.getAttribute('data-path') ||
                   titleEl.closest('.nav-folder')?.getAttribute('data-path') ||
                   titleEl.closest('[data-path]')?.getAttribute('data-path') ||
                   '';
      if (!path || path === '/') {
        cleanup();
        return;
      }

      const matchedRule = matchFolderRule(path, this.plugin.settings.rules, this.plugin.settings.fileConfigs);
      const color = matchedRule?.color?.trim();
      const mode: CaptainFolderOverrideMode = 
        matchedRule?.explorerOverride !== undefined 
          ? matchedRule.explorerOverride 
          : (matchedRule ? globalMode : 'none');

      if (color && mode !== 'none') {
        titleEl.removeClass(
          'pakcli-mode-text-only',
          'pakcli-mode-text-icon',
          'pakcli-mode-text-icon-badge',
          'pakcli-mode-text-icon-badge-chevron',
          'pakcli-mode-all'
        );
        titleEl.addClass('pakcli-captain-folder-colored', 'pakcli-mode-' + mode.replace(/_/g, '-'));

        titleEl.style.setProperty('--captain-folder-color', color, 'important');

        // 1. Text filename: Always colored in all non-none modes
        if (contentEl) {
          contentEl.addClass('pakcli-captain-colored-text');
          contentEl.style.setProperty('color', color, 'important');
          contentEl.style.setProperty('-webkit-text-fill-color', color, 'important');
        }

        const isCollapseIndicator = (el: Element | null): boolean => {
          if (!el) return false;
          if (
            el.matches(
              '.collapse-icon, .nav-folder-collapse-indicator, [class*="collapse"], ' +
              '.right-triangle, svg.right-triangle, svg.chevron-right, svg.chevron-down, ' +
              'svg[class*="chevron"], [data-icon*="chevron"], [data-icon*="triangle"]'
            ) ||
            el.closest(
              '.collapse-icon, .nav-folder-collapse-indicator, [class*="collapse"], .right-triangle'
            ) ||
            el.querySelector(
              '.collapse-icon, .nav-folder-collapse-indicator, svg.right-triangle, svg[class*="chevron"]'
            ) !== null
          ) {
            return true;
          }
          return false;
        };

        const isProtected = (element: Element | null): boolean => {
          if (!element) return true;
          if (isCollapseIndicator(element)) return true;
          if (
            element.closest(
              '.pakcli-folder-index-badges, .tree-item-flair, .tree-item-flair-outer, .nav-folder-title-extra'
            )
          ) {
            return true;
          }
          return false;
        };

        // 2. Folder Icon: Apply ONLY if mode is 'text_icon', 'text_icon_badge', 'text_icon_badge_chevron', or 'all'
        const shouldColorIcon = (mode === 'text_icon' || mode === 'text_icon_badge' || mode === 'text_icon_badge_chevron' || mode === 'all');

        if (shouldColorIcon) {
          titleEl.style.setProperty('--folder-color', color, 'important');
          titleEl.style.setProperty('--folder-icon-color', color, 'important');
          titleEl.style.setProperty('--nav-folder-icon-color', color, 'important');
          titleEl.style.removeProperty('--tree-item-icon-color');

          const applyIconColor = (el: HTMLElement) => {
            if (isProtected(el) || isCollapseIndicator(el)) return;
            el.addClass('pakcli-captain-colored-icon');
            el.style.setProperty('color', color, 'important');
            el.style.setProperty('fill', color, 'important');
            el.style.setProperty('stroke', color, 'important');
            el.style.setProperty('-webkit-text-fill-color', color, 'important');

            const comp = window.getComputedStyle(el);
            const isSvg = el.tagName.toLowerCase() === 'svg' || el.querySelector('svg') !== null;
            const hasMask = (comp.webkitMaskImage && comp.webkitMaskImage !== 'none') ||
                            (comp.maskImage && comp.maskImage !== 'none') ||
                            el.classList.contains('obsidian-icon-folder-icon') ||
                            el.classList.contains('iconize-icon') ||
                            el.hasAttribute('data-icon');

            if (hasMask || !isSvg) {
              el.style.setProperty('background-color', color, 'important');
            }
            if (el.tagName.toLowerCase() === 'svg') {
              el.style.setProperty('fill', color, 'important');
              el.style.setProperty('stroke', color, 'important');
            }
            el.querySelectorAll<SVGElement>('path, circle, rect, polygon, line, svg').forEach((shape) => {
              if (isProtected(shape) || isCollapseIndicator(shape)) return;
              shape.style.setProperty('fill', color, 'important');
              shape.style.setProperty('stroke', color, 'important');
              shape.style.setProperty('color', color, 'important');
            });
          };

          const iconEls = titleEl.querySelectorAll<HTMLElement>(
            '.nav-folder-title-icon, .nav-folder-icon, .folder-icon, ' +
            '.obsidian-icon-folder-icon, .iconize-icon, [data-icon]:not(.collapse-icon):not([class*="collapse"])'
          );
          iconEls.forEach((iconEl) => applyIconColor(iconEl));

          for (let i = 0; i < titleEl.children.length; i++) {
            const child = titleEl.children[i] as HTMLElement;
            if (!child || isProtected(child) || isCollapseIndicator(child) || child === contentEl) {
              continue;
            }
            if (child.classList.contains('tree-item-icon') || child.classList.contains('collapse-icon')) {
              continue;
            }
            const isIcon = child.matches('.nav-folder-title-icon, .nav-folder-icon, .folder-icon, .obsidian-icon-folder-icon, .iconize-icon, [data-icon]') ||
                           (/icon|folder/i.test(child.className) && !/collapse/i.test(child.className));
            if (isIcon) {
              applyIconColor(child);
            }
          }

          if (contentEl) {
            const innerIcons = contentEl.querySelectorAll<HTMLElement>(
              '.nav-folder-title-icon, .nav-folder-icon, .folder-icon, .obsidian-icon-folder-icon, .iconize-icon, [data-icon], span[class*="icon"], div[class*="icon"]'
            );
            innerIcons.forEach((inIcon) => {
              if (!isProtected(inIcon) && !isCollapseIndicator(inIcon)) {
                applyIconColor(inIcon);
              }
            });
          }
        } else {
          // If text_only (without icon), ensure icons and icon CSS variables are strictly NOT colored
          titleEl.style.removeProperty('--folder-color');
          titleEl.style.removeProperty('--folder-icon-color');
          titleEl.style.removeProperty('--nav-folder-icon-color');
          titleEl.style.removeProperty('--tree-item-icon-color');

          const existingIcons = titleEl.querySelectorAll<HTMLElement>(
            '.pakcli-captain-colored-icon, .nav-folder-title-icon, .nav-folder-icon, .folder-icon, ' +
            '.obsidian-icon-folder-icon, .iconize-icon, [data-icon]:not(.collapse-icon):not([class*="collapse"]), ' +
            '.tree-item-icon:not(.collapse-icon)'
          );
          existingIcons.forEach((ic) => {
            ic.style.removeProperty('color');
            ic.style.removeProperty('fill');
            ic.style.removeProperty('stroke');
            ic.style.removeProperty('background-color');
            ic.style.removeProperty('-webkit-text-fill-color');
            ic.removeClass('pakcli-captain-colored-icon');
            ic.querySelectorAll<SVGElement>('path, circle, rect, polygon, line, svg').forEach((s) => {
              s.style.removeProperty('fill');
              s.style.removeProperty('stroke');
              s.style.removeProperty('color');
            });
          });

          for (let i = 0; i < titleEl.children.length; i++) {
            const child = titleEl.children[i] as HTMLElement;
            if (!child || isProtected(child) || isCollapseIndicator(child) || child === contentEl) continue;
            if (child.classList.contains('tree-item-icon') || child.classList.contains('collapse-icon')) continue;
            const isIcon = child.matches('.nav-folder-title-icon, .nav-folder-icon, .folder-icon, .obsidian-icon-folder-icon, .iconize-icon, [data-icon]') ||
                           (/icon|folder/i.test(child.className) && !/collapse/i.test(child.className));
            if (isIcon) {
              child.style.removeProperty('color');
              child.style.removeProperty('fill');
              child.style.removeProperty('stroke');
              child.style.removeProperty('background-color');
              child.style.removeProperty('-webkit-text-fill-color');
              child.removeClass('pakcli-captain-colored-icon');
              child.querySelectorAll<SVGElement>('path, circle, rect, polygon, line, svg').forEach((s) => {
                s.style.removeProperty('fill');
                s.style.removeProperty('stroke');
                s.style.removeProperty('color');
              });
            }
          }

          if (contentEl) {
            const innerIcons = contentEl.querySelectorAll<HTMLElement>(
              '.nav-folder-title-icon, .nav-folder-icon, .folder-icon, .obsidian-icon-folder-icon, .iconize-icon, [data-icon], span[class*="icon"], div[class*="icon"]'
            );
            innerIcons.forEach((inIcon) => {
              inIcon.style.removeProperty('color');
              inIcon.style.removeProperty('fill');
              inIcon.style.removeProperty('stroke');
              inIcon.style.removeProperty('background-color');
              inIcon.style.removeProperty('-webkit-text-fill-color');
              inIcon.removeClass('pakcli-captain-colored-icon');
              inIcon.querySelectorAll<SVGElement>('path, circle, rect, polygon, line, svg').forEach((s) => {
                s.style.removeProperty('fill');
                s.style.removeProperty('stroke');
                s.style.removeProperty('color');
              });
            });
          }
        }

        // 3. Badges: Apply ONLY if mode is 'text_icon_badge', 'text_icon_badge_chevron', or 'all'
        const shouldColorBadges = (mode === 'text_icon_badge' || mode === 'text_icon_badge_chevron' || mode === 'all');
        const badgeEls = titleEl.querySelectorAll<HTMLElement>('.pakcli-folder-index-badges .pakcli-folder-badge');
        badgeEls.forEach((b) => {
          if (shouldColorBadges) {
            b.style.setProperty('color', color, 'important');
            b.style.setProperty('-webkit-text-fill-color', color, 'important');
            b.style.setProperty('border-color', color, 'important');
          } else {
            b.style.removeProperty('color');
            b.style.removeProperty('-webkit-text-fill-color');
            b.style.removeProperty('border-color');
            b.style.removeProperty('background-color');
            b.style.removeProperty('background');
          }
        });

        // 4. Chevron: Apply ONLY if mode is 'text_icon_badge_chevron' or 'all'
        const shouldColorChevron = (mode === 'text_icon_badge_chevron' || mode === 'all');
        const chevronEls = titleEl.querySelectorAll<HTMLElement>('.collapse-icon, .nav-folder-collapse-indicator');
        chevronEls.forEach((c) => {
          if (shouldColorChevron) {
            c.style.setProperty('color', color, 'important');
            c.style.setProperty('stroke', color, 'important');
            c.querySelectorAll<SVGElement>('svg, path, polygon').forEach((s) => {
              s.style.setProperty('color', color, 'important');
              s.style.setProperty('stroke', color, 'important');
            });
          } else {
            c.style.removeProperty('color');
            c.style.removeProperty('stroke');
            c.querySelectorAll<SVGElement>('svg, path, polygon').forEach((s) => {
              s.style.removeProperty('color');
              s.style.removeProperty('stroke');
            });
          }
        });

        // 5. Flair: Apply ONLY if mode is 'all'
        const shouldColorFlair = (mode === 'all');
        const flairEls = titleEl.querySelectorAll<HTMLElement>('.tree-item-flair, .nav-folder-title-extra');
        flairEls.forEach((f) => {
          if (shouldColorFlair) {
            f.style.setProperty('color', color, 'important');
            f.style.setProperty('-webkit-text-fill-color', color, 'important');
          } else {
            f.style.removeProperty('color');
            f.style.removeProperty('-webkit-text-fill-color');
          }
        });

        // 6. Background: If mode is 'all', apply folder colored background; otherwise clear so neutral desaturated background applies
        if (mode === 'all') {
          titleEl.style.setProperty('background-color', `color-mix(in srgb, ${color} 15%, var(--background-primary))`, 'important');
          titleEl.style.setProperty('background', `color-mix(in srgb, ${color} 15%, var(--background-primary))`, 'important');
        } else {
          titleEl.style.removeProperty('background-color');
          titleEl.style.removeProperty('background');
        }

      } else {
        cleanup();
      }
    });
  }

  public getTimestampPrefix(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}_`;
  }

  public getSelectedFiles(fallbackFile?: TAbstractFile): TAbstractFile[] {
    const selected: TAbstractFile[] = [];
    const seen = new Set<string>();

    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (!view) continue;

      // 1. Check if view natively exposes selectedFiles (Set or Array)
      if (view.selectedFiles) {
        const nativeSel = view.selectedFiles;
        if (nativeSel instanceof Set || Array.isArray(nativeSel)) {
          for (const item of nativeSel) {
            const f = item instanceof TAbstractFile ? item : (typeof item === 'string' ? this.app.vault.getAbstractFileByPath(item) : item?.file);
            if (f && !seen.has(f.path)) {
              seen.add(f.path);
              selected.push(f);
            }
          }
        }
      }

      // 2. Check view.fileItems for elements with 'is-selected'
      if (view.fileItems && typeof view.fileItems === 'object') {
        for (const path in view.fileItems) {
          const item = view.fileItems[path];
          const isSel = item?.el?.classList?.contains('is-selected') ||
                        item?.titleEl?.classList?.contains('is-selected') ||
                        item?.selfEl?.classList?.contains('is-selected');
          if (isSel && item?.file && !seen.has(item.file.path)) {
            seen.add(item.file.path);
            selected.push(item.file);
          }
        }
      }

      // 3. Fallback: DOM query
      const container = view.containerEl as HTMLElement;
      if (container) {
        const selectedEls = container.querySelectorAll(
          '.is-selected, .nav-file-title.is-selected, .nav-folder-title.is-selected, .tree-item-self.is-selected, .pakcli-recent-item .tree-item-self.is-selected'
        );

        selectedEls.forEach((el) => {
          const path = el.getAttribute('data-path') ||
                       el.closest('[data-path]')?.getAttribute('data-path') ||
                       el.querySelector('[data-path]')?.getAttribute('data-path') ||
                       el.getAttribute('aria-label');
          if (path && !seen.has(path)) {
            seen.add(path);
            const af = this.app.vault.getAbstractFileByPath(path);
            if (af) {
              selected.push(af);
            }
          }
        });
      }
    }

    // Also check Recent pane if rendered outside leaf
    if (this.recentPaneEl) {
      const recentSelected = this.recentPaneEl.querySelectorAll('.tree-item-self.is-selected');
      recentSelected.forEach((el) => {
        const path = el.getAttribute('aria-label') || el.getAttribute('data-path');
        if (path && !seen.has(path)) {
          seen.add(path);
          const af = this.app.vault.getAbstractFileByPath(path);
          if (af) {
            selected.push(af);
          }
        }
      });
    }

    if (fallbackFile) {
      if (selected.length > 1 && selected.some((f) => f.path === fallbackFile.path)) {
        return selected;
      }
      return [fallbackFile];
    }

    return selected;
  }

  public async moveToBacklog(itemOrItems: TAbstractFile | TAbstractFile[], useTimestamp: boolean = false) {
    const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
    try {
      const backlogFolder = (this.plugin.settings.backlogFolderPath || 'Backlog').trim().replace(/^\/+|\/+$/g, '') || 'Backlog';
      await ensureFolderExists(this.app, backlogFolder);

      let count = 0;
      for (const item of items) {
        const prefix = useTimestamp ? this.getTimestampPrefix() : '';
        let targetName = `${prefix}${item.name}`;
        let newPath = `${backlogFolder}/${targetName}`;

        if (this.app.vault.getAbstractFileByPath(newPath) && newPath !== item.path) {
          const ext = item instanceof TFile && item.extension ? `.${item.extension}` : '';
          const base = item instanceof TFile && item.extension ? targetName.slice(0, -(ext.length)) : targetName;
          let counter = 1;
          while (this.app.vault.getAbstractFileByPath(`${backlogFolder}/${base} ${counter}${ext}`)) {
            counter++;
          }
          newPath = `${backlogFolder}/${base} ${counter}${ext}`;
        }

        await this.app.fileManager.renameFile(item, newPath);
        count++;
      }

      if (items.length === 1) {
        new Notice(`Moved "${items[0].name}" to "${backlogFolder}"`);
      } else {
        new Notice(`Moved ${count} files to "${backlogFolder}"`);
      }
    } catch (err) {
      console.error('[PakCLI] Error moving to backlog:', err);
      new Notice(`Failed to move to backlog: ${String(err)}`);
    }
  }

  private attachFolderClickListener(containerEl: HTMLElement) {
    if (this.onFolderClickBound) {
      containerEl.removeEventListener('click', this.onFolderClickBound);
    }
    this.onFolderClickBound = (e: MouseEvent) => this.onFolderClick(e);
    containerEl.addEventListener('click', this.onFolderClickBound);
  }

  private onFolderClick(e: MouseEvent) {
    const target = (e.target as HTMLElement)?.closest('.nav-folder-title, .tree-item-self') as HTMLElement;
    if (!target || target.closest('.pakcli-virtual-folder')) return;

    if (this.plugin.settings.baseExplorerActive) {
      if (this.baseExplorerDebounce !== null) {
        cancelAnimationFrame(this.baseExplorerDebounce);
      }
      this.baseExplorerDebounce = requestAnimationFrame(() => {
        this.baseExplorerDebounce = null;
        this.applyBaseExplorerFilter();
      });
    }
    if (this.badgeDebounce !== null) {
      cancelAnimationFrame(this.badgeDebounce);
    }
    this.badgeDebounce = requestAnimationFrame(() => {
      this.badgeDebounce = null;
      if (this.plugin.settings.enableMergeFolderIndex !== false) {
        this.refreshFolderBadges();
      }
      this.applyCaptainFolderTextColors();
      if (this.plugin.dictionaryExplorerManager) {
        this.plugin.dictionaryExplorerManager.scheduleRefresh();
      }
      if (this.plugin.relationshipExplorerManager) {
        this.plugin.relationshipExplorerManager.scheduleRefresh();
      }
    });
    if (!this.plugin.settings.enableAutoFolderIndex) return;
    const folderTitle = target.classList.contains('nav-folder-title') ? target : (target.closest('.nav-folder-title') as HTMLElement || target);
    const path = folderTitle.getAttribute('data-path');
    if (!path) return;
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (abstract instanceof TFolder) {
      this.handleFolderIndexCreation(abstract).catch((err) => {
        console.error('[PakCLI] Error creating folder index:', err);
      });
    }
  }

  public async handleFolderIndexCreation(folder: TFolder) {
    if (!this.plugin.settings.enableAutoFolderIndex) return;
    const indexPath = `${folder.path === '/' ? '' : folder.path}/index.md`.replace(/^\/+/, '');
    const existing = this.app.vault.getAbstractFileByPath(indexPath);

    // Strictly enforce requirement: if file already exists, DO NOTHING
    if (existing instanceof TFile) {
      return;
    }

    // Construct title
    const prefix = this.plugin.settings.folderIndexPrefix || '';
    const suffix = this.plugin.settings.folderIndexSuffix || '';
    const useTs = this.plugin.settings.folderIndexUseTimestamp === true;
    const tsPrefix = useTs ? this.getTimestampPrefix() : '';

    const title = `${tsPrefix}${prefix}${folder.name}${suffix}`;
    const content = this.getFolderIndexContent(title);

    try {
      const createdFile = await this.app.vault.create(indexPath, content);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(createdFile);
      new Notice(`Created folder index: ${indexPath}`);
    } catch (err) {
      console.error('[PakCLI] Failed to create folder index:', err);
    }
  }

  public getFolderIndexContent(title: string): string {
    const format = this.plugin.settings.folderIndexContentFormat || 'frontmatter_only';
    switch (format) {
      case 'heading_only':
        return `# ${title}\n\n`;
      case 'both':
        return `---\ntitle: "${title}"\n---\n\n# ${title}\n\n`;
      case 'frontmatter_only':
      default:
        return `---\ntitle: "${title}"\n---\n\n`;
    }
  }

  private detach() {
    if (this.baseExplorerObserver) {
      this.baseExplorerObserver.disconnect();
      this.baseExplorerObserver = null;
    }
    if (this.baseExplorerDebounce !== null) {
      cancelAnimationFrame(this.baseExplorerDebounce);
      this.baseExplorerDebounce = null;
    }
    if (this.badgeDebounce !== null) {
      cancelAnimationFrame(this.badgeDebounce);
      this.badgeDebounce = null;
    }
    this.removeFolderBadges();
    this.removeCaptainFolderTextColors();
    if (this.splitBtnEl) {
      this.splitBtnEl.remove();
      this.splitBtnEl = null;
    }
    if (this.baseBtnEl) {
      this.baseBtnEl.remove();
      this.baseBtnEl = null;
    }
    if (this.showIndexBtnEl) {
      this.showIndexBtnEl.remove();
      this.showIndexBtnEl = null;
    }
    if (this.dictVirtualFolderBtnEl) {
      this.dictVirtualFolderBtnEl.remove();
      this.dictVirtualFolderBtnEl = null;
    }
    if (this.recentPaneEl) {
      this.recentPaneEl.remove();
      this.recentPaneEl = null;
    }
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (leaves && leaves.length > 0) {
      const containerEl = (leaves[0].view as any)?.containerEl as HTMLElement;
      if (containerEl) {
        containerEl.removeClass('pakcli-base-explorer-active');
        if (this.onFolderClickBound) {
          containerEl.removeEventListener('click', this.onFolderClickBound);
          this.onFolderClickBound = null;
        }
        containerEl.removeClass('pakcli-explorer-split-active');
        const navHeader = containerEl.querySelector('.nav-header') as HTMLElement;
        const navFiles = containerEl.querySelector('.nav-files-container') as HTMLElement;
        if (navHeader) navHeader.style.removeProperty('order');
        if (navFiles) {
          navFiles.style.removeProperty('order');
          navFiles.style.removeProperty('flex');
          navFiles.style.removeProperty('overflow');
        }
      }
    }
  }

  public getRecentsCsvPath(): string {
    const folder = (this.plugin.settings.recentsArtifactFolderPath || 'artifacts/pakcli-panel').trim().replace(/^\/+|\/+$/g, '') || 'artifacts/pakcli-panel';
    return `${folder}/recents.csv`;
  }

  public scheduleSaveRecentsCsv() {
    if (this.saveCsvTimeout) {
      clearTimeout(this.saveCsvTimeout);
    }
    this.saveCsvTimeout = setTimeout(() => {
      this.saveRecentsCsvArtifact().catch((err) => {
        console.error('[PakCLI] Error saving recents CSV artifact:', err);
      });
    }, 400);
  }

  public async saveRecentsCsvArtifact(): Promise<TFile | null> {
    try {
      const folder = (this.plugin.settings.recentsArtifactFolderPath || 'artifacts/pakcli-panel').trim().replace(/^\/+|\/+$/g, '') || 'artifacts/pakcli-panel';
      await ensureFolderExists(this.app, folder);

      const csvPath = `${folder}/recents.csv`;
      const rows: string[] = ['path,time last open,date last open'];

      for (const file of this.recentFilesList) {
        if (!(file instanceof TFile)) continue;
        if (this.isArtifactFile(file.path)) continue;
        if (!(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) continue;

        const ts = this.openTimes.get(file.path) || file.stat.mtime || Date.now();
        const { timeStr, dateStr } = this.formatDateTime(ts);
        rows.push(`${this.escapeCsv(file.path)},${this.escapeCsv(timeStr)},${this.escapeCsv(dateStr)}`);
      }

      const csvContent = rows.join('\n') + '\n';
      const existing = this.app.vault.getAbstractFileByPath(csvPath);

      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, csvContent);
        return existing;
      } else {
        const created = await this.app.vault.create(csvPath, csvContent);
        return created;
      }
    } catch (e) {
      console.error('[PakCLI] Failed to save recents CSV artifact:', e);
      return null;
    }
  }

  private async loadRecentsFromCsvArtifact(files: TFile[]) {
    try {
      const primaryPath = this.getRecentsCsvPath();
      const possiblePaths = [
        primaryPath,
        'artifacts/pakcli-panel/recents.csv',
        'artifacts/recents.csv',
        'csv_view_artifacts/recents.csv',
      ];

      let csvAbstract: TFile | null = null;
      for (const candidate of possiblePaths) {
        const abstract = this.app.vault.getAbstractFileByPath(candidate);
        if (abstract instanceof TFile) {
          csvAbstract = abstract;
          break;
        }
      }

      if (!csvAbstract) {
        const allFiles = this.app.vault.getFiles();
        csvAbstract = allFiles.find((f) => f.name.toLowerCase() === 'recents.csv') || null;
      }

      if (!(csvAbstract instanceof TFile)) return;

      const content = await this.app.vault.read(csvAbstract);
      const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) return;

      const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toUpperCase());
      const pathIdx = header.indexOf('PATH');
      const timeIdx = header.indexOf('TIME LAST OPEN');
      const dateIdx = header.indexOf('DATE LAST OPEN');

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const cols = this.parseCsvLine(line);
        const filePath = cols[pathIdx !== -1 ? pathIdx : 0];
        if (!filePath) continue;

        const timeStr = cols[timeIdx !== -1 ? timeIdx : 1] || '';
        const dateStr = cols[dateIdx !== -1 ? dateIdx : 2] || '';

        let timestamp = 0;
        if (dateStr && timeStr) {
          const parsed = Date.parse(`${dateStr}T${timeStr}`);
          if (!isNaN(parsed)) {
            timestamp = parsed;
          }
        }
        if (!timestamp) timestamp = Date.now();

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          if (!this.openTimes.has(file.path)) {
            this.openTimes.set(file.path, timestamp);
          }
          if (!files.some((f) => f.path === file.path)) {
            files.push(file);
          }
        }
      }
    } catch (e) {
      console.warn('[PakCLI] Could not load recents from CSV artifact:', e);
    }
  }

  private formatDateTime(timestamp: number): { timeStr: string; dateStr: string } {
    const d = new Date(timestamp);
    const validDate = isNaN(d.getTime()) ? new Date() : d;
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(validDate.getHours())}:${pad(validDate.getMinutes())}:${pad(validDate.getSeconds())}`;
    const dateStr = `${validDate.getFullYear()}-${pad(validDate.getMonth() + 1)}-${pad(validDate.getDate())}`;
    return { timeStr, dateStr };
  }

  private escapeCsv(val: string): string {
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private folders: TFolder[];
  private onChoose: (folder: TFolder) => void;

  constructor(app: App, onChoose: (folder: TFolder) => void) {
    super(app);
    this.folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
    this.onChoose = onChoose;
    this.setPlaceholder('Type to search destination folder...');
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path || '/ (Root)';
  }

  onChooseItem(folder: TFolder, evt: MouseEvent | KeyboardEvent): void {
    this.onChoose(folder);
  }
}

