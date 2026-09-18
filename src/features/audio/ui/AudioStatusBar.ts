import { setIcon } from 'obsidian';
import type PakCLITablePlugin from '../../../main';
import { AudioEngine } from '../audioEngine';
import { PlaylistManager } from '../playlistManager';
import { formatAudioTime } from './renderAudioPlayerContent';
import { AudioPlayerState } from '../types';

export class AudioStatusBar {
    private plugin: PakCLITablePlugin;
    private audioEngine: AudioEngine;
    private playlistManager: PlaylistManager;

    private statusBarEl: HTMLElement;
    private textSpan: HTMLElement;
    private timeSpan: HTMLElement;
    private prevBtn: HTMLElement;
    private playPauseBtn: HTMLElement;
    private nextBtn: HTMLElement;

    private isVisibleState: boolean = true;
    private unsubTime: (() => void) | null = null;
    private unsubState: (() => void) | null = null;

    constructor(plugin: PakCLITablePlugin, audioEngine: AudioEngine, playlistManager: PlaylistManager) {
        this.plugin = plugin;
        this.audioEngine = audioEngine;
        this.playlistManager = playlistManager;

        this.statusBarEl = this.plugin.addStatusBarItem();
        this.statusBarEl.addClass('pakcli-audio-status-bar');

        const pill = this.statusBarEl.createDiv({ cls: 'pakcli-audio-status-pill' });

        const iconSpan = pill.createSpan({ cls: 'pakcli-status-icon', text: '🎵' });

        this.textSpan = pill.createSpan({ cls: 'pakcli-status-text', text: 'Ambient Audio' });
        this.textSpan.title = 'Click to open PakCLI Audio Player';
        this.textSpan.onclick = (e) => {
            e.stopPropagation();
            this.audioEngine.playClickSnap();
            this.plugin.audioPlayerPopup?.toggle();
        };

        this.timeSpan = pill.createSpan({ cls: 'pakcli-status-time', text: '[00:00]' });

        this.prevBtn = pill.createEl('button', { cls: 'pakcli-status-btn', title: 'Previous Track' });
        setIcon(this.prevBtn, 'skip-back');
        this.prevBtn.onclick = (e) => {
            e.stopPropagation();
            this.audioEngine.playClickSnap();
            this.playlistManager.previous();
        };

        this.playPauseBtn = pill.createEl('button', { cls: 'pakcli-status-btn', title: 'Play/Pause' });
        setIcon(this.playPauseBtn, 'play');
        this.playPauseBtn.onclick = (e) => {
            e.stopPropagation();
            this.audioEngine.playClickSnap();
            this.playlistManager.togglePlay();
        };

        this.nextBtn = pill.createEl('button', { cls: 'pakcli-status-btn', title: 'Next Track' });
        setIcon(this.nextBtn, 'skip-forward');
        this.nextBtn.onclick = (e) => {
            e.stopPropagation();
            this.audioEngine.playClickSnap();
            this.playlistManager.next();
        };

        this.setupSubscriptions();
    }

    private setupSubscriptions(): void {
        this.unsubTime = this.audioEngine.onTimeUpdate((cur) => {
            this.timeSpan.setText(`[${formatAudioTime(cur)}]`);
        });

        this.unsubState = this.playlistManager.onStateChange((state: AudioPlayerState) => {
            if (state.currentTrack) {
                this.textSpan.setText(state.currentTrack.name);
                this.textSpan.title = `Now Playing: ${state.currentTrack.name} (${state.currentTrack.path})\nClick to open Player`;
                if (state.currentTime > 0) {
                    this.timeSpan.setText(`[${formatAudioTime(state.currentTime)}]`);
                }
            } else {
                this.textSpan.setText('Ambient Audio');
                this.textSpan.title = 'Click to open PakCLI Audio Player';
            }

            setIcon(this.playPauseBtn, state.isPlaying ? 'pause' : 'play');
            this.playPauseBtn.title = state.isPlaying ? 'Pause' : 'Play';
        });
    }

    public show(): void {
        this.isVisibleState = true;
        this.statusBarEl.style.display = 'inline-flex';
    }

    public hide(): void {
        this.isVisibleState = false;
        this.statusBarEl.style.display = 'none';
    }

    public destroy(): void {
        if (this.unsubTime) this.unsubTime();
        if (this.unsubState) this.unsubState();
        this.statusBarEl.remove();
    }
}
