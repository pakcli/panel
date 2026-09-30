import { Notice, setIcon } from 'obsidian';
import { ParsedTaskItem, PomodoroMode, PomodoroTimerState, TodoListSettings } from './types';

export class PomodoroWidget {
    private containerEl: HTMLElement;
    private settings: TodoListSettings;
    private timerState: PomodoroTimerState = 'idle';
    private currentMode: PomodoroMode = 'work';
    private remainingSeconds: number = 25 * 60;
    private totalSeconds: number = 25 * 60;
    private intervalId: number | null = null;
    private activeTask: ParsedTaskItem | null = null;
    private completedSessionsToday: number = 0;

    // DOM References
    private rootEl: HTMLElement | null = null;
    private timerTextEl: HTMLElement | null = null;
    private progressRingEl: SVGCircleElement | null = null;
    private startBtnEl: HTMLButtonElement | null = null;
    private activeTaskTextEl: HTMLElement | null = null;
    private sessionDotsEl: HTMLElement | null = null;

    public onSessionCompleted?: (task: ParsedTaskItem | null) => void;

    constructor(containerEl: HTMLElement, settings: TodoListSettings) {
        this.containerEl = containerEl;
        this.settings = settings;
        this.resetTimeForMode(this.currentMode);
    }

    public render(): void {
        this.containerEl.empty();
        this.rootEl = this.containerEl.createDiv({ cls: 'pakcli-pomo-widget' });

        // Header: Mode Switcher
        const modeTabs = this.rootEl.createDiv({ cls: 'pomo-mode-tabs' });
        const workTab = modeTabs.createEl('button', { 
            text: `Work (${this.settings.workDurationMinutes}m)`,
            cls: `pomo-tab-btn ${this.currentMode === 'work' ? 'is-active' : ''}`
        });
        const shortBreakTab = modeTabs.createEl('button', { 
            text: `Short (${this.settings.shortBreakMinutes}m)`,
            cls: `pomo-tab-btn ${this.currentMode === 'short_break' ? 'is-active' : ''}`
        });
        const longBreakTab = modeTabs.createEl('button', { 
            text: `Long (${this.settings.longBreakMinutes}m)`,
            cls: `pomo-tab-btn ${this.currentMode === 'long_break' ? 'is-active' : ''}`
        });

        workTab.onclick = () => this.switchMode('work');
        shortBreakTab.onclick = () => this.switchMode('short_break');
        longBreakTab.onclick = () => this.switchMode('long_break');

        // Active Focus Task Banner
        const bannerEl = this.rootEl.createDiv({ cls: 'pomo-task-banner' });
        const iconSpan = bannerEl.createSpan({ cls: 'pomo-task-icon' });
        setIcon(iconSpan, 'crosshair');
        this.activeTaskTextEl = bannerEl.createSpan({ cls: 'pomo-task-label' });
        this.updateActiveTaskDisplay();

        const clearTaskBtn = bannerEl.createEl('button', { cls: 'pomo-clear-task-btn', title: 'Clear focus task' });
        setIcon(clearTaskBtn, 'x');
        clearTaskBtn.onclick = () => this.setActiveTask(null);

        // Circular Timer Display
        const clockContainer = this.rootEl.createDiv({ cls: 'pomo-clock-container' });
        
        // SVG Ring
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 120 120');
        svg.setAttribute('class', 'pomo-progress-svg');

        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '60');
        bgCircle.setAttribute('cy', '60');
        bgCircle.setAttribute('r', '52');
        bgCircle.setAttribute('class', 'pomo-ring-bg');
        svg.appendChild(bgCircle);

        this.progressRingEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.progressRingEl.setAttribute('cx', '60');
        this.progressRingEl.setAttribute('cy', '60');
        this.progressRingEl.setAttribute('r', '52');
        this.progressRingEl.setAttribute('class', 'pomo-ring-progress');
        // Perimeter = 2 * PI * 52 ≈ 326.7
        this.progressRingEl.style.strokeDasharray = '326.7';
        this.progressRingEl.style.strokeDashoffset = '0';
        svg.appendChild(this.progressRingEl);

        clockContainer.appendChild(svg);

        // Center Time Text
        this.timerTextEl = clockContainer.createDiv({ cls: 'pomo-timer-display', text: this.formatTime() });

        // Controls (Start/Pause, Reset, Skip)
        const controls = this.rootEl.createDiv({ cls: 'pomo-controls' });

        this.startBtnEl = controls.createEl('button', { 
            cls: 'pomo-btn pomo-start-btn',
            text: this.timerState === 'running' ? 'Pause' : 'Start Focus'
        });
        this.startBtnEl.onclick = () => this.toggleStart();

        const resetBtn = controls.createEl('button', { cls: 'pomo-btn pomo-sub-btn', title: 'Reset Timer' });
        setIcon(resetBtn, 'rotate-ccw');
        resetBtn.onclick = () => this.resetTimer();

        const skipBtn = controls.createEl('button', { cls: 'pomo-btn pomo-sub-btn', title: 'Skip Session' });
        setIcon(skipBtn, 'fast-forward');
        skipBtn.onclick = () => this.skipSession();

