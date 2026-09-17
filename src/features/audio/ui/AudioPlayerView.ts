import { ItemView, WorkspaceLeaf } from 'obsidian';
import type PakCLITablePlugin from '../../../main';
import { AudioEngine } from '../audioEngine';
import { PlaylistManager } from '../playlistManager';
import { renderAudioPlayerContent } from './renderAudioPlayerContent';

export const PAKCLI_AUDIO_VIEW_TYPE = 'pakcli-audio-player-view';

export class AudioPlayerView extends ItemView {
    private plugin: PakCLITablePlugin;
    private audioEngine: AudioEngine;
    private playlistManager: PlaylistManager;
    private cleanupRenderer: (() => void) | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: PakCLITablePlugin, audioEngine: AudioEngine, playlistManager: PlaylistManager) {
        super(leaf);
        this.plugin = plugin;
        this.audioEngine = audioEngine;
        this.playlistManager = playlistManager;
    }

    getViewType(): string {
        return PAKCLI_AUDIO_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'PakCLI Audio & Ambient';
    }

    getIcon(): string {
        return 'headphones';
    }

    async onOpen(): Promise<void> {
        const container = this.contentEl;
        container.empty();
        container.addClass('pakcli-audio-view-container');

        this.cleanupRenderer = renderAudioPlayerContent({
            containerEl: container,
            audioEngine: this.audioEngine,
            playlistManager: this.playlistManager,
            isDocked: true,
            onDock: () => {
                // Undock to 50% screen popup
                this.audioEngine.playClickSnap();
                this.leaf.detach();
                this.plugin.audioPlayerPopup?.show();
            },
            onMinimize: () => {
                this.audioEngine.playClickSnap();
                this.leaf.detach();
                if (this.plugin.audioStatusBar) {
                    this.plugin.audioStatusBar.show();
                }
            },
            onClose: () => {
                this.audioEngine.playClickSnap();
                this.leaf.detach();
            }
        });
    }

    async onClose(): Promise<void> {
        if (this.cleanupRenderer) {
            this.cleanupRenderer();
            this.cleanupRenderer = null;
        }
        this.contentEl.empty();
    }
}
