import { App, TFile, Notice, Component } from 'obsidian';
import { MasterHistoryEngine } from '../../history/MasterHistoryEngine';

// Local structural types for Obsidian Bases APIs
type Value = string | number | boolean | null;

export interface BasesPropertyId {
	id: string;
}

export interface BasesEntry {
	file?: TFile;
	getValue?(propertyId: unknown): Value | null;
}

export interface BasesEntryGroup {
	key?: Value;
	entries?: BasesEntry[];
	hasKey?(): boolean;
}

export interface BasesQueryResult {
	data?: BasesEntry[];
	groupedData?: BasesEntryGroup[];
	properties?: BasesPropertyId[];
}

export interface BasesViewConfig {
	name?: string;
	get?(key: string): unknown;
	set?(key: string, value: unknown): void;
}

export interface QueryController {
	on?(event: string, cb: (...args: unknown[]) => void): void;
	off?(event: string, cb: (...args: unknown[]) => void): void;
}

// Inherit from Obsidian BasesView if present on require('obsidian'), else Component
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ObsidianBaseClass: typeof Component = (require('obsidian') as any).BasesView || Component;

export class SpecTreeBasesView extends ObsidianBaseClass {
	type = 'tree';
	public app: App;
	public config?: BasesViewConfig;
	public data?: BasesQueryResult;

	private historyEngine: MasterHistoryEngine;
	private containerEl: HTMLElement;
	private controlBarEl: HTMLElement;
	private treeBodyEl: HTMLElement;

	// View state
	private lockView = true;
	private folderCollapsedState: Map<string, boolean> = new Map();
	private fileCollapsedState: Map<string, boolean> = new Map();
	private unsubscribeHistory?: () => void;
	private lastScrollTop = 0;

	constructor(
		controller: QueryController,
		parentEl: HTMLElement,
		app: App,
		historyEngine: MasterHistoryEngine
	) {
		super(controller as unknown as undefined);
		this.app = app;
		this.historyEngine = historyEngine;

		// Safe DOM initialization
		if (parentEl && typeof parentEl.createDiv === 'function') {
			this.containerEl = parentEl.createDiv({ cls: 'bases-spec-tree-container' });
		} else {
			this.containerEl = document.createElement('div');
			this.containerEl.className = 'bases-spec-tree-container';
			if (parentEl && typeof parentEl.appendChild === 'function') {
				parentEl.appendChild(this.containerEl);
			}
		}

		this.controlBarEl = this.containerEl.createDiv({ cls: 'bases-spec-tree-control-bar' });
		this.treeBodyEl = this.containerEl.createDiv({ cls: 'bases-spec-tree-body' });

		this.treeBodyEl.addEventListener('scroll', () => {
			this.lastScrollTop = this.treeBodyEl.scrollTop;
		});

		// Subscribe to history changes to re-evaluate Undo/Redo button states
		if (this.historyEngine && typeof this.historyEngine.subscribe === 'function') {
			this.unsubscribeHistory = this.historyEngine.subscribe(() => {
				this.updateControlBarButtons();
			});
		}
	}

	public unload(): void {
		this.cleanup();
		super.unload?.();
	}

	override onunload(): void {
		this.cleanup();
		super.onunload?.();
	}

	private cleanup(): void {
		if (this.unsubscribeHistory) {
			this.unsubscribeHistory();
			this.unsubscribeHistory = undefined;
		}
		if (this.containerEl) {
			this.containerEl.empty();
		}
	}

	/**
	 * Called by Obsidian Bases when query data updates
	 */
	public onDataUpdated(): void {
		try {
			this.render();
		} catch (err) {
			console.error('[SpecTreeBasesView] Error in onDataUpdated:', err);
		}
	}

	public update(): void {
		try {
			this.render();
		} catch (err) {
			console.error('[SpecTreeBasesView] Error in update():', err);
		}
	}

	private extractFile(entry: unknown): TFile | null {
		if (!entry) return null;
		if (entry instanceof TFile) return entry;
		const candidate = (entry as { file?: unknown }).file;
		if (candidate instanceof TFile) return candidate;
		if (typeof (entry as { path?: unknown }).path === 'string') {
			const f = this.app.vault.getAbstractFileByPath((entry as { path: string }).path);
			if (f instanceof TFile) return f;
		}
		return null;
	}

	private getVisibleFiles(): TFile[] {
		if (!this.data) return [];
		const entries = Array.isArray(this.data.data) ? this.data.data : [];
		const result: TFile[] = [];
		for (const e of entries) {
			const f = this.extractFile(e);
			if (f) result.push(f);
		}
		return result;
	}

