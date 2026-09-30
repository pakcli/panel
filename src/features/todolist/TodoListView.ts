import { App, ItemView, WorkspaceLeaf, Notice, setIcon, TFile } from 'obsidian';
import { ParsedTaskItem, TodoListSettings, TodoScopeMode, TodoSortOption, TodoStatus } from './types';
import { VaultTaskScanner } from './scanner';
import { PomodoroWidget } from './PomodoroWidget';

export const TODOLIST_VIEW_TYPE = 'pakcli-todolist-view';

export class TodoListView extends ItemView {
    private settings: TodoListSettings;
    private scanner: VaultTaskScanner;
    private pomodoroWidget: PomodoroWidget | null = null;

    // View state
    private tasks: ParsedTaskItem[] = [];
    private filterQuery: string = '';
    private currentScopeMode: TodoScopeMode = 'vault';
    private currentScopeFolder: string = '';
    private currentSort: TodoSortOption = 'dateend_closest';
    private pomodoroPosition: 'top' | 'bottom' = 'top';

    // UI elements
    private todoHeaderEl: HTMLElement | null = null;
    private contentContainerEl: HTMLElement | null = null;
    private pomoContainerEl: HTMLElement | null = null;
    private tasksListContainerEl: HTMLElement | null = null;
    private statsBarEl: HTMLElement | null = null;

    private debounceTimeout: number | null = null;

    constructor(leaf: WorkspaceLeaf, settings: TodoListSettings) {
        super(leaf);
        this.settings = settings;
        this.scanner = new VaultTaskScanner(this.app);

        this.currentScopeMode = settings.defaultScopeMode || 'vault';
        this.currentScopeFolder = settings.defaultScopeDirectory || '';
        this.currentSort = settings.defaultSortOption || 'dateend_closest';
        this.pomodoroPosition = settings.pomodoroPosition || 'top';
    }

    getViewType(): string {
        return TODOLIST_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Todo & Pomodoro Hub';
    }

