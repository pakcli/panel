export type TodoStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

export type TodoSortOption = 
    | 'dateend_closest' 
    | 'oldest_task' 
    | 'newest_task' 
    | 'a_z' 
    | 'z_a';

export type TodoScopeMode = 'vault' | 'directory';

export type TodoPanelPosition = 'sidebar-left' | 'sidebar-right' | 'center';

export type PomodoroPosition = 'top' | 'bottom';

export type PomodoroTimerState = 'idle' | 'running' | 'paused';

export type PomodoroMode = 'work' | 'short_break' | 'long_break';

export interface ParsedTaskItem {
    id: string;
    filePath: string;
    fileName: string;
    lineNumber: number;
    rawLine: string;
    status: TodoStatus;
    hasTimeRange: boolean;
    timeStartStr?: string;
    dateStartStr?: string;
    timeEndStr?: string;
    dateEndStr?: string;
    startDate?: Date | null;
    endDate?: Date | null;
    content: string;
    wikilinks: string[];
    completedPomodoros: number;
}

export interface TodoListSettings {
    defaultPanelPosition: TodoPanelPosition;
    ribbonIcon: string;
    defaultScopeMode: TodoScopeMode;
    defaultScopeDirectory: string;
    defaultSortOption: TodoSortOption;
    pomodoroPosition: PomodoroPosition;
    workDurationMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    autoStartNextSession: boolean;
    playChimeSound: boolean;
    storageMode?: 'markdown_parser' | 'json' | 'csv';
    jsonFilePath?: string;
    csvFilePath?: string;
}

export const DEFAULT_TODOLIST_SETTINGS: TodoListSettings = {
    defaultPanelPosition: 'sidebar-left',
    ribbonIcon: 'target',
    defaultScopeMode: 'vault',
    defaultScopeDirectory: 'Projects',
    defaultSortOption: 'dateend_closest',
    pomodoroPosition: 'top',
    workDurationMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    autoStartNextSession: false,
    playChimeSound: true,
    storageMode: 'markdown_parser',
    jsonFilePath: 'todo_projects.json',
    csvFilePath: 'todo_projects.csv'
};
