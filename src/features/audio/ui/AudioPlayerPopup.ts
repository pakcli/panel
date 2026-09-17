import type PakCLITablePlugin from '../../../main';
import { AudioEngine } from '../audioEngine';
import { PlaylistManager } from '../playlistManager';
import { renderAudioPlayerContent } from './renderAudioPlayerContent';

export class AudioPlayerPopup {
    private plugin: PakCLITablePlugin;
    private audioEngine: AudioEngine;
    private playlistManager: PlaylistManager;

    private containerEl: HTMLElement | null = null;
    private cleanupRenderer: (() => void) | null = null;
    private isOpen: boolean = false;

    constructor(plugin: PakCLITablePlugin, audioEngine: AudioEngine, playlistManager: PlaylistManager) {
        this.plugin = plugin;
        this.audioEngine = audioEngine;
        this.playlistManager = playlistManager;
    }

    public isVisible(): boolean {
        return this.isOpen;
    }

    public toggle(): void {
        if (this.isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    public show(): void {
        if (this.isOpen && this.containerEl) {
            return;
        }

        this.isOpen = true;
        this.createDOM();
    }

    public hide(): void {
        this.isOpen = false;
        if (this.cleanupRenderer) {
            this.cleanupRenderer();
            this.cleanupRenderer = null;
        }
        if (this.containerEl) {
            this.containerEl.remove();
            this.containerEl = null;
        }
    }

    private createDOM(): void {
        // Create 50% screen fixed container on right edge of workspace
        const el = document.createElement('div');
        el.className = 'pakcli-audio-popup-container';
        el.setAttribute('data-pakcli-audio-popup', 'true');

        this.cleanupRenderer = renderAudioPlayerContent({
            containerEl: el,
            audioEngine: this.audioEngine,
            playlistManager: this.playlistManager,
            onDock: () => {
                this.audioEngine.playClickSnap();
                this.hide();
                this.plugin.openAudioPlayerTab();
            },
            onMinimize: () => {
                this.audioEngine.playClickSnap();
                this.hide();
                if (this.plugin.audioStatusBar) {
                    this.plugin.audioStatusBar.show();
                }
            },
            onClose: () => {
                this.audioEngine.playClickSnap();
                this.hide();
            }
        });

        document.body.appendChild(el);
        this.containerEl = el;
    }
}
