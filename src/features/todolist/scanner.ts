import { App, TFile, TFolder } from 'obsidian';
import { ParsedTaskItem, TodoScopeMode, TodoSortOption, TodoStatus } from './types';
import { TaskLineParser } from './parser';

export class VaultTaskScanner {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Retrieves all folder paths in the vault for the scope dropdown.
     */
    public getAllFolders(): string[] {
        const folders: string[] = [];
        const filesAndFolders = this.app.vault.getAllLoadedFiles();
        for (const item of filesAndFolders) {
            if (item instanceof TFolder && item.path !== '/') {
                folders.push(item.path);
            }
        }
        return folders.sort((a, b) => a.localeCompare(b));
    }

    /**
     * Scans markdown files in the specified scope (vault or folder) and extracts tasks.
     */
    public async scanTasks(scopeMode: TodoScopeMode, scopeDirectory?: string): Promise<ParsedTaskItem[]> {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const targetFiles: TFile[] = [];

        const normalizedDir = scopeDirectory ? scopeDirectory.trim().replace(/^\/+|\/+$/g, '') : '';

        for (const file of markdownFiles) {
            if (scopeMode === 'directory' && normalizedDir) {
                // Must be inside the directory
                if (file.path.startsWith(normalizedDir + '/') || file.path === normalizedDir) {
                    targetFiles.push(file);
                }
            } else {
                targetFiles.push(file);
            }
        }

        const tasks: ParsedTaskItem[] = [];

        for (const file of targetFiles) {
            try {
                const content = await this.app.vault.cachedRead(file);
                const lines = content.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const parsed = TaskLineParser.parseLine(line, i + 1, file.path, file.basename);
                    if (parsed) {
                        tasks.push(parsed);
                    }
                }
            } catch (err) {
                console.warn(`[VaultTaskScanner] Failed to read ${file.path}:`, err);
            }
        }

        return tasks;
    }

    /**
     * Sorts tasks according to the chosen sort strategy.
     */
    public sortTasks(tasks: ParsedTaskItem[], sortOption: TodoSortOption): ParsedTaskItem[] {
        const sorted = [...tasks];
        const now = new Date().getTime();

        switch (sortOption) {
            case 'dateend_closest': {
                return sorted.sort((a, b) => {
                    // Priority to items with endDate
                    if (a.endDate && b.endDate) {
                        return a.endDate.getTime() - b.endDate.getTime();
                    }
                    if (a.endDate && !b.endDate) return -1;
                    if (!a.endDate && b.endDate) return 1;
                    return a.content.localeCompare(b.content);
                });
            }
            case 'oldest_task': {
                return sorted.sort((a, b) => {
                    const timeA = a.startDate ? a.startDate.getTime() : (a.endDate ? a.endDate.getTime() : Infinity);
                    const timeB = b.startDate ? b.startDate.getTime() : (b.endDate ? b.endDate.getTime() : Infinity);
                    if (timeA !== timeB) return timeA - timeB;
                    return a.content.localeCompare(b.content);
                });
            }
            case 'newest_task': {
                return sorted.sort((a, b) => {
                    const timeA = a.startDate ? a.startDate.getTime() : (a.endDate ? a.endDate.getTime() : -Infinity);
                    const timeB = b.startDate ? b.startDate.getTime() : (b.endDate ? b.endDate.getTime() : -Infinity);
                    if (timeA !== timeB) return timeB - timeA;
                    return a.content.localeCompare(b.content);
                });
            }
            case 'a_z': {
                return sorted.sort((a, b) => a.content.localeCompare(b.content));
            }
            case 'z_a': {
                return sorted.sort((a, b) => b.content.localeCompare(a.content));
            }
            default:
                return sorted;
        }
    }

    /**
     * Updates the status of a task line in its corresponding Markdown file.
     */
    public async updateTaskStatus(task: ParsedTaskItem, nextStatus: TodoStatus): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(task.filePath);
        if (!(file instanceof TFile)) {
            return false;
        }

        try {
            await this.app.vault.process(file, (data) => {
                const lines = data.split(/\r?\n/);
                const lineIdx = task.lineNumber - 1;
                if (lineIdx >= 0 && lineIdx < lines.length) {
                    const updated = TaskLineParser.updateLineStatus(lines[lineIdx], nextStatus);
                    lines[lineIdx] = updated;
                    return lines.join('\n');
                }
                return data;
            });
            task.status = nextStatus;
            return true;
        } catch (err) {
            console.error(`[VaultTaskScanner] Failed to update task status in ${task.filePath}:`, err);
            return false;
        }
    }

    /**
     * Appends or increments pomodoro session count on the task's line.
     */
    public async incrementTaskPomodoro(task: ParsedTaskItem): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(task.filePath);
        if (!(file instanceof TFile)) {
            return false;
        }

        try {
            await this.app.vault.process(file, (data) => {
                const lines = data.split(/\r?\n/);
                const lineIdx = task.lineNumber - 1;
                if (lineIdx >= 0 && lineIdx < lines.length) {
                    const updated = TaskLineParser.addPomodoroToLine(lines[lineIdx]);
                    lines[lineIdx] = updated;
                    return lines.join('\n');
                }
                return data;
            });
            task.completedPomodoros = (task.completedPomodoros || 0) + 1;
            return true;
        } catch (err) {
            console.error(`[VaultTaskScanner] Failed to increment pomodoro in ${task.filePath}:`, err);
            return false;
        }
    }
}
