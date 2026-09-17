import { App, Notice, TFile, TFolder, normalizePath, setIcon } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DEFAULT_RELATIONSHIP_TIERS, RelationshipTierConfig, RelationshipViewStructure, RelationshipSortOrder } from '../../settings';

export class RelationshipExplorerManager {
    private app: App;
    private plugin: PakCLITablePlugin;
    private collapsedTierIds: Set<string> = new Set();
    private mutationObserver: MutationObserver | null = null;
    private rafId: number | null = null;
    private needsFollowUpPass = false;
    private trailingTimer: number | null = null;
    private navFilesContainer: HTMLElement | null = null;
    private onScrollBound: (() => void) | null = null;

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

    public scheduleRefresh() {
        this.needsFollowUpPass = true;
        if (this.rafId === null) {
            this.rafId = requestAnimationFrame(() => {
                this.rafId = null;
                this.needsFollowUpPass = false;
                if (document.querySelector('.nav-files-container input, .nav-files-container [contenteditable="true"], .nav-folder-title input, .nav-file-title input, [contenteditable="true"]')) {
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
            if (document.querySelector('.nav-files-container input, .nav-files-container [contenteditable="true"], .nav-folder-title input, .nav-file-title input, [contenteditable="true"]')) {
                return;
            }
            this.refreshVirtualFolders();
        }, 60);
    }

    private connectObserver() {
        if (!this.mutationObserver || !this.navFilesContainer) return;
        this.mutationObserver.observe(this.navFilesContainer, {
            childList: true,
            subtree: true,
        });
    }

    private disconnectObserver() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
    }


    private registerEvents() {
        this.plugin.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.scheduleRefresh();
                this.observeExplorer();
            })
        );

        this.plugin.registerEvent(
            this.app.vault.on('rename', () => {
                this.scheduleRefresh();
            })
        );

        this.plugin.registerEvent(
            this.app.vault.on('delete', () => {
                this.scheduleRefresh();
            })
        );

        this.plugin.registerEvent(
            this.app.vault.on('create', () => {
                this.scheduleRefresh();
            })
        );

        this.plugin.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                const root = normalizePath(this.plugin.settings.familyCirclesRootFolder || 'Relationships');
                if (file.path.startsWith(root)) {
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
            const relRoot = normalizePath(this.plugin.settings.familyCirclesRootFolder || 'Relationships');
            this.mutationObserver = new MutationObserver((mutations) => {
                if (document.querySelector('.nav-files-container input, .nav-files-container [contenteditable="true"], .nav-folder-title input, .nav-file-title input, [contenteditable="true"]')) return;

                let shouldRefresh = false;

                for (const mut of mutations) {
                    const targetEl = mut.target as HTMLElement;
                    if (!targetEl) continue;

                    // Ignore mutations inside our virtual folders
                    if (targetEl.closest?.('.pakcli-virtual-folder')) continue;

                    // Check added nodes
                    if (mut.addedNodes?.length > 0) {
                        for (let i = 0; i < mut.addedNodes.length; i++) {
                            const node = mut.addedNodes[i] as HTMLElement;
                            if (node.nodeType !== Node.ELEMENT_NODE) continue;
                            if (node.classList?.contains('pakcli-virtual-folder')) continue;
                            const p = normalizePath(node.getAttribute?.('data-path') || '');
                            if (p === relRoot || p.startsWith(relRoot + '/')) { shouldRefresh = true; break; }
                        }
                    }
                    if (shouldRefresh) break;

                    // Check removed nodes
                    if (mut.removedNodes?.length > 0) {
                        for (let i = 0; i < mut.removedNodes.length; i++) {
                            const node = mut.removedNodes[i] as HTMLElement;
                            if (node.nodeType !== Node.ELEMENT_NODE) continue;
                            if (node.classList?.contains('pakcli-virtual-folder')) continue;
                            const p = normalizePath(node.getAttribute?.('data-path') || '');
                            if (p === relRoot || p.startsWith(relRoot + '/')) { shouldRefresh = true; break; }
                        }
                    }
                    if (shouldRefresh) break;
                }

                if (shouldRefresh) this.scheduleRefresh();
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

    public refreshVirtualFolders() {
        if (this.isOrganizing) return;

        const relRoot = normalizePath(this.plugin.settings.familyCirclesRootFolder || 'Relationships');
        const folders = this.plugin.settings.relationshipFolders || [];
        const folderEntry = folders.find(f => normalizePath(f.path) === relRoot);
        const viewStructure: RelationshipViewStructure = folderEntry?.viewStructure || this.plugin.settings.relationshipViewStructure || 'concentric';
        const sortOrder: RelationshipSortOrder = folderEntry?.sortOrder || this.plugin.settings.relationshipSortOrder || 'closeness_desc';

        if (viewStructure === 'flat') {
            this.removeVirtualFolders();
            return;
        }

        this.applyVirtualFolders(viewStructure, sortOrder);
    }

    private applyVirtualFolders(viewStructure: RelationshipViewStructure, sortOrder: RelationshipSortOrder) {
        const leaves = this.app.workspace.getLeavesOfType('file-explorer');
        if (!leaves || leaves.length === 0) return;
        const container = (leaves[0].view as any)?.containerEl as HTMLElement;
        if (!container) return;

        if (document.querySelector('.nav-files-container input, .nav-files-container [contenteditable="true"], .nav-folder-title input, .nav-file-title input, [contenteditable="true"]')) return;

        const relRoot = normalizePath(this.plugin.settings.familyCirclesRootFolder || 'Relationships');

        // Robust folder title element lookup (Obsidian puts data-path on .nav-folder-title)
        let titleEl = container.querySelector(`.nav-folder-title[data-path="${relRoot}"], .tree-item-self[data-path="${relRoot}"]`) as HTMLElement;
        if (!titleEl) {
            const allElements = Array.from(container.querySelectorAll('[data-path]'));
            titleEl = (allElements.find(el => {
                const p = normalizePath(el.getAttribute('data-path') || '');
                return p === relRoot;
            }) as HTMLElement) || null;
        }
        if (!titleEl) return;

        // Ensure clicking the folder chevron/title refreshes virtual folders
        if (!(titleEl as any).__pakcli_rel_click_bound) {
            (titleEl as any).__pakcli_rel_click_bound = true;
            titleEl.addEventListener('click', () => {
                window.setTimeout(() => this.scheduleRefresh(), 60);
            });
        }

        const folderEl = (titleEl.closest('.nav-folder, .tree-item.nav-folder') || titleEl.parentElement) as HTMLElement;
        if (!folderEl) return;

        const childrenContainer = folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') as HTMLElement;
        if (!childrenContainer) return;

        if (folderEl.classList.contains('is-collapsed')) return;

        // Disconnect observer for the entire DOM operation window — no isOrganizing race
        this.disconnectObserver();
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
                    const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file'));
                    for (const f of files) {
                        childrenContainer.appendChild(f);
                    }
                    vf.remove();
                });
                childrenContainer.setAttribute('data-pakcli-view-structure', viewStructure);
                childrenContainer.setAttribute('data-pakcli-tiers', tiersKey);
                childrenContainer.setAttribute('data-pakcli-sort-order', sortOrder);
            }

            // 2. Collect all .nav-file elements anywhere inside childrenContainer
            const allNavFileEls = Array.from(childrenContainer.querySelectorAll('.nav-file, .tree-item.nav-file')) as HTMLElement[];

            // Map file paths to DOM elements
            const fileElMap = new Map<string, HTMLElement>();
            for (const fileEl of allNavFileEls) {
                const path = fileEl.getAttribute('data-path') || 
                             fileEl.querySelector('.nav-file-title, .tree-item-self')?.getAttribute('data-path') || '';
                if (path) {
                    fileElMap.set(normalizePath(path), fileEl);
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

            // Helper to build or reuse a virtual folder DOM element
            const buildVirtualFolder = (tier: RelationshipTierConfig, count: number): HTMLElement => {
                let virtualFolderEl = childrenContainer.querySelector(`.pakcli-virtual-folder[data-virtual-tier="${tier.id}"]`) as HTMLElement;
                const isCollapsed = this.collapsedTierIds.has(tier.id);

                if (!virtualFolderEl) {
                    virtualFolderEl = document.createElement('div');
                    virtualFolderEl.className = `nav-folder tree-item nav-folder pakcli-virtual-folder ${isCollapsed ? 'is-collapsed' : ''}`;
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
                    if (this.plugin.settings.explorerVirtualFolderColorText === true) {
                        nameEl.style.color = tier.color;
                    }
                    titleDiv.appendChild(nameEl);

                    // 3. Toggle: Line Between Text & Badge (default: true)
                    if (this.plugin.settings.explorerVirtualFolderShowLine !== false) {
                        const lineEl = document.createElement('div');
                        lineEl.className = 'pakcli-virtual-folder-line';
                        titleDiv.appendChild(lineEl);
                    }

                    // Base-style "i" Virtual Badge
                    const badgeEl = document.createElement('span');
                    badgeEl.className = 'pakcli-virtual-badge';
                    badgeEl.title = `Virtual Folder • Score [${tier.min.toFixed(2)} - ${tier.max.toFixed(2)}]`;
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
                    const countEl = document.createElement('span');
                    countEl.className = 'nav-folder-title-extra tree-item-flair pakcli-virtual-count';
                    countEl.textContent = `${count}`;
                    titleDiv.appendChild(countEl);

                    virtualFolderEl.appendChild(titleDiv);

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

                        const nowCollapsed = virtualFolderEl.classList.contains('is-collapsed');
                        const ch = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
                        if (nowCollapsed) {
                            virtualFolderEl.classList.remove('is-collapsed');
                            this.collapsedTierIds.delete(tier.id);
                            if (ch) ch.style.removeProperty('display');
                        } else {
                            virtualFolderEl.classList.add('is-collapsed');
                            this.collapsedTierIds.add(tier.id);
                            if (ch) ch.style.setProperty('display', 'none', 'important');
                        }
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
                    if (isCollapsed && !virtualFolderEl.classList.contains('is-collapsed')) {
                        virtualFolderEl.classList.add('is-collapsed');
                    } else if (!isCollapsed && virtualFolderEl.classList.contains('is-collapsed')) {
                        virtualFolderEl.classList.remove('is-collapsed');
                    }
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
                    } else {
                        childrenContainer.appendChild(vFolder); // enforce visual order
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
                            for (const fileEl of matchingEls) {
                                vChildren.appendChild(fileEl);
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
                    childrenContainer.appendChild(friendsVFolder);

                    const friendsVChildren = Array.from(friendsVFolder.children).find(c => c.classList.contains('pakcli-virtual-folder-children')) as HTMLElement;
                    if (friendsVChildren) {
                        for (const fileEl of friendsMatchingEls) {
                            friendsVChildren.appendChild(fileEl);
                        }

                        let currentParent: HTMLElement = friendsVChildren;
                        for (let i = 0; i < innerChainTiers.length; i++) {
                            const tier = innerChainTiers[i];
                            const matchingEls = sortFileElements(tierFileMap.get(tier.id) || []);
                            const vFolder = buildVirtualFolder(tier, matchingEls.length);
                            currentParent.appendChild(vFolder);

                            const vChildren = Array.from(vFolder.children).find(c => c.classList.contains('pakcli-virtual-folder-children')) as HTMLElement;
                            if (vChildren) {
                                for (const fileEl of matchingEls) {
                                    vChildren.appendChild(fileEl);
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
                    childrenContainer.appendChild(vFolder);

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
                            for (const fileEl of matchingEls) {
                                vChildren.appendChild(fileEl);
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
            for (const uncEl of sortedUnc) {
                childrenContainer.appendChild(uncEl);
            }

        } catch (err) {
            console.error('[PakCLI Relationship] Error applying virtual folders:', err);
        } finally {
            window.setTimeout(() => this.connectObserver(), 30);
        }
    }

    public removeVirtualFolders() {
        const leaves = this.app.workspace.getLeavesOfType('file-explorer');
        if (!leaves || leaves.length === 0) return;
        const container = (leaves[0].view as any)?.containerEl as HTMLElement;
        if (!container) return;

        const relRoot = normalizePath(this.plugin.settings.familyCirclesRootFolder || 'Relationships');
        
        let titleEl = container.querySelector(`.nav-folder-title[data-path="${relRoot}"], .tree-item-self[data-path="${relRoot}"]`) as HTMLElement;
        if (!titleEl) {
            const allElements = Array.from(container.querySelectorAll('[data-path]'));
            titleEl = (allElements.find(el => normalizePath(el.getAttribute('data-path') || '') === relRoot) as HTMLElement) || null;
        }
        if (!titleEl) return;

        const folderEl = (titleEl.closest('.nav-folder, .tree-item.nav-folder') || titleEl.parentElement) as HTMLElement;
        if (!folderEl) return;

        const childrenContainer = folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') as HTMLElement;
        if (!childrenContainer) return;

        this.disconnectObserver();
        try {
            // 1. Restore any hidden raw folders
            const hiddenRawFolders = childrenContainer.querySelectorAll('.pakcli-raw-folder-hidden');
            hiddenRawFolders.forEach((el) => {
                el.removeClass('pakcli-raw-folder-hidden');
                (el as HTMLElement).style.removeProperty('display');
            });

            // 2. Extract any files inside virtual folders back out to root childrenContainer
            const virtualFolders = childrenContainer.querySelectorAll('.pakcli-virtual-folder');
            virtualFolders.forEach((vf) => {
                const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file'));
                for (const f of files) childrenContainer.appendChild(f);
                vf.remove();
            });

            childrenContainer.removeAttribute('data-pakcli-view-structure');
            childrenContainer.removeAttribute('data-pakcli-tiers');
            childrenContainer.removeAttribute('data-pakcli-sort-order');
        } finally {
            window.setTimeout(() => this.connectObserver(), 30);
        }
    }
}
