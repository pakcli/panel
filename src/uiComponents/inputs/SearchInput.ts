import { setIcon } from 'obsidian';

export interface SearchInputOptions {
    containerEl: HTMLElement;
    placeholder?: string;
    initialValue?: string;
    debounceMs?: number;
    cls?: string;
    onSearch: (query: string) => void;
}

export class SearchInput {
    public containerEl: HTMLElement;
    public inputEl: HTMLInputElement;
    private clearBtnEl: HTMLElement;
    private debounceTimer: number | null = null;
    private options: SearchInputOptions;

    constructor(options: SearchInputOptions) {
        this.options = options;

        this.containerEl = options.containerEl.createDiv({
            cls: `pakcli-search-input-wrap ${options.cls || ''}`,
        });

        const iconWrap = this.containerEl.createSpan({ cls: 'pakcli-search-icon' });
        setIcon(iconWrap, 'search');

        this.inputEl = this.containerEl.createEl('input', {
            type: 'text',
            cls: 'pakcli-search-input',
            value: options.initialValue || '',
            attr: {
                placeholder: options.placeholder || 'Search...',
                spellcheck: 'false',
            },
        });

        this.clearBtnEl = this.containerEl.createSpan({
            cls: 'pakcli-search-clear-btn',
            text: '✖',
            attr: { title: 'Clear search' },
        });

        this.updateClearBtnVisibility();

        this.inputEl.addEventListener('input', () => {
            this.updateClearBtnVisibility();
            this.triggerDebouncedSearch();
        });

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.clear();
            }
        });

        this.clearBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clear();
        });
    }

    private updateClearBtnVisibility(): void {
        if (this.inputEl.value.trim().length > 0) {
            this.clearBtnEl.addClass('is-visible');
        } else {
            this.clearBtnEl.removeClass('is-visible');
        }
    }

    private triggerDebouncedSearch(): void {
        if (this.debounceTimer !== null) {
            window.clearTimeout(this.debounceTimer);
        }
        const delay = this.options.debounceMs !== undefined ? this.options.debounceMs : 200;
        this.debounceTimer = window.setTimeout(() => {
            this.options.onSearch(this.inputEl.value);
        }, delay);
    }

    public clear(): void {
        this.inputEl.value = '';
        this.updateClearBtnVisibility();
        this.options.onSearch('');
        this.inputEl.focus();
    }

    public getValue(): string {
        return this.inputEl.value;
    }

    public setValue(val: string): void {
        this.inputEl.value = val;
        this.updateClearBtnVisibility();
    }
}