    getIcon(): string {
        return this.settings.ribbonIcon || 'target';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('pakcli-todolist-root');

        // Build UI Skeleton
        this.todoHeaderEl = container.createDiv({ cls: 'pakcli-todo-header' });
        this.buildHeader();

        this.contentContainerEl = container.createDiv({ cls: 'pakcli-todo-content' });
        this.rebuildSplitLayout();

        // Listen for vault changes to automatically update tasks list
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file.path.endsWith('.md')) this.debouncedScan();
            })
        );
        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file.path.endsWith('.md')) this.debouncedScan();
            })
        );
        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file.path.endsWith('.md')) this.debouncedScan();
            })
        );

        // Initial task scan
        await this.refreshTasks();
    }

    public updateSettings(newSettings: TodoListSettings): void {
        this.settings = newSettings;
        if (this.pomodoroPosition !== newSettings.pomodoroPosition) {
            this.pomodoroPosition = newSettings.pomodoroPosition;
            this.rebuildSplitLayout();
        }
    }

    private rebuildSplitLayout(): void {
        if (!this.contentContainerEl) return;
        this.contentContainerEl.empty();

        this.pomoContainerEl = createDiv({ cls: 'pakcli-todo-pomo-slot' });
        this.tasksListContainerEl = createDiv({ cls: 'pakcli-todo-tasks-slot' });

        if (this.pomodoroPosition === 'top') {
            this.contentContainerEl.appendChild(this.pomoContainerEl);
            this.contentContainerEl.appendChild(this.tasksListContainerEl);
        } else {
            this.contentContainerEl.appendChild(this.tasksListContainerEl);
            this.contentContainerEl.appendChild(this.pomoContainerEl);
        }

        // Initialize Pomodoro
        if (this.pomodoroWidget) {
            this.pomodoroWidget.destroy();
        }
        this.pomodoroWidget = new PomodoroWidget(this.pomoContainerEl, this.settings);
        this.pomodoroWidget.onSessionCompleted = async (activeTask) => {
            if (activeTask) {
                await this.scanner.incrementTaskPomodoro(activeTask);
                this.renderTaskList();
            }
        };
        this.pomodoroWidget.render();

        this.renderTaskList();
    }

    private buildHeader(): void {
        if (!this.todoHeaderEl) return;
        this.todoHeaderEl.empty();

        const topRow = this.todoHeaderEl.createDiv({ cls: 'todo-header-top' });
        
        // Title & Icon
        const titleArea = topRow.createDiv({ cls: 'todo-header-title-area' });
        const iconSpan = titleArea.createSpan({ cls: 'todo-header-icon' });
        setIcon(iconSpan, 'target');
        titleArea.createSpan({ text: 'Focus & Tasks', cls: 'todo-header-title' });

        // Action Toolbar
        const actions = topRow.createDiv({ cls: 'todo-header-actions' });

        // Toggle Pomodoro Position
        const togglePosBtn = actions.createEl('button', {
            cls: 'clickable-icon todo-action-btn',
            title: this.pomodoroPosition === 'top' ? 'Move Pomodoro to Bottom' : 'Move Pomodoro to Top'
        });
        setIcon(togglePosBtn, this.pomodoroPosition === 'top' ? 'panel-top-close' : 'panel-bottom-close');
        togglePosBtn.onclick = () => {
            this.pomodoroPosition = this.pomodoroPosition === 'top' ? 'bottom' : 'top';
            togglePosBtn.title = this.pomodoroPosition === 'top' ? 'Move Pomodoro to Bottom' : 'Move Pomodoro to Top';
            setIcon(togglePosBtn, this.pomodoroPosition === 'top' ? 'panel-top-close' : 'panel-bottom-close');
            this.rebuildSplitLayout();
        };

        // Refresh Button
        const refreshBtn = actions.createEl('button', {
            cls: 'clickable-icon todo-action-btn',
            title: 'Refresh Tasks from Vault'
        });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.onclick = () => this.refreshTasks();

        // Control Row: Scope & Sort Dropdowns
        const controlsRow = this.todoHeaderEl.createDiv({ cls: 'todo-header-controls' });

        // Scope Dropdown
        const scopeContainer = controlsRow.createDiv({ cls: 'todo-control-group' });
        const scopeSelect = scopeContainer.createEl('select', { cls: 'dropdown todo-scope-select' });

        const vaultOpt = scopeSelect.createEl('option', { text: '🌐 Whole Vault', value: 'vault' });
        if (this.currentScopeMode === 'vault') vaultOpt.selected = true;

        const allFolders = this.scanner.getAllFolders();
        for (const folder of allFolders) {
            const opt = scopeSelect.createEl('option', { text: `📁 ${folder}`, value: folder });
            if (this.currentScopeMode === 'directory' && this.currentScopeFolder === folder) {
                opt.selected = true;
            }
        }

        scopeSelect.onchange = () => {
            const val = scopeSelect.value;
            if (val === 'vault') {
                this.currentScopeMode = 'vault';
                this.currentScopeFolder = '';
            } else {
                this.currentScopeMode = 'directory';
                this.currentScopeFolder = val;
            }
            this.refreshTasks();
        };

        // Sort Dropdown
        const sortContainer = controlsRow.createDiv({ cls: 'todo-control-group' });
        const sortSelect = sortContainer.createEl('select', { cls: 'dropdown todo-sort-select' });

        const sortOptions: { val: TodoSortOption; label: string }[] = [
            { val: 'dateend_closest', label: '⏳ Date End Closest (Default)' },
            { val: 'oldest_task', label: '⏮️ Oldest Task' },
            { val: 'newest_task', label: '⏭️ Newest Task' },
            { val: 'a_z', label: '🔤 A -> Z' },
            { val: 'z_a', label: '🔤 Z -> A' }
        ];

        for (const s of sortOptions) {
            const opt = sortSelect.createEl('option', { text: s.label, value: s.val });
            if (this.currentSort === s.val) opt.selected = true;
        }

        sortSelect.onchange = () => {
            this.currentSort = sortSelect.value as TodoSortOption;
            this.renderTaskList();
        };

        // Search Filter Input
        const searchRow = this.todoHeaderEl.createDiv({ cls: 'todo-header-search' });
        const searchInput = searchRow.createEl('input', {
            type: 'text',
            cls: 'todo-search-input',
            placeholder: 'Filter task text or [[wikilink]]...'
        });
        searchInput.value = this.filterQuery;
        searchInput.oninput = () => {
            this.filterQuery = searchInput.value.toLowerCase().trim();
            this.renderTaskList();
        };

        // Stats summary bar
        this.statsBarEl = this.todoHeaderEl.createDiv({ cls: 'todo-stats-bar' });
        this.updateStatsDisplay();
    }

    private updateStatsDisplay(): void {
        if (!this.statsBarEl) return;
        const total = this.tasks.length;
        const done = this.tasks.filter(t => t.status === 'done').length;
        const inProg = this.tasks.filter(t => t.status === 'in_progress').length;
        const todo = this.tasks.filter(t => t.status === 'todo').length;

        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        this.statsBarEl.setText(`Tasks: ${total} | Todo: ${todo} | In Progress: ${inProg} | Done: ${done} (${percent}%)`);
    }

    private debouncedScan(): void {
        if (this.debounceTimeout !== null) {
            window.clearTimeout(this.debounceTimeout);
        }
        this.debounceTimeout = window.setTimeout(() => {
            this.refreshTasks();
        }, 500);
    }

    private async refreshTasks(): Promise<void> {
        this.tasks = await this.scanner.scanTasks(this.currentScopeMode, this.currentScopeFolder);
        this.updateStatsDisplay();
        this.renderTaskList();
    }

    private renderTaskList(): void {
        if (!this.tasksListContainerEl) return;
        this.tasksListContainerEl.empty();

        let filtered = this.tasks;
        if (this.filterQuery) {
            filtered = filtered.filter(t => 
                t.content.toLowerCase().includes(this.filterQuery) ||
                t.fileName.toLowerCase().includes(this.filterQuery) ||
                t.wikilinks.some(link => link.toLowerCase().includes(this.filterQuery))
            );
        }

        const sorted = this.scanner.sortTasks(filtered, this.currentSort);

        if (sorted.length === 0) {
            const emptyEl = this.tasksListContainerEl.createDiv({ cls: 'todo-empty-state' });
            setIcon(emptyEl.createSpan({ cls: 'todo-empty-icon' }), 'check-circle-2');
            emptyEl.createSpan({ 
                text: this.tasks.length === 0 
                    ? 'No tasks found in selected scope.\nCreate a task with: - [ ] hh-mm, dd-mm-yyyy -> hh-mm, dd-mm-yyyy Title [[Note]]' 
                    : 'No tasks match current filter.' 
            });
            return;
        }

        const listEl = this.tasksListContainerEl.createDiv({ cls: 'todo-items-list' });

        for (const task of sorted) {
            this.renderTaskItem(listEl, task);
        }
    }

    private renderTaskItem(containerEl: HTMLElement, task: ParsedTaskItem): void {
        const itemEl = containerEl.createDiv({ cls: `todo-task-item status-${task.status}` });

        // Highlight active task in pomodoro
        const activePomoTask = this.pomodoroWidget?.getActiveTask();
        if (activePomoTask && activePomoTask.id === task.id) {
            itemEl.addClass('is-pomodoro-active');
        }

        // Left: Interactive Status Checkbox Button
        const statusBtn = itemEl.createEl('button', { 
            cls: `todo-status-btn status-${task.status}`,
            title: `Status: ${task.status} (Click to toggle)`
        });
        this.renderStatusIcon(statusBtn, task.status);

        statusBtn.onclick = async (e) => {
            e.stopPropagation();
            const nextStatus = this.getNextStatus(task.status);
            const success = await this.scanner.updateTaskStatus(task, nextStatus);
            if (success) {
                this.updateStatsDisplay();
                this.renderTaskList();
            }
        };

        // Center: Task Body
        const bodyEl = itemEl.createDiv({ cls: 'todo-task-body' });

        // Top line: Time badge & Note badge
        const metaLine = bodyEl.createDiv({ cls: 'todo-task-meta' });

        // File Origin Badge
        const fileBadge = metaLine.createSpan({ cls: 'todo-file-badge', text: task.fileName });
        fileBadge.title = task.filePath;
        fileBadge.onclick = (e) => {
            e.stopPropagation();
            this.openSourceFile(task);
        };

        // Time Range Badge
        if (task.hasTimeRange && task.timeStartStr && task.dateStartStr && task.timeEndStr && task.dateEndStr) {
            const timeBadge = metaLine.createSpan({ cls: 'todo-time-badge' });
            
            const isOverdue = task.endDate && task.endDate.getTime() < Date.now() && task.status !== 'done';
            const isToday = task.endDate && this.isToday(task.endDate);

            if (isOverdue) timeBadge.addClass('is-overdue');
            else if (isToday) timeBadge.addClass('is-today');

            timeBadge.setText(`⏱️ ${task.timeStartStr}, ${task.dateStartStr} -> ${task.timeEndStr}, ${task.dateEndStr}`);
            if (isOverdue) {
                timeBadge.title = 'Overdue Deadline!';
            }
        }

        // Completed Pomodoros Pill
        if (task.completedPomodoros > 0) {
            metaLine.createSpan({ cls: 'todo-pomo-pill', text: `🍅 ${task.completedPomodoros}` });
        }

        // Content Line (Render text and clickable [[wikilinks]])
        const contentLine = bodyEl.createDiv({ cls: 'todo-task-content' });
        this.renderTaskContentWithWikilinks(contentLine, task);

        // Right: Action Buttons
        const actionsEl = itemEl.createDiv({ cls: 'todo-task-actions' });

        // Focus Pomodoro Button
        const focusBtn = actionsEl.createEl('button', {
            cls: 'todo-action-icon-btn focus-btn',
            title: 'Focus in Pomodoro'
        });
        setIcon(focusBtn, 'crosshair');
        focusBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.pomodoroWidget) {
                this.pomodoroWidget.setActiveTask(task);
                this.renderTaskList();
                new Notice(`🎯 Focus set to: ${task.content || task.fileName}`);
            }
        };

        // Go to Source Note & Line
        const openBtn = actionsEl.createEl('button', {
            cls: 'todo-action-icon-btn open-btn',
            title: 'Open in editor at line'
        });
        setIcon(openBtn, 'external-link');
        openBtn.onclick = (e) => {
            e.stopPropagation();
            this.openSourceFile(task);
        };
    }

    private renderStatusIcon(btn: HTMLElement, status: TodoStatus): void {
        btn.empty();
        if (status === 'done') {
            setIcon(btn, 'check');
        } else if (status === 'in_progress') {
            setIcon(btn, 'loader');
        } else if (status === 'cancelled') {
            setIcon(btn, 'x');
        } else {
            setIcon(btn, 'circle');
        }
    }

    private getNextStatus(curr: TodoStatus): TodoStatus {
        if (curr === 'todo') return 'in_progress';
        if (curr === 'in_progress') return 'done';
        if (curr === 'done') return 'cancelled';
        return 'todo';
    }

    private renderTaskContentWithWikilinks(container: HTMLElement, task: ParsedTaskItem): void {
        const text = task.content;
        const wikilinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = wikilinkRegex.exec(text)) !== null) {
            // Text before link
            if (match.index > lastIndex) {
                container.createSpan({ text: text.substring(lastIndex, match.index) });
            }

            const target = match[1];
            const alias = match[2] || target;

            const linkEl = container.createEl('a', {
                cls: 'internal-link todo-wikilink',
                text: alias,
                href: '#'
            });
            linkEl.title = `Open [[${target}]]`;
            linkEl.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.app.workspace.openLinkText(target, task.filePath);
            };

            lastIndex = match.index + match[0].length;
        }

        // Remaining text
        if (lastIndex < text.length) {
            container.createSpan({ text: text.substring(lastIndex) });
        }
    }

    private async openSourceFile(task: ParsedTaskItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.filePath);
        if (file instanceof TFile) {
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file, { eState: { line: task.lineNumber - 1 } });
        }
    }

    private isToday(date: Date): boolean {
        const today = new Date();
        return date.getDate() === today.getDate() &&
               date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    }

    async onClose(): Promise<void> {
        if (this.pomodoroWidget) {
            this.pomodoroWidget.destroy();
            this.pomodoroWidget = null;
        }
        if (this.debounceTimeout !== null) {
            window.clearTimeout(this.debounceTimeout);
            this.debounceTimeout = null;
        }
    }
}
