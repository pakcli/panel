export interface HistoryNodeInfo {
	uid: string;
	ctime: number;
	current_path: string;
	previous_paths: string[];
}

export type HistoryActionType = 'UPDATE_PROPERTY' | 'DELETE_PROPERTY' | 'ADD_PROPERTY' | 'RENAME_FILE';

export interface HistoryTransaction {
	id: string;
	timestamp: number;
	source: 'base_view' | 'editor' | 'tree' | 'vault';
	base_path?: string;
	node: HistoryNodeInfo;
	action: HistoryActionType;
	key?: string;
	before: unknown;
	after: unknown;
	file_mtime_before: number;
}

export interface MasterHistoryData {
	version: number;
	max_entries: number;
	transactions: HistoryTransaction[];
	redo_stack: HistoryTransaction[];
}

export interface HistorySettings {
	enabled: boolean;
	defaultMode: 'entire-vault' | 'scoped' | 'none';
	maxEntries: number;
	showScopedHeaderUndo: boolean;
}

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
	enabled: true,
	defaultMode: 'entire-vault',
	maxEntries: 100,
	showScopedHeaderUndo: true,
};