        // Footer: Completed sessions today
        const footer = this.rootEl.createDiv({ cls: 'pomo-footer' });
        this.sessionDotsEl = footer.createSpan({ cls: 'pomo-session-dots' });
        this.updateSessionDots();
    }

    public setActiveTask(task: ParsedTaskItem | null): void {
        this.activeTask = task;
        this.updateActiveTaskDisplay();
    }

    public getActiveTask(): ParsedTaskItem | null {
        return this.activeTask;
    }

    private updateActiveTaskDisplay(): void {
        if (!this.activeTaskTextEl) return;
        if (this.activeTask) {
            this.activeTaskTextEl.setText(`Focusing: ${this.activeTask.content || this.activeTask.fileName}`);
            this.activeTaskTextEl.parentElement?.classList.add('has-task');
        } else {
            this.activeTaskTextEl.setText('Click ▶ on a task to focus');
            this.activeTaskTextEl.parentElement?.classList.remove('has-task');
        }
    }

    private switchMode(mode: PomodoroMode): void {
        this.pause();
        this.currentMode = mode;
        this.resetTimeForMode(mode);
        this.render();
    }

    private resetTimeForMode(mode: PomodoroMode): void {
        let mins = 25;
        if (mode === 'work') mins = this.settings.workDurationMinutes || 25;
        else if (mode === 'short_break') mins = this.settings.shortBreakMinutes || 5;
        else if (mode === 'long_break') mins = this.settings.longBreakMinutes || 15;

        this.totalSeconds = mins * 60;
        this.remainingSeconds = this.totalSeconds;
    }

    private toggleStart(): void {
        if (this.timerState === 'running') {
            this.pause();
        } else {
            this.start();
        }
    }

    private start(): void {
        if (this.intervalId !== null) return;
        this.timerState = 'running';
        if (this.startBtnEl) {
            this.startBtnEl.setText('Pause');
            this.startBtnEl.classList.add('is-running');
        }

        this.intervalId = window.setInterval(() => {
            this.tick();
        }, 1000);
    }

    private pause(): void {
        if (this.intervalId !== null) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.timerState = 'paused';
        if (this.startBtnEl) {
            this.startBtnEl.setText('Resume');
            this.startBtnEl.classList.remove('is-running');
        }
    }

    private resetTimer(): void {
        this.pause();
        this.timerState = 'idle';
        this.resetTimeForMode(this.currentMode);
        this.updateClockUI();
        if (this.startBtnEl) {
            this.startBtnEl.setText('Start Focus');
            this.startBtnEl.classList.remove('is-running');
        }
    }

    private skipSession(): void {
        this.pause();
        this.advanceToNextMode();
    }

    private tick(): void {
        if (this.remainingSeconds > 0) {
            this.remainingSeconds--;
            this.updateClockUI();
        } else {
            this.handleSessionCompleted();
        }
    }

    private handleSessionCompleted(): void {
        this.pause();
        this.playChime();

        if (this.currentMode === 'work') {
            this.completedSessionsToday++;
            const msg = this.activeTask 
                ? `🍅 Pomodoro completed for: ${this.activeTask.content}`
                : `🍅 Pomodoro completed! Time for a break.`;
            new Notice(msg, 6000);

            if (this.onSessionCompleted) {
                this.onSessionCompleted(this.activeTask);
            }
        } else {
            new Notice('Break ended! Ready to focus?', 5000);
        }

        this.updateSessionDots();
        this.advanceToNextMode();
    }

    private advanceToNextMode(): void {
        if (this.currentMode === 'work') {
            // After 4 work sessions, recommend long break
            if (this.completedSessionsToday > 0 && this.completedSessionsToday % 4 === 0) {
                this.currentMode = 'long_break';
            } else {
                this.currentMode = 'short_break';
            }
        } else {
            this.currentMode = 'work';
        }

        this.resetTimeForMode(this.currentMode);
        this.render();

        if (this.settings.autoStartNextSession) {
            this.start();
        }
    }

    private updateClockUI(): void {
        if (this.timerTextEl) {
            this.timerTextEl.setText(this.formatTime());
        }

        if (this.progressRingEl && this.totalSeconds > 0) {
            const fraction = 1 - (this.remainingSeconds / this.totalSeconds);
            const circumference = 326.7;
            const offset = circumference * (1 - fraction);
            this.progressRingEl.style.strokeDashoffset = offset.toFixed(1);
        }
    }

    private updateSessionDots(): void {
        if (!this.sessionDotsEl) return;
        const totalVisual = Math.max(4, this.completedSessionsToday + 1);
        let html = `Today's Focus: `;
        for (let i = 0; i < totalVisual; i++) {
            if (i < this.completedSessionsToday) {
                html += '🍅';
            } else {
                html += '⚪';
            }
        }
        html += ` (${this.completedSessionsToday})`;
        this.sessionDotsEl.setText(html);
    }

    private formatTime(): string {
        const m = Math.floor(this.remainingSeconds / 60);
        const s = this.remainingSeconds % 60;
        const mm = m < 10 ? `0${m}` : `${m}`;
        const ss = s < 10 ? `0${s}` : `${s}`;
        return `${mm}:${ss}`;
    }

    /**
     * Synthesizes a warm, gentle bell chime using Web Audio API (Zero external assets needed).
     */
    private playChime(): void {
        if (!this.settings.playChimeSound) return;

        try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            // Harmonic chime chord (528 Hz - Solfeggio / warm bell)
            osc.type = 'sine';
            osc.frequency.setValueAtTime(528, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 1.8);
        } catch {
            // Audio context fallback ignored safely
        }
    }

    public destroy(): void {
        if (this.intervalId !== null) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}