	private getVisibleFilePaths(): string[] {
		return this.getVisibleFiles().map(f => f.path);
	}

	private render(): void {
		if (!this.containerEl) return;
		const savedScroll = this.lastScrollTop;

		this.renderControlBar();
		this.renderTree();

		if (this.lockView && this.treeBodyEl) {
			requestAnimationFrame(() => {
				this.treeBodyEl.scrollTop = savedScroll;
			});
		}
	}

	// =========================================================================
	// CONTROL BAR (Row 2 Controls)
	// =========================================================================
	private renderControlBar(): void {
		if (!this.controlBarEl) return;
		this.controlBarEl.empty();
		const visibleFiles = this.getVisibleFiles();
		const visiblePaths = visibleFiles.map(f => f.path);

		// 1. Result count badge
		const resultBadge = this.controlBarEl.createSpan({ cls: 'spec-tree-badge' });
		resultBadge.setText(`${visibleFiles.length} results`);

		// 2. Scoped Undo & Redo buttons (Minimal, zero dropdown)
		const undoRedoGroup = this.controlBarEl.createDiv({ cls: 'spec-tree-btn-group' });

		const undoBtn = undoRedoGroup.createEl('button', {
			cls: 'spec-tree-btn spec-tree-undo-btn',
			text: '↶ Undo',
		});
		undoBtn.title = 'Undo perubahan pada file di view ini (Scoped)';
		const canUndo = this.historyEngine ? this.historyEngine.canUndoScoped(visiblePaths) : false;
		undoBtn.disabled = !canUndo;
		undoBtn.onclick = async () => {
			if (this.historyEngine) {
				await this.historyEngine.undoScoped(visiblePaths);
				this.render();
			}
		};

		const redoBtn = undoRedoGroup.createEl('button', {
			cls: 'spec-tree-btn spec-tree-redo-btn',
			text: '↷ Redo',
		});
		redoBtn.title = 'Redo perubahan pada file di view ini (Scoped)';
		const canRedo = this.historyEngine ? this.historyEngine.canRedoScoped(visiblePaths) : false;
		redoBtn.disabled = !canRedo;
		redoBtn.onclick = async () => {
			if (this.historyEngine) {
				await this.historyEngine.redoScoped(visiblePaths);
				this.render();
			}
		};

		// 3. Expand All / Collapse All buttons
		const foldGroup = this.controlBarEl.createDiv({ cls: 'spec-tree-btn-group' });

		const expandAllBtn = foldGroup.createEl('button', {
			cls: 'spec-tree-btn',
			text: '⊞ Expand All',
		});
		expandAllBtn.title = 'Buka semua folder dan frontmatter specs';
		expandAllBtn.onclick = () => {
			this.expandAll();
		};

		const collapseAllBtn = foldGroup.createEl('button', {
			cls: 'spec-tree-btn',
			text: '⊟ Collapse All',
		});
		collapseAllBtn.title = 'Lipat semua folder dan sembunyikan frontmatter specs';
		collapseAllBtn.onclick = () => {
			this.collapseAll();
		};

		// 4. LockView Toggle
		const lockBtn = this.controlBarEl.createEl('button', {
			cls: `spec-tree-btn spec-tree-lock-btn ${this.lockView ? 'is-active' : ''}`,
			text: this.lockView ? '🔒 LockView: ON' : '🔓 LockView: OFF',
		});
		lockBtn.title = 'Kunci posisi scroll kanvas saat mengedit textbox frontmatter';
		lockBtn.onclick = () => {
			this.lockView = !this.lockView;
			lockBtn.setText(this.lockView ? '🔒 LockView: ON' : '🔓 LockView: OFF');
			lockBtn.toggleClass('is-active', this.lockView);
		};
	}

	private updateControlBarButtons(): void {
		if (!this.controlBarEl) return;
		const visiblePaths = this.getVisibleFilePaths();
		const undoBtn = this.controlBarEl.querySelector('.spec-tree-undo-btn') as HTMLButtonElement | null;
		const redoBtn = this.controlBarEl.querySelector('.spec-tree-redo-btn') as HTMLButtonElement | null;
		if (undoBtn && this.historyEngine) {
			undoBtn.disabled = !this.historyEngine.canUndoScoped(visiblePaths);
		}
		if (redoBtn && this.historyEngine) {
			redoBtn.disabled = !this.historyEngine.canRedoScoped(visiblePaths);
		}
	}

	private expandAll(): void {
		this.folderCollapsedState.clear();
		this.fileCollapsedState.clear();
		this.render();
	}

