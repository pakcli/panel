import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { DEFAULT_RELATIONSHIP_TIERS, RelationshipTierConfig, RelationshipViewStructure } from '../../settings';

export class RelationshipExplorerManager {
    private app: App;
    private plugin: PakCLITablePlugin;
    private collapsedTierIds: Set<string> = new Set();
    private isOrganizing = false;
    private mutationObserver: MutationObserver | null = null;
    private debounceTimer: number | null = null;

    constructor(plugin: PakCLITablePlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    public init() {
        this.registerEvents();
        this.app.workspace.onLayoutReady(() => {
            this.scheduleRefresh();
            this.observeExplorer();
        });
    }

    public destroy() {
        if (this.debounceTimer !== null) {
            cancelAnimationFrame(this.debounceTimer);
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
            cancelAnimationFrame(this.debounceTimer);
        }
        this.debounceTimer = requestAnimationFrame(() => {
            this.debounceTimer = null;
            this.refreshVirtualFolders();
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
                if (mut.type === 'childList') {
                    const relRoot = normalizePath(this.plugin.settings.familyCirclesRootFolder || 'Relationships');
                    const targetEl = mut.target as HTMLElement;
                    if (targetEl.closest(`[data-path="${relRoot}"]`)) {
                        shouldRefresh = true;
                        break;
                    }
                }
            }
            if (shouldRefresh) {
                this.scheduleRefresh();
            }
        });

        this.mutationObserver.observe(navFilesContainer, {
            childList: true,
            subtree: true
        });
    }

    public refreshVirtualFolders() {
        if (this.isOrganizing) return;

        const relRoot = normalizePath(this.plugin.settings.familyCirclesRootFolder || 'Relationships');
        const folders = this.plugin.settings.relationshipFolders || [];
        const folderEntry = folders.find(f => normalizePath(f.path) === relRoot);
        const viewStructure: RelationshipViewStructure = folderEntry?.viewStructure || this.plugin.settings.relationshipViewStructure || 'flat';
        const isEnabled = this.plugin.settings.explorerRelationshipVirtualFolders === true && viewStructure !== 'flat';

        if (!isEnabled || viewStructure === 'flat') {
            this.removeVirtualFolders();
            return;
        }

        this.applyVirtualFolders(viewStructure);
    }

