import { App, Notice, TFile, TFolder, normalizePath, setIcon } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DEFAULT_RELATIONSHIP_TIERS, RelationshipTierConfig, RelationshipViewStructure, RelationshipSortOrder, RelationshipFolderEntry } from '../../settings';

export class RelationshipExplorerManager {
    private app: App;
    private plugin: PakCLITablePlugin;
    private collapsedTierIds: Set<string> = new Set();
    private relChildrenContainers: Set<HTMLElement> = new Set();
    private isOrganizing: boolean = false;
    private isToggling: boolean = false;
    private mutationObserver: MutationObserver | null = null;
    private rafId: number | null = null;
    private needsFollowUpPass = false;
    private trailingTimer: number | null = null;
    private navFilesContainer: HTMLElement | null = null;
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
        return !!explorerEl.querySelector('input:not([type="checkbox"]), .nav-folder-title[contenteditable="true"], .nav-file-title[contenteditable="true"], .nav-folder-title [contenteditable="true"], .nav-file-title [contenteditable="true"], .tree-item-inner[contenteditable="true"]');
    }

    public scheduleRefresh(delayMs: number = 80) {
        if (this.isOrganizing || this.isToggling) return;

        if (this.trailingTimer !== null) {
            window.clearTimeout(this.trailingTimer);
            this.trailingTimer = null;
        }
        this.trailingTimer = window.setTimeout(() => {
            this.trailingTimer = null;
            if (this.isRenamingInExplorer() || this.isOrganizing || this.isToggling) {
                return;
            }
            if (this.isScrolling) {
                this.scheduleRefresh(150);
                return;
            }
            this.lastRefreshTime = Date.now();
            this.refreshVirtualFolders();
        }, delayMs);
    }

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

    public getRelationshipFolderEntries(): RelationshipFolderEntry[] {
        const folders = this.plugin.settings.relationshipFolders;
        if (folders && folders.length > 0) {
            return folders.filter(f => !!f.path && !!f.path.trim()).map(f => ({
                id: f.id || `rel_${f.path}`,
                path: normalizePath(f.path.trim()),
                mode: f.mode || '1dir',
                viewStructure: f.viewStructure || 'concentric',
                sortOrder: f.sortOrder || 'closeness_desc',
                label: f.label
            }));
        }
        return [{
            id: 'rel_default',
            path: normalizePath(this.plugin.settings.familyCirclesRootFolder || 'Relationships'),
            mode: this.plugin.settings.relationshipMode || '1dir',
            viewStructure: this.plugin.settings.relationshipViewStructure || 'concentric',
            sortOrder: this.plugin.settings.relationshipSortOrder || 'closeness_desc',
            label: 'Primary Relationships'
        }];
    }

    public isMatchingRelFolder(path: string): boolean {
        if (!path) return false;
        const p = normalizePath(path).toLowerCase();
        const entries = this.getRelationshipFolderEntries();
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

    private registerEvents() {
        this.plugin.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.scheduleRefresh();
                this.observeExplorer();
            })
        );

        this.plugin.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (this.isMatchingRelFolder(file.path) || (oldPath && this.isMatchingRelFolder(oldPath))) {
                    this.scheduleRefresh();
                }
            })
        );

        this.plugin.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (this.isMatchingRelFolder(file.path)) {
                    this.scheduleRefresh();
                }
            })
        );

        this.plugin.registerEvent(
            this.app.vault.on('create', (file) => {
                if (this.isMatchingRelFolder(file.path)) {
                    this.scheduleRefresh();
                }
            })
        );

        this.plugin.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                if (this.isMatchingRelFolder(file.path)) {
                    this.scheduleRefresh();
                }
            })
        );
    }

    private observeExplorer() {
        this.disconnectObserver();

        const leaves = this.app.workspace.getLeavesOfType('file-explorer');
        if (!leaves || leaves.length === 0) return;
        const container = (leaves[0].view as any)?.containerEl as HTMLElement;
        if (!container) return;

        const navFiles = (container.querySelector('.nav-files-container') || container) as HTMLElement;
        this.navFilesContainer = navFiles;

        if (!this.scrollBoundHandler) {
            this.scrollBoundHandler = () => {
                this.isScrolling = true;
                if (this.scrollTimer !== null) window.clearTimeout(this.scrollTimer);
                this.scrollTimer = window.setTimeout(() => {
                    this.isScrolling = false;
                    this.scrollTimer = null;
                }, 250);
            };
            window.addEventListener('scroll', this.scrollBoundHandler, { capture: true, passive: true });
            window.addEventListener('wheel', this.scrollBoundHandler, { passive: true });
        }

        if (!this.mutationObserver && this.navFilesContainer) {
            this.mutationObserver = new MutationObserver((mutations) => {
                if (this.isRenamingInExplorer() || this.isOrganizing || this.isToggling) {
                    return;
                }

                let shouldRefresh = false;

                for (const mut of mutations) {
                    const targetEl = mut.target as HTMLElement;
                    if (!targetEl) continue;

                    // Ignore mutations inside our virtual folders
                    if (targetEl.classList?.contains('pakcli-virtual-folder') || targetEl.closest?.('.pakcli-virtual-folder')) continue;

                    // 1. Folder expand/collapse attribute change
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
                                if (folderPath && this.isMatchingRelFolder(folderPath)) {
                                    shouldRefresh = true;
                                    break;
                                }
                            }
                        }
                    }

                    // 2. ChildList mutation: only refresh when files are actually added to relationship folders that lack virtual folders
                    if (mut.type === 'childList') {
                        const targetChildren = (targetEl.classList.contains('nav-folder-children') || targetEl.classList.contains('tree-item-children'))
                            ? targetEl
                            : (targetEl.closest('.nav-folder-children, .tree-item-children') as HTMLElement | null);
                        if (targetChildren && targetChildren.querySelector(':scope > .pakcli-virtual-folder')) {
                            continue;
                        }

                        if (mut.addedNodes && mut.addedNodes.length > 0) {
                            const hasAddedFile = Array.from(mut.addedNodes).some(n => {
                                const el = n as HTMLElement;
                                if (el.nodeType !== Node.ELEMENT_NODE) return false;
                                if (el.classList?.contains('pakcli-virtual-folder') || el.closest?.('.pakcli-virtual-folder')) return false;
                                return el.classList?.contains('nav-file') || !!el.querySelector?.('.nav-file:not(.pakcli-virtual-folder *)');
                            });
                            if (hasAddedFile) {
                                const parentFolder = targetChildren ? (targetChildren.closest('.nav-folder') as HTMLElement | null) : null;
                                if (parentFolder && !parentFolder.classList.contains('mod-root') && !parentFolder.classList.contains('pakcli-virtual-folder')) {
                                    const titleEl = (parentFolder.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self') || parentFolder) as HTMLElement;
                                    const folderPath = titleEl.getAttribute('data-path') || parentFolder.getAttribute('data-path') || '';
                                    if (folderPath && this.isMatchingRelFolder(folderPath)) {
                                        const isCollapsed = parentFolder.classList.contains('is-collapsed') || titleEl.classList.contains('is-collapsed');
                                        if (!isCollapsed) {
                                            shouldRefresh = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (shouldRefresh) this.scheduleRefresh(150);
            });
        }

        this.connectObserver();
    }

    private resolveDraggedFile(e: DragEvent): TFile | null {
        // 1. Check Obsidian's internal dragManager
        const dm = (this.app as any).dragManager;
        if (dm) {
            if (dm.dragFile instanceof TFile) return dm.dragFile;
            if (Array.isArray(dm.dragFiles) && dm.dragFiles[0] instanceof TFile) return dm.dragFiles[0];
            if (dm.activeDrag?.file instanceof TFile) return dm.activeDrag.file;
            if (Array.isArray(dm.activeDrag?.files) && dm.activeDrag.files[0] instanceof TFile) return dm.activeDrag.files[0];
            if (dm.draggable?.file instanceof TFile) return dm.draggable.file;
        }

        // 2. Check HTML5 dataTransfer
        if (e.dataTransfer) {
            const text = e.dataTransfer.getData('text/plain') || '';
            if (text) {
                const clean = text.replace(/^\[\[(.*?)\]\]$/, '$1').trim();
                let file = this.app.vault.getAbstractFileByPath(normalizePath(clean));
                if (file instanceof TFile) return file;

                file = this.app.vault.getAbstractFileByPath(normalizePath(clean + '.md'));
                if (file instanceof TFile) return file;

                const allMd = this.app.vault.getMarkdownFiles();
                const matched = allMd.find(f => f.basename === clean || f.name === clean || f.path.endsWith('/' + clean));
                if (matched) return matched;
            }

            const uri = e.dataTransfer.getData('text/uri-list') || '';
            if (uri) {
                const decoded = decodeURIComponent(uri);
                const allMd = this.app.vault.getMarkdownFiles();
                const matched = allMd.find(f => decoded.includes(f.name) || decoded.includes(f.path));
                if (matched) return matched;
            }
        }

        return null;
    }

    private findRelationshipFolderEl(container: HTMLElement, relPath: string): HTMLElement | null {
        if (!container || !relPath) return null;
        const normalizedTarget = normalizePath(relPath).toLowerCase();
        const targetName = relPath.split('/').pop()?.toLowerCase();

        // 1. Direct query on folder elements or direct folder titles
        let folderEl = container.querySelector(
            `.nav-folder[data-path="${relPath}"], .tree-item.nav-folder[data-path="${relPath}"]`
        ) as HTMLElement;

        if (!folderEl) {
            const titleEl = container.querySelector(
                `.nav-folder > .nav-folder-title[data-path="${relPath}"], .tree-item.nav-folder > .tree-item-self[data-path="${relPath}"]`
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
            // Second pass: path ends with normalized target (e.g. target is "Relationships" and folder is "Digital Library/Relationships")
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
            if (title && !(title as any).__pakcli_rel_click_bound) {
                (title as any).__pakcli_rel_click_bound = true;
                title.addEventListener('click', () => {
                    window.setTimeout(() => this.scheduleRefresh(), 60);
                });
            }
            return folderEl;
        }

        return null;
    }

    public refreshVirtualFolders() {
        if (this.isToggling) return;
        if (this.isOrganizing) {
            return;
        }

        const isEnabled = this.plugin.settings.explorerRelationshipVirtualFolders !== false;
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

        const entries = this.getRelationshipFolderEntries();
        if (entries.length === 0) return;

        this.isOrganizing = true;
        this.disconnectObserver();
        this.relChildrenContainers.clear();

        try {
            for (const entry of entries) {
                if (entry.viewStructure === 'flat') {
                    this.removeVirtualFoldersForEntry(container, entry.path);
                } else {
                    this.applyVirtualFoldersToEntry(container, entry);
                }
            }
        } catch (err) {
            console.error('[PakCLI Relationship] Error refreshing virtual folders:', err);
        } finally {
            this.isOrganizing = false;
            // Drain our own DOM mutations BEFORE reconnecting so the observer doesn't immediately re-fire
            this.mutationObserver?.takeRecords();
            this.connectObserver();
        }
    }

    private applyVirtualFoldersToEntry(container: HTMLElement, entry: RelationshipFolderEntry) {
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

        const actualPath = folderAbstract instanceof TFolder ? folderAbstract.path : normPath;
        const folderEl = this.findRelationshipFolderEl(container, actualPath) || this.findRelationshipFolderEl(container, normPath);
        if (!folderEl) return;

        const childrenContainer = (folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
            folderEl.querySelector('.nav-folder-children, .tree-item-children')) as HTMLElement;
        if (!childrenContainer) return;

        this.relChildrenContainers.add(childrenContainer);

        const isFolderCollapsed = folderEl.classList.contains('is-collapsed') ||
            folderEl.querySelector(':scope > .nav-folder-title, :scope > .tree-item-self')?.classList.contains('is-collapsed');
        if (isFolderCollapsed) return;

        const viewStructure: RelationshipViewStructure = entry.viewStructure || 'concentric';
        const sortOrder: RelationshipSortOrder = entry.sortOrder || 'closeness_desc';

        try {
            const configuredTiers: RelationshipTierConfig[] = this.plugin.settings.relationshipTiers || DEFAULT_RELATIONSHIP_TIERS;
            const tiers: RelationshipTierConfig[] = configuredTiers
                .filter(t => t.id !== 'know')
                .map(t => {
                    if (t.id === 'friends') {
                        return { ...t, min: 0.01, max: 0.40 };
                    }
                    return { ...t };
                });
            const propKey = this.plugin.settings.relationshipPropertyKey || 'closeness';

            // 1. Hide any physical subfolders if in subfolder mode so virtual closeness folders cleanly take over view
            const rawSubfolders = childrenContainer.querySelectorAll(':scope > .nav-folder:not(.pakcli-virtual-folder), :scope > .tree-item.nav-folder:not(.pakcli-virtual-folder)');
            rawSubfolders.forEach((el) => {
                (el as HTMLElement).style.display = 'none';
                el.addClass('pakcli-raw-folder-hidden');
            });

            // Check if existing virtual folders need teardown (e.g. view structure changed, tiers changed, or sort order changed)
            const currentStructure = childrenContainer.getAttribute('data-pakcli-view-structure');
            const currentTiersKey = childrenContainer.getAttribute('data-pakcli-tiers');
            const currentSortOrder = childrenContainer.getAttribute('data-pakcli-sort-order');
            const tiersKey = tiers.map(t => t.id).join(',');

            if (currentStructure !== viewStructure || currentTiersKey !== tiersKey || currentSortOrder !== sortOrder) {
                const existingVFs = childrenContainer.querySelectorAll('.pakcli-virtual-folder');
                existingVFs.forEach((vf) => {
                    const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file, .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)'));
                    for (const f of files) {
                        childrenContainer.appendChild(f);
                    }
                    vf.remove();
                });
                childrenContainer.setAttribute('data-pakcli-view-structure', viewStructure);
                childrenContainer.setAttribute('data-pakcli-tiers', tiersKey);
                childrenContainer.setAttribute('data-pakcli-sort-order', sortOrder);
            }

            // 2. Collect all candidate file elements in this folder
            const directFiles = Array.from(
                childrenContainer.querySelectorAll(':scope > .nav-file, :scope > .tree-item.nav-file, :scope > .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')
            ) as HTMLElement[];

            const mountedVFs = Array.from(childrenContainer.querySelectorAll('.pakcli-virtual-folder'));
            if (currentStructure === viewStructure && currentTiersKey === tiersKey && currentSortOrder === sortOrder && directFiles.length === 0 && mountedVFs.length > 0) {
                // All notes are already organized inside virtual folders!
                // Update counts without touching DOM tree structure
                for (const vf of mountedVFs) {
                    const countEl = vf.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-count');
                    const ch = vf.querySelector(':scope > .pakcli-virtual-folder-children');
                    if (countEl && ch) {
                        const count = ch.querySelectorAll(':scope > .nav-file, :scope > .tree-item.nav-file').length;
                        if (countEl.textContent !== String(count)) {
                            countEl.textContent = String(count);
                        }
                    }
                }
                return;
            }

            const subfolderFiles = Array.from(
                childrenContainer.querySelectorAll(':scope > .nav-folder:not(.pakcli-virtual-folder) .nav-file, :scope > .tree-item.nav-folder:not(.pakcli-virtual-folder) .tree-item.nav-file')
            ) as HTMLElement[];
            const virtualFiles = Array.from(
                childrenContainer.querySelectorAll('.pakcli-virtual-folder .nav-file, .pakcli-virtual-folder .tree-item.nav-file, .pakcli-virtual-folder .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')
            ) as HTMLElement[];
            const allNavFileEls = Array.from(new Set([...directFiles, ...subfolderFiles, ...virtualFiles]));

            // Map file paths to DOM elements
            const fileElMap = new Map<string, HTMLElement>();
            const normFolderPath = normalizePath(actualPath);
            for (const fileEl of allNavFileEls) {
                let path = fileEl.getAttribute('data-path') || 
                             fileEl.querySelector('.nav-file-title, .tree-item-self')?.getAttribute('data-path') || '';
                if (!path) {
                    const textName = fileEl.querySelector('.nav-file-title-content, .tree-item-inner')?.textContent?.trim() || '';
                    if (textName) {
                        const targetPath = normFolderPath + '/' + (textName.endsWith('.md') ? textName : textName + '.md');
                        const f = this.app.vault.getAbstractFileByPath(targetPath);
                        if (f) {
                            path = f.path;
                        } else {
                            const allMd = this.app.vault.getMarkdownFiles();
                            const matched = allMd.find(m => (m.path.startsWith(normFolderPath) || m.parent?.path === normFolderPath) && (m.basename === textName || m.name === textName));
                            if (matched) path = matched.path;
                        }
                    }
                }
                if (path) {
                    fileElMap.set(normalizePath(path), fileEl);
                }
            }

            // Enrich fileElMap with native Obsidian FileItem references (survives DOM virtualization)
            const leaves = this.app.workspace.getLeavesOfType('file-explorer');
            const leaf = leaves.find((l) => l.view?.containerEl?.contains(childrenContainer)) || leaves[0];
            const view = leaf?.view as any;
            if (view?.fileItems && typeof view.fileItems === 'object') {
                for (const p in view.fileItems) {
                    const item = view.fileItems[p];
                    if (item?.el && item?.file instanceof TFile) {
                        const normP = normalizePath(p);
                        if ((normP === normFolderPath || normP.startsWith(normFolderPath + '/')) && !fileElMap.has(normP)) {
                            fileElMap.set(normP, item.el);
                        }
                    }
                }
            }

            // Group files by matched tier ID
            const tierFileMap = new Map<string, HTMLElement[]>();
            for (const tier of tiers) {
                tierFileMap.set(tier.id, []);
            }
            const uncategorizedFiles: HTMLElement[] = [];

            // Classify each file
            fileElMap.forEach((el, path) => {
                const abstract = this.app.vault.getAbstractFileByPath(normalizePath(path));
                if (abstract instanceof TFile && abstract.extension === 'md') {
                    const cache = this.app.metadataCache.getFileCache(abstract);
                    let score = 0.25;

                    const rawCloseness = cache?.frontmatter?.[propKey] ?? 
                                         cache?.frontmatter?.closeness ?? 
                                         cache?.frontmatter?.score ??
                                         cache?.frontmatter?.affinity;

                    const lowerName = abstract.basename.toLowerCase();
                    const lowerRole = String(cache?.frontmatter?.role || '').toLowerCase();
                    const isMeNote = lowerName === 'me' || lowerRole.includes('self') || lowerRole.includes('me') || lowerName.includes('myself');

                    if (rawCloseness !== undefined && rawCloseness !== null && !isNaN(Number(rawCloseness))) {
                        score = Math.max(-1, Math.min(1, Number(rawCloseness)));
                    } else if (isMeNote) {
                        score = 1.0;
                    }

                    const matchedTier = tiers.find(t => score >= Math.min(t.min, t.max) && score <= Math.max(t.min, t.max));
                    if (matchedTier && tierFileMap.has(matchedTier.id)) {
                        tierFileMap.get(matchedTier.id)!.push(el);
                    } else {
                        uncategorizedFiles.push(el);
                    }
                } else {
                    uncategorizedFiles.push(el);
                }
            });

            // Helper to sort file elements based on sortOrder
            const sortFileElements = (fileEls: HTMLElement[]): HTMLElement[] => {
                return [...fileEls].sort((a, b) => {
                    const pathA = a.getAttribute('data-path') || a.querySelector('.nav-file-title, .tree-item-self')?.getAttribute('data-path') || '';
                    const pathB = b.getAttribute('data-path') || b.querySelector('.nav-file-title, .tree-item-self')?.getAttribute('data-path') || '';
                    const fileA = this.app.vault.getAbstractFileByPath(normalizePath(pathA)) as TFile;
                    const fileB = this.app.vault.getAbstractFileByPath(normalizePath(pathB)) as TFile;

                    const nameA = fileA?.basename || '';
                    const nameB = fileB?.basename || '';

                    if (sortOrder === 'filename_asc') {
                        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                    }
                    if (sortOrder === 'filename_desc') {
                        return nameB.localeCompare(nameA, undefined, { numeric: true, sensitivity: 'base' });
                    }

                    const cacheA = fileA ? this.app.metadataCache.getFileCache(fileA) : null;
                    const cacheB = fileB ? this.app.metadataCache.getFileCache(fileB) : null;

                    if (sortOrder === 'title_asc' || sortOrder === 'title_desc') {
                        const titleA = String(cacheA?.frontmatter?.title || nameA);
                        const titleB = String(cacheB?.frontmatter?.title || nameB);
                        const cmp = titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
                        return sortOrder === 'title_asc' ? cmp : -cmp;
                    }

                    // Score sorting ('closeness_desc' | 'closeness_asc')
                    const getScore = (f: TFile, c: any): number => {
                        let sc = 0.25;
                        const raw = c?.frontmatter?.[propKey] ?? c?.frontmatter?.closeness ?? c?.frontmatter?.score ?? c?.frontmatter?.affinity;
                        const lName = f?.basename.toLowerCase() || '';
                        const lRole = String(c?.frontmatter?.role || '').toLowerCase();
                        const isMe = lName === 'me' || lRole.includes('self') || lRole.includes('me') || lName.includes('myself');
                        if (raw !== undefined && raw !== null && !isNaN(Number(raw))) {
                            sc = Math.max(-1, Math.min(1, Number(raw)));
                        } else if (isMe) {
                            sc = 1.0;
                        }
                        return sc;
                    };

                    const scoreA = fileA ? getScore(fileA, cacheA) : 0;
                    const scoreB = fileB ? getScore(fileB, cacheB) : 0;

                    if (sortOrder === 'closeness_asc') {
                        const diff = scoreA - scoreB;
                        return diff !== 0 ? diff : nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                    } else {
                        // Default: closeness_desc (+1 to -1)
                        const diff = scoreB - scoreA;
                        return diff !== 0 ? diff : nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                    }
                });
            };

            // Surgical DOM placement helper to avoid DOM thrashing & scroll jumping
            const insertSurgically = (parentEl: HTMLElement, items: HTMLElement[]) => {
                for (let i = 0; i < items.length; i++) {
                    const el = items[i];
                    const nextEl = items[i + 1] || null;
                    if (el.parentElement !== parentEl) {
                        if (nextEl && nextEl.parentElement === parentEl) {
                            parentEl.insertBefore(el, nextEl);
                        } else {
                            parentEl.appendChild(el);
                        }
                    } else if (nextEl && el.nextElementSibling !== nextEl && nextEl.parentElement === parentEl) {
                        parentEl.insertBefore(el, nextEl);
                    }
                }
            };

            // Helper to build or reuse a virtual folder DOM element
            const buildVirtualFolder = (tier: RelationshipTierConfig, count: number): HTMLElement => {
                let virtualFolderEl = childrenContainer.querySelector(`.pakcli-virtual-folder[data-virtual-tier="${tier.id}"]`) as HTMLElement;
                const isCollapsed = this.collapsedTierIds.has(tier.id);

                if (!virtualFolderEl) {
                    virtualFolderEl = document.createElement('div');
                    virtualFolderEl.className = `nav-folder tree-item nav-folder pakcli-virtual-folder ${isCollapsed ? 'pakcli-collapsed' : ''}`;
                    virtualFolderEl.setAttribute('data-virtual-tier', tier.id);
                    virtualFolderEl.style.setProperty('--tier-color', tier.color);

                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'nav-folder-title tree-item-self is-clickable pakcli-virtual-folder-title';
                    titleDiv.title = `${tier.name} [${tier.min.toFixed(2)} - ${tier.max.toFixed(2)}] • Virtual Folder`;

                    // Chevron indicator (native Obsidian Lucide chevron-right)
                    const chevronEl = document.createElement('div');
                    chevronEl.className = 'nav-folder-collapse-indicator collapse-icon';
                    chevronEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-right"><path d="m9 18 6-6-6-6"></path></svg>`;
                    titleDiv.appendChild(chevronEl);

                    // 1. Toggle: Pakai Dot (default: false)
                    if (this.plugin.settings.explorerVirtualFolderShowDot === true) {
                        const dot = document.createElement('span');
                        dot.className = 'pakcli-virtual-folder-dot';
                        dot.style.backgroundColor = tier.color;
                        titleDiv.appendChild(dot);
                    }

                    // 2. Name & Toggle: Warnai Text (default: false)
                    const nameEl = document.createElement('div');
                    nameEl.className = 'nav-folder-title-content tree-item-inner';
                    nameEl.textContent = tier.name;
                    if (this.plugin.settings.explorerVirtualFolderColorName !== false) {
                        nameEl.style.color = tier.color;
                    }
                    titleDiv.appendChild(nameEl);

                    // 3. Garis Horizontal
                    const line = document.createElement('div');
                    line.className = 'pakcli-virtual-folder-line';
                    titleDiv.appendChild(line);

                    // 4. Toggle: Badge [i virtual] (default: true)
                    if (this.plugin.settings.explorerVirtualFolderShowBadge !== false) {
                        const badge = document.createElement('span');
                        badge.className = 'pakcli-virtual-badge';
                        badge.title = `Virtual Folder • Tier ${tier.name}`;

                        const badgeIcon = document.createElement('span');
                        badgeIcon.className = 'pakcli-badge-i';
                        badgeIcon.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
                        badge.appendChild(badgeIcon);

                        const badgeText = document.createElement('span');
                        badgeText.className = 'pakcli-badge-text';
                        badgeText.textContent = 'virtual';
                        badge.appendChild(badgeText);

                        titleDiv.appendChild(badge);
                    }

                    // 5. Toggle: Counter (default: true)
                    if (this.plugin.settings.explorerVirtualFolderShowCount !== false) {
                        const countEl = document.createElement('span');
                        countEl.className = 'nav-folder-title-extra tree-item-flair pakcli-virtual-count';
                        countEl.textContent = `${count}`;
                        titleDiv.appendChild(countEl);
                    }

                    virtualFolderEl.appendChild(titleDiv);

                    // Children container for files
                    const virtualChildren = document.createElement('div');
                    virtualChildren.className = 'nav-folder-children tree-item-children pakcli-virtual-folder-children';
                    if (isCollapsed) {
                        virtualChildren.style.setProperty('display', 'none', 'important');
                    }
                    virtualFolderEl.appendChild(virtualChildren);

                    // ── Click handler (attached ONCE at creation) ──────────────
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

                        const nowCollapsed = virtualFolderEl.classList.contains('pakcli-collapsed');
                        const ch = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
                        if (nowCollapsed) {
                            virtualFolderEl.classList.remove('pakcli-collapsed');
                            this.collapsedTierIds.delete(tier.id);
                            if (ch) ch.style.removeProperty('display');
                        } else {
                            virtualFolderEl.classList.add('pakcli-collapsed');
                            this.collapsedTierIds.add(tier.id);
                            if (ch) ch.style.setProperty('display', 'none', 'important');
                        }
                        virtualFolderEl.classList.remove('is-collapsed');
                    }, { capture: true });

                    // ── Drag and Drop (attached ONCE at creation) ──────────────
                    if (this.plugin.settings.explorerVirtualFolderDragDrop !== false) {
                        titleDiv.addEventListener('dragover', (e: DragEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                            virtualFolderEl.classList.add('pakcli-drop-target');
                        });
                        titleDiv.addEventListener('dragleave', () => {
                            virtualFolderEl.classList.remove('pakcli-drop-target');
                        });
                        titleDiv.addEventListener('drop', async (e: DragEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            virtualFolderEl.classList.remove('pakcli-drop-target');

                            const targetFile = this.resolveDraggedFile(e);
                            if (!targetFile) return;

                            const targetScore = tier.min === tier.max
                                ? tier.min
                                : Number(((tier.min + tier.max) / 2).toFixed(2));

                            const prop = this.plugin.settings.relationshipPropertyKey || 'closeness';
                            try {
                                await this.app.fileManager.processFrontMatter(targetFile, (fm) => {
                                    fm[prop] = targetScore;
                                });
                                new Notice(`Moved "${targetFile.basename}" to ${tier.name} (${targetScore >= 0 ? '+' : ''}${targetScore.toFixed(2)})`);
                            } catch (err) {
                                console.error('[PakCLI] Error updating frontmatter on drop:', err);
                                new Notice(`Failed to update ${targetFile.basename}`);
                            }
                        });
                    }

                } else {
                    // ── Update existing virtual folder ─────────────────────────
                    const countEl = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-count');
                    if (countEl) countEl.textContent = `${count}`;

                    const nameEl = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-title .nav-folder-title-content') as HTMLElement;
                    if (nameEl) {
                        nameEl.textContent = tier.name;
                        if (this.plugin.settings.explorerVirtualFolderColorText === true) {
                            nameEl.style.color = tier.color;
                        } else {
                            nameEl.style.removeProperty('color');
                        }
                    }

                    // Sync collapse state
                    if (isCollapsed && !virtualFolderEl.classList.contains('pakcli-collapsed')) {
                        virtualFolderEl.classList.add('pakcli-collapsed');
                    } else if (!isCollapsed && virtualFolderEl.classList.contains('pakcli-collapsed')) {
                        virtualFolderEl.classList.remove('pakcli-collapsed');
                    }
                    virtualFolderEl.classList.remove('is-collapsed');
                    const ch = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
                    if (ch) {
                        if (isCollapsed) {
                            ch.style.setProperty('display', 'none', 'important');
                        } else {
                            ch.style.removeProperty('display');
                        }
                    }
                }

                return virtualFolderEl;
            };

            if (viewStructure === 'range') {
                // ── 2. RANGE PER FOLDER (SIBLING FOLDERS) ──
                let orderedTiers = [...tiers];
                if (sortOrder === 'closeness_asc') {
                    // Ascending: Bad (-1) at the top, Household (+1) at the bottom
                    orderedTiers.sort((a, b) => Math.min(a.min, a.max) - Math.min(b.min, b.max));
                } else {
                    // Descending: Household (+1) at the top, Bad (-1) at the bottom
                    orderedTiers.sort((a, b) => Math.min(b.min, b.max) - Math.min(a.min, a.max));
                }

                for (const tier of orderedTiers) {
                    const matchingEls = sortFileElements(tierFileMap.get(tier.id) || []);
                    const vFolder = buildVirtualFolder(tier, matchingEls.length);

                    if (vFolder.parentElement !== childrenContainer) {
                        childrenContainer.appendChild(vFolder);
                    }

                    const vChildren = Array.from(vFolder.children).find(c => c.classList.contains('pakcli-virtual-folder-children')) as HTMLElement;
                    if (vChildren) {
                        const emptyNotice = Array.from(vChildren.children).find(c => c.classList.contains('pakcli-virtual-empty'));
                        if (matchingEls.length === 0) {
                            if (!emptyNotice) {
                                const notice = document.createElement('div');
                                notice.className = 'pakcli-virtual-empty';
                                notice.textContent = 'No notes in this range';
                                vChildren.appendChild(notice);
                            }
                        } else {
                            if (emptyNotice) emptyNotice.remove();
                            for (let i = 0; i < matchingEls.length; i++) {
                                const fileEl = matchingEls[i];
                                const nextEl = matchingEls[i + 1] || null;
                                if (fileEl.parentElement !== vChildren) {
                                    if (nextEl && nextEl.parentElement === vChildren) {
                                        vChildren.insertBefore(fileEl, nextEl);
                                    } else {
                                        vChildren.appendChild(fileEl);
                                    }
                                } else if (nextEl && fileEl.nextElementSibling !== nextEl && nextEl.parentElement === vChildren) {
                                    vChildren.insertBefore(fileEl, nextEl);
                                }
                                fileEl.style.removeProperty('display');
                            }
                        }
                    }
                }
            } else {
                // ── 3. CONCENTRIC NESTED (RUSSIAN DOLL / MATRYOSHKA) ──
                // Relationship folder branches directly into 3 branches (NO Know folder):
                //   • Friends [0.01 - 0.40] (nests Close Friends [0.41 - 0.60] ➔ Family [0.61 - 0.80] ➔ Household [0.81 - 1.00])
                //   • Unsure [0.00 - 0.00] (se-level dengan Friends)
                //   • Bad [-1.00 - -0.01] (se-level dengan Friends)
                //
                // Ordering in Relationship folder:
                // Option A: closeness_desc (+1 to -1) (Default)
                //   1. Friends (nests Close Friends ➔ Family ➔ Household)
                //   2. Unsure (0.00)
                //   3. Bad (-1.00)
                // Option B: closeness_asc (-1 to +1)
                //   1. Bad (-1.00)
                //   2. Unsure (0.00)
                //   3. Friends (nests Close Friends ➔ Family ➔ Household)

                const sortedAsc = [...tiers].sort((a, b) => Math.min(a.min, a.max) - Math.min(b.min, b.max));
                const positiveTiers = sortedAsc.filter(t => Math.max(t.min, t.max) > 0.0);
                const unsureTiers = sortedAsc.filter(t => t.min === 0.0 && t.max === 0.0);
                const badTiers = sortedAsc.filter(t => Math.max(t.min, t.max) < 0.0);
                const otherNeutralOrBad = sortedAsc.filter(t => Math.max(t.min, t.max) <= 0.0 && !unsureTiers.includes(t) && !badTiers.includes(t));
                const sideBranches = [...unsureTiers, ...badTiers, ...otherNeutralOrBad];

                // positiveTiers in ascending order:
                // [0] = Friends (0.01 - 0.40)
                // [1] = Close Friends (0.41 - 0.60)
                // [2] = Family (0.61 - 0.80)
                // [3] = Household (0.81 - 1.00)
                const friendsTier = positiveTiers.length > 0 ? positiveTiers[0] : null;
                const innerChainTiers = positiveTiers.length > 0 ? positiveTiers.slice(1) : [];

                // Helper to mount Friends chain directly under childrenContainer
                const mountFriendsBranch = () => {
                    if (!friendsTier) return;
                    const friendsMatchingEls = sortFileElements(tierFileMap.get(friendsTier.id) || []);
                    const friendsVFolder = buildVirtualFolder(friendsTier, friendsMatchingEls.length);
                    if (friendsVFolder.parentElement !== childrenContainer) {
                        childrenContainer.appendChild(friendsVFolder);
                    }

                    const friendsVChildren = Array.from(friendsVFolder.children).find(c => c.classList.contains('pakcli-virtual-folder-children')) as HTMLElement;
                    if (friendsVChildren) {
                        insertSurgically(friendsVChildren, friendsMatchingEls);
                        for (const fileEl of friendsMatchingEls) {
                            fileEl.style.removeProperty('display');
                        }

                        let currentParent: HTMLElement = friendsVChildren;
                        for (let i = 0; i < innerChainTiers.length; i++) {
                            const tier = innerChainTiers[i];
                            const matchingEls = sortFileElements(tierFileMap.get(tier.id) || []);
                            const vFolder = buildVirtualFolder(tier, matchingEls.length);
                            if (vFolder.parentElement !== currentParent) {
                                currentParent.appendChild(vFolder);
                            }

                            const vChildren = Array.from(vFolder.children).find(c => c.classList.contains('pakcli-virtual-folder-children')) as HTMLElement;
                            if (vChildren) {
                                insertSurgically(vChildren, matchingEls);
                                for (const fileEl of matchingEls) {
                                    fileEl.style.removeProperty('display');
                                }
                                currentParent = vChildren;
                            }
                        }
                    }
                };

                // Helper to mount a side branch (Unsure / Bad) directly under childrenContainer
                const mountSideBranch = (tier: RelationshipTierConfig) => {
                    const matchingEls = sortFileElements(tierFileMap.get(tier.id) || []);
                    const vFolder = buildVirtualFolder(tier, matchingEls.length);
                    if (vFolder.parentElement !== childrenContainer) {
                        childrenContainer.appendChild(vFolder);
                    }

                    const vChildren = Array.from(vFolder.children).find(c => c.classList.contains('pakcli-virtual-folder-children')) as HTMLElement;
                    if (vChildren) {
                        const emptyNotice = Array.from(vChildren.children).find(c => c.classList.contains('pakcli-virtual-empty'));
                        if (matchingEls.length === 0) {
                            if (!emptyNotice) {
                                const notice = document.createElement('div');
                                notice.className = 'pakcli-virtual-empty';
                                notice.textContent = 'No notes in this range';
                                vChildren.appendChild(notice);
                            }
                        } else {
                            if (emptyNotice) emptyNotice.remove();
                            insertSurgically(vChildren, matchingEls);
                            for (const fileEl of matchingEls) {
                                fileEl.style.removeProperty('display');
                            }
                        }
                    }
                };

                if (sortOrder === 'closeness_asc') {
                    // Option B: Ascending (-1 to +1)
                    // Bad at top, Unsure in middle, Friends at bottom
                    for (const tier of badTiers) {
                        mountSideBranch(tier);
                    }
                    for (const tier of [...unsureTiers, ...otherNeutralOrBad]) {
                        mountSideBranch(tier);
                    }
                    mountFriendsBranch();
                } else {
                    // Option A: Descending (+1 to -1) (Default)
                    // Friends at top, Unsure in middle, Bad at bottom
                    mountFriendsBranch();
                    for (const tier of sideBranches) {
                        mountSideBranch(tier);
                    }
                }
            }

            // Append any uncategorized files directly at the bottom of the main folder
            const sortedUnc = sortFileElements(uncategorizedFiles);
            insertSurgically(childrenContainer, sortedUnc);

        } catch (err) {
            console.error('[PakCLI Relationship] Error applying virtual folders:', err);
        }
    }

    public removeVirtualFoldersForEntry(container: HTMLElement, relPath: string) {
        const folderEl = this.findRelationshipFolderEl(container, relPath);
        if (!folderEl) return;

        const childrenContainer = (folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
            folderEl.querySelector('.nav-folder-children, .tree-item-children')) as HTMLElement;
        if (!childrenContainer) return;

        // 1. Restore any hidden raw folders
        const hiddenRawFolders = childrenContainer.querySelectorAll('.pakcli-raw-folder-hidden');
        hiddenRawFolders.forEach((el) => {
            el.removeClass('pakcli-raw-folder-hidden');
            (el as HTMLElement).style.removeProperty('display');
        });

        // 2. Extract any files inside virtual folders back out to root childrenContainer
        const virtualFolders = Array.from(childrenContainer.querySelectorAll('.pakcli-virtual-folder')) as HTMLElement[];
        for (const vf of virtualFolders) {
            const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file, .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')) as HTMLElement[];
            for (const f of files) {
                f.style.removeProperty('display');
                f.classList.remove('pakcli-merged-child-hidden');
                if (f.parentElement !== childrenContainer) {
                    childrenContainer.appendChild(f);
                }
            }
            vf.remove();
        }

        // 3. Sort files alphabetically so the folder is clean and flat
        const noteEls = Array.from(childrenContainer.querySelectorAll(':scope > .nav-file, :scope > .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')) as HTMLElement[];
        noteEls.sort((a, b) => {
            const titleA = a.querySelector('.nav-file-title-content, .tree-item-inner, .nav-file-title')?.textContent?.trim() || a.getAttribute('data-path') || '';
            const titleB = b.querySelector('.nav-file-title-content, .tree-item-inner, .nav-file-title')?.textContent?.trim() || b.getAttribute('data-path') || '';
            return titleA.localeCompare(titleB, undefined, { sensitivity: 'base' });
        });
        for (const el of noteEls) {
            childrenContainer.appendChild(el);
        }

        childrenContainer.removeAttribute('data-pakcli-view-structure');
        childrenContainer.removeAttribute('data-pakcli-tiers');
        childrenContainer.removeAttribute('data-pakcli-sort-order');
    }

    public removeVirtualFolders() {
        const leaves = this.app.workspace.getLeavesOfType('file-explorer');
        if (!leaves || leaves.length === 0) return;

        this.disconnectObserver();
        try {
            for (const leaf of leaves) {
                const container = (leaf.view as any)?.containerEl as HTMLElement;
                if (!container) continue;

                // 1. Clean configured entries
                const entries = this.getRelationshipFolderEntries();
                for (const entry of entries) {
                    this.removeVirtualFoldersForEntry(container, entry.path);
                }

                // 2. Global fallback scan across entire explorer leaf for ANY remaining relationship virtual folders
                const strayVFs = Array.from(
                    container.querySelectorAll('.pakcli-virtual-folder[data-virtual-tier], .pakcli-rel-virtual-folder, .pakcli-virtual-folder:not(.pakcli-dict-virtual-folder):not([data-virtual-letter])')
                ) as HTMLElement[];

                const affectedParents = new Set<HTMLElement>();

                for (const vf of strayVFs) {
                    const realFolder = vf.closest('.nav-folder:not(.pakcli-virtual-folder), .tree-item.nav-folder:not(.pakcli-virtual-folder)') as HTMLElement;
                    const targetChildren = (realFolder?.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') ||
                        vf.parentElement) as HTMLElement;

                    if (targetChildren) {
                        affectedParents.add(targetChildren);
                        const files = Array.from(
                            vf.querySelectorAll('.nav-file, .tree-item.nav-file, .tree-item:not(.nav-folder):not(.pakcli-virtual-folder)')
                        ) as HTMLElement[];
                        for (const f of files) {
                            f.style.removeProperty('display');
                            f.classList.remove('pakcli-merged-child-hidden');
                            if (f.parentElement !== targetChildren) {
                                targetChildren.appendChild(f);
                            }
                        }
                    }
                    vf.remove();
                }

                // Restore any hidden raw folders in the container
                const hiddenRawFolders = container.querySelectorAll('.pakcli-raw-folder-hidden');
                hiddenRawFolders.forEach((el) => {
                    el.removeClass('pakcli-raw-folder-hidden');
                    (el as HTMLElement).style.removeProperty('display');
                });

                // Sort files alphabetically in all affected parents so the view is 100% FLAT
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
                    parent.removeAttribute('data-pakcli-view-structure');
                    parent.removeAttribute('data-pakcli-tiers');
                    parent.removeAttribute('data-pakcli-sort-order');
                }
            }
        } finally {
            this.relChildrenContainers.clear();
            window.setTimeout(() => this.connectObserver(), 30);
        }
    }
}
