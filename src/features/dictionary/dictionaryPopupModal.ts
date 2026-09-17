import { App, Modal, TFile, TFolder, setIcon, Menu, moment, normalizePath } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DictionaryFolderEntry } from '../explorer/types';

export class DictionaryPopupModal extends Modal {
  private plugin: PakCLITablePlugin;
  private searchQuery: string = '';
  private activeLetter: string | null = null;
  private currentScope: 'specific' | 'active' = 'specific';
  private searchInputEl: HTMLInputElement | null = null;
  private contentContainerEl: HTMLElement | null = null;
  private alphabetContainerEl: HTMLElement | null = null;

  constructor(plugin: PakCLITablePlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.currentScope = this.plugin.settings.dictionaryScope ?? 'specific';
    this.activeLetter = this.plugin.settings.dictionaryActiveLetter ?? null;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('pakcli-dict-modal');
    contentEl.empty();

    this.renderHeader(contentEl);
    this.renderAlphabetShortcuts(contentEl);

    const scrollArea = contentEl.createDiv({ cls: 'pakcli-dict-scroll-area' });
    this.contentContainerEl = scrollArea;

    this.renderBody();

    // Auto-focus search input
    window.setTimeout(() => {
      this.searchInputEl?.focus();
    }, 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  /** Gets folder scopes based on current scope */
  private getTargetFolderScopes(): { folder: TFolder; subfolderMode: 'exclude' | 'include' | 'own_az' }[] {
    if (this.currentScope === 'active') {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.parent) {
        return [{ folder: activeFile.parent, subfolderMode: 'include' }];
      }
      // Fallback: root
      return [{ folder: this.app.vault.getRoot(), subfolderMode: 'include' }];
    } else {
      const entries: DictionaryFolderEntry[] = this.plugin.dictionaryExplorerManager
        ? this.plugin.dictionaryExplorerManager.getDictionaryFolderEntries()
        : (this.plugin.settings.dictionaryFolders && this.plugin.settings.dictionaryFolders.length > 0
            ? this.plugin.settings.dictionaryFolders
            : [{ id: 'default', path: this.plugin.settings.dictionaryFolderPath || 'Dictionary', subfolderMode: 'own_az' }]);

      const scopes: { folder: TFolder; subfolderMode: 'exclude' | 'include' | 'own_az' }[] = [];
      for (const entry of entries) {
        const norm = normalizePath(entry.path);
        const abstract = this.app.vault.getAbstractFileByPath(norm);
        if (abstract instanceof TFolder) {
          scopes.push({ folder: abstract, subfolderMode: entry.subfolderMode || 'own_az' });
        }
      }
      return scopes;
    }
  }

  /** Gets the primary target folder for single-folder compatibility */
  private getTargetFolder(): TFolder | null {
    const scopes = this.getTargetFolderScopes();
    return scopes.length > 0 ? scopes[0].folder : null;
  }

  /** Gets all markdown files across all target scopes respecting subfolderMode */
  private getScopeFiles(): TFile[] {
    const scopes = this.getTargetFolderScopes();
    if (scopes.length === 0) return [];

    const files: TFile[] = [];
    const seenPaths = new Set<string>();

    for (const scope of scopes) {
      if (scope.subfolderMode === 'exclude') {
        // Direct files only
        for (const child of scope.folder.children) {
          if (child instanceof TFile && child.extension === 'md') {
            if (!child.name.toLowerCase().startsWith('index')) {
              if (!seenPaths.has(child.path)) {
                seenPaths.add(child.path);
                files.push(child);
              }
            }
          }
        }
      } else {
        // 'include' or 'own_az': recursively collect
        const collect = (f: TFolder) => {
          for (const child of f.children) {
            if (child instanceof TFile && child.extension === 'md') {
              if (!child.name.toLowerCase().startsWith('index')) {
                if (!seenPaths.has(child.path)) {
                  seenPaths.add(child.path);
                  files.push(child);
                }
              }
            } else if (child instanceof TFolder) {
              collect(child);
            }
          }
        };
        collect(scope.folder);
      }
    }

    return files.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { sensitivity: 'base' }));
  }

  /** Builds letter count map */
  private getLetterCounts(files: TFile[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let c = 65; c <= 90; c++) {
      counts[String.fromCharCode(c)] = 0;
    }
    counts['#'] = 0;

    for (const file of files) {
      const firstChar = file.basename.trim().charAt(0).toUpperCase();
      if (firstChar >= 'A' && firstChar <= 'Z') {
        counts[firstChar] = (counts[firstChar] || 0) + 1;
      } else {
        counts['#'] = (counts['#'] || 0) + 1;
      }
    }
    return counts;
  }

  private renderHeader(parent: HTMLElement) {
    const headerEl = parent.createDiv({ cls: 'pakcli-dict-header' });

    // Title Row
    const titleRow = headerEl.createDiv({ cls: 'pakcli-dict-title-row' });
    const titleLeft = titleRow.createDiv({ cls: 'pakcli-dict-title-left' });
    const titleIcon = titleLeft.createSpan({ cls: 'pakcli-dict-title-icon' });
    setIcon(titleIcon, 'book-marked');
    titleLeft.createEl('h2', { text: 'A–Z Dictionary Navigator', cls: 'pakcli-dict-title-text' });

    // Scope Selector Pill in Header
    const scopeWrapper = titleRow.createDiv({ cls: 'pakcli-dict-scope-wrapper' });
    const scopes = this.getTargetFolderScopes();
    let folderLabel = 'Dictionary (Not Found)';
    let tooltipText = '';

    if (this.currentScope === 'active') {
      const activeFile = this.app.workspace.getActiveFile();
      folderLabel = activeFile?.parent ? (activeFile.parent.path === '/' ? 'Vault Root' : activeFile.parent.path) : 'Vault Root';
      tooltipText = `Active Folder: ${folderLabel}. Click to switch to Specific Folder(s).`;
    } else {
      if (scopes.length === 1) {
        folderLabel = scopes[0].folder.path === '/' ? 'Vault Root' : scopes[0].folder.path;
        tooltipText = `Target: ${folderLabel} (${scopes[0].subfolderMode}). Click to switch to Active Folder.`;
      } else if (scopes.length > 1) {
        folderLabel = `${scopes.length} Folders`;
        tooltipText = `Targets:\n${scopes.map(s => `• ${s.folder.path} [${s.subfolderMode}]`).join('\n')}\nClick to switch to Active Folder.`;
      } else {
        folderLabel = this.plugin.settings.dictionaryFolderPath || 'Dictionary (Not Found)';
        tooltipText = `Target: ${folderLabel}. Click to switch to Active Folder.`;
      }
    }

    const scopeBtn = scopeWrapper.createEl('button', {
      cls: `pakcli-dict-scope-btn ${this.currentScope === 'active' ? 'is-active-scope' : ''}`,
      attr: { 'aria-label': tooltipText },
    });
    const scopeIcon = scopeBtn.createSpan({ cls: 'pakcli-dict-scope-icon' });
    setIcon(scopeIcon, this.currentScope === 'active' ? 'folder-clock' : 'folder');
    scopeBtn.createSpan({
      text: this.currentScope === 'active' ? `Active: ${folderLabel}` : `Folder: ${folderLabel}`,
      cls: 'pakcli-dict-scope-text',
    });

    scopeBtn.addEventListener('click', () => {
      this.currentScope = this.currentScope === 'specific' ? 'active' : 'specific';
      this.plugin.settings.dictionaryScope = this.currentScope;
      this.plugin.saveSettings();
      this.onOpen();
    });

    // Search Row
    const searchRow = headerEl.createDiv({ cls: 'pakcli-dict-search-row' });
    const searchWrap = searchRow.createDiv({ cls: 'pakcli-dict-search-wrap' });
    const searchIconEl = searchWrap.createSpan({ cls: 'pakcli-dict-search-icon' });
    setIcon(searchIconEl, 'search');

    const input = searchWrap.createEl('input', {
      type: 'text',
      cls: 'pakcli-dict-search-input',
      attr: { placeholder: 'Search dictionary terms, definitions...' },
    });
    input.value = this.searchQuery;
    this.searchInputEl = input;

    input.addEventListener('input', () => {
      this.searchQuery = input.value.trim().toLowerCase();
      this.renderBody();
    });

    if (this.searchQuery) {
      const clearBtn = searchWrap.createSpan({ cls: 'pakcli-dict-search-clear clickable-icon' });
      setIcon(clearBtn, 'x');
      clearBtn.addEventListener('click', () => {
        this.searchQuery = '';
        input.value = '';
        this.renderBody();
        input.focus();
      });
    }
  }

  private renderAlphabetShortcuts(parent: HTMLElement) {
    const files = this.getScopeFiles();
    const counts = this.getLetterCounts(files);

    const ribbonWrap = parent.createDiv({ cls: 'pakcli-dict-ribbon-wrap' });
    this.alphabetContainerEl = ribbonWrap;

    // ALL button
    const allBtn = ribbonWrap.createEl('button', {
      cls: `pakcli-dict-letter-btn ${this.activeLetter === null ? 'is-active is-pinned' : ''}`,
      text: `ALL (${files.length})`,
      attr: { 'aria-label': 'Show all terms (unpinned)' },
    });
    allBtn.addEventListener('click', () => {
      this.activeLetter = null;
      this.plugin.settings.dictionaryActiveLetter = null;
      this.plugin.saveSettings();
      this.updateAlphabetButtons();
      this.renderBody();
    });

    // Letters A-Z
    for (let c = 65; c <= 90; c++) {
      const letter = String.fromCharCode(c);
      const count = counts[letter] || 0;
      const isPinned = this.activeLetter === letter;
      const isDimmed = count === 0;

      const btn = ribbonWrap.createEl('button', {
        cls: `pakcli-dict-letter-btn ${isPinned ? 'is-active is-pinned' : ''} ${isDimmed ? 'is-dimmed' : ''}`,
        attr: {
          'data-letter': letter,
          'aria-label': `${letter}: ${count} term${count === 1 ? '' : 's'}${isPinned ? ' (Pinned - Click to unpin)' : ''}`,
        },
      });

      btn.createSpan({ text: letter, cls: 'pakcli-letter-char' });
      if (count > 0) {
        btn.createSpan({ text: `${count}`, cls: 'pakcli-letter-count' });
      }

      btn.addEventListener('click', () => {
        if (this.activeLetter === letter) {
          // Unpin if already active
          this.activeLetter = null;
        } else {
          // Pin this letter
          this.activeLetter = letter;
        }
        this.plugin.settings.dictionaryActiveLetter = this.activeLetter;
        this.plugin.saveSettings();
        this.updateAlphabetButtons();
        this.renderBody();
      });
    }

    // Symbol / Number '#'
    const numCount = counts['#'] || 0;
    const isNumPinned = this.activeLetter === '#';
    const numBtn = ribbonWrap.createEl('button', {
      cls: `pakcli-dict-letter-btn ${isNumPinned ? 'is-active is-pinned' : ''} ${numCount === 0 ? 'is-dimmed' : ''}`,
      attr: {
        'data-letter': '#',
        'aria-label': `Numbers & Symbols: ${numCount} terms`,
      },
    });
    numBtn.createSpan({ text: '#', cls: 'pakcli-letter-char' });
    if (numCount > 0) {
      numBtn.createSpan({ text: `${numCount}`, cls: 'pakcli-letter-count' });
    }
    numBtn.addEventListener('click', () => {
      this.activeLetter = this.activeLetter === '#' ? null : '#';
      this.plugin.settings.dictionaryActiveLetter = this.activeLetter;
      this.plugin.saveSettings();
      this.updateAlphabetButtons();
      this.renderBody();
    });
  }

  private updateAlphabetButtons() {
    if (!this.alphabetContainerEl) return;
    const buttons = this.alphabetContainerEl.querySelectorAll('.pakcli-dict-letter-btn');
    buttons.forEach((b) => {
      const letter = b.getAttribute('data-letter');
      if (!letter) {
        // ALL button
        if (this.activeLetter === null) {
          b.addClass('is-active', 'is-pinned');
        } else {
          b.removeClass('is-active', 'is-pinned');
        }
      } else {
        if (this.activeLetter === letter) {
          b.addClass('is-active', 'is-pinned');
        } else {
          b.removeClass('is-active', 'is-pinned');
        }
      }
    });
  }

  private renderBody() {
    if (!this.contentContainerEl) return;
    const container = this.contentContainerEl;
    container.empty();

    const allScopeFiles = this.getScopeFiles();
    if (allScopeFiles.length === 0) {
      const empty = container.createDiv({ cls: 'pakcli-dict-empty-state' });
      setIcon(empty.createDiv({ cls: 'pakcli-dict-empty-icon' }), 'book-open');
      const scopes = this.getTargetFolderScopes();
      const scopeDesc = scopes.length > 0 ? scopes.map(s => s.folder.path).join(', ') : (this.plugin.settings.dictionaryFolderPath || 'target folders');
      empty.createDiv({
        cls: 'pakcli-dict-empty-title',
        text: `No dictionary notes found in ${scopeDesc}.`,
      });
      empty.createDiv({
        cls: 'pakcli-dict-empty-sub',
        text: 'Create markdown files or switch scope to start browsing terms.',
      });
      return;
    }

    // 1. PINNED TERMS SECTION (if any pinned terms exist in this scope)
    const pinnedPaths = new Set(this.plugin.settings.dictionaryPinnedTerms || []);
    const pinnedFiles = allScopeFiles.filter((f) => pinnedPaths.has(f.path));
    if (pinnedFiles.length > 0 && !this.searchQuery && !this.activeLetter) {
      this.renderSectionHeader(container, '📌 Pinned Terms', pinnedFiles.length);
      const pinnedList = container.createDiv({ cls: 'pakcli-dict-list pakcli-dict-pinned-list' });
      for (const file of pinnedFiles) {
        this.renderListItem(pinnedList, file, true);
      }
    }

    // 2. RECENT DICTIONARY FILES (Files in this dictionary scope recently accessed/modified)
    if (!this.searchQuery && !this.activeLetter) {
      const scopeFilePaths = new Set(allScopeFiles.map((f) => f.path));
      const lastOpenPaths = this.app.workspace.getLastOpenFiles() || [];
      const recentScopeFiles: TFile[] = [];

      for (const p of lastOpenPaths) {
        if (scopeFilePaths.has(p)) {
          const f = this.app.vault.getAbstractFileByPath(p);
          if (f instanceof TFile) recentScopeFiles.push(f);
        }
      }

      // If lastOpenFiles has few, sort scope files by mtime
      if (recentScopeFiles.length < 5) {
        const sortedByMtime = [...allScopeFiles].sort((a, b) => b.stat.mtime - a.stat.mtime);
        for (const f of sortedByMtime) {
          if (!recentScopeFiles.includes(f) && recentScopeFiles.length < 6) {
            recentScopeFiles.push(f);
          }
        }
      }

      if (recentScopeFiles.length > 0) {
        this.renderSectionHeader(container, '🕒 Recent Dictionary Terms', recentScopeFiles.length);
        const recentList = container.createDiv({ cls: 'pakcli-dict-list pakcli-dict-recent-list' });
        for (const file of recentScopeFiles) {
          this.renderListItem(recentList, file, false, true);
        }
      }
    }

    // 3. DICTIONARY TERMS (• ☰ List View)
    let filteredFiles = allScopeFiles;

    // Filter by pinned letter if active
    if (this.activeLetter) {
      if (this.activeLetter === '#') {
        filteredFiles = filteredFiles.filter((f) => {
          const c = f.basename.trim().charAt(0).toUpperCase();
          return !(c >= 'A' && c <= 'Z');
        });
      } else {
        filteredFiles = filteredFiles.filter((f) => f.basename.trim().toUpperCase().startsWith(this.activeLetter!));
      }
    }

    // Filter by search query
    if (this.searchQuery) {
      filteredFiles = filteredFiles.filter((f) => f.basename.toLowerCase().includes(this.searchQuery));
    }

    const titlePrefix = this.activeLetter ? `LIST: [ ${this.activeLetter} ]` : 'LIST: ALL TERMS';
    this.renderSectionHeaderWithControls(container, `• ☰ ${titlePrefix}`, filteredFiles.length);

    if (filteredFiles.length === 0) {
      const noMatch = container.createDiv({ cls: 'pakcli-dict-no-match' });
      noMatch.setText('No matching dictionary terms.');
      return;
    }

    // If modal display mode is 'grouped', render as collapsible virtual letter folders
    if (this.plugin.settings.dictionaryDisplayMode === 'grouped') {
      const letterGroups = new Map<string, TFile[]>();
      for (const file of filteredFiles) {
        const firstChar = file.basename.trim().charAt(0).toUpperCase();
        const key = firstChar >= 'A' && firstChar <= 'Z' ? firstChar : '#';
        if (!letterGroups.has(key)) {
          letterGroups.set(key, []);
        }
        letterGroups.get(key)!.push(file);
      }

      const sortedKeys = Array.from(letterGroups.keys()).sort((a, b) => {
        if (a === '#') return 1;
        if (b === '#') return -1;
        return a.localeCompare(b);
      });

      const foldersContainer = container.createDiv({ cls: 'pakcli-dict-virtual-folders-list' });

      for (const letter of sortedKeys) {
        const filesInLetter = letterGroups.get(letter) || [];
        const isCollapsed = this.collapsedLetters.has(letter);

        const folderGroup = foldersContainer.createDiv({
          cls: `pakcli-dict-folder-group ${isCollapsed ? 'is-collapsed' : ''}`,
          attr: { 'data-letter': letter },
        });

        // Virtual Folder Header Row
        const folderHeader = folderGroup.createDiv({ cls: 'pakcli-dict-folder-header is-clickable' });
        const folderLeft = folderHeader.createDiv({ cls: 'pakcli-dict-folder-left' });

        const chevron = folderLeft.createSpan({ cls: 'pakcli-dict-folder-chevron' });
        setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');

        const fIcon = folderLeft.createSpan({ cls: 'pakcli-dict-folder-icon' });
        setIcon(fIcon, isCollapsed ? 'folder' : 'folder-open');

        folderLeft.createSpan({ text: letter, cls: 'pakcli-dict-folder-name' });
        folderHeader.createSpan({ text: `${filesInLetter.length} terms`, cls: 'pakcli-dict-folder-count' });

        folderHeader.addEventListener('click', () => {
          if (this.collapsedLetters.has(letter)) {
            this.collapsedLetters.delete(letter);
            folderGroup.removeClass('is-collapsed');
            setIcon(chevron, 'chevron-down');
            setIcon(fIcon, 'folder-open');
          } else {
            this.collapsedLetters.add(letter);
            folderGroup.addClass('is-collapsed');
            setIcon(chevron, 'chevron-right');
            setIcon(fIcon, 'folder');
          }
        });

        const childrenContainer = folderGroup.createDiv({ cls: 'pakcli-dict-folder-children pakcli-dict-list' });
        for (const file of filesInLetter) {
          this.renderListItem(childrenContainer, file, pinnedPaths.has(file.path));
        }
      }
    } else {
      // Default: Clean flat list (• ☰ LIST: ALL TERMS) matching user's reference
      const termList = container.createDiv({ cls: 'pakcli-dict-list' });
      for (const file of filteredFiles) {
        this.renderListItem(termList, file, pinnedPaths.has(file.path));
      }
    }
  }

  private collapsedLetters: Set<string> = new Set();

  private renderSectionHeaderWithControls(parent: HTMLElement, title: string, count: number) {
    const secHeader = parent.createDiv({ cls: 'pakcli-dict-section-header' });
    const leftWrap = secHeader.createDiv({ cls: 'pakcli-dict-section-left' });
    leftWrap.createSpan({ text: title, cls: 'pakcli-dict-section-title' });
    leftWrap.createSpan({ text: `${count}`, cls: 'pakcli-dict-section-count' });

    const controls = secHeader.createDiv({ cls: 'pakcli-dict-section-controls' });

    // Mode switch button: List vs Folders
    const isFolderMode = this.plugin.settings.dictionaryDisplayMode === 'grouped';
    const modeBtn = controls.createEl('button', {
      text: isFolderMode ? '📁 Folder View' : '☰ List View',
      cls: 'pakcli-dict-ctrl-btn',
      attr: { 'aria-label': 'Toggle between Flat List and Virtual Folders inside popup' },
    });
    modeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.plugin.settings.dictionaryDisplayMode = isFolderMode ? 'list' : 'grouped';
      this.plugin.saveSettings();
      this.renderBody();
    });

    if (isFolderMode) {
      const expandAllBtn = controls.createEl('button', { text: 'Expand All', cls: 'pakcli-dict-ctrl-btn' });
      const collapseAllBtn = controls.createEl('button', { text: 'Collapse All', cls: 'pakcli-dict-ctrl-btn' });

      expandAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.collapsedLetters.clear();
        this.renderBody();
      });

      collapseAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        for (let c = 65; c <= 90; c++) this.collapsedLetters.add(String.fromCharCode(c));
        this.collapsedLetters.add('#');
        this.renderBody();
      });
    }
  }

  private renderSectionHeader(parent: HTMLElement, title: string, count: number) {
    const secHeader = parent.createDiv({ cls: 'pakcli-dict-section-header' });
    secHeader.createSpan({ text: title, cls: 'pakcli-dict-section-title' });
    secHeader.createSpan({ text: `${count}`, cls: 'pakcli-dict-section-count' });
  }

  /**
   * Renders a single dictionary note item matching the user's reference:
   * • ☰ List item
   */
  private renderListItem(parent: HTMLElement, file: TFile, isPinned: boolean, showTime = false) {
    const row = parent.createDiv({ cls: 'pakcli-dict-item' });

    // Bullet dot indicator: •
    row.createSpan({ text: '•', cls: 'pakcli-dict-bullet' });

    // List icon: ☰
    const iconSpan = row.createSpan({ cls: 'pakcli-dict-list-icon' });
    setIcon(iconSpan, 'list');

    // Title
    row.createSpan({ cls: 'pakcli-dict-item-title', text: file.basename });

    // Actions & Info on right
    const metaWrap = row.createDiv({ cls: 'pakcli-dict-item-meta' });

    if (showTime) {
      const timeStr = moment(file.stat.mtime).fromNow();
      metaWrap.createSpan({ cls: 'pakcli-dict-item-time', text: timeStr });
    }

    // Pin Toggle Icon
    const pinBtn = metaWrap.createSpan({
      cls: `pakcli-dict-pin-btn clickable-icon ${isPinned ? 'is-pinned' : ''}`,
      attr: { 'aria-label': isPinned ? 'Unpin term' : 'Pin term to top' },
    });
    setIcon(pinBtn, 'pin');
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePinTerm(file.path);
    });

    // Hover link preview
    row.addEventListener('mouseover', (e: MouseEvent) => {
      this.app.workspace.trigger('hover-link', {
        event: e,
        source: 'preview',
        hoverParent: this,
        targetEl: row,
        linktext: file.path,
        sourcePath: file.path,
      });
    });

    // Click to open note
    row.addEventListener('click', async (e: MouseEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      const leaf = this.app.workspace.getLeaf(isMod);
      await leaf.openFile(file);
      this.close();
    });

    // Right-click context menu
    row.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = new Menu();

      menu.addItem((item) => {
        item.setTitle(`Open ${file.basename}`).setIcon('file-text').onClick(async () => {
          const leaf = this.app.workspace.getLeaf(false);
          await leaf.openFile(file);
          this.close();
        });
      });

      menu.addItem((item) => {
        item.setTitle('Open in new tab').setIcon('file-plus').onClick(async () => {
          const leaf = this.app.workspace.getLeaf(true);
          await leaf.openFile(file);
          this.close();
        });
      });

      menu.addItem((item) => {
        item.setTitle(isPinned ? 'Unpin term' : 'Pin term').setIcon('pin').onClick(() => {
          this.togglePinTerm(file.path);
        });
      });

      menu.showAtMouseEvent(e);
    });
  }

  private togglePinTerm(path: string) {
    let pinned = this.plugin.settings.dictionaryPinnedTerms || [];
    if (pinned.includes(path)) {
      pinned = pinned.filter((p) => p !== path);
    } else {
      pinned = [...pinned, path];
    }
    this.plugin.settings.dictionaryPinnedTerms = pinned;
    this.plugin.saveSettings();
    this.renderBody();
  }
}
