import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type PakCLITablePlugin from '../../main';

export class DictionaryExplorerManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private collapsedLetters: Set<string> = new Set();
  private mutationObserver: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private navFilesContainer: HTMLElement | null = null;

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
    this.disconnectObserver();
    this.removeVirtualFolders();
  }

  public scheduleRefresh() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.refreshVirtualFolders();
    }, 80);
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

    if (!this.mutationObserver) {
      this.mutationObserver = new MutationObserver((mutations) => {
        if (document.querySelector('.nav-folder-title input, .nav-file-title input')) return;

        let shouldRefresh = false;

        for (const mut of mutations) {
          const targetEl = mut.target as HTMLElement;
          if (!targetEl) continue;

          // Completely ignore anything inside our virtual folders
          if (targetEl.classList?.contains('pakcli-virtual-folder') ||
              targetEl.closest?.('.pakcli-virtual-folder')) continue;

          // For attribute mutations, only care about the dict folder's own class changes
          if (mut.type === 'attributes') {
            if (targetEl.classList.contains('nav-folder')) {
              const title = targetEl.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self');
              const p = normalizePath(title?.getAttribute('data-path') || targetEl.getAttribute('data-path') || '');
              if (this.isMatchingDictFolder(p)) {
                shouldRefresh = true;
                break;
              }
            }
            continue;
          }

          // childList mutations: check added nodes
          if (mut.addedNodes?.length > 0) {
            for (let i = 0; i < mut.addedNodes.length; i++) {
              const node = mut.addedNodes[i] as HTMLElement;
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              if (node.classList?.contains('pakcli-virtual-folder') ||
                  node.closest?.('.pakcli-virtual-folder')) continue;
              const p = normalizePath(node.getAttribute?.('data-path') || '');
              if (this.isMatchingDictFolder(p)) { shouldRefresh = true; break; }
              const pf = node.closest?.('.nav-folder:not(.pakcli-virtual-folder), .tree-item.nav-folder:not(.pakcli-virtual-folder)');
              if (pf) {
                const t = pf.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self');
                const fp = normalizePath(t?.getAttribute('data-path') || pf.getAttribute('data-path') || '');
                if (this.isMatchingDictFolder(fp)) { shouldRefresh = true; break; }
              }
            }
          }
          if (shouldRefresh) break;

          // childList mutations: check removed nodes
          if (mut.removedNodes?.length > 0) {
            for (let i = 0; i < mut.removedNodes.length; i++) {
              const node = mut.removedNodes[i] as HTMLElement;
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              if (node.classList?.contains('pakcli-virtual-folder') ||
                  node.closest?.('.pakcli-virtual-folder')) continue;
              const p = normalizePath(node.getAttribute?.('data-path') || '');
              if (this.isMatchingDictFolder(p)) { shouldRefresh = true; break; }
            }
          }
          if (shouldRefresh) break;

          const targetPath = normalizePath(targetEl.getAttribute?.('data-path') || '');
          if (targetPath && this.isMatchingDictFolder(targetPath)) { shouldRefresh = true; break; }
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

    const dictRoot = this.getDictionaryFolderPath();
    const folderEl = this.findDictionaryFolderEl(container, dictRoot);
    if (!folderEl) return;

    const childrenContainer = folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') as HTMLElement;
    if (!childrenContainer) return;

    this.disconnectObserver();
    try {
      const virtualFolders = Array.from(childrenContainer.querySelectorAll('.pakcli-dict-virtual-folder, .pakcli-virtual-folder[data-virtual-letter]'));
      for (const vf of virtualFolders) {
        const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file'));
        for (const f of files) childrenContainer.appendChild(f);
        vf.remove();
      }
    } finally {
      this.connectObserver();
    }
  }

  // ── Find the dictionary folder DOM element ────────────────────────────────

  private findDictionaryFolderEl(container: HTMLElement, dictRoot: string): HTMLElement | null {
    const normalizedTarget = normalizePath(dictRoot).toLowerCase();

    let titleEl = container.querySelector(`.nav-folder-title[data-path="${normalizedTarget}"], .tree-item-self[data-path="${normalizedTarget}"]`) as HTMLElement;
    if (!titleEl) {
      const allElements = Array.from(container.querySelectorAll('[data-path]'));
      titleEl = (allElements.find(el => {
        const p = normalizePath(el.getAttribute('data-path') || '').toLowerCase();
        return p === normalizedTarget || p.endsWith('/' + normalizedTarget);
      }) as HTMLElement) || null;
    }

    if (titleEl) {
      if (!(titleEl as any).__pakcli_dict_click_bound) {
        (titleEl as any).__pakcli_dict_click_bound = true;
        titleEl.addEventListener('click', () => {
          window.setTimeout(() => this.scheduleRefresh(), 60);
        });
      }
      return (titleEl.closest('.nav-folder, .tree-item.nav-folder') || titleEl.parentElement) as HTMLElement;
    }

    const allFolders = Array.from(container.querySelectorAll('.nav-folder, .tree-item.nav-folder')) as HTMLElement[];
    for (const f of allFolders) {
      const p = normalizePath(f.getAttribute('data-path') || f.querySelector('.nav-folder-title, .tree-item-self')?.getAttribute('data-path') || '').toLowerCase();
      if (p === normalizedTarget || p.endsWith('/' + normalizedTarget)) return f;
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

    if (document.querySelector('.nav-folder-title input, .nav-file-title input')) return;

    const dictRoot = this.getDictionaryFolderPath();
    const folderEl = this.findDictionaryFolderEl(container, dictRoot);
    if (!folderEl) return;

    const childrenContainer = (folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
      folderEl.querySelector('.nav-folder-children, .tree-item-children')) as HTMLElement;
    if (!childrenContainer) return;

    if (folderEl.classList.contains('is-collapsed')) return;

    // ── Disconnect observer for the entire DOM operation window ─────────────
    this.disconnectObserver();

    try {
      // 1. Collect all nav-file elements (including those already in virtual folders)
      const allNavFileEls = Array.from(childrenContainer.querySelectorAll('.nav-file, .tree-item.nav-file')) as HTMLElement[];

      const fileElMap = new Map<string, HTMLElement>();
      for (const fileEl of allNavFileEls) {
        const path = fileEl.getAttribute('data-path') ||
          fileEl.querySelector('.nav-file-title, .tree-item-self')?.getAttribute('data-path') || '';
        if (path) fileElMap.set(normalizePath(path), fileEl);
      }

      // 2. Group by letter
      const letterMap = new Map<string, HTMLElement[]>();
      for (let c = 65; c <= 90; c++) letterMap.set(String.fromCharCode(c), []);
      letterMap.set('#', []);

      fileElMap.forEach((el, path) => {
        const abstract = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!(abstract instanceof TFile)) return;

        // Keep index files at root
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
      });

      const letters = [...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)), '#'];
      const activeLetters = letters.filter(letter => (letterMap.get(letter) || []).length > 0);

      // 3. Remove virtual folders for letters with 0 files, recovering their files
      const existingVFs = Array.from(childrenContainer.querySelectorAll(':scope > .pakcli-virtual-folder[data-virtual-letter]')) as HTMLElement[];
      for (const vf of existingVFs) {
        const letter = vf.getAttribute('data-virtual-letter') || '';
        if (!activeLetters.includes(letter)) {
          const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file'));
          for (const f of files) childrenContainer.appendChild(f);
          vf.remove();
        }
      }

      // 4. Build or update virtual folders
      const desiredVFEls: HTMLElement[] = [];

      for (const letter of activeLetters) {
        const fileEls = letterMap.get(letter)!;
        const isCollapsed = this.collapsedLetters.has(letter);

        // Find or create the virtual folder element
        let vfEl = childrenContainer.querySelector(`.pakcli-virtual-folder[data-virtual-letter="${letter}"]`) as HTMLElement;

        if (!vfEl) {
          // ── Create new virtual folder ──────────────────────────────────
          vfEl = document.createElement('div');
          vfEl.className = `nav-folder tree-item pakcli-virtual-folder pakcli-dict-virtual-folder${isCollapsed ? ' is-collapsed' : ''}`;
          vfEl.setAttribute('data-virtual-letter', letter);
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
          countSpan.textContent = String(fileEls.length);
          titleDiv.appendChild(countSpan);

          vfEl.appendChild(titleDiv);

          // Children container
          const chDiv = document.createElement('div');
          chDiv.className = 'nav-folder-children tree-item-children pakcli-virtual-folder-children';
          if (isCollapsed) {
            chDiv.style.setProperty('display', 'none', 'important');
          }
          vfEl.appendChild(chDiv);

          // ── Click handler: set ONCE at creation ────────────────────────
          titleDiv.addEventListener('click', (e: MouseEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();

            const nowCollapsed = vfEl.classList.contains('is-collapsed');
            const ch = vfEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;

            if (nowCollapsed) {
              vfEl.classList.remove('is-collapsed');
              this.collapsedLetters.delete(letter);
              if (ch) ch.style.removeProperty('display');
            } else {
              vfEl.classList.add('is-collapsed');
              this.collapsedLetters.add(letter);
              if (ch) ch.style.setProperty('display', 'none', 'important');
            }
          }, { capture: true });

        } else {
          // ── Update existing virtual folder ─────────────────────────────
          // Update class
          if (isCollapsed && !vfEl.classList.contains('is-collapsed')) {
            vfEl.classList.add('is-collapsed');
          } else if (!isCollapsed && vfEl.classList.contains('is-collapsed')) {
            vfEl.classList.remove('is-collapsed');
          }

          // Update count
          const countSpan = vfEl.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-count');
          if (countSpan && countSpan.textContent !== String(fileEls.length)) {
            countSpan.textContent = String(fileEls.length);
          }

          // Update children visibility
          const ch = vfEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
          if (ch) {
            if (isCollapsed) {
              ch.style.setProperty('display', 'none', 'important');
            } else {
              ch.style.removeProperty('display');
            }
          }
        }

        desiredVFEls.push(vfEl);

        // 5. Move files into the children container (only if out of place)
        const chDiv = vfEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
        if (chDiv) {
          fileEls.sort((a, b) => {
            const nameA = a.getAttribute('data-path') || '';
            const nameB = b.getAttribute('data-path') || '';
            return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
          });

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
        for (const vf of desiredVFEls) {
          if (vf.parentElement !== childrenContainer) childrenContainer.appendChild(vf);
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
      // Reconnect observer after a brief delay to absorb any residual Obsidian mutations
      window.setTimeout(() => this.connectObserver(), 150);
    }
  }
}
