import { ItemView, WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import { MasterHistoryEngine } from './MasterHistoryEngine';
import { HistoryTransaction } from './types';

export const VAULT_HISTORY_VIEW_TYPE = 'pakcli-vault-history-view';

export class VaultHistoryView extends ItemView {
	private historyEngine: MasterHistoryEngine;
	private unsubscribe?: () => void;
	private filterQuery = '';

	constructor(leaf: WorkspaceLeaf, historyEngine: MasterHistoryEngine) {
		super(leaf);
		this.historyEngine = historyEngine;
	}

	override getViewType(): string {
		return VAULT_HISTORY_VIEW_TYPE;
	}

	override getDisplayText(): string {
		return 'Vault History & Audit Log';
	}

	override getIcon(): string {
		return 'history';
	}

	override async onOpen(): Promise<void> {
		this.unsubscribe = this.historyEngine.subscribe(() => {
			this.render();
		});
		this.render();
	}

	override async onClose(): Promise<void> {
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		this.containerEl.empty();
	}

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;
		container.empty();
		container.addClass('vault-history-view-container');

		// Header Section
		const header = container.createDiv({ cls: 'vault-history-header' });
		const titleRow = header.createDiv({ cls: 'vault-history-title-row' });
		titleRow.createEl('h4', { text: '🕒 Vault History & Audit Log' });

		// Master Global Controls Row
		const controlsRow = header.createDiv({ cls: 'vault-history-controls-row' });

		const undoBtn = controlsRow.createEl('button', {
			cls: 'mod-cta',
			text: '↶ Master Undo',
		});
		undoBtn.disabled = !this.historyEngine.canUndoGlobal();
		undoBtn.onclick = async () => {
			await this.historyEngine.undoGlobal();
		};

		const redoBtn = controlsRow.createEl('button', {
			cls: 'mod-cta',
			text: '↷ Master Redo',
		});
		redoBtn.disabled = !this.historyEngine.canRedoGlobal();
		redoBtn.onclick = async () => {
			await this.historyEngine.redoGlobal();
		};

		const exportBtn = controlsRow.createEl('button', {
			text: 'Export CSV 📥',
		});
		exportBtn.title = 'Salin riwayat transaksi sebagai format CSV ke clipboard';
		exportBtn.onclick = async () => {
			const csv = this.historyEngine.exportToCsv();
			await navigator.clipboard.writeText(csv);
			new Notice('Riwayat audit CSV berhasil disalin ke clipboard!');
		};

		// Filter / Search Input
		const filterRow = header.createDiv({ cls: 'vault-history-filter-row' });
		const filterInput = filterRow.createEl('input', {
			type: 'text',
			placeholder: 'Filter by file name or key...',
			value: this.filterQuery,
		});
		filterInput.oninput = () => {
			this.filterQuery = filterInput.value.toLowerCase().trim();
			this.renderTransactionsList(listContainer);
		};

		// Transactions List Container
		const listContainer = container.createDiv({ cls: 'vault-history-list' });
		this.renderTransactionsList(listContainer);
	}

	private renderTransactionsList(container: HTMLElement): void {
		container.empty();
		const allTransactions = this.historyEngine.getTransactions();

		const filtered = allTransactions.filter(tx => {
			if (!this.filterQuery) return true;
			const targetFile = tx.node.current_path.toLowerCase();
			const key = (tx.key || '').toLowerCase();
			return targetFile.includes(this.filterQuery) || key.includes(this.filterQuery);
		});

		if (filtered.length === 0) {
			const emptyMsg = container.createDiv({ cls: 'vault-history-empty' });
			emptyMsg.setText('Belum ada transaksi riwayat tercatat.');
			return;
		}

		container.createEl('div', {
			cls: 'vault-history-count-header',
			text: `Recent Transactions (${filtered.length})`,
		});

		for (const tx of filtered) {
			this.renderTransactionItem(container, tx);
		}
	}

	private renderTransactionItem(container: HTMLElement, tx: HistoryTransaction): void {
		const item = container.createDiv({ cls: 'vault-history-item' });

		const timeStr = new Date(tx.timestamp).toLocaleTimeString();
		const fileName = tx.node.current_path.split('/').pop() || tx.node.current_path;

		const topRow = item.createDiv({ cls: 'vault-history-item-top' });
		topRow.createSpan({ cls: 'vault-history-dot' }).setText('●');
		topRow.createSpan({ cls: 'vault-history-time' }).setText(timeStr);
		topRow.createSpan({ cls: 'vault-history-file' }).setText(` — ${fileName}`);

		const detailRow = item.createDiv({ cls: 'vault-history-item-detail' });
		const beforeStr = typeof tx.before === 'object' ? JSON.stringify(tx.before) : String(tx.before ?? '—');
		const afterStr = typeof tx.after === 'object' ? JSON.stringify(tx.after) : String(tx.after ?? '—');

		if (tx.action === 'UPDATE_PROPERTY' || tx.action === 'ADD_PROPERTY' || tx.action === 'DELETE_PROPERTY') {
			detailRow.setText(`Field: ${tx.key || 'property'} ➔ "${afterStr}" (was: "${beforeStr}")`);
		} else {
			detailRow.setText(`Action: ${tx.action}`);
		}

		const scopeRow = item.createDiv({ cls: 'vault-history-item-scope' });
		scopeRow.setText(`Scope: ${tx.base_path || tx.source}`);

		const actionRow = item.createDiv({ cls: 'vault-history-item-actions' });
		const revertBtn = actionRow.createEl('button', {
			cls: 'spec-tree-revert-btn',
			text: '↩ Revert This Cell',
		});
		revertBtn.onclick = async () => {
			await this.historyEngine.revertTransaction(tx.id);
		};
	}
}
