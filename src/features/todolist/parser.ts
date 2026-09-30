import { ParsedTaskItem, TodoStatus } from './types';

export class TaskLineParser {
    // Regex for matching markdown task checkbox: - [ ], - [/], - [x], - [-], etc.
    private static readonly CHECKBOX_REGEX = /^(\s*[-*+]\s+\[)([\s/xX-])(\]\s*)(.*)$/;

    // Regex for time-range: hh-mm, dd-mm-yyyy -> hh-mm, dd-mm-yyyy
    // Also accepts ":" separator for time e.g. 09:00, 30-09-2026 -> 11:30, 30-09-2026
    private static readonly TIME_RANGE_REGEX = /^(\d{1,2}[-:]\d{2}),\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})\s*->\s*(\d{1,2}[-:]\d{2}),\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})(.*)$/;

    // Wikilink extraction [[target|alias]] or [[target]]
    private static readonly WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

    // Pomodoro count extraction e.g. 🍅 2 or 🍅2 or 🍅 2/3
    private static readonly POMODORO_REGEX = /🍅\s*(\d+)(?:\/\d+)?/;

    /**
     * Parses a single line of text from a markdown file.
     * Returns ParsedTaskItem if line is a valid task checkbox, null otherwise.
     */
    public static parseLine(
        line: string,
        lineNumber: number,
        filePath: string,
        fileName: string
    ): ParsedTaskItem | null {
        const checkMatch = line.match(this.CHECKBOX_REGEX);
        if (!checkMatch) {
            return null;
        }

        const mark = checkMatch[2];
        const restOfLine = checkMatch[4].trim();

        let status: TodoStatus = 'todo';
        if (mark === 'x' || mark === 'X') {
            status = 'done';
        } else if (mark === '/') {
            status = 'in_progress';
        } else if (mark === '-') {
            status = 'cancelled';
        } else {
            status = 'todo';
        }

        let hasTimeRange = false;
        let timeStartStr: string | undefined;
        let dateStartStr: string | undefined;
        let timeEndStr: string | undefined;
        let dateEndStr: string | undefined;
        let startDate: Date | null = null;
        let endDate: Date | null = null;
        let content = restOfLine;

        // Try matching time-range
        const rangeMatch = restOfLine.match(this.TIME_RANGE_REGEX);
        if (rangeMatch) {
            hasTimeRange = true;
            timeStartStr = rangeMatch[1];
            dateStartStr = rangeMatch[2];
            timeEndStr = rangeMatch[3];
            dateEndStr = rangeMatch[4];
            content = rangeMatch[5].trim();

            startDate = this.parseDateTime(timeStartStr, dateStartStr);
            endDate = this.parseDateTime(timeEndStr, dateEndStr);
        }

        // Extract wikilinks
        const wikilinks: string[] = [];
        let linkMatch: RegExpExecArray | null;
        const linkRegex = new RegExp(this.WIKILINK_REGEX);
        while ((linkMatch = linkRegex.exec(content)) !== null) {
            wikilinks.push(linkMatch[1].trim());
        }

        // Extract completed pomodoros
        let completedPomodoros = 0;
        const pomoMatch = content.match(this.POMODORO_REGEX);
        if (pomoMatch) {
            completedPomodoros = parseInt(pomoMatch[1], 10) || 0;
        }

        const id = `${filePath}:${lineNumber}`;

        return {
            id,
            filePath,
            fileName,
            lineNumber,
            rawLine: line,
            status,
            hasTimeRange,
            timeStartStr,
            dateStartStr,
            timeEndStr,
            dateEndStr,
            startDate,
            endDate,
            content,
            wikilinks,
            completedPomodoros
        };
    }

    /**
     * Converts "hh-mm" (or "hh:mm") and "dd-mm-yyyy" (or "dd/mm/yyyy") into a JavaScript Date.
     */
    public static parseDateTime(timeStr: string, dateStr: string): Date | null {
        try {
            const timeParts = timeStr.includes(':') ? timeStr.split(':') : timeStr.split('-');
            if (timeParts.length < 2) return null;
            const hours = parseInt(timeParts[0], 10);
            const minutes = parseInt(timeParts[1], 10);

            const dateDelimiter = dateStr.includes('/') ? '/' : '-';
            const dateParts = dateStr.split(dateDelimiter);
            if (dateParts.length < 3) return null;

            const day = parseInt(dateParts[0], 10);
            const month = parseInt(dateParts[1], 10) - 1; // 0-indexed in JS
            const year = parseInt(dateParts[2], 10);

            if (isNaN(hours) || isNaN(minutes) || isNaN(day) || isNaN(month) || isNaN(year)) {
                return null;
            }

            return new Date(year, month, day, hours, minutes, 0, 0);
        } catch {
            return null;
        }
    }

    /**
     * Replaces the checkbox status symbol of an existing line.
     */
    public static updateLineStatus(rawLine: string, nextStatus: TodoStatus): string {
        let char = ' ';
        if (nextStatus === 'done') char = 'x';
        else if (nextStatus === 'in_progress') char = '/';
        else if (nextStatus === 'cancelled') char = '-';
        else char = ' ';

        return rawLine.replace(this.CHECKBOX_REGEX, (match, prefix, _mark, suffix, rest) => {
            return `${prefix}${char}${suffix}${rest}`;
        });
    }

    /**
     * Increments or updates the pomodoro count on a line string.
     */
    public static addPomodoroToLine(rawLine: string): string {
        if (this.POMODORO_REGEX.test(rawLine)) {
            return rawLine.replace(this.POMODORO_REGEX, (_m, count) => {
                const n = parseInt(count, 10) + 1;
                return `🍅 ${n}`;
            });
        } else {
            return `${rawLine.trimEnd()} 🍅 1`;
        }
    }
}
