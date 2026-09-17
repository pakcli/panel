import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type PakCLITablePlugin from '../../main';

export class DictionaryExplorerManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private collapsedLetters: Set<string> = new Set();
  private isOrganizing = false;
  private mutationObserver: MutationObserver | null = null;
  private debounceTimer: number | null = null;

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
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    this.removeVirtualFolders();
  }

  public scheduleRefresh() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.refreshVirtualFolders();
    }, 60);
  }

  private getDictionaryFolderPath(): string {
    if (this.plugin.settings.dictionaryScope === 'active') {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.parent && activeFile.parent.path !== '/') {
        return normalizePath(activeFile.parent.path);
      }
    }
    return normalizePath(this.plugin.settings.dictionaryFolderPath || 'Dictionary');
  }

  private isMatchingDictFolder(path: string): boolean {
    if (!path) return false;
    const dictRoot = this.getDictionaryFolderPath().toLowerCase();
    const p = normalizePath(path).toLowerCase();
    return p === dictRoot || p.endsWith('/' + dictRoot) || p.startsWith(dictRoot + '/');
  }

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

  private observeExplorer() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const container = (leaves[0].view as any)?.containerEl as HTMLElement;
    if (!container) return;

    const navFilesContainer = container.querySelector('.nav-files-container') || container;

    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.isOrganizing) return;
      if (document.querySelector('.nav-folder-title input, .nav-file-title input')) return;

      let shouldRefresh = false;

      for (const mut of mutations) {
        const targetEl = mut.target as HTMLElement;
        if (!targetEl) continue;

        // CRITICAL: Ignore any mutations on or inside any virtual folders
        if (targetEl.classList?.contains('pakcli-virtual-folder') || targetEl.closest?.('.pakcli-virtual-folder')) {
          continue;
        }

        // If attribute mutation: only care if the dictionary folder element itself changed collapse state
        if (mut.type === 'attributes') {
          if (targetEl.classList.contains('nav-folder')) {
            const title = targetEl.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self');
            const p = normalizePath(title?.getAttribute('data-path') || targetEl.getAttribute('data-path') || '');
            if (this.isMatchingDictFolder(p)) {
              shouldRefresh = true;
              break;
            }
          }
          continue; // Ignore all other attribute mutations (hover, focus, selection, etc.)
        }

        // Check added nodes: ignore virtual folder elements
        if (mut.addedNodes && mut.addedNodes.length > 0) {
          for (let i = 0; i < mut.addedNodes.length; i++) {
            const node = mut.addedNodes[i] as HTMLElement;
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList?.contains('pakcli-virtual-folder') || node.closest?.('.pakcli-virtual-folder')) {
                continue;
              }
              const p = normalizePath(node.getAttribute?.('data-path') || '');
              if (this.isMatchingDictFolder(p)) {
                shouldRefresh = true;
                break;
              }
              const parentFolder = node.closest?.('.nav-folder:not(.pakcli-virtual-folder), .tree-item.nav-folder:not(.pakcli-virtual-folder)');
              if (parentFolder) {
                const title = parentFolder.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self');
                const folderPath = normalizePath(title?.getAttribute('data-path') || parentFolder.getAttribute('data-path') || '');
                if (this.isMatchingDictFolder(folderPath)) {
                  shouldRefresh = true;
                  break;
                }
              }
            }
          }
        }
        if (shouldRefresh) break;

        // Check removed nodes: ignore virtual folder elements
        if (mut.removedNodes && mut.removedNodes.length > 0) {
          for (let i = 0; i < mut.removedNodes.length; i++) {
            const node = mut.removedNodes[i] as HTMLElement;
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList?.contains('pakcli-virtual-folder') || node.closest?.('.pakcli-virtual-folder')) {
                continue;
              }
              const p = normalizePath(node.getAttribute?.('data-path') || '');
              if (this.isMatchingDictFolder(p)) {
                shouldRefresh = true;
                break;
              }
            }
          }
        }
        if (shouldRefresh) break;

        // Direct path check on target
        const targetPath = normalizePath(targetEl.getAttribute?.('data-path') || '');
        if (targetPath && this.isMatchingDictFolder(targetPath)) {
          shouldRefresh = true;
          break;
        }
      }

      if (shouldRefresh) {
        this.scheduleRefresh();
      }
    });

    this.mutationObserver.observe(navFilesContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  public removeVirtualFolders() {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const container = (leaves[0].view as any)?.containerEl as HTMLElement;
    if (!container) return;

    const dictRoot = this.getDictionaryFolderPath();
    const folderEl = this.findDictionaryFolderEl(container, dictRoot);
    if (!folderEl) return;

    const childrenContainer = folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') as HTMLElement;
    if (!childrenContainer) return;

    const virtualFolders = Array.from(childrenContainer.querySelectorAll('.pakcli-dict-virtual-folder, .pakcli-virtual-folder[data-virtual-letter]'));
    for (const vf of virtualFolders) {
      const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file'));
      for (const f of files) {
        childrenContainer.appendChild(f);
      }
      vf.remove();
    }
  }

  private findDictionaryFolderEl(container: HTMLElement, dictRoot: string): HTMLElement | null {
    const normalizedTarget = normalizePath(dictRoot).toLowerCase();

    // 1. Direct query by data-path on nav-folder-title or tree-item-self
    let titleEl = container.querySelector(`.nav-folder-title[data-path="${normalizedTarget}"], .tree-item-self[data-path="${normalizedTarget}"]`) as HTMLElement;
    if (!titleEl) {
      const allElements = Array.from(container.querySelectorAll('[data-path]'));
      titleEl = (allElements.find(el => {
        const p = normalizePath(el.getAttribute('data-path') || '').toLowerCase();
        return p === normalizedTarget || p.endsWith('/' + normalizedTarget);
      }) as HTMLElement) || null;
    }

    if (titleEl) {
      // Ensure clicking the folder chevron/title refreshes virtual folders
      if (!(titleEl as any).__pakcli_dict_click_bound) {
        (titleEl as any).__pakcli_dict_click_bound = true;
        titleEl.addEventListener('click', () => {
          window.setTimeout(() => this.scheduleRefresh(), 60);
        });
      }
      return (titleEl.closest('.nav-folder, .tree-item.nav-folder') || titleEl.parentElement) as HTMLElement;
    }

    // 2. Fallback: match by data-path on nav-folder
    const allFolders = Array.from(container.querySelectorAll('.nav-folder, .tree-item.nav-folder')) as HTMLElement[];
    for (const f of allFolders) {
      const p = normalizePath(f.getAttribute('data-path') || f.querySelector('.nav-folder-title, .tree-item-self')?.getAttribute('data-path') || '').toLowerCase();
      if (p === normalizedTarget || p.endsWith('/' + normalizedTarget)) {
        return f;
      }
    }

    return null;
  }

  public refreshVirtualFolders() {
    if (this.isOrganizing) return;

    const isEnabled = this.plugin.settings.enableDictionaryVirtualFolders !== false;
    if (!isEnabled) {
      this.removeVirtualFolders();
      return;
    }

    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    if (!leaves || leaves.length === 0) return;
    const container = (leaves[0].view as any)?.containerEl as HTMLElement;
    if (!container) return;

    if (document.querySelector('.nav-folder-title input, .nav-file-title input')) return;

    const dictRoot = this.getDictionaryFolderPath();
    const folderEl = this.findDictionaryFolderEl(container, dictRoot);
    if (!folderEl) return;

    const childrenContainer = (folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
      folderEl.querySelector('.nav-folder-children, .tree-item-children')) as HTMLElement;
    if (!childrenContainer) return; // Folder is collapsed

    this.isOrganizing = true;

    try {
      // 1. Collect all .nav-file elements directly or inside existing virtual folders
      const allNavFileEls = Array.from(childrenContainer.querySelectorAll('.nav-file, .tree-item.nav-file')) as HTMLElement[];

      const fileElMap = new Map<string, HTMLElement>();
      for (const fileEl of allNavFileEls) {
        const path = fileEl.getAttribute('data-path') || fileEl.querySelector('.nav-file-title, .tree-item-self')?.getAttribute('data-path') || '';
        if (path) {
          fileElMap.set(normalizePath(path), fileEl);
        }
      }

      // Group files by initial letter A-Z, #
      const letterMap = new Map<string, HTMLElement[]>();
      for (let c = 65; c <= 90; c++) {
        letterMap.set(String.fromCharCode(c), []);
      }
      letterMap.set('#', []);

      fileElMap.forEach((el, path) => {
        const abstract = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (abstract instanceof TFile) {
          // Keep index files directly at root of dictionary folder
          if (abstract.name.toLowerCase().startsWith('index.')) {
            if (el.parentElement !== childrenContainer) {
              childrenContainer.insertBefore(el, childrenContainer.firstChild);
            }
            return;
          }

          const firstChar = abstract.basename.trim().charAt(0).toUpperCase();
          if (firstChar >= 'A' && firstChar <= 'Z') {
            letterMap.get(firstChar)?.push(el);
          } else {
            letterMap.get('#')?.push(el);
          }
        }
      });

      // Helper to build or reuse a virtual folder DOM element matching relationship virtual folder styling
      const buildVirtualFolder = (letter: string, count: number): HTMLElement => {
        let virtualFolderEl = childrenContainer.querySelector(`.pakcli-virtual-folder[data-virtual-letter="${letter}"]`) as HTMLElement;
        const isCollapsed = this.collapsedLetters.has(letter);

        if (!virtualFolderEl) {
          virtualFolderEl = document.createElement('div');
          virtualFolderEl.className = `nav-folder tree-item nav-folder pakcli-virtual-folder pakcli-dict-virtual-folder ${isCollapsed ? 'is-collapsed' : ''}`;
          virtualFolderEl.setAttribute('data-virtual-letter', letter);
          virtualFolderEl.style.setProperty('--tier-color', 'var(--interactive-accent)');

          const titleDiv = document.createElement('div');
          titleDiv.className = 'nav-folder-title tree-item-self is-clickable pakcli-virtual-folder-title pakcli-dict-virtual-folder-title';
          titleDiv.title = `Dictionary [${letter}] • Virtual Folder`;

          // Chevron indicator (native Obsidian Lucide chevron-right like Relationship)
          const chevronEl = document.createElement('div');
          chevronEl.className = 'nav-folder-collapse-indicator collapse-icon';
          chevronEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-right"><path d="m9 18 6-6-6-6"></path></svg>`;
          titleDiv.appendChild(chevronEl);

          // Letter title content
          const nameEl = document.createElement('div');
          nameEl.className = 'nav-folder-title-content tree-item-inner';
          nameEl.textContent = letter;
          titleDiv.appendChild(nameEl);

          // Connecting line between text and virtual badge
          const lineEl = document.createElement('div');
          lineEl.className = 'pakcli-virtual-folder-line';
          titleDiv.appendChild(lineEl);

          // Base-style "i" Virtual Badge
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

          // Count in native flair style
          const countSpan = document.createElement('span');
          countSpan.className = 'nav-folder-title-extra tree-item-flair pakcli-virtual-count';
          countSpan.textContent = String(count);
          titleDiv.appendChild(countSpan);

          virtualFolderEl.appendChild(titleDiv);

          const virtualChildren = document.createElement('div');
          virtualChildren.className = 'nav-folder-children tree-item-children pakcli-virtual-folder-children';
          if (isCollapsed) {
            virtualChildren.style.display = 'none';
          }
          virtualFolderEl.appendChild(virtualChildren);
        } else {
          // Update count if changed
          const countSpan = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-count');
          if (countSpan && countSpan.textContent !== String(count)) {
            countSpan.textContent = String(count);
          }

          const ch = Array.from(virtualFolderEl.children).find(c => c.classList.contains('pakcli-virtual-folder-children')) as HTMLElement;
          if (isCollapsed) {
            if (!virtualFolderEl.classList.contains('is-collapsed')) {
              virtualFolderEl.classList.add('is-collapsed');
            }
            if (ch && ch.style.display !== 'none') {
              ch.style.display = 'none';
            }
          } else {
            if (virtualFolderEl.classList.contains('is-collapsed')) {
              virtualFolderEl.classList.remove('is-collapsed');
            }
            if (ch && ch.style.display === 'none') {
              ch.style.removeProperty('display');
            }
          }
        }

        // Guaranteed click handler for expand/collapse (left-click only, stops propagation)
        const titleDiv = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-title') as HTMLElement;
        if (titleDiv) {
          titleDiv.onclick = (e: MouseEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();

            const currentlyCollapsed = virtualFolderEl.classList.contains('is-collapsed');
            const ch = Array.from(virtualFolderEl.children).find(c => c.classList.contains('pakcli-virtual-folder-children')) as HTMLElement;
            if (currentlyCollapsed) {
              virtualFolderEl.classList.remove('is-collapsed');
              this.collapsedLetters.delete(letter);
              if (ch) ch.style.removeProperty('display');
            } else {
              virtualFolderEl.classList.add('is-collapsed');
              this.collapsedLetters.add(letter);
              if (ch) ch.style.display = 'none';
            }
          };
        }

        return virtualFolderEl;
      };

      const letters = [...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)), '#'];
      const activeLetters = letters.filter(letter => (letterMap.get(letter) || []).length > 0);

      // Remove virtual folders for letters with 0 files
      const existingVFs = Array.from(childrenContainer.querySelectorAll(':scope > .pakcli-virtual-folder[data-virtual-letter]')) as HTMLElement[];
      for (const vf of existingVFs) {
        const letter = vf.getAttribute('data-virtual-letter') || '';
        if (!activeLetters.includes(letter)) {
          const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file'));
          for (const f of files) {
            childrenContainer.appendChild(f);
          }
          vf.remove();
        }
      }

      // Build or update virtual folders
      const desiredVFEls: HTMLElement[] = [];
      for (const letter of activeLetters) {
        const fileEls = letterMap.get(letter)!;
        const vfEl = buildVirtualFolder(letter, fileEls.length);
        desiredVFEls.push(vfEl);

        const chDiv = Array.from(vfEl.children).find(c => c.classList.contains('pakcli-virtual-folder-children')) as HTMLElement;
        if (chDiv) {
          fileEls.sort((a, b) => {
            const nameA = a.getAttribute('data-path') || '';
            const nameB = b.getAttribute('data-path') || '';
            return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
          });

          // Only move/append if children of chDiv don't already match fileEls
          const currentChFiles = Array.from(chDiv.children);
          const chMatches = currentChFiles.length === fileEls.length &&
            currentChFiles.every((c, idx) => c === fileEls[idx]);

          if (!chMatches) {
            for (const el of fileEls) {
              if (el.parentElement !== chDiv) {
                chDiv.appendChild(el);
              }
            }
            for (let i = 0; i < fileEls.length; i++) {
              if (chDiv.children[i] !== fileEls[i]) {
                chDiv.appendChild(fileEls[i]);
              }
            }
          }
        }
      }

      // Mount/order virtual folders in childrenContainer only if needed
      const currentMountedVFs = Array.from(childrenContainer.querySelectorAll(':scope > .pakcli-virtual-folder[data-virtual-letter]')) as HTMLElement[];
      const vfOrderMatches = currentMountedVFs.length === desiredVFEls.length &&
        currentMountedVFs.every((c, idx) => c === desiredVFEls[idx]);

      if (!vfOrderMatches) {
        for (const vf of desiredVFEls) {
          if (vf.parentElement !== childrenContainer) {
            childrenContainer.appendChild(vf);
          }
        }
        for (let i = 0; i < desiredVFEls.length; i++) {
          if (childrenContainer.children[i] !== desiredVFEls[i]) {
            childrenContainer.appendChild(desiredVFEls[i]);
          }
        }
      }
    } catch (err) {
      console.error('[PakCLI Dictionary] Error applying virtual folders:', err);
    } finally {
      if (this.mutationObserver) {
        this.mutationObserver.takeRecords();
      }
      window.setTimeout(() => {
        this.isOrganizing = false;
        if (this.mutationObserver) {
          this.mutationObserver.takeRecords();
        }
      }, 120);
    }
  }
}
