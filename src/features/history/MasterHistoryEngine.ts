import { App, Notice, TFile, EventRef } from 'obsidian';
import { HistoryTransaction, HistoryNodeInfo, HistorySettings, DEFAULT_HISTORY_SETTINGS } from './types';

export class MasterHistoryEngine {
	private app: App;
	private settings: HistorySettings;
	private transactions: HistoryTransaction[] = [];
	private redoStack: HistoryTransaction[] = [];
	private listeners: Set<() => void> = new Set();
	private eventRefs: EventRef[] = [];
	private isApplyingHistory = false;

	constructor(app: App, settings: Partial<HistorySettings> = {}) {
		this.app = app;
		this.settings = { ...DEFAULT_HISTORY_SETTINGS, ...settings };
		this.registerVaultListeners();
	}

	public updateSettings(settings: Partial<HistorySettings>): void {
		this.settings = { ...this.settings, ...settings };
		this.notifyChange();
	}

	public getSettings(): HistorySettings {
		return this.settings;
	}

	public subscribe(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	private notifyChange(): void {
		for (const cb of this.listeners) {
			try {
				cb();
			} catch (e) {
				console.error('[MasterHistoryEngine] Listener callback failed:', e);
			}
		}
	}

	private registerVaultListeners(): void {
		// Track file renames to maintain node identity & historical paths
		const renameRef = this.app.vault.on('rename', (file, oldPath) => {
			if (!(file instanceof TFile)) return;
			const newPath = file.path;

			// Update all transactions referencing this file
			for (const tx of [...this.transactions, ...this.redoStack]) {
				if (tx.node.current_path === oldPath || tx.node.previous_paths.includes(oldPath)) {
					if (!tx.node.previous_paths.includes(oldPath)) {
						tx.node.previous_paths.push(oldPath);
					}
					tx.node.current_path = newPath;
				}
			}
			this.notifyChange();
		});
		this.eventRefs.push(renameRef);
	}

	public unload(): void {
		for (const ref of this.eventRefs) {
			this.app.vault.offref(ref);
		}
		this.eventRefs = [];
		this.listeners.clear();
	}

	/**
	 * Build or extract persistent node tracking info for a file
	 */
	public getNodeInfo(file: TFile): HistoryNodeInfo {
		const ctime = file.stat.ctime || Date.now();
		const uid = `f_${ctime}_${file.basename.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`;
		return {
			uid,
			ctime,
			current_path: file.path,
			previous_paths: [],
		};
	}

	/**
	 * Record a new change transaction
	 */
	public recordChange(params: {
		file: TFile;
		source: 'base_view' | 'editor' | 'tree' | 'vault';
		action: HistoryTransaction['action'];
		key?: string;
		before: unknown;
		after: unknown;
		basePath?: string;
	}): HistoryTransaction | null {
		if (!this.settings.enabled || this.isApplyingHistory) return null;

		const tx: HistoryTransaction = {
			id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
			timestamp: Date.now(),
			source: params.source,
			base_path: params.basePath,
			node: this.getNodeInfo(params.file),
			action: params.action,
			key: params.key,
			before: params.before,
			after: params.after,
			file_mtime_before: params.file.stat.mtime,
		};

		this.transactions.push(tx);
		if (this.transactions.length > this.settings.maxEntries) {
			this.transactions.shift();
		}

		// New direct action clears redo stack
		this.redoStack = [];
		this.notifyChange();
		return tx;
	}

	/**
	 * Get history transactions (newest first)
	 */
	public getTransactions(): readonly HistoryTransaction[] {
		return [...this.transactions].reverse();
	}

	public getRedoStack(): readonly HistoryTransaction[] {
		return [...this.redoStack].reverse();
	}

	public canUndoGlobal(): boolean {
		return this.transactions.length > 0;
	}

	public canRedoGlobal(): boolean {
		return this.redoStack.length > 0;
	}

	public canUndoScoped(filePaths: string[]): boolean {
		const set = new Set(filePaths);
		return this.transactions.some(tx => set.has(tx.node.current_path) || tx.node.previous_paths.some(p => set.has(p)));
	}

	public canRedoScoped(filePaths: string[]): boolean {
		const set = new Set(filePaths);
		return this.redoStack.some(tx => set.has(tx.node.current_path) || tx.node.previous_paths.some(p => set.has(p)));
	}

	/**
	 * Perform Global Undo
	 */
	public async undoGlobal(): Promise<boolean> {
		if (this.transactions.length === 0) return false;
		const tx = this.transactions.pop()!;
		const success = await this.applyReverseTransaction(tx);
		if (success) {
			this.redoStack.push(tx);
			const fileName = tx.node.current_path.split('/').pop() || tx.node.current_path;
			new Notice(`Undo (Global): ${tx.key || tx.action} pada ${fileName}`);
		} else {
			// Put back if rollback was aborted
			this.transactions.push(tx);
		}
		this.notifyChange();
		return success;
	}

	/**
	 * Perform Global Redo
	 */
	public async redoGlobal(): Promise<boolean> {
		if (this.redoStack.length === 0) return false;
		const tx = this.redoStack.pop()!;
		const success = await this.applyForwardTransaction(tx);
		if (success) {
			this.transactions.push(tx);
			const fileName = tx.node.current_path.split('/').pop() || tx.node.current_path;
			new Notice(`Redo (Global): ${tx.key || tx.action} pada ${fileName}`);
		} else {
			this.redoStack.push(tx);
		}
		this.notifyChange();
		return success;
	}

	/**
	 * Perform Scoped Undo (only affects files currently in the active Base scope)
	 */
	public async undoScoped(filePaths: string[]): Promise<boolean> {
		const set = new Set(filePaths);
		const idx = this.findLastIndex(this.transactions, tx =>
			set.has(tx.node.current_path) || tx.node.previous_paths.some(p => set.has(p))
		);

		if (idx === -1) {
			new Notice('Tidak ada perubahan yang dapat di-undo pada view ini.');
			return false;
		}

		const [tx] = this.transactions.splice(idx, 1);
		const success = await this.applyReverseTransaction(tx);
		if (success) {
			this.redoStack.push(tx);
		} else {
			this.transactions.splice(idx, 0, tx);
		}
		this.notifyChange();
		return success;
	}

	/**
	 * Perform Scoped Redo
	 */
	public async redoScoped(filePaths: string[]): Promise<boolean> {
		const set = new Set(filePaths);
		const idx = this.findLastIndex(this.redoStack, tx =>
			set.has(tx.node.current_path) || tx.node.previous_paths.some(p => set.has(p))
		);

		if (idx === -1) {
			new Notice('Tidak ada perubahan yang dapat di-redo pada view ini.');
			return false;
		}

		const [tx] = this.redoStack.splice(idx, 1);
		const success = await this.applyForwardTransaction(tx);
		if (success) {
			this.transactions.push(tx);
		} else {
			this.redoStack.splice(idx, 0, tx);
		}
		this.notifyChange();
		return success;
	}

	/**
	 * Surgical Revert of a specific transaction cell from audit log
	 */
	public async revertTransaction(id: string): Promise<boolean> {
		const idx = this.transactions.findIndex(t => t.id === id);
		if (idx === -1) return false;

		const tx = this.transactions[idx];
		const success = await this.applyReverseTransaction(tx);
		if (success) {
			this.transactions.splice(idx, 1);
			this.redoStack.push(tx);
			this.notifyChange();
			new Notice(`Perubahan "${tx.key || tx.action}" berhasil di-revert.`);
		}
		return success;
	}

	/**
	 * Core Rollback Worker with Stale-Check Guard
	 */
	private async applyReverseTransaction(tx: HistoryTransaction): Promise<boolean> {
		const file = this.resolveFile(tx.node);
		if (!file) {
			new Notice(`⚠️ File tidak ditemukan: ${tx.node.current_path}`);
			return false;
		}

		// Stale-Check Guard: verify file wasn't modified externally after the transaction
		if (file.stat.mtime > tx.file_mtime_before + 3000) {
			// Tolerance of 3 seconds to account for slight file-system write latency
			const proceed = confirm(
				`⚠️ File "${file.basename}" telah dimodifikasi di luar Base View sejak perubahan ini dibuat.\nLanjutkan undo dan timpa perubahan manual?`
			);
			if (!proceed) {
				new Notice('⚠️ Undo dibatalkan: File telah dimodifikasi di luar Base View. Perubahan manual Anda tetap aman.');
				return false;
			}
		}

		this.isApplyingHistory = true;
		try {
			if (tx.action === 'UPDATE_PROPERTY' || tx.action === 'ADD_PROPERTY' || tx.action === 'DELETE_PROPERTY') {
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					if (!tx.key) return;
					if (tx.action === 'ADD_PROPERTY') {
						// Reversing an addition means removing it
						delete fm[tx.key];
					} else if (tx.action === 'DELETE_PROPERTY') {
						// Reversing a deletion means restoring the before value
						fm[tx.key] = tx.before;
					} else {
						// Reversing an update sets it back to before
						if (tx.before === undefined || tx.before === null) {
							delete fm[tx.key];
						} else {
							fm[tx.key] = tx.before;
						}
					}
				});
				return true;
			}
			return false;
		} catch (err) {
			console.error('[MasterHistoryEngine] Failed to apply reverse transaction:', err);
			new Notice(`Gagal mengembalikan perubahan: ${String(err)}`);
			return false;
		} finally {
			this.isApplyingHistory = false;
		}
	}

	/**
	 * Core Forward Worker for Redo
	 */
	private async applyForwardTransaction(tx: HistoryTransaction): Promise<boolean> {
		const file = this.resolveFile(tx.node);
		if (!file) {
			new Notice(`⚠️ File tidak ditemukan: ${tx.node.current_path}`);
			return false;
		}

		this.isApplyingHistory = true;
		try {
			if (tx.action === 'UPDATE_PROPERTY' || tx.action === 'ADD_PROPERTY' || tx.action === 'DELETE_PROPERTY') {
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					if (!tx.key) return;
					if (tx.action === 'DELETE_PROPERTY') {
						delete fm[tx.key];
					} else {
						fm[tx.key] = tx.after;
					}
				});
				return true;
			}
			return false;
		} catch (err) {
			console.error('[MasterHistoryEngine] Failed to apply forward transaction:', err);
			return false;
		} finally {
			this.isApplyingHistory = false;
		}
	}

	private resolveFile(node: HistoryNodeInfo): TFile | null {
		const direct = this.app.vault.getAbstractFileByPath(node.current_path);
		if (direct instanceof TFile) return direct;

		for (const oldPath of node.previous_paths) {
			const candidate = this.app.vault.getAbstractFileByPath(oldPath);
			if (candidate instanceof TFile) return candidate;
		}
		return null;
	}

	private findLastIndex<T>(array: T[], predicate: (item: T) => boolean): number {
		for (let i = array.length - 1; i >= 0; i--) {
			if (predicate(array[i])) return i;
		}
		return -1;
	}

	/**
	 * Export the current history log to CSV format
	 */
	public exportToCsv(): string {
		const headers = ['ID', 'Timestamp', 'Date_Time', 'File', 'Action', 'Key', 'Before', 'After', 'Scope'];
		const rows = this.transactions.map(tx => {
			const dt = new Date(tx.timestamp).toISOString();
			const beforeStr = typeof tx.before === 'object' ? JSON.stringify(tx.before) : String(tx.before ?? '');
			const afterStr = typeof tx.after === 'object' ? JSON.stringify(tx.after) : String(tx.after ?? '');
			return [
				tx.id,
				tx.timestamp,
				dt,
				`"${tx.node.current_path.replace(/"/g, '""')}"`,
				tx.action,
				`"${(tx.key || '').replace(/"/g, '""')}"`,
				`"${beforeStr.replace(/"/g, '""')}"`,
				`"${afterStr.replace(/"/g, '""')}"`,
				`"${(tx.base_path || tx.source).replace(/"/g, '""')}"`,
			].join(',');
		});
		return [headers.join(','), ...rows].join('\n');
	}
}
