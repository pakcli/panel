import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DictionaryFolderEntry, DictionarySubfolderMode } from '../explorer/types';



export class DictionaryExplorerManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private collapsedLetters: Set<string> = new Set();
  private mutationObserver: MutationObserver | null = null;
  private rafId: number | null = null;
  private needsFollowUpPass = false;
  private trailingTimer: number | null = null;
  private isOrganizing = false;
  private isToggling = false;
  private navFilesContainer: HTMLElement | null = null;
  private dictChildrenContainers: Set<HTMLElement> = new Set();
  private lastRefreshTime = 0;
  private isScrolling = false;
  private scrollTimer: number | null = null;
  private scrollBoundHandler: (() => void) | null = null;

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public init() {
    this.registerEvents();
    const start = () => {
      this.scheduleRefresh();
      this.observeExplorer();
    };
    if (this.app.workspace.layoutReady) {
      start();
    } else {
      this.app.workspace.onLayoutReady(start);
    }
  }

  public destroy() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.trailingTimer !== null) {
      window.clearTimeout(this.trailingTimer);
      this.trailingTimer = null;
    }
    if (this.scrollTimer !== null) {
      window.clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    if (this.scrollBoundHandler) {
      window.removeEventListener('scroll', this.scrollBoundHandler, { capture: true } as any);
      window.removeEventListener('wheel', this.scrollBoundHandler);
      this.scrollBoundHandler = null;
    }
    this.disconnectObserver();
    this.removeVirtualFolders();
  }

  private isRenamingInExplorer(): boolean {
    const explorerEl = document.querySelector('.nav-files-container');
    if (!explorerEl) return false;
    return !!explorerEl.querySelector(
      '.nav-folder-title input, .nav-file-title input, .tree-item-self input, ' +
      '.nav-folder-title[contenteditable="true"], .nav-file-title[contenteditable="true"], ' +
      '.nav-folder-title [contenteditable="true"], .nav-file-title [contenteditable="true"], ' +
      '.tree-item-inner[contenteditable="true"]'
    );
  }

  public scheduleRefresh(delayMs: number = 20, reason?: string) {
    if (this.isOrganizing || this.isToggling) return;

    if (this.trailingTimer !== null) {
      window.clearTimeout(this.trailingTimer);
      this.trailingTimer = null;
    }

    if (delayMs <= 0) {
      requestAnimationFrame(() => {
        if (this.isRenamingInExplorer() || this.isOrganizing || this.isToggling) return;
        this.lastRefreshTime = Date.now();
        this.refreshVirtualFolders();
      });
      return;
    }

    this.trailingTimer = window.setTimeout(() => {
      this.trailingTimer = null;
      if (this.isRenamingInExplorer() || this.isOrganizing || this.isToggling) {
        return;
      }
      this.lastRefreshTime = Date.now();
      this.refreshVirtualFolders();
    }, delayMs);
  }

  // ── Observer helpers ───────────────────────────────────────────────────────

  private connectObserver() {
    if (!this.mutationObserver || !this.navFilesContainer) return;
    this.mutationObserver.observe(this.navFilesContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  }

  private disconnectObserver() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
  }

  // ── Settings helpers ──────────────────────────────────────────────────────

  public getDictionaryFolderEntries(): DictionaryFolderEntry[] {
    let rawEntries: DictionaryFolderEntry[] = [];
    if (this.plugin.settings.dictionaryScope === 'active') {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.parent && activeFile.parent.path !== '/') {
        rawEntries = [{ path: activeFile.parent.path, subfolderMode: ((this.plugin.settings as any).subfolderMode as DictionarySubfolderMode) || 'own_az' }];
      }
    } else {
      rawEntries = (((this.plugin.settings as any).dictionaryFolderEntries || []) as any[]).map(e => ({
        path: e.path,
        subfolderMode: (e.subfolderMode as DictionarySubfolderMode) || 'own_az'
      }));
    }

    if (rawEntries.length === 0) {
      const legacyPath = (this.plugin.settings.dictionaryFolderPath || '').trim();
      if (legacyPath) {
        rawEntries = [{ path: legacyPath, subfolderMode: ((this.plugin.settings as any).subfolderMode as DictionarySubfolderMode) || 'own_az' }];
      }
    }

    return rawEntries;
  }

  private isMatchingDictFolder(path: string): boolean {
    if (!path) return false;
    const isEnabled = this.plugin.settings.enableDictionaryVirtualFolders !== false;
    if (!isEnabled) return false;
    const p = normalizePath(path).toLowerCase();
    const entries = this.getDictionaryFolderEntries();
    return entries.some(e => {
      const root = normalizePath(e.path).toLowerCase();
      const base = root.split('/').pop() || root;
      if (p === root || p.startsWith(root + '/')) return true;
      if (p === base || p.startsWith(base + '/')) return true;
      if (p.endsWith('/' + root) || p.includes('/' + root + '/')) return true;
      if (p.endsWith('/' + base) || p.includes('/' + base + '/')) return true;

      const folderAbstract = this.app.vault.getAbstractFileByPath(e.path);
      if (folderAbstract) {
        const actual = folderAbstract.path.toLowerCase();
        if (p === actual || p.startsWith(actual + '/') || p.endsWith('/' + actual) || p.includes('/' + actual + '/')) {
          return true;
        }
      }
      return false;
    });
  }

  // ── Event registration ────────────────────────────────────────────────────

  private registerEvents() {
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.scheduleRefresh(80, 'layout-change');
        this.observeExplorer();
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on('create', (file) => {
        if (this.isMatchingDictFolder(file.path)) this.scheduleRefresh(80, 'vault-create');
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (this.isMatchingDictFolder(file.path)) this.scheduleRefresh(80, 'vault-delete');
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (this.isMatchingDictFolder(file.path) || this.isMatchingDictFolder(oldPath)) {
          this.scheduleRefresh(80, 'vault-rename');
        }
      })
    );
  }

  // ── MutationObserver setup ────────────────────────────────────────────────

  private observeExplorer() {
    this.disconnectObserver();

    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const container = (leaves[0].view as any)?.containerEl as HTMLElement;
    if (!container) return;

    const navFiles = (container.querySelector('.nav-files-container') || container) as HTMLElement;
    this.navFilesContainer = navFiles;

    if (this.scrollBoundHandler) {
      window.removeEventListener('scroll', this.scrollBoundHandler, { capture: true } as any);
      window.removeEventListener('wheel', this.scrollBoundHandler);
      this.scrollBoundHandler = null;
    }

    if (!this.mutationObserver && this.navFilesContainer) {
      this.mutationObserver = new MutationObserver((mutations) => {
        if (this.isRenamingInExplorer() || this.isOrganizing || this.isToggling) {
          return;
        }

        let shouldRefresh = false;
        let refreshReason = '';

        for (const mut of mutations) {
          const targetEl = mut.target as HTMLElement;
          if (!targetEl) continue;

          // Ignore mutations inside our own virtual folders
          if (targetEl.classList?.contains('pakcli-virtual-folder') ||
              targetEl.closest?.('.pakcli-virtual-folder')) continue;

          // 1. Folder expand attribute change: trigger only when a dictionary folder expands
          if (mut.type === 'attributes' && mut.attributeName === 'class') {
            const folderEl = targetEl.classList.contains('nav-folder')
              ? targetEl
              : (targetEl.closest?.('.nav-folder') as HTMLElement | null);
            if (folderEl && !folderEl.classList.contains('mod-root') && !folderEl.classList.contains('pakcli-virtual-folder')) {
              const hadCollapsed = (mut.oldValue || '').includes('is-collapsed');
              const isNowCollapsed = targetEl.classList.contains('is-collapsed') || folderEl.classList.contains('is-collapsed');
              if (hadCollapsed && !isNowCollapsed) {
                const folderPath = folderEl.getAttribute('data-path') ||
                  folderEl.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.getAttribute('data-path') || '';
                if (folderPath && this.isMatchingDictFolder(folderPath)) {
                  shouldRefresh = true;
                  refreshReason = `folder expanded: ${folderPath}`;
                  break;
                }
              }
            }
          }

          // 2. ChildList mutation: absorb loose notes added directly to dictionary folder containers
          if (mut.type === 'childList') {
            const targetChildren = (targetEl.classList.contains('nav-folder-children') || targetEl.classList.contains('tree-item-children'))
              ? targetEl
              : (targetEl.closest('.nav-folder-children, .tree-item-children') as HTMLElement | null);

            if (!targetChildren) continue;

            // Ignore internal mutations inside virtual folder children
            if (targetEl.classList.contains('pakcli-virtual-folder-children') || targetEl.closest('.pakcli-virtual-folder-children')) {
              continue;
            }

            if (mut.addedNodes && mut.addedNodes.length > 0) {
              const hasAddedLooseFile = Array.from(mut.addedNodes).some(n => {
                const el = n as HTMLElement;
                if (el.nodeType !== Node.ELEMENT_NODE) return false;
                if (el.classList?.contains('pakcli-virtual-folder') || el.closest?.('.pakcli-virtual-folder')) return false;
                return (el.classList?.contains('nav-file') || (el.classList?.contains('tree-item') && !el.classList?.contains('nav-folder')));
              });

              if (hasAddedLooseFile) {
                const parentFolder = targetChildren.closest('.nav-folder') as HTMLElement | null;
                if (parentFolder && !parentFolder.classList.contains('mod-root') && !parentFolder.classList.contains('pakcli-virtual-folder')) {
                  const titleEl = (parentFolder.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self') || parentFolder) as HTMLElement;
                  const folderPath = titleEl.getAttribute('data-path') || parentFolder.getAttribute('data-path') || '';
                  if (folderPath && this.isMatchingDictFolder(folderPath)) {
                    const isCollapsed = parentFolder.classList.contains('is-collapsed') || titleEl.classList.contains('is-collapsed');
                    if (!isCollapsed) {
                      shouldRefresh = true;
                      refreshReason = `childList addedNodes in folder: ${folderPath}`;
                      break;
                    }
                  }
                }
              }
            }
          }
        }

        if (shouldRefresh) {
          this.scheduleRefresh(0, refreshReason);
        }
      });
    }

    this.connectObserver();
  }

  // ── Remove virtual folders ─────────────────────────────────────────────────

  public removeVirtualFolders() {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;

    this.disconnectObserver();
    try {
      for (const leaf of leaves) {
        const container = (leaf.view as any)?.containerEl as HTMLElement;
        if (!container) continue;

        const virtualFolders = Array.from(
          container.querySelectorAll('.pakcli-dict-virtual-folder, .pakcli-virtual-folder[data-virtual-letter]')
        ) as HTMLElement[];

        const affectedParents = new Set<HTMLElement>();

        for (const vf of virtualFolders) {
          const parent = vf.parentElement;
          if (parent) {
            affectedParents.add(parent);
            const files = Array.from(
              vf.querySelectorAll('.nav-file, .tree-item.nav-file, .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')
            ) as HTMLElement[];
            for (const f of files) {
              f.style.removeProperty('display');
              f.classList.remove('pakcli-merged-child-hidden');
              if (f.parentElement !== parent) {
                parent.appendChild(f);
              }
            }
          }
          vf.remove();
        }

        // Sort notes alphabetically once per affected parent container
        for (const parent of affectedParents) {
          const noteEls = Array.from(
            parent.querySelectorAll(':scope > .nav-file, :scope > .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')
          ) as HTMLElement[];
          noteEls.sort((a, b) => {
            const titleA = a.querySelector('.nav-file-title-content, .tree-item-inner, .nav-file-title')?.textContent?.trim() || a.getAttribute('data-path') || '';
            const titleB = b.querySelector('.nav-file-title-content, .tree-item-inner, .nav-file-title')?.textContent?.trim() || b.getAttribute('data-path') || '';
            return titleA.localeCompare(titleB, undefined, { sensitivity: 'base' });
          });
          for (const el of noteEls) {
            parent.appendChild(el);
          }
        }

        // Restore any hidden merged folders
        const hiddenFolders = Array.from(container.querySelectorAll('.pakcli-merged-folder-hidden'));
        for (const hf of hiddenFolders) {
          (hf as HTMLElement).style.removeProperty('display');
          hf.classList.remove('pakcli-merged-folder-hidden');
        }
      }
    } finally {
      this.dictChildrenContainers.clear();
      this.connectObserver();
    }
  }

  // ── Find the dictionary folder DOM element ────────────────────────────────

  private findDictionaryFolderEl(container: HTMLElement, dictRoot: string): HTMLElement | null {
    if (!container || !dictRoot) return null;
    const normalizedTarget = normalizePath(dictRoot).toLowerCase();
    const targetName = dictRoot.split('/').pop()?.toLowerCase();

    // Scan only actual folder elements (.nav-folder / .tree-item.nav-folder)
    const allFolders = Array.from(
      container.querySelectorAll('.nav-folder:not(.pakcli-virtual-folder), .tree-item.nav-folder:not(.pakcli-virtual-folder)')
    ) as HTMLElement[];

    // Pass 1: exact normalized path match
    let folderEl = (allFolders.find(f => {
      const p = normalizePath(
        f.getAttribute('data-path') ||
        f.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.getAttribute('data-path') ||
        ''
      ).toLowerCase();
      return p === normalizedTarget;
    }) as HTMLElement) || null;

    // Pass 2: path ends with normalized target (e.g. target is "Dictionary" and folder is "Digital Library/Dictionary")
    if (!folderEl) {
      folderEl = (allFolders.find(f => {
        const p = normalizePath(
          f.getAttribute('data-path') ||
          f.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.getAttribute('data-path') ||
          ''
        ).toLowerCase();
        return p.endsWith('/' + normalizedTarget);
      }) as HTMLElement) || null;
    }

    // Pass 3: folder title or path matches targetName
    if (!folderEl && targetName) {
      folderEl = (allFolders.find(f => {
        const p = normalizePath(
          f.getAttribute('data-path') ||
          f.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.getAttribute('data-path') ||
          ''
        ).toLowerCase();
        if (p === targetName || p.endsWith('/' + targetName)) return true;
        const titleContent = f.querySelector(':scope > .nav-folder-title .nav-folder-title-content, :scope > .tree-item-self .tree-item-inner')
          ?.textContent?.trim().toLowerCase();
        return titleContent === targetName;
      }) as HTMLElement) || null;
    }

    if (folderEl) {
      const title = (folderEl.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self') || folderEl) as HTMLElement;
      if (title && !(title as any).__pakcli_dict_click_bound) {
        (title as any).__pakcli_dict_click_bound = true;
        title.addEventListener('click', () => {
          this.scheduleRefresh(20);
        });
      }
      return folderEl;
    }

    return null;
  }

  private findSubfolderEl(parentChildrenContainer: HTMLElement, folderPath: string): HTMLElement | null {
    if (!parentChildrenContainer || !folderPath) return null;
    const targetNorm = normalizePath(folderPath).toLowerCase();
    const targetBase = folderPath.split('/').pop()?.toLowerCase();

    const childFolders = Array.from(
      parentChildrenContainer.querySelectorAll(':scope > .nav-folder, :scope > .tree-item.nav-folder')
    ) as HTMLElement[];

    for (const f of childFolders) {
      if (f.classList.contains('pakcli-virtual-folder')) continue;
      const titleEl = (f.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self') || f) as HTMLElement;
      const p = normalizePath(
        titleEl.getAttribute('data-path') ||
        f.getAttribute('data-path') ||
        ''
      ).toLowerCase();
      if (p === targetNorm || (targetBase && (p.endsWith('/' + targetBase) || p === targetBase))) {
        return f;
      }
      const titleText = (titleEl.querySelector('.nav-folder-title-content, .tree-item-inner')?.textContent || '').trim().toLowerCase();
      if (targetBase && titleText === targetBase) {
        return f;
      }
    }
    return null;
  }

  // ── Main refresh ───────────────────────────────────────────────────────────

  public refreshVirtualFolders() {
    if (this.isToggling) return;
    const isEnabled = this.plugin.settings.enableDictionaryVirtualFolders !== false;
    if (!isEnabled) {
      this.removeVirtualFolders();
      return;
    }

    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const container = (leaves[0].view as any)?.containerEl as HTMLElement;
    if (!container) return;

    const navFiles = (container.querySelector('.nav-files-container') || container) as HTMLElement;

    if (this.isOrganizing || this.isRenamingInExplorer()) {
      return;
    }

    const entries = this.getDictionaryFolderEntries();

    this.isOrganizing = true;
    this.disconnectObserver();
    this.dictChildrenContainers.clear();

    try {
      // 1. Process configured entries (e.g. custom subfolderMode, include, exclude)
      for (const entry of entries) {
        this.applyVirtualFoldersToEntry(container, entry);
      }

      // 2. Clean up any stray virtual folders in non-dictionary folders (e.g. "Tool Hardware")
      const strayVFs = Array.from(
        container.querySelectorAll('.pakcli-dict-virtual-folder')
      ) as HTMLElement[];
      for (const vf of strayVFs) {
        const parent = vf.parentElement;
        if (parent && !this.dictChildrenContainers.has(parent)) {
          const ch = vf.querySelector(':scope > .pakcli-virtual-folder-children');
          if (ch) {
            while (ch.firstChild) {
              parent.appendChild(ch.firstChild);
            }
          }
          vf.remove();
        }
      }
    } catch (err) {
      console.error('[PakCLI Dictionary] Error applying virtual folders:', err);
    } finally {
      this.isOrganizing = false;
      // Drain our own DOM mutations BEFORE reconnecting so the observer doesn't immediately re-fire
      this.mutationObserver?.takeRecords();
      this.connectObserver();
    }
  }

  private applyVirtualFoldersToEntry(container: HTMLElement, entry: DictionaryFolderEntry) {
    const normPath = normalizePath(entry.path);
    let folderAbstract = this.app.vault.getAbstractFileByPath(normPath);
    if (!(folderAbstract instanceof TFolder)) {
      const lower = normPath.toLowerCase();
      const allFiles = this.app.vault.getAllLoadedFiles();
      const matched = allFiles.find(f => f instanceof TFolder && f.path.toLowerCase() === lower);
      if (matched instanceof TFolder) {
        folderAbstract = matched;
      } else {
        const baseName = normPath.split('/').pop()?.toLowerCase();
        if (baseName) {
          const matchedByName = allFiles.find(f => f instanceof TFolder && (f.path.toLowerCase() === baseName || f.name.toLowerCase() === baseName));
          if (matchedByName instanceof TFolder) {
            folderAbstract = matchedByName;
          }
        }
      }
    }
    if (!(folderAbstract instanceof TFolder)) return;

    const actualPath = folderAbstract.path;
    const folderEl = this.findDictionaryFolderEl(container, actualPath) || this.findDictionaryFolderEl(container, normPath);
    if (!folderEl) return;

    const childrenContainer = (folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
      folderEl.querySelector('.nav-folder-children, .tree-item-children')) as HTMLElement;
    if (!childrenContainer) return;
    if (this.dictChildrenContainers.has(childrenContainer)) return;
    this.dictChildrenContainers.add(childrenContainer);

    const isFolderCollapsed = folderEl.classList.contains('is-collapsed') ||
      folderEl.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.classList.contains('is-collapsed');
    if (isFolderCollapsed) return;

    const subfolderMode: DictionarySubfolderMode = entry.subfolderMode || 'own_az';

    if (subfolderMode === 'exclude') {
      const directFiles = folderAbstract.children.filter((c): c is TFile => c instanceof TFile);
      const rawFolders = childrenContainer.querySelectorAll(':scope > .nav-folder:not(.pakcli-virtual-folder), :scope > .tree-item.nav-folder:not(.pakcli-virtual-folder)');
      rawFolders.forEach(el => {
        (el as HTMLElement).style.removeProperty('display');
        el.classList.remove('pakcli-merged-folder-hidden');
      });
      this.organizeFolderChildren(container, childrenContainer, actualPath, directFiles, false);

    } else if (subfolderMode === 'include') {
      const allFiles: TFile[] = [];
      const collect = (f: TFolder) => {
        for (const child of f.children) {
          if (child instanceof TFile) allFiles.push(child);
          else if (child instanceof TFolder) collect(child);
        }
      };
      collect(folderAbstract);

      const rawFolders = childrenContainer.querySelectorAll(':scope > .nav-folder:not(.pakcli-virtual-folder), :scope > .tree-item.nav-folder:not(.pakcli-virtual-folder)');
      rawFolders.forEach(el => {
        (el as HTMLElement).style.setProperty('display', 'none', 'important');
        el.classList.add('pakcli-merged-folder-hidden');
      });

      this.organizeFolderChildren(container, childrenContainer, actualPath, allFiles, true);

    } else if (subfolderMode === 'own_az') {
      const directFiles = folderAbstract.children.filter((c): c is TFile => c instanceof TFile);
      const rawFolders = childrenContainer.querySelectorAll(':scope > .nav-folder:not(.pakcli-virtual-folder), :scope > .tree-item.nav-folder:not(.pakcli-virtual-folder)');
      rawFolders.forEach(el => {
        (el as HTMLElement).style.removeProperty('display');
        el.classList.remove('pakcli-merged-folder-hidden');
      });

      this.organizeFolderChildren(container, childrenContainer, actualPath, directFiles, false);

      // Process subfolders
      const processSubfolders = (parentFolder: TFolder, parentFolderEl: HTMLElement) => {
        const parentChildren = (parentFolderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
          parentFolderEl.querySelector('.nav-folder-children, .tree-item-children')) as HTMLElement;
        if (!parentChildren) return;

        for (const child of parentFolder.children) {
          if (child instanceof TFolder) {
            const subFolderEl = this.findSubfolderEl(parentChildren, child.path) ||
              this.findDictionaryFolderEl(container, child.path);

            if (subFolderEl) {
              const titleEl = (subFolderEl.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self') || subFolderEl) as HTMLElement;
              if (titleEl && !(titleEl as any).__pakcli_dict_click_bound) {
                (titleEl as any).__pakcli_dict_click_bound = true;
                titleEl.addEventListener('click', () => {
                  this.scheduleRefresh(80);
                });
              }

              const subChildren = (subFolderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
                subFolderEl.querySelector('.nav-folder-children, .tree-item-children')) as HTMLElement;

              if (subChildren) {
                this.dictChildrenContainers.add(subChildren);
                const isSubCollapsed = subFolderEl.classList.contains('is-collapsed') ||
                  titleEl.classList.contains('is-collapsed');
                if (!isSubCollapsed) {
                  const subDirectFiles = child.children.filter((c): c is TFile => c instanceof TFile);
                  this.organizeFolderChildren(container, subChildren, child.path, subDirectFiles, false);
                }
              }
              processSubfolders(child, subFolderEl);
            }
          }
        }
      };
      processSubfolders(folderAbstract, folderEl);
    }
  }

  private buildVirtualFoldersForContainer(
    container: HTMLElement,
    childrenContainer: HTMLElement,
    folderPath: string,
    vaultFiles: TFile[],
    isMerged: boolean = false
  ) {
    this.organizeFolderChildren(container, childrenContainer, folderPath, vaultFiles, isMerged);
  }

  private organizeFolderChildren(
    container: HTMLElement,
    childrenContainer: HTMLElement,
    folderPath: string,
    vaultFiles: TFile[],
    isMerged: boolean = false
  ) {
    const normFolderPath = normalizePath(folderPath);
    const normFolderPathLower = normFolderPath.toLowerCase();

    const isIndexElement = (el: HTMLElement) => {
      const p = el.getAttribute('data-path') || el.querySelector('[data-path]')?.getAttribute('data-path') || '';
      if (p) {
        const n = p.split('/').pop()?.toLowerCase() || '';
        return n.startsWith('index.') || n === 'index' || n.endsWith('.base');
      }
      const title = el.querySelector('.nav-file-title-content, .tree-item-inner, .nav-file-title, .tree-item-self')?.textContent?.trim()?.toLowerCase() || '';
      return title === 'index' || title.startsWith('index.') || title.endsWith('.base');
    };

    const getElementLetter = (el: HTMLElement): string => {
      let name = '';
      const rawPath = el.getAttribute('data-path') ||
        el.querySelector('.nav-file-title, .tree-item-self, [data-path]')?.getAttribute('data-path') || '';
      if (rawPath) {
        name = rawPath.split('/').pop() || '';
      }
      if (!name) {
        name = el.querySelector('.nav-file-title-content, .tree-item-inner, .nav-file-title, .tree-item-self')?.textContent?.trim() || '';
      }
      const cleanName = name.replace(/\.md$/i, '').trim();
      if (!cleanName) return '#';
      const firstChar = cleanName.charAt(0).toUpperCase();
      return (firstChar >= 'A' && firstChar <= 'Z') ? firstChar : '#';
    };

    // Group vaultFiles by letter
    const vaultFilesByLetter = new Map<string, TFile[]>();
    for (let c = 65; c <= 90; c++) vaultFilesByLetter.set(String.fromCharCode(c), []);
    vaultFilesByLetter.set('#', []);

    for (const file of vaultFiles) {
      if (file.name.toLowerCase().startsWith('index.') || file.name.toLowerCase().endsWith('.base')) continue;
      const firstChar = file.basename.trim().charAt(0).toUpperCase();
      const letter = (firstChar >= 'A' && firstChar <= 'Z') ? firstChar : '#';
      vaultFilesByLetter.get(letter)?.push(file);
    }

    const letters = [...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)), '#'];
    const activeVaultLetters = letters.filter(l => (vaultFilesByLetter.get(l)?.length ?? 0) > 0);

    const existingVFs = Array.from(
      childrenContainer.querySelectorAll(':scope > .pakcli-virtual-folder[data-virtual-letter]')
    ) as HTMLElement[];

    const looseNoteEls = (Array.from(
      childrenContainer.querySelectorAll(':scope > .nav-file, :scope > .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')
    ) as HTMLElement[]).filter(el => !isIndexElement(el));

    // ── FAST-PATH CHECK ────────────────────────────────────────────────────────
    // If all virtual folders are in place and no loose notes exist, do ZERO DOM work!
    const isOrderMatching = existingVFs.length === activeVaultLetters.length &&
      existingVFs.every((vf, idx) => vf.getAttribute('data-virtual-letter') === activeVaultLetters[idx]);

    if (looseNoteEls.length === 0 && isOrderMatching) {
      for (const vf of existingVFs) {
        const letter = vf.getAttribute('data-virtual-letter') || '';
        const ch = vf.querySelector(':scope > .pakcli-virtual-folder-children');
        const count = ch ? ch.querySelectorAll(':scope > .nav-file, :scope > .tree-item:not(.nav-folder)').length : 0;
        const totalCount = Math.max(count, vaultFilesByLetter.get(letter)?.length ?? 0);
        const countSpan = vf.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-count');
        if (countSpan && countSpan.textContent !== String(totalCount)) {
          countSpan.textContent = String(totalCount);
        }
      }
      return;
    }

    // ── Deduplicate any duplicate virtual folders ──────────────────────────────
    const vfsByLetter = new Map<string, HTMLElement[]>();
    for (const vf of existingVFs) {
      const l = vf.getAttribute('data-virtual-letter') || '';
      if (!vfsByLetter.has(l)) vfsByLetter.set(l, []);
      vfsByLetter.get(l)!.push(vf);
    }
    for (const [l, vfs] of vfsByLetter.entries()) {
      if (vfs.length > 1) {
        const primary = vfs[0];
        const primaryCh = primary.querySelector(':scope > .pakcli-virtual-folder-children');
        for (let i = 1; i < vfs.length; i++) {
          const dup = vfs[i];
          const dupCh = dup.querySelector(':scope > .pakcli-virtual-folder-children');
          if (dupCh && primaryCh) {
            while (dupCh.firstChild) {
              primaryCh.appendChild(dupCh.firstChild);
            }
          }
          dup.remove();
        }
      }
    }

    // ── Ensure desired virtual folders exist ──────────────────────────────────
    const targetLetters = activeVaultLetters.length > 0 ? activeVaultLetters : letters.filter(l => (vaultFilesByLetter.get(l)?.length ?? 0) > 0);
    const letterToVF = new Map<string, HTMLElement>();

    for (const letter of targetLetters) {
      let vfEl = childrenContainer.querySelector(
        `:scope > .pakcli-virtual-folder[data-virtual-letter="${letter}"]`
      ) as HTMLElement;

      if (!vfEl) {
        const totalCount = vaultFilesByLetter.get(letter)?.length ?? 0;
        vfEl = this.createVirtualFolderElement(letter, normFolderPath, totalCount);
        childrenContainer.appendChild(vfEl);
      } else {
        vfEl.setAttribute('data-folder-scope', normFolderPath);
        const collapseKey = `${normFolderPathLower}:${letter}`;
        const isCollapsed = this.collapsedLetters.has(collapseKey);
        if (isCollapsed) {
          vfEl.classList.add('pakcli-collapsed');
        } else {
          vfEl.classList.remove('pakcli-collapsed');
        }
        vfEl.classList.remove('is-collapsed');

        const ch = vfEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
        if (ch) {
          if (isCollapsed) ch.style.setProperty('display', 'none', 'important');
          else ch.style.removeProperty('display');
        }
      }
      this.ensureVFClickListener(vfEl, letter, normFolderPath);
      letterToVF.set(letter, vfEl);
    }

    // ── Move loose notes into their matching virtual folder ────────────────────
    const candidateNotes = Array.from(
      childrenContainer.querySelectorAll(
        ':scope > .nav-file, :scope > .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)'
      )
    ) as HTMLElement[];

    const firstVF = childrenContainer.querySelector(':scope > .pakcli-virtual-folder');

    for (const el of candidateNotes) {
      if (isIndexElement(el)) {
        if (firstVF && el.nextElementSibling !== firstVF) {
          childrenContainer.insertBefore(el, firstVF);
        }
        continue;
      }
      const letter = getElementLetter(el);
      let vf = letterToVF.get(letter);
      if (!vf) {
        vf = this.createVirtualFolderElement(letter, normFolderPath, 1);
        childrenContainer.appendChild(vf);
        this.ensureVFClickListener(vf, letter, normFolderPath);
        letterToVF.set(letter, vf);
      }
      const chDiv = vf.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
      if (chDiv && el.parentElement !== chDiv) {
        chDiv.appendChild(el);
        el.style.removeProperty('display');
        el.classList.remove('pakcli-merged-child-hidden');
      }
    }

    // ── Stably order virtual folders without re-appending existing ones ────────
    const orderedVFs = Array.from(letterToVF.values());
    for (let i = 0; i < orderedVFs.length; i++) {
      const cur = orderedVFs[i];
      const next = orderedVFs[i + 1] || null;
      if (next && next.parentElement === childrenContainer) {
        if (cur.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_PRECEDING) {
          childrenContainer.insertBefore(cur, next);
        }
      }
    }

    // ── Update counts cleanly ──────────────────────────────────────────────────
    for (const [letter, vf] of letterToVF.entries()) {
      const ch = vf.querySelector(':scope > .pakcli-virtual-folder-children');
      const count = ch ? ch.querySelectorAll(':scope > .nav-file, :scope > .tree-item:not(.nav-folder)').length : 0;
      const totalCount = Math.max(count, vaultFilesByLetter.get(letter)?.length ?? 0);
      const countSpan = vf.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-count');
      if (countSpan && countSpan.textContent !== String(totalCount)) {
        countSpan.textContent = String(totalCount);
      }
    }
  }

  private createVirtualFolderElement(letter: string, normFolderPath: string, count: number): HTMLElement {
    const collapseKey = `${normFolderPath.toLowerCase()}:${letter}`;
    const isCollapsed = this.collapsedLetters.has(collapseKey);

    const vfEl = document.createElement('div');
    vfEl.className = `nav-folder tree-item pakcli-virtual-folder pakcli-dict-virtual-folder${isCollapsed ? ' pakcli-collapsed' : ''}`;
    vfEl.setAttribute('data-virtual-letter', letter);
    vfEl.setAttribute('data-folder-scope', normFolderPath);
    vfEl.style.setProperty('--tier-color', 'var(--interactive-accent)');

    const titleDiv = document.createElement('div');
    titleDiv.className = 'nav-folder-title tree-item-self is-clickable pakcli-virtual-folder-title pakcli-dict-virtual-folder-title';
    titleDiv.title = `Dictionary [${letter}] • Virtual Folder`;

    const chevronEl = document.createElement('div');
    chevronEl.className = 'nav-folder-collapse-indicator collapse-icon';
    chevronEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-right"><path d="m9 18 6-6-6-6"></path></svg>`;
    titleDiv.appendChild(chevronEl);

    const nameEl = document.createElement('div');
    nameEl.className = 'nav-folder-title-content tree-item-inner';
    nameEl.textContent = letter;
    titleDiv.appendChild(nameEl);

    const lineEl = document.createElement('div');
    lineEl.className = 'pakcli-virtual-folder-line';
    titleDiv.appendChild(lineEl);

    const badgeEl = document.createElement('span');
    badgeEl.className = 'pakcli-virtual-badge';
    badgeEl.title = `Virtual Folder • Letter ${letter}`;
    const badgeIcon = document.createElement('span');
    badgeIcon.className = 'pakcli-badge-i';
    badgeIcon.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    badgeEl.appendChild(badgeIcon);
    const badgeText = document.createElement('span');
    badgeText.className = 'pakcli-badge-text';
    badgeText.textContent = 'virtual';
    badgeEl.appendChild(badgeText);
    titleDiv.appendChild(badgeEl);

    const countSpan = document.createElement('span');
    countSpan.className = 'nav-folder-title-extra tree-item-flair pakcli-virtual-count';
    countSpan.textContent = String(count);
    titleDiv.appendChild(countSpan);

    vfEl.appendChild(titleDiv);

    const chDiv = document.createElement('div');
    chDiv.className = 'nav-folder-children tree-item-children pakcli-virtual-folder-children';
    if (isCollapsed) {
      chDiv.style.setProperty('display', 'none', 'important');
    }
    vfEl.appendChild(chDiv);

    return vfEl;
  }

  private ensureVFClickListener(vfEl: HTMLElement, letter: string, normFolderPath: string) {
    const titleDiv = vfEl.querySelector(':scope > .pakcli-virtual-folder-title') as HTMLElement;
    if (!titleDiv || (titleDiv as any).__pakcli_dict_click_bound) return;

    (titleDiv as any).__pakcli_dict_click_bound = true;
    titleDiv.addEventListener('click', (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      // Block MutationObserver re-entry so the class
      // change and children visibility change don't trigger a re-layout.
      this.isToggling = true;
      // Cancel any pending timer so it can't call refreshVirtualFolders mid-toggle
      if (this.trailingTimer !== null) {
        window.clearTimeout(this.trailingTimer);
        this.trailingTimer = null;
      }
      window.setTimeout(() => { this.isToggling = false; }, 200);

      const nowCollapsed = vfEl.classList.contains('pakcli-collapsed');
      const ch = vfEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
      const currentScope = vfEl.getAttribute('data-folder-scope') || normFolderPath;
      const currentLetter = vfEl.getAttribute('data-virtual-letter') || letter;
      const key = `${normalizePath(currentScope).toLowerCase()}:${currentLetter}`;

      if (nowCollapsed) {
        vfEl.classList.remove('pakcli-collapsed');
        this.collapsedLetters.delete(key);
        if (ch) ch.style.removeProperty('display');
      } else {
        vfEl.classList.add('pakcli-collapsed');
        this.collapsedLetters.add(key);
        if (ch) ch.style.setProperty('display', 'none', 'important');
      }
      vfEl.classList.remove('is-collapsed');
    }, { capture: true });
  }
}