	private collapseAll(): void {
		const entries = Array.isArray(this.data?.data) ? this.data.data : [];
		for (const entry of entries) {
			const file = this.extractFile(entry);
			if (!file) continue;
			const folder = file.parent?.path || '/';
			this.folderCollapsedState.set(folder, true);
			this.fileCollapsedState.set(file.path, true);
		}
		this.render();
	}

	// =========================================================================
	// TREE OUTLINER BODY
	// =========================================================================
	private renderTree(): void {
		if (!this.treeBodyEl) return;
		this.treeBodyEl.empty();
		const entries = Array.isArray(this.data?.data) ? this.data.data : [];

		if (entries.length === 0) {
			const emptyMsg = this.treeBodyEl.createDiv({ cls: 'spec-tree-empty' });
			emptyMsg.setText('Tidak ada file ditemukan dalam query Base ini.');
			return;
		}

		// Check if native groupedData is present
		try {
			if (this.data && Array.isArray(this.data.groupedData) && this.data.groupedData.length > 0) {
				for (const group of this.data.groupedData) {
					const groupKey = group.key !== undefined && group.key !== null ? String(group.key) : 'Ungrouped';
					this.renderFolderGroup(groupKey, group.entries || []);
				}
				return;
			}
		} catch (e) {
			// Ignore getter error and fallback to folder grouping
		}

		// Fallback: Group entries by parent folder path
		const groups = new Map<string, BasesEntry[]>();
		for (const entry of entries) {
			const file = this.extractFile(entry);
			if (!file) continue;
			const folder = file.parent?.path || '/';
			if (!groups.has(folder)) {
				groups.set(folder, []);
			}
			groups.get(folder)!.push(entry);
		}

		// Render each folder group
		for (const [folderPath, folderEntries] of groups) {
			this.renderFolderGroup(folderPath, folderEntries);
		}
	}

	private renderFolderGroup(folderLabelText: string, entries: BasesEntry[]): void {
		const isFolderCollapsed = this.folderCollapsedState.get(folderLabelText) ?? false;

		const groupContainer = this.treeBodyEl.createDiv({ cls: 'spec-tree-group' });

		// Level 0: Group Header (folder ...)
		const groupHeader = groupContainer.createDiv({ cls: 'spec-tree-group-header' });
		const foldIcon = groupHeader.createSpan({ cls: 'spec-tree-fold-icon' });
		foldIcon.setText(isFolderCollapsed ? '▶' : '▼');

		const folderLabel = groupHeader.createSpan({ cls: 'spec-tree-group-label' });
		folderLabel.setText(`folder ${folderLabelText === '/' ? 'Root' : folderLabelText}`);

		groupHeader.onclick = () => {
			this.folderCollapsedState.set(folderLabelText, !isFolderCollapsed);
			this.render();
		};

		if (isFolderCollapsed) return;

		// Level 1: File items inside folder
		const filesList = groupContainer.createDiv({ cls: 'spec-tree-files-container' });

		for (const entry of entries) {
			const file = this.extractFile(entry);
			if (file) {
				this.renderFileItem(filesList, file);
			}
		}
	}

	private renderFileItem(container: HTMLElement, file: TFile): void {
		if (!file) return;
		const isFileCollapsed = this.fileCollapsedState.get(file.path) ?? false;

		const fileItem = container.createDiv({ cls: 'spec-tree-file-item' });

		// Row: File header (• filename, ext, timestamp)
		const fileHeader = fileItem.createDiv({ cls: 'spec-tree-file-header' });

		const foldIcon = fileHeader.createSpan({ cls: 'spec-tree-fold-icon' });
		foldIcon.setText(isFileCollapsed ? '▶' : '▼');

		const bullet = fileHeader.createSpan({ cls: 'spec-tree-bullet' });
		bullet.setText('•');

		const fileNameLink = fileHeader.createEl('a', {
			cls: 'internal-link spec-tree-file-link',
			text: file.basename || file.name,
		});
		fileNameLink.onclick = (e) => {
			e.stopPropagation();
			this.app.workspace.openLinkText(file.path, '', false);
		};

		const metaInfo = fileHeader.createSpan({ cls: 'spec-tree-file-meta' });
		const mtimeStr = file.stat && file.stat.mtime ? new Date(file.stat.mtime).toLocaleString() : '';
		metaInfo.setText(`, ${file.extension || 'md'}, ${mtimeStr}`);

		fileHeader.onclick = () => {
			this.fileCollapsedState.set(file.path, !isFileCollapsed);
			this.render();
		};

		if (isFileCollapsed) return;

		// Level 2: Tab-indented Frontmatter rows
		const specsContainer = fileItem.createDiv({ cls: 'spec-tree-specs-container' });

		// Row 0: [➕ Add Frontmatter]
		const addRow = specsContainer.createDiv({ cls: 'spec-tree-row spec-tree-add-row' });
		const addBtn = addRow.createEl('button', {
			cls: 'spec-tree-add-btn',
			text: '➕ Add Frontmatter',
		});
		addBtn.onclick = (e) => {
			e.stopPropagation();
			this.promptAddFrontmatter(file);
		};

		// Read current frontmatter from cache
		const cache = this.app?.metadataCache ? this.app.metadataCache.getFileCache(file) : null;
		const frontmatter = cache?.frontmatter || {};

		// Render existing frontmatter keys
		for (const [key, value] of Object.entries(frontmatter)) {
			if (key === 'position') continue; // Obsidian internal key
			this.renderPropertyRow(specsContainer, file, key, value);
		}
	}