    private applyVirtualFolders(viewStructure: RelationshipViewStructure) {
        const leaves = this.app.workspace.getLeavesOfType('file-explorer');
        if (!leaves || leaves.length === 0) return;
        const container = (leaves[0].view as any)?.containerEl as HTMLElement;
        if (!container) return;

        if (document.querySelector('.nav-folder-title input, .nav-file-title input')) return;

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

        const folderEl = (titleEl.closest('.nav-folder, .tree-item.nav-folder') || titleEl.parentElement) as HTMLElement;
        if (!folderEl) return;

        const childrenContainer = folderEl.querySelector(':scope > .nav-folder-children, :scope > .tree-item-children') as HTMLElement;
        if (!childrenContainer) return; // Folder is collapsed

        this.isOrganizing = true;
        try {
            const tiers: RelationshipTierConfig[] = this.plugin.settings.relationshipTiers || DEFAULT_RELATIONSHIP_TIERS;
            const propKey = this.plugin.settings.relationshipPropertyKey || 'closeness';

            // 1. Hide any physical subfolders if in subfolder mode so virtual closeness folders cleanly take over view
            const rawSubfolders = childrenContainer.querySelectorAll(':scope > .nav-folder:not(.pakcli-virtual-folder), :scope > .tree-item.nav-folder:not(.pakcli-virtual-folder)');
            rawSubfolders.forEach((el) => {
                (el as HTMLElement).style.display = 'none';
                el.addClass('pakcli-raw-folder-hidden');
            });

            // Cleanly extract files from existing virtual folders and remove stale virtual folders
            const existingVFs = childrenContainer.querySelectorAll('.pakcli-virtual-folder');
            existingVFs.forEach((vf) => {
                const files = Array.from(vf.querySelectorAll('.nav-file, .tree-item.nav-file'));
                for (const f of files) {
                    childrenContainer.appendChild(f);
                }
                vf.remove();
            });

            // 2. Collect all .nav-file elements anywhere inside childrenContainer
            const allNavFileEls = Array.from(childrenContainer.querySelectorAll('.nav-file, .tree-item.nav-file')) as HTMLElement[];

            // Map file paths to DOM elements
            const fileElMap = new Map<string, HTMLElement>();
            for (const fileEl of allNavFileEls) {
                const path = fileEl.getAttribute('data-path') || 
                             fileEl.querySelector('.nav-file-title, .tree-item-self')?.getAttribute('data-path') || '';
                if (path) {
                    fileElMap.set(path, fileEl);
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
                const abstract = this.app.vault.getAbstractFileByPath(path);
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
                        score = Math.max(0, Math.min(1, Number(rawCloseness)));
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

            // Helper to build or reuse a virtual folder DOM element
            const buildVirtualFolder = (tier: RelationshipTierConfig, count: number, isNested: boolean): HTMLElement => {
                let virtualFolderEl = childrenContainer.querySelector(`[data-virtual-tier="${tier.id}"]`) as HTMLElement;
                const isCollapsed = this.collapsedTierIds.has(tier.id);

                if (!virtualFolderEl) {
                    virtualFolderEl = document.createElement('div');
                    virtualFolderEl.className = `nav-folder tree-item nav-folder pakcli-virtual-folder ${isCollapsed ? 'is-collapsed' : ''} ${isNested ? 'pakcli-virtual-nested' : ''}`;
                    virtualFolderEl.setAttribute('data-virtual-tier', tier.id);
                    virtualFolderEl.style.setProperty('--tier-color', tier.color);

                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'nav-folder-title tree-item-self pakcli-virtual-folder-title';

                    // Chevron indicator
                    const chevronEl = document.createElement('div');
                    chevronEl.className = 'nav-folder-collapse-indicator collapse-icon';
                    chevronEl.innerHTML = `<svg viewBox="0 0 100 100" class="right-triangle"><polygon points="0,0 100,50 0,100"></polygon></svg>`;
                    titleDiv.appendChild(chevronEl);

                    // Tier color dot
                    const dot = document.createElement('span');
                    dot.className = 'pakcli-virtual-folder-dot';
                    dot.style.backgroundColor = tier.color;
                    titleDiv.appendChild(dot);

                    // Name
                    const nameEl = document.createElement('div');
                    nameEl.className = 'nav-folder-title-content tree-item-inner';
                    nameEl.textContent = tier.name;
                    titleDiv.appendChild(nameEl);

                    // Virtual Badge
                    const badgeEl = document.createElement('span');
                    badgeEl.className = 'pakcli-virtual-badge';
                    badgeEl.textContent = '🔮 Virtual';
                    titleDiv.appendChild(badgeEl);

                    // Range
                    const rangeEl = document.createElement('span');
                    rangeEl.className = 'pakcli-virtual-range';
                    rangeEl.textContent = `[${tier.min.toFixed(2)} - ${tier.max.toFixed(2)}]`;
                    titleDiv.appendChild(rangeEl);

                    // Count
                    const countEl = document.createElement('span');
                    countEl.className = 'pakcli-virtual-count';
                    countEl.textContent = `(${count})`;
                    titleDiv.appendChild(countEl);

                    // Toggle expand/collapse
                    titleDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (this.collapsedTierIds.has(tier.id)) {
                            this.collapsedTierIds.delete(tier.id);
                            virtualFolderEl.removeClass('is-collapsed');
                            const ch = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
                            if (ch) ch.style.removeProperty('display');
                        } else {
                            this.collapsedTierIds.add(tier.id);
                            virtualFolderEl.addClass('is-collapsed');
                            const ch = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
                            if (ch) ch.style.display = 'none';
                        }
                    });

                    virtualFolderEl.appendChild(titleDiv);

                    const virtualChildren = document.createElement('div');
                    virtualChildren.className = 'nav-folder-children tree-item-children pakcli-virtual-folder-children';
                    if (isCollapsed) {
                        virtualChildren.style.display = 'none';
                    }
                    virtualFolderEl.appendChild(virtualChildren);
                } else {
                    // Update dynamic attributes
                    const countEl = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-count');
                    if (countEl) countEl.textContent = `(${count})`;

                    const rangeEl = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-range');
                    if (rangeEl) rangeEl.textContent = `[${tier.min.toFixed(2)} - ${tier.max.toFixed(2)}]`;

                    const dot = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-title .pakcli-virtual-folder-dot') as HTMLElement;
                    if (dot) dot.style.backgroundColor = tier.color;

                    const nameEl = virtualFolderEl.querySelector(':scope > .pakcli-virtual-folder-title .nav-folder-title-content');
                    if (nameEl) nameEl.textContent = tier.name;
                }

                return virtualFolderEl;
            };

            if (viewStructure === 'range') {
                // ── 2. RANGE PER FOLDER (SIBLING FOLDERS) ──
                for (const tier of tiers) {
                    const matchingEls = tierFileMap.get(tier.id) || [];
                    const vFolder = buildVirtualFolder(tier, matchingEls.length, false);

                    if (vFolder.parentElement !== childrenContainer) {
                        childrenContainer.appendChild(vFolder);
                    }

                    const vChildren = vFolder.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
                    if (vChildren) {
                        const emptyNotice = vChildren.querySelector('.pakcli-virtual-empty');
                        if (emptyNotice) emptyNotice.remove();

                        if (matchingEls.length === 0) {
                            const notice = document.createElement('div');
                            notice.className = 'pakcli-virtual-empty';
                            notice.textContent = 'No notes in this range';
                            vChildren.appendChild(notice);
                        } else {
                            for (const fileEl of matchingEls) {
                                if (fileEl.parentElement !== vChildren) {
                                    vChildren.appendChild(fileEl);
                                }
                            }
                        }
                    }
                }
            } else {
                // ── 3. CONCENTRIC NESTED (RUSSIAN DOLL / MATRYOSHKA) ──
                // Order tiers ascending by closeness (outermost to innermost core)
                // Know [0.01 - 0.20] ⊃ Friends [0.21 - 0.40] ⊃ Close Friends [0.41 - 0.60] ⊃ Family [0.61 - 0.80] ⊃ Household [0.81 - 1.00]
                const sortedAsc = [...tiers].sort((a, b) => Math.min(a.min, a.max) - Math.min(b.min, b.max));
                const otherTiers = sortedAsc.filter(t => Math.max(t.min, t.max) <= 0.0); // e.g. Enemy
                const concentricTiers = sortedAsc.filter(t => Math.max(t.min, t.max) > 0.0); // Know ➔ Friends ➔ Close Friends ➔ Family ➔ Household

                // 1. Build concentric Matryoshka nesting
                let currentParentContainer: HTMLElement = childrenContainer;
                let friendsLevelContainer: HTMLElement = childrenContainer; // Holds Friends and Enemy at the same level

                for (let i = 0; i < concentricTiers.length; i++) {
                    const tier = concentricTiers[i];
                    const matchingEls = tierFileMap.get(tier.id) || [];
                    const isNested = i > 0;
                    const vFolder = buildVirtualFolder(tier, matchingEls.length, isNested);

                    if (vFolder.parentElement !== currentParentContainer) {
                        currentParentContainer.appendChild(vFolder);
                    }

                    const vChildren = vFolder.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
                    if (vChildren) {
                        // Place this tier's notes first
                        for (const fileEl of matchingEls) {
                            if (fileEl.parentElement !== vChildren) {
                                vChildren.appendChild(fileEl);
                            }
                        }

                        // Outermost tier (Know) children container holds the 2nd layer: Friends & Enemy
                        if (i === 0) {
                            friendsLevelContainer = vChildren;
                        }

                        // Next inner tier will be nested inside this vChildren!
                        currentParentContainer = vChildren;
                    }
                }

                // 2. Place Enemy at the same level as Friends (inside Know alongside Friends)
                for (const tier of otherTiers) {
                    const matchingEls = tierFileMap.get(tier.id) || [];
                    const isNested = friendsLevelContainer !== childrenContainer;
                    const vFolder = buildVirtualFolder(tier, matchingEls.length, isNested);
                    if (vFolder.parentElement !== friendsLevelContainer) {
                        friendsLevelContainer.appendChild(vFolder);
                    }
                    const vChildren = vFolder.querySelector(':scope > .pakcli-virtual-folder-children') as HTMLElement;
                    if (vChildren) {
                        vChildren.innerHTML = '';
                        if (matchingEls.length === 0) {
                            const notice = document.createElement('div');
                            notice.className = 'pakcli-virtual-empty';
                            notice.textContent = 'No notes in this range';
                            vChildren.appendChild(notice);
                        } else {
                            matchingEls.forEach(el => vChildren.appendChild(el));
                        }
                    }
                }
            }

            // Append any uncategorized files directly at the bottom of the main folder
            for (const uncEl of uncategorizedFiles) {
                if (uncEl.parentElement !== childrenContainer) {
                    childrenContainer.appendChild(uncEl);
                }
            }

        } finally {
            this.isOrganizing = false;
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

        this.isOrganizing = true;
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
                for (const f of files) {
                    childrenContainer.appendChild(f);
                }
                vf.remove();
            });
        } finally {
            this.isOrganizing = false;
        }
    }
}
