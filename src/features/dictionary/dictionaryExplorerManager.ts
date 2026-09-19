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
  private navFilesContainer: HTMLElement | null = null;
  private onScrollBound: (() => void) | null = null;
  private dictChildrenContainers: Set<HTMLElement> = new Set();

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
    if (this.navFilesContainer && this.onScrollBound) {
      this.navFilesContainer.removeEventListener('scroll', this.onScrollBound);
      this.onScrollBound = null;
    }
    this.disconnectObserver();
    this.removeVirtualFolders();
  }

  private isRenamingInExplorer(): boolean {
    const explorerEl = document.querySelector('.nav-files-container');
    if (!explorerEl) return false;
    return !!explorerEl.querySelector('input:not([type="checkbox"]), .nav-folder-title[contenteditable="true"], .nav-file-title[contenteditable="true"], .nav-folder-title [contenteditable="true"], .nav-file-title [contenteditable="true"], .tree-item-inner[contenteditable="true"]');
  }

  public scheduleRefresh() {
    this.needsFollowUpPass = true;
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.needsFollowUpPass = false;
        if (this.isRenamingInExplorer()) {
          return;
        }
        this.refreshVirtualFolders();
        if (this.needsFollowUpPass) {
          this.scheduleRefresh();
        }
      });
    }

    if (this.trailingTimer !== null) {
      window.clearTimeout(this.trailingTimer);
    }
    this.trailingTimer = window.setTimeout(() => {
      this.trailingTimer = null;
      if (this.isRenamingInExplorer()) {
        return;
      }
      this.refreshVirtualFolders();
    }, 60);
  }

  // ── Observer helpers ───────────────────────────────────────────────────────

  private connectObserver() {
    if (!this.mutationObserver || !this.navFilesContainer) return;
    this.mutationObserver.observe(this.navFilesContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private disconnectObserver() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
  }

  // ── Settings helpers ──────────────────────────────────────────────────────

  public getDictionaryFolderEntries(): DictionaryFolderEntry[] {
    if (this.plugin.settings.dictionaryScope === 'active') {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.parent && activeFile.parent.path !== '/') {
        return [{
          id: 'active',
          path: normalizePath(activeFile.parent.path),
          subfolderMode: 'include',
        }];
      }
    }
    const folders = this.plugin.settings.dictionaryFolders;
    if (folders && folders.length > 0) {
      return folders.filter(f => !!f.path && !!f.path.trim()).map(f => ({
        id: f.id || `dict_${f.path}`,
        path: normalizePath(f.path.trim()),
        subfolderMode: (f.subfolderMode || 'own_az') as DictionarySubfolderMode,
        label: f.label
      }));
    }
    return [{
      id: 'dict_default',
      path: normalizePath(this.plugin.settings.dictionaryFolderPath || 'Dictionary'),
      subfolderMode: 'own_az',
    }];
  }

  private isMatchingDictFolder(path: string): boolean {
    if (!path) return false;
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
        this.scheduleRefresh();
        this.observeExplorer();
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on('create', (file) => {
        if (this.isMatchingDictFolder(file.path)) this.scheduleRefresh();
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (this.isMatchingDictFolder(file.path)) this.scheduleRefresh();
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (this.isMatchingDictFolder(file.path) || this.isMatchingDictFolder(oldPath)) {
          this.scheduleRefresh();
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

    this.navFilesContainer = (container.querySelector('.nav-files-container') || container) as HTMLElement;

    if (this.navFilesContainer) {
      if (this.onScrollBound) {
        this.navFilesContainer.removeEventListener('scroll', this.onScrollBound);
      }
      this.onScrollBound = () => {
        this.scheduleRefresh();
      };
      this.navFilesContainer.addEventListener('scroll', this.onScrollBound, { passive: true });
    }

    if (!this.mutationObserver) {
      this.mutationObserver = new MutationObserver((mutations) => {
        if (this.isRenamingInExplorer()) return;

        let shouldRefresh = false;

        for (const mut of mutations) {
          const targetEl = mut.target as HTMLElement;
          if (!targetEl) continue;

          // Ignore mutations inside our own virtual folders
          if (targetEl.classList?.contains('pakcli-virtual-folder') ||
              targetEl.closest?.('.pakcli-virtual-folder')) continue;

          // Fast-path: Mutation inside or directly on any tracked dictionary folder's children container
          const isInsideDict = Array.from(this.dictChildrenContainers).some(
            c => targetEl === c || c.contains(targetEl)
          );
          if (isInsideDict) {
            shouldRefresh = true;
            break;
          }

          // Check attribute changes (e.g. is-collapsed toggled on folder expand/collapse)
          if (mut.type === 'attributes' && mut.attributeName === 'class') {
            if (targetEl && !targetEl.classList.contains('pakcli-virtual-folder') && !targetEl.closest?.('.pakcli-virtual-folder')) {
              if (targetEl.classList.contains('nav-folder') || targetEl.classList.contains('tree-item')) {
                const p = normalizePath(targetEl.getAttribute?.('data-path') ||
                  targetEl.querySelector?.('.nav-folder-title, .tree-item-self')?.getAttribute('data-path') || '');
                if (!p || this.isMatchingDictFolder(p) || targetEl.querySelector?.('.nav-folder-children, .tree-item-children')) {
                  shouldRefresh = true;
                  break;
                }
              }
            }
          }

          // Check added nodes
          if (mut.addedNodes?.length > 0) {
            for (let i = 0; i < mut.addedNodes.length; i++) {
              const node = mut.addedNodes[i] as HTMLElement;
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              if (node.classList?.contains('pakcli-virtual-folder')) continue;
              const p = normalizePath(node.getAttribute?.('data-path') ||
                node.querySelector?.('.nav-file-title, .nav-folder-title, .tree-item-self')?.getAttribute('data-path') || '');
              if (this.isMatchingDictFolder(p)) { shouldRefresh = true; break; }
              const pf = node.closest?.('.nav-folder:not(.pakcli-virtual-folder)');
              if (pf) {
                const t = pf.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self');
                const fp = normalizePath(t?.getAttribute('data-path') || pf.getAttribute('data-path') || '');
                if (this.isMatchingDictFolder(fp)) { shouldRefresh = true; break; }
              }
            }
          }
          if (shouldRefresh) break;

          // Check removed nodes
          if (mut.removedNodes?.length > 0) {
            for (let i = 0; i < mut.removedNodes.length; i++) {
              const node = mut.removedNodes[i] as HTMLElement;
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              if (node.classList?.contains('pakcli-virtual-folder')) continue;
              const p = normalizePath(node.getAttribute?.('data-path') ||
                node.querySelector?.('.nav-file-title, .nav-folder-title, .tree-item-self')?.getAttribute('data-path') || '');
              if (this.isMatchingDictFolder(p)) { shouldRefresh = true; break; }
            }
          }
          if (shouldRefresh) break;
        }

        if (shouldRefresh) this.scheduleRefresh();
      });
    }

    this.connectObserver();
  }

  // ── Remove virtual folders ─────────────────────────────────────────────────

  public removeVirtualFolders() {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const container = (leaves[0].view as any)?.containerEl as HTMLElement;
    if (!container) return;

    this.disconnectObserver();
    try {
      const virtualFolders = Array.from(container.querySelectorAll('.pakcli-dict-virtual-folder'));
      for (const vf of virtualFolders) {
        const parent = vf.parentElement;
        if (parent) {
          const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file'));
          for (const f of files) parent.appendChild(f);
        }
        vf.remove();
      }

      // Restore any hidden merged folders
      const hiddenFolders = Array.from(container.querySelectorAll('.pakcli-merged-folder-hidden'));
      for (const hf of hiddenFolders) {
        (hf as HTMLElement).style.removeProperty('display');
        hf.classList.remove('pakcli-merged-folder-hidden');
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

    // 1. Direct query on folder elements or direct folder titles
    let folderEl = container.querySelector(
      `.nav-folder[data-path="${dictRoot}"], .tree-item.nav-folder[data-path="${dictRoot}"]`
    ) as HTMLElement;

    if (!folderEl) {
      const titleEl = container.querySelector(
        `.nav-folder > .nav-folder-title[data-path="${dictRoot}"], .tree-item.nav-folder > .tree-item-self[data-path="${dictRoot}"]`
      ) as HTMLElement;
      if (titleEl) {
        folderEl = (titleEl.closest('.nav-folder, .tree-item.nav-folder') || titleEl.parentElement) as HTMLElement;
      }
    }

    // 2. Scan only actual folder elements (.nav-folder / .tree-item.nav-folder)
    const allFolders = Array.from(container.querySelectorAll('.nav-folder:not(.pakcli-virtual-folder), .tree-item.nav-folder:not(.pakcli-virtual-folder)')) as HTMLElement[];

    if (!folderEl) {
      // First pass: exact normalized path match
      folderEl = (allFolders.find(f => {
        const p = normalizePath(
          f.getAttribute('data-path') ||
          f.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.getAttribute('data-path') ||
          ''
        ).toLowerCase();
        return p === normalizedTarget;
      }) as HTMLElement) || null;
    }

    if (!folderEl) {
      // Second pass: path ends with normalized target (e.g. target is "Dictionary" and folder is "Digital Library/Dictionary")
      folderEl = (allFolders.find(f => {
        const p = normalizePath(
          f.getAttribute('data-path') ||
          f.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.getAttribute('data-path') ||
          ''
        ).toLowerCase();
        return p.endsWith('/' + normalizedTarget);
      }) as HTMLElement) || null;
    }

    if (!folderEl && targetName) {
      // Third pass: folder title or path matches targetName
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
          window.setTimeout(() => this.scheduleRefresh(), 60);
        });
      }
      return folderEl;
    }

    return null;
  }

  // ── Main refresh ───────────────────────────────────────────────────────────

  public refreshVirtualFolders() {
    const isEnabled = this.plugin.settings.enableDictionaryVirtualFolders !== false;
    if (!isEnabled) {
      this.removeVirtualFolders();
      return;
    }

    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const container = (leaves[0].view as any)?.containerEl as HTMLElement;
    if (!container) return;

    if (this.isRenamingInExplorer()) return;

    const entries = this.getDictionaryFolderEntries();
    if (entries.length === 0) return;

    this.disconnectObserver();
    this.dictChildrenContainers.clear();

    try {
      for (const entry of entries) {
        this.applyVirtualFoldersToEntry(container, entry);
      }
    } catch (err) {
      console.error('[PakCLI Dictionary] Error applying virtual folders:', err);
    } finally {
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

    this.dictChildrenContainers.add(childrenContainer);

    const isFolderCollapsed = folderEl.classList.contains('is-collapsed') ||
      folderEl.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.classList.contains('is-collapsed');
    if (isFolderCollapsed) return;

    const subfolderMode: DictionarySubfolderMode = entry.subfolderMode || 'own_az';

    if (subfolderMode === 'exclude') {
      // 1. Direct files only
      const directFiles = folderAbstract.children.filter((c): c is TFile => c instanceof TFile);
      // Ensure physical subfolders stay visible
      const rawFolders = childrenContainer.querySelectorAll(':scope > .nav-folder:not(.pakcli-virtual-folder), :scope > .tree-item.nav-folder:not(.pakcli-virtual-folder)');
      rawFolders.forEach(el => {
        (el as HTMLElement).style.removeProperty('display');
        el.classList.remove('pakcli-merged-folder-hidden');
      });
      this.buildVirtualFoldersForContainer(container, childrenContainer, actualPath, directFiles, false);

    } else if (subfolderMode === 'include') {
      // 2. All files recursively into single A-Z list
      const allFiles: TFile[] = [];
      const collect = (f: TFolder) => {
        for (const child of f.children) {
          if (child instanceof TFile) allFiles.push(child);
          else if (child instanceof TFolder) collect(child);
        }
      };
      collect(folderAbstract);

      // Hide physical subfolders so notes are unified cleanly under the A-Z folders
      const rawFolders = childrenContainer.querySelectorAll(':scope > .nav-folder:not(.pakcli-virtual-folder), :scope > .tree-item.nav-folder:not(.pakcli-virtual-folder)');
      rawFolders.forEach(el => {
        (el as HTMLElement).style.setProperty('display', 'none', 'important');
        el.classList.add('pakcli-merged-folder-hidden');
      });

      this.buildVirtualFoldersForContainer(container, childrenContainer, actualPath, allFiles, true);

    } else if (subfolderMode === 'own_az') {
      // 3. Direct files get A-Z virtual folders, AND each physical subfolder gets its own A-Z virtual folders!
      const directFiles = folderAbstract.children.filter((c): c is TFile => c instanceof TFile);
      // Ensure physical subfolders stay visible
      const rawFolders = childrenContainer.querySelectorAll(':scope > .nav-folder:not(.pakcli-virtual-folder), :scope > .tree-item.nav-folder:not(.pakcli-virtual-folder)');
      rawFolders.forEach(el => {
        (el as HTMLElement).style.removeProperty('display');
        el.classList.remove('pakcli-merged-folder-hidden');
      });

      this.buildVirtualFoldersForContainer(container, childrenContainer, actualPath, directFiles, false);

      // Recursively find and build virtual folders for subfolders
      const processSubfolders = (parentFolder: TFolder) => {
        for (const child of parentFolder.children) {
          if (child instanceof TFolder) {
            const subFolderEl = this.findDictionaryFolderEl(container, child.path);
            if (subFolderEl) {
              const subChildren = (subFolderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
                subFolderEl.querySelector('.nav-folder-children, .tree-item-children')) as HTMLElement;
              if (subChildren) {
                this.dictChildrenContainers.add(subChildren);
                const isSubCollapsed = subFolderEl.classList.contains('is-collapsed') ||
                  subFolderEl.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.classList.contains('is-collapsed');
                if (!isSubCollapsed) {
                  const subDirectFiles = child.children.filter((c): c is TFile => c instanceof TFile);
                  this.buildVirtualFoldersForContainer(container, subChildren, child.path, subDirectFiles, false);
                }
              }
            }
            processSubfolders(child);
          }
        }
      };
      processSubfolders(folderAbstract);
    }
  }

  private buildVirtualFoldersForContainer(
    container: HTMLElement,
    childrenContainer: HTMLElement,
    folderPath: string,
    vaultFiles: TFile[],
    isMerged: boolean = false
  ) {
    const normFolderPath = normalizePath(folderPath);
    const normFolderPathLower = normFolderPath.toLowerCase();

    // 0. Scan vault files by letter
    const vaultFilesByLetter = new Map<string, TFile[]>();
    for (let c = 65; c <= 90; c++) vaultFilesByLetter.set(String.fromCharCode(c), []);
    vaultFilesByLetter.set('#', []);

    const vaultByNormPath = new Map<string, TFile>();
    const vaultByBasename = new Map<string, TFile>();
    for (const file of vaultFiles) {
      const normP = normalizePath(file.path).toLowerCase();
      vaultByNormPath.set(normP, file);
      vaultByBasename.set(file.basename.toLowerCase(), file);

      if (!file.name.toLowerCase().startsWith('index.')) {
        const firstChar = file.basename.trim().charAt(0).toUpperCase();
        if (firstChar >= 'A' && firstChar <= 'Z') {
          vaultFilesByLetter.get(firstChar)?.push(file);
        } else {
          vaultFilesByLetter.get('#')?.push(file);
        }
      }
    }

    // 1. Collect all file elements that belong to THIS folder.
    // If merged: all files in childrenContainer tree (since physical folders are hidden).
    // If NOT merged (own_az or exclude): ONLY direct files or files inside THIS container's virtual folders!
    let candidateNavFileEls: HTMLElement[];
    if (isMerged) {
      candidateNavFileEls = Array.from(
        childrenContainer.querySelectorAll('.nav-file, .tree-item.nav-file, .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')
      ) as HTMLElement[];
    } else {
      const directFiles = Array.from(
        childrenContainer.querySelectorAll(':scope > .nav-file, :scope > .tree-item.nav-file, :scope > .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')
      ) as HTMLElement[];
      const virtualFiles = Array.from(
        childrenContainer.querySelectorAll(':scope > .pakcli-virtual-folder > .pakcli-virtual-folder-children > *')
      ).filter(el => !el.classList.contains('nav-folder') && !el.classList.contains('pakcli-virtual-folder')) as HTMLElement[];
      candidateNavFileEls = [...directFiles, ...virtualFiles];
    }

    // 2. Group candidate files by letter (robust against path casing and DOM formatting)
    const letterMap = new Map<string, HTMLElement[]>();
    for (let c = 65; c <= 90; c++) letterMap.set(String.fromCharCode(c), []);
    letterMap.set('#', []);

    const seenCandidateEls = new Set<HTMLElement>();

    for (const fileEl of candidateNavFileEls) {
      if (seenCandidateEls.has(fileEl)) continue;
      seenCandidateEls.add(fileEl);

      const rawPath = fileEl.getAttribute('data-path') ||
        fileEl.querySelector('[data-path]')?.getAttribute('data-path') || '';
      const normP = rawPath ? normalizePath(rawPath).toLowerCase() : '';
      const domTitle = fileEl.querySelector('.nav-file-title-content, .tree-item-inner, .nav-file-title, .tree-item-self')?.textContent?.trim() || '';

      // Match against vaultFiles
      let matchedFile: TFile | null = null;
      if (normP) {
        matchedFile = vaultByNormPath.get(normP) || null;
      }
      if (!matchedFile && domTitle) {
        const cleanTitle = domTitle.toLowerCase().endsWith('.md') ? domTitle.slice(0, -3).toLowerCase() : domTitle.toLowerCase();
        matchedFile = vaultByBasename.get(cleanTitle) || null;
      }
      if (!matchedFile && rawPath) {
        const abstract = this.app.vault.getAbstractFileByPath(rawPath) || this.app.vault.getAbstractFileByPath(decodeURIComponent(rawPath));
        if (abstract instanceof TFile) {
          matchedFile = abstract;
        }
      }

      // If in non-merged mode and file belongs to another folder outside this tree, restore it
      if (!isMerged && matchedFile && matchedFile.parent) {
        const trueParent = normalizePath(matchedFile.parent.path);
        if (trueParent.toLowerCase() !== normFolderPathLower) {
          const trueFolderEl = this.findDictionaryFolderEl(container, trueParent);
          if (trueFolderEl) {
            const trueChildren = (trueFolderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
              trueFolderEl.querySelector('.nav-folder-children, .tree-item-children')) as HTMLElement;
            if (trueChildren && fileEl.parentElement !== trueChildren) {
              trueChildren.appendChild(fileEl);
              continue;
            }
          }
        }
      }

      // If file does not exist in vault at all, it was deleted! Remove from DOM!
      if (!matchedFile) {
        fileEl.remove();
        continue;
      }

      const noteName = matchedFile.basename;
      if (!noteName) continue;

      // Keep index files at root of this folder
      if (noteName.toLowerCase().startsWith('index')) {
        if (fileEl.parentElement !== childrenContainer) {
          childrenContainer.insertBefore(fileEl, childrenContainer.firstChild);
        }
        continue;
      }

      const firstChar = noteName.trim().charAt(0).toUpperCase();
      const letter = (firstChar >= 'A' && firstChar <= 'Z') ? firstChar : '#';
      letterMap.get(letter)?.push(fileEl);
    }

    const letters = [...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)), '#'];
    const activeLetters = letters.filter(letter => 
      (vaultFilesByLetter.get(letter)?.length ?? 0) > 0 || (letterMap.get(letter)?.length ?? 0) > 0
    );

    // 3. Clean up existing virtual folders in childrenContainer:
    // - Remove duplicate virtual folders with the same letter
    // - Remove virtual folders with mismatched data-folder-scope
    // - Remove virtual folders for letters with 0 files
    const existingVFs = Array.from(
      childrenContainer.querySelectorAll(':scope > .pakcli-virtual-folder[data-virtual-letter]')
    ) as HTMLElement[];
    const seenLetters = new Set<string>();

    for (const vf of existingVFs) {
      const letter = vf.getAttribute('data-virtual-letter') || '';
      const scope = vf.getAttribute('data-folder-scope');
      const isDuplicate = seenLetters.has(letter);
      const isMismatch = scope && normalizePath(scope).toLowerCase() !== normFolderPathLower;
      const isInactive = !activeLetters.includes(letter);

      if (isDuplicate || isMismatch || isInactive) {
        // Return files back to childrenContainer before removing vf
        const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file, .tree-item:not(.nav-folder)'));
        for (const f of files) childrenContainer.appendChild(f);
        vf.remove();
      } else {
        seenLetters.add(letter);
      }
    }

    // 4. Build or update virtual folders
    const desiredVFEls: HTMLElement[] = [];

    for (const letter of activeLetters) {
      const fileEls = letterMap.get(letter) || [];
      const collapseKey = `${normFolderPathLower}:${letter}`;
      const isCollapsed = this.collapsedLetters.has(collapseKey);

      // IMPORTANT: MUST use :scope > to never match into subfolders!
      let vfEl = childrenContainer.querySelector(
        `:scope > .pakcli-virtual-folder[data-virtual-letter="${letter}"]`
      ) as HTMLElement;
      const totalCount = vaultFilesByLetter.get(letter)?.length ?? fileEls.length;

      if (!vfEl) {
        // Create new virtual folder
        vfEl = document.createElement('div');
        vfEl.className = `nav-folder tree-item pakcli-virtual-folder pakcli-dict-virtual-folder${isCollapsed ? ' is-collapsed' : ''}`;
        vfEl.setAttribute('data-virtual-letter', letter);
        vfEl.setAttribute('data-folder-scope', normFolderPath);
        vfEl.style.setProperty('--tier-color', 'var(--interactive-accent)');

        const titleDiv = document.createElement('div');
        titleDiv.className = 'nav-folder-title tree-item-self is-clickable pakcli-virtual-folder-title pakcli-dict-virtual-folder-title';
        titleDiv.title = `Dictionary [${letter}] • Virtual Folder`;

        // Chevron
        const chevronEl = document.createElement('div');
        chevronEl.className = 'nav-folder-collapse-indicator collapse-icon';
        chevronEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-right"><path d="m9 18 6-6-6-6"></path></svg>`;
        titleDiv.appendChild(chevronEl);

        // Letter name
        const nameEl = document.createElement('div');
        nameEl.className = 'nav-folder-title-content tree-item-inner';
        nameEl.textContent = letter;
        titleDiv.appendChild(nameEl);

        // Connecting line
        const lineEl = document.createElement('div');
        lineEl.className = 'pakcli-virtual-folder-line';
        titleDiv.appendChild(lineEl);

        // Badge
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

        // Count
        const countSpan = document.createElement('span');
        countSpan.className = 'nav-folder-title-extra tree-item-flair pakcli-virtual-count';
        countSpan.textContent = String(totalCount);
        titleDiv.appendChild(countSpan);

        vfEl.appendChild(titleDiv);

        // Children container
        const chDiv = document.createElement('div');
        chDiv.className = 'nav-folder-children tree-item-children pakcli-virtual-folder-children';
        if (isCollapsed) {
          chDiv.style.setProperty('display', 'none', 'important');
        }
        vfEl.appendChild(chDiv);
      } else {
        // Update existing virtual folder
        vfEl.setAttribute('data-folder-scope', normFolderPath);
        if (isCollapsed && !vfEl.classList.contains('is-collapsed')) {
          vfEl.classList.add('is-collapsed');
        } else if (!isCollapsed && vfEl.classList.contains('is-collapsed')) {
          vfEl.classList.remove('is-collapsed');
        }

        const countSpan = vfEl.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-count');
        if (countSpan && countSpan.textContent !== String(totalCount)) {
          countSpan.textContent = String(totalCount);
        }

        const ch = vfEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
        if (ch) {
          if (isCollapsed) {
            ch.style.setProperty('display', 'none', 'important');
          } else {
            ch.style.removeProperty('display');
          }
        }
      }

      // Ensure click listener is ALWAYS bound on titleDiv (whether new or existing)
      const titleDiv = vfEl.querySelector(':scope > .pakcli-virtual-folder-title') as HTMLElement;
      if (titleDiv && !(titleDiv as any).__pakcli_dict_click_bound) {
        (titleDiv as any).__pakcli_dict_click_bound = true;
        titleDiv.addEventListener('click', (e: MouseEvent) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.stopImmediatePropagation();
          e.preventDefault();

          const nowCollapsed = vfEl.classList.contains('is-collapsed');
          const ch = vfEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
          const currentScope = vfEl.getAttribute('data-folder-scope') || normFolderPath;
          const currentLetter = vfEl.getAttribute('data-virtual-letter') || letter;
          const key = `${normalizePath(currentScope).toLowerCase()}:${currentLetter}`;

          if (nowCollapsed) {
            vfEl.classList.remove('is-collapsed');
            this.collapsedLetters.delete(key);
            if (ch) ch.style.removeProperty('display');
          } else {
            vfEl.classList.add('is-collapsed');
            this.collapsedLetters.add(key);
            if (ch) ch.style.setProperty('display', 'none', 'important');
          }
          this.scheduleRefresh();
        }, { capture: true });
      }

      desiredVFEls.push(vfEl);

      // 5. Move files into the children container (only if out of place)
      const chDiv = vfEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
      if (chDiv) {
        fileEls.sort((a, b) => {
          const titleA = a.querySelector('.nav-file-title-content, .tree-item-inner, .nav-file-title')?.textContent?.trim() || a.getAttribute('data-path') || '';
          const titleB = b.querySelector('.nav-file-title-content, .tree-item-inner, .nav-file-title')?.textContent?.trim() || b.getAttribute('data-path') || '';
          return titleA.localeCompare(titleB, undefined, { sensitivity: 'base' });
        });

        // Clean up any children in chDiv that are not in fileEls (deleted or moved files)
        const currentChildren = Array.from(chDiv.children) as HTMLElement[];
        for (const child of currentChildren) {
          if (!fileEls.includes(child)) {
            child.remove();
          }
        }

        const currentChFiles = Array.from(chDiv.children);
        const chMatches = currentChFiles.length === fileEls.length &&
          currentChFiles.every((c, idx) => c === fileEls[idx]);

        if (!chMatches) {
          for (const el of fileEls) {
            if (el.parentElement !== chDiv) chDiv.appendChild(el);
          }
          for (let i = 0; i < fileEls.length; i++) {
            if (chDiv.children[i] !== fileEls[i]) chDiv.appendChild(fileEls[i]);
          }
        }
      }
    }

    // 6. Mount/order virtual folders in childrenContainer (only if order has changed)
    const currentMountedVFs = Array.from(
      childrenContainer.querySelectorAll(':scope > .pakcli-virtual-folder[data-virtual-letter]')
    ) as HTMLElement[];
    const vfOrderMatches = currentMountedVFs.length === desiredVFEls.length &&
      currentMountedVFs.every((c, idx) => c === desiredVFEls[idx]);

    if (!vfOrderMatches) {
      // Clean up any extra virtual folders that are not in desiredVFEls
      for (const vf of currentMountedVFs) {
        if (!desiredVFEls.includes(vf)) {
          const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file, .tree-item:not(.nav-folder)'));
          for (const f of files) childrenContainer.appendChild(f);
          vf.remove();
        }
      }
      for (const vf of desiredVFEls) {
        if (vf.parentElement !== childrenContainer) childrenContainer.appendChild(vf);
      }
      for (let i = 0; i < desiredVFEls.length; i++) {
        childrenContainer.appendChild(desiredVFEls[i]);
      }
    }
  }
}
