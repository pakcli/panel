import { App, TFile, Notice } from 'obsidian';

export interface TriageHistoryEntry {
    timestamp: number;
    filePath: string;
    action: 'pin' | 'unpin';
    targetLink: string;
    previousList: string[];
}

export class TriageHistoryManager {
    private history: TriageHistoryEntry[] = [];
    private future: TriageHistoryEntry[] = [];
    private readonly MAX_HISTORY = 30;

    push(entry: TriageHistoryEntry) {
        this.history.push(entry);
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        }
        this.future = [];
    }

    async pinToFrontmatter(app: App, file: TFile, linkName: string): Promise<void> {
        let previousList: string[] = [];
        await app.fileManager.processFrontMatter(file, (fm) => {
            if (!fm.dependencies) fm.dependencies = [];
            const list: string[] = Array.isArray(fm.dependencies) ? fm.dependencies : [fm.dependencies];
            previousList = [...list];
            const clean = `[[${linkName}]]`;
            if (!list.includes(clean) && !list.includes(linkName)) {
                list.push(clean);
            }
            fm.dependencies = list;
        });

        this.push({
            timestamp: Date.now(),
            filePath: file.path,
            action: 'pin',
            targetLink: linkName,
            previousList
        });

        new Notice(`📌 Pinned [[${linkName}]] to Hard Dependencies.`);
    }

    async unpinFromFrontmatter(app: App, file: TFile, linkName: string): Promise<void> {
        let previousList: string[] = [];
        await app.fileManager.processFrontMatter(file, (fm) => {
            if (!fm.dependencies) return;
            const list: string[] = Array.isArray(fm.dependencies) ? fm.dependencies : [fm.dependencies];
            previousList = [...list];
            fm.dependencies = list.filter((item: string) => {
                const c = String(item).replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
                return c !== linkName;
            });
        });

        this.push({
            timestamp: Date.now(),
            filePath: file.path,
            action: 'unpin',
            targetLink: linkName,
            previousList
        });

        new Notice(`✖ Unpinned [[${linkName}]] from Hard Dependencies.`);
    }

    async undo(app: App): Promise<void> {
        const entry = this.history.pop();
        if (!entry) {
            new Notice('Tidak ada aksi yang bisa di-undo.');
            return;
        }

        const file = app.vault.getAbstractFileByPath(entry.filePath);
        if (!(file instanceof TFile)) return;

        let currentList: string[] = [];
        await app.fileManager.processFrontMatter(file, (fm) => {
            currentList = Array.isArray(fm.dependencies) ? [...fm.dependencies] : (fm.dependencies ? [fm.dependencies] : []);
            fm.dependencies = entry.previousList;
        });

        this.future.push({
            ...entry,
            previousList: currentList
        });

        new Notice(`↩️ Undo: restored previous dependencies state.`);
    }

    async redo(app: App): Promise<void> {
        const entry = this.future.pop();
        if (!entry) {
            new Notice('Tidak ada aksi yang bisa di-redo.');
            return;
        }

        const file = app.vault.getAbstractFileByPath(entry.filePath);
        if (!(file instanceof TFile)) return;

        let currentList: string[] = [];
        await app.fileManager.processFrontMatter(file, (fm) => {
            currentList = Array.isArray(fm.dependencies) ? [...fm.dependencies] : (fm.dependencies ? [fm.dependencies] : []);
            fm.dependencies = entry.previousList;
        });

        this.history.push({
            ...entry,
            previousList: currentList
        });

        new Notice(`↪️ Redo: re-applied dependencies state.`);
    }
}