	private renderPropertyRow(container: HTMLElement, file: TFile, key: string, value: unknown): void {
		const row = container.createDiv({ cls: 'spec-tree-row spec-tree-prop-row' });

		// Key label
		const keyLabel = row.createSpan({ cls: 'spec-tree-prop-key' });
		keyLabel.setText(`${key}:`);

		// Input Textbox
		const inputWrapper = row.createDiv({ cls: 'spec-tree-input-wrapper' });
		const input = inputWrapper.createEl('input', {
			type: 'text',
			cls: 'spec-tree-input',
			value: value !== undefined && value !== null ? String(value) : '',
		});
		input.placeholder = '— (empty)';

		// Save on change/blur
		let initialVal = input.value;
		input.onfocus = () => {
			initialVal = input.value;
		};

		input.onkeydown = (e) => {
			if (e.key === 'Enter') {
				input.blur();
			}
		};

		input.onblur = async () => {
			const newVal = input.value.trim();
			if (newVal === initialVal) return;

			// Commit to frontmatter and record to Master History Engine
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm[key] = newVal;
			});

			if (this.historyEngine) {
				this.historyEngine.recordChange({
					file,
					source: 'base_view',
					action: 'UPDATE_PROPERTY',
					key,
					before: initialVal,
					after: newVal,
				});
			}

			initialVal = newVal;
			this.updateControlBarButtons();
		};

		// Sticky Actions: Copy Link & Delete Prop
		const actionsGroup = row.createDiv({ cls: 'spec-tree-prop-actions' });

		// [📋] Copy Link
		const copyBtn = actionsGroup.createEl('button', {
			cls: 'spec-tree-action-btn',
			text: '📋',
		});
		copyBtn.title = 'Copy reference to clipboard';
		copyBtn.onclick = async (e) => {
			e.stopPropagation();
			const textToCopy = `[[${file.basename}#^${key}]]`;
			await navigator.clipboard.writeText(textToCopy);
			new Notice(`Copied: ${textToCopy}`);
		};

		// [🗑️] Delete Property
		const deleteBtn = actionsGroup.createEl('button', {
			cls: 'spec-tree-action-btn spec-tree-delete-btn',
			text: '🗑️',
		});
		deleteBtn.title = 'Hapus properti ini';
		deleteBtn.onclick = async (e) => {
			e.stopPropagation();
			const confirmDel = confirm(`Hapus properti "${key}" dari "${file.basename}"?`);
			if (!confirmDel) return;

			const beforeVal = value;
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				delete fm[key];
			});

			if (this.historyEngine) {
				this.historyEngine.recordChange({
					file,
					source: 'base_view',
					action: 'DELETE_PROPERTY',
					key,
					before: beforeVal,
					after: undefined,
				});
			}

			new Notice(`Properti "${key}" dihapus.`);
			this.render();
		};
	}

	private promptAddFrontmatter(file: TFile): void {
		const key = prompt(`Masukkan nama frontmatter property baru untuk "${file.basename}":`);
		if (!key || !key.trim()) return;

		const cleanKey = key.trim();
		const val = prompt(`Masukkan nilai awal untuk "${cleanKey}":`, '');
		const cleanVal = val !== null ? val.trim() : '';

		void (async () => {
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm[cleanKey] = cleanVal;
			});

			if (this.historyEngine) {
				this.historyEngine.recordChange({
					file,
					source: 'base_view',
					action: 'ADD_PROPERTY',
					key: cleanKey,
					before: undefined,
					after: cleanVal,
				});
			}

			new Notice(`Properti "${cleanKey}" ditambahkan ke "${file.basename}".`);
			this.render();
		})();
	}
}
