import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { AudioTrack, PlaybackMode, AudioPlayerState, SUPPORTED_AUDIO_EXTENSIONS, DetectedAudioFolder } from './types';
import { AudioEngine } from './audioEngine';
import { ensureFolderExists } from '../sqlseal/utils/views';

/**
 * PlaylistManager:
 * Implements the Smart Queue Matrix and Playlist Lifecycle for Vault MP3 & Audio files.
 */
export class PlaylistManager {
    private app: App;
    private audioEngine: AudioEngine;

    private targetFolder: string = '';
    private targetFolders: string[] = [];
    private playbackMode: PlaybackMode = 'loop_all';

    private basePlaylist: AudioTrack[] = [];
    private priorityQueue: AudioTrack[] = [];
    private historyStack: AudioTrack[] = [];

    private currentTrack: AudioTrack | null = null;
    private currentIndex: number = -1;

    private musicLabel: string = 'Background Audio';

    private stateListeners: Set<(state: AudioPlayerState) => void> = new Set();
    private artifactFolderPath: string = 'artifacts/pakcli-panel';
    private saveTimeout: ReturnType<typeof setTimeout> | null = null;
    private lastPeriodicSaveTime: number = 0;

    constructor(
        app: App, 
        audioEngine: AudioEngine, 
        initialTargetFolder: string = '', 
        initialMode: PlaybackMode = 'loop_all',
        initialMusicLabel: string = 'Background Audio',
        initialTargetFolders: string[] = [],
        initialArtifactFolderPath: string = 'artifacts/pakcli-panel'
    ) {
        this.app = app;
        this.audioEngine = audioEngine;
        this.targetFolder = initialTargetFolder;
        this.targetFolders = [...initialTargetFolders];
        this.playbackMode = initialMode;
        this.musicLabel = initialMusicLabel || 'Background Audio';
        this.artifactFolderPath = initialArtifactFolderPath || 'artifacts/pakcli-panel';

        // Wire AudioEngine track ended event to smart queue transition
        this.audioEngine.onTrackEnded(() => {
            this.handleTrackEnded();
        });

        // Wire play state changes to notify UI and save state
        this.audioEngine.onPlayStateChange(() => {
            this.notifyState();
            this.scheduleSaveArtifact();
        });

        // Periodic save every 5 seconds while playing so playback position is never lost
        this.audioEngine.onTimeUpdate(() => {
            const now = Date.now();
            if (now - this.lastPeriodicSaveTime > 5000) {
                this.lastPeriodicSaveTime = now;
                this.saveAudioStateArtifact().catch(() => {});
            }
        });

        this.scanVaultAudioTracks();
    }

    public scanVaultAudioTracks(): void {
        const allFiles = this.app.vault.getFiles();
        const normTarget = this.targetFolder ? normalizePath(this.targetFolder).toLowerCase() : '';

        const tracks: AudioTrack[] = [];

        for (const file of allFiles) {
            const ext = (file.extension || '').toLowerCase();
            if (!SUPPORTED_AUDIO_EXTENSIONS.has(ext)) continue;

            const filePath = normalizePath(file.path);
            const parentFolder = file.parent ? normalizePath(file.parent.path) : '';
            const parentNorm = (parentFolder && parentFolder !== '.' && parentFolder !== '/') ? parentFolder.toLowerCase() : '/';

            // Filter by target folder if specified and not empty
            if (normTarget && normTarget !== '/' && normTarget !== '.') {
                if (normTarget === '__all_targets__') {
                    if (this.targetFolders.length > 0) {
                        const matchesAny = this.targetFolders.some(tf => {
                            const tfNorm = (tf && tf !== '/' && tf !== '.') ? normalizePath(tf).toLowerCase() : '/';
                            return parentNorm === tfNorm || parentNorm.startsWith(tfNorm + '/');
                        });
                        if (!matchesAny) continue;
                    }
                } else {
                    if (parentNorm !== normTarget && !parentNorm.startsWith(normTarget + '/')) {
                        continue;
                    }
                }
            }

            tracks.push({
                id: filePath,
                name: file.basename,
                path: filePath,
                folder: parentFolder || 'Vault Root',
                extension: ext,
                file: file,
                duration: 0
            });
        }

        // Natural sort by folder then title
        tracks.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));

        this.basePlaylist = tracks;

        // Re-sync current index if track is playing
        if (this.currentTrack) {
            const idx = this.basePlaylist.findIndex(t => t.path === this.currentTrack!.path);
            this.currentIndex = idx;
        }

        this.notifyState();
    }

    public getDetectedAudioFolders(): DetectedAudioFolder[] {
        const folderMap = new Map<string, { trackCount: number; formats: Set<string> }>();
        const files = this.app.vault.getFiles();
        for (const file of files) {
            const ext = (file.extension || '').toLowerCase();
            if (!SUPPORTED_AUDIO_EXTENSIONS.has(ext)) continue;

            const parentFolder = file.parent ? normalizePath(file.parent.path) : '';
            const folderPath = (parentFolder && parentFolder !== '.' && parentFolder !== '/') ? parentFolder : '/';

            if (!folderMap.has(folderPath)) {
                folderMap.set(folderPath, { trackCount: 0, formats: new Set<string>() });
            }
            const entry = folderMap.get(folderPath)!;
            entry.trackCount++;
            entry.formats.add(ext);
        }

        return Array.from(folderMap.entries())
            .map(([folderPath, data]) => ({
                path: folderPath,
                name: folderPath === '/' ? 'Vault Root (/)' : folderPath,
                trackCount: data.trackCount,
                formats: Array.from(data.formats).sort()
            }))
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    public getAvailableFolders(): string[] {
        const detected = this.getDetectedAudioFolders();
        return detected.map(d => d.path);
    }

    public getTargetFolders(): string[] {
        return [...this.targetFolders];
    }

    public setTargetFolders(folders: string[]): void {
        this.targetFolders = [...folders];
        if (this.targetFolder === '__all_targets__') {
            this.scanVaultAudioTracks();
        }
        this.notifyState();
        this.scheduleSaveArtifact();
    }

    public setMusicLabel(label: string): void {
        this.musicLabel = label || 'Background Audio';
        this.notifyState();
        this.scheduleSaveArtifact();
    }

    public getMusicLabel(): string {
        return this.musicLabel;
    }

    public getState(): AudioPlayerState {
        return {
            currentTrack: this.currentTrack,
            isPlaying: this.audioEngine.isPlaying(),
            currentTime: this.audioEngine.getCurrentTime(),
            duration: this.audioEngine.getDuration(),
            playbackMode: this.playbackMode,
            masterVolume: this.audioEngine.getMasterVolume(),
            isMuted: this.audioEngine.isAudioMuted(),
            musicVolume: this.audioEngine.getMusicVolume(),
            isMusicMuted: this.audioEngine.isAudioMusicMuted(),
            musicLabel: this.musicLabel,
            sfxVolume: this.audioEngine.getSfxVolume(),
            isSfxMuted: this.audioEngine.isAudioSfxMuted(),
            basePlaylist: [...this.basePlaylist],
            priorityQueue: [...this.priorityQueue],
            historyStack: [...this.historyStack],
            targetFolder: this.targetFolder,
            targetFolders: [...this.targetFolders]
        };
    }

    public notifyState(): void {
        const state = this.getState();
        for (const listener of this.stateListeners) {
            listener(state);
        }
    }

    public onStateChange(cb: (state: AudioPlayerState) => void): () => void {
        this.stateListeners.add(cb);
        cb(this.getState());
        return () => this.stateListeners.delete(cb);
    }

    // --- Playback Controls ---

    public async playTrack(track: AudioTrack, isPriority: boolean = false): Promise<void> {
        if (this.currentTrack && this.currentTrack.path !== track.path) {
            this.historyStack.push(this.currentTrack);
            if (this.historyStack.length > 50) this.historyStack.shift();
        }

        this.currentTrack = track;
        if (!isPriority) {
            this.currentIndex = this.basePlaylist.findIndex(t => t.path === track.path);
        }

        const resourcePath = this.app.vault.getResourcePath(track.file);
        await this.audioEngine.loadTrack(resourcePath, true);
        this.notifyState();
        this.scheduleSaveArtifact(true);
    }

    public async playNow(track: AudioTrack): Promise<void> {
        await this.playTrack(track, false);
    }

    /**
     * Inserts track immediately at front of Priority Queue:
     * Active Track ➔ [Track*] ➔ Next in queue/playlist
     */
    public playNext(track: AudioTrack): void {
        const priorityItem = { ...track, isPriority: true };
        this.priorityQueue.unshift(priorityItem);
        this.notifyState();
        this.scheduleSaveArtifact();
    }

    /**
     * Adds track to end of Priority Queue
     */
    public addToQueue(track: AudioTrack): void {
        const priorityItem = { ...track, isPriority: true };
        this.priorityQueue.push(priorityItem);
        this.notifyState();
        this.scheduleSaveArtifact();
    }

    public async playFolderAsPlaylist(folder: TFolder): Promise<void> {
        this.targetFolder = folder.path;
        this.priorityQueue = [];
        this.scanVaultAudioTracks();
        if (this.basePlaylist.length > 0) {
            await this.playTrack(this.basePlaylist[0], false);
        }
        this.scheduleSaveArtifact(true);
    }

    public addFolderToQueue(folder: TFolder): void {
        const allFiles = this.app.vault.getFiles();
        const normTarget = normalizePath(folder.path).toLowerCase();

        for (const f of allFiles) {
            const ext = (f.extension || '').toLowerCase();
            if (!SUPPORTED_AUDIO_EXTENSIONS.has(ext)) continue;
            const parent = f.parent ? normalizePath(f.parent.path).toLowerCase() : '';
            if (parent === normTarget || parent.startsWith(normTarget + '/')) {
                const track: AudioTrack = {
                    id: f.path,
                    name: f.basename,
                    path: f.path,
                    folder: f.parent?.path || '',
                    extension: ext,
                    file: f,
                    duration: 0,
                    isPriority: true
                };
                this.priorityQueue.push(track);
            }
        }
        this.notifyState();
        this.scheduleSaveArtifact();
    }

    public removeQueueItem(index: number): void {
        if (index >= 0 && index < this.priorityQueue.length) {
            this.priorityQueue.splice(index, 1);
            this.notifyState();
            this.scheduleSaveArtifact();
        }
    }

    public clearQueue(): void {
        this.priorityQueue = [];
        this.notifyState();
        this.scheduleSaveArtifact();
    }

    public getUpcomingTracks(limit: number = 10): AudioTrack[] {
        const upcoming: AudioTrack[] = [];
        for (const item of this.priorityQueue) {
            upcoming.push(item);
            if (upcoming.length >= limit) return upcoming;
        }

        if (this.basePlaylist.length > 0) {
            const start = this.currentIndex >= 0 ? (this.currentIndex + 1) % this.basePlaylist.length : 0;
            for (let i = 0; i < this.basePlaylist.length && upcoming.length < limit; i++) {
                const idx = (start + i) % this.basePlaylist.length;
                const track = this.basePlaylist[idx];
                if (!upcoming.some((t) => t.path === track.path)) {
                    upcoming.push(track);
                }
            }
        }
        return upcoming;
    }

    public async togglePlay(): Promise<void> {
        if (this.audioEngine.isPlaying()) {
            this.audioEngine.pause();
        } else {
            if (!this.currentTrack) {
                if (this.priorityQueue.length > 0) {
                    const next = this.priorityQueue.shift()!;
                    await this.playTrack(next, true);
                    return;
                } else if (this.basePlaylist.length > 0) {
                    await this.playTrack(this.basePlaylist[0], false);
                    return;
                }
            } else {
                await this.audioEngine.play();
            }
        }
        this.notifyState();
        this.scheduleSaveArtifact(true);
    }

    public stop(): void {
        this.audioEngine.stop();
        this.notifyState();
        this.scheduleSaveArtifact(true);
    }

    public async next(): Promise<void> {
        // 1. If Priority Queue has tracks, take next
        if (this.priorityQueue.length > 0) {
            const nextTrack = this.priorityQueue.shift()!;
            await this.playTrack(nextTrack, true);
            return;
        }

        if (this.basePlaylist.length === 0) {
            this.stop();
            return;
        }

        // 2. Playback Mode resolution
        if (this.playbackMode === 'loop_one') {
            if (this.currentTrack) {
                this.audioEngine.seek(0);
                await this.audioEngine.play();
            } else {
                await this.playTrack(this.basePlaylist[0], false);
            }
            return;
        }

        if (this.playbackMode === 'shuffle') {
            const pool = this.basePlaylist.filter(t => t.path !== this.currentTrack?.path);
            const target = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : this.basePlaylist[0];
            await this.playTrack(target, false);
            return;
        }

        // Sequential (loop_all or linear)
        const nextIdx = this.currentIndex + 1;
        if (nextIdx >= this.basePlaylist.length) {
            if (this.playbackMode === 'loop_all') {
                await this.playTrack(this.basePlaylist[0], false);
            } else {
                // Linear: stop at end of playlist
                this.stop();
            }
        } else {
            await this.playTrack(this.basePlaylist[nextIdx], false);
        }
    }

    public async previous(): Promise<void> {
        const curTime = this.audioEngine.getCurrentTime();

        // If played > 3 seconds, rewind to beginning
        if (curTime > 3.0) {
            this.audioEngine.seek(0);
            await this.audioEngine.play();
            return;
        }

        // If played <= 3 seconds, pop previous from history
        if (this.historyStack.length > 0) {
            const prev = this.historyStack.pop()!;
            await this.playTrack(prev, false);
            return;
        }

        // Otherwise go to previous track in base playlist
        if (this.basePlaylist.length === 0) return;
        const prevIdx = (this.currentIndex - 1 + this.basePlaylist.length) % this.basePlaylist.length;
        await this.playTrack(this.basePlaylist[prevIdx], false);
    }

    private async handleTrackEnded(): Promise<void> {
        if (this.playbackMode === 'loop_one') {
            this.audioEngine.seek(0);
            await this.audioEngine.play();
            return;
        }
        await this.next();
    }

    public setPlaybackMode(mode: PlaybackMode): void {
        this.playbackMode = mode;
        this.notifyState();
        this.scheduleSaveArtifact();
    }

    public cyclePlaybackMode(): PlaybackMode {
        const modes: PlaybackMode[] = ['loop_all', 'loop_one', 'shuffle', 'linear'];
        const idx = modes.indexOf(this.playbackMode);
        this.playbackMode = modes[(idx + 1) % modes.length];
        this.notifyState();
        this.scheduleSaveArtifact();
        return this.playbackMode;
    }

    public setTargetFolder(folder: string): void {
        this.targetFolder = folder;
        this.scanVaultAudioTracks();
        this.scheduleSaveArtifact();
    }

    // --- Artifact Persistence (audio_player_state.json) ---

    public getArtifactPath(): string {
        const folder = (this.artifactFolderPath || 'artifacts/pakcli-panel').trim().replace(/^\/+|\/+$/g, '') || 'artifacts/pakcli-panel';
        return `${folder}/audio_player_state.json`;
    }

    public scheduleSaveArtifact(immediate: boolean = false): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }

        if (immediate) {
            this.saveAudioStateArtifact().catch((err) => {
                console.error('[PakCLI] Error saving audio state artifact:', err);
            });
            return;
        }

        this.saveTimeout = setTimeout(() => {
            this.saveAudioStateArtifact().catch((err) => {
                console.error('[PakCLI] Error saving audio state artifact:', err);
            });
        }, 500);
    }

    public async saveAudioStateArtifact(): Promise<TFile | null> {
        try {
            const folder = (this.artifactFolderPath || 'artifacts/pakcli-panel').trim().replace(/^\/+|\/+$/g, '') || 'artifacts/pakcli-panel';
            await ensureFolderExists(this.app, folder);

            const artifactPath = `${folder}/audio_player_state.json`;
            const state = this.getState();

            const controlPayload = {
                isPlaying: state.isPlaying,
                currentTime: state.currentTime,
                duration: state.duration,
                playbackMode: state.playbackMode,
                targetFolder: state.targetFolder,
                targetFolders: state.targetFolders,
                musicLabel: state.musicLabel,
                masterVolume: state.masterVolume,
                musicVolume: state.musicVolume,
                sfxVolume: state.sfxVolume,
                isMuted: state.isMuted,
                isMusicMuted: state.isMusicMuted,
                isSfxMuted: state.isSfxMuted
            };

            const queuePayload = {
                priorityQueue: state.priorityQueue.map((t) => ({
                    path: t.path,
                    name: t.name,
                    folder: t.folder,
                    extension: t.extension,
                    isPriority: t.isPriority
                })),
                historyStack: state.historyStack.slice(-20).map((t) => ({
                    path: t.path,
                    name: t.name,
                    folder: t.folder,
                    extension: t.extension
                })),
                upcoming: this.getUpcomingTracks(10).map((t) => ({
                    path: t.path,
                    name: t.name,
                    folder: t.folder,
                    extension: t.extension,
                    isPriority: t.isPriority
                })),
                totalTracksInScope: this.basePlaylist.length
            };

            const currentTrackPayload = state.currentTrack ? {
                id: state.currentTrack.id,
                path: state.currentTrack.path,
                name: state.currentTrack.name,
                folder: state.currentTrack.folder,
                extension: state.currentTrack.extension,
                duration: state.duration
            } : null;

            const payload = {
                version: 1,
                savedAt: Date.now(),
                savedDate: new Date().toISOString(),
                currentTrack: currentTrackPayload,
                control: controlPayload,
                controls: controlPayload,
                queue: queuePayload
            };

            const content = JSON.stringify(payload, null, 2);

            const writeJson = async (targetPath: string) => {
                const existing = this.app.vault.getAbstractFileByPath(targetPath);
                if (existing instanceof TFile) {
                    await this.app.vault.modify(existing, content);
                    return existing;
                } else {
                    return await this.app.vault.create(targetPath, content);
                }
            };

            const savedFile = await writeJson(artifactPath);

            // Also mirror to artifacts/pakcli-panel if different so user can find it in either folder
            if (folder !== 'artifacts/pakcli-panel') {
                try {
                    await ensureFolderExists(this.app, 'artifacts/pakcli-panel');
                    await writeJson('artifacts/pakcli-panel/audio_player_state.json');
                } catch {
                    // Ignore secondary mirror write errors
                }
            }

            return savedFile;
        } catch (err) {
            console.error('[PakCLI] Failed to save audio state artifact:', err);
            return null;
        }
    }

    public async loadAudioStateArtifact(): Promise<boolean> {
        try {
            const folder = (this.artifactFolderPath || 'artifacts/pakcli-panel').trim().replace(/^\/+|\/+$/g, '') || 'artifacts/pakcli-panel';
            let artifactPath = `${folder}/audio_player_state.json`;
            let file = this.app.vault.getAbstractFileByPath(artifactPath);

            // Fallback to artifacts/pakcli-panel/audio_player_state.json if primary doesn't exist
            if (!(file instanceof TFile)) {
                const fallbackPath = 'artifacts/pakcli-panel/audio_player_state.json';
                const fallbackFile = this.app.vault.getAbstractFileByPath(fallbackPath);
                if (fallbackFile instanceof TFile) {
                    file = fallbackFile;
                    artifactPath = fallbackPath;
                } else {
                    return false;
                }
            }

            const raw = await this.app.vault.read(file);
            if (!raw || !raw.trim()) return false;

            const data = JSON.parse(raw);
            if (!data) return false;

            const control = data.control || data.controls || data;
            const queue = data.queue || data;
            const currentTrack = data.currentTrack;

            // 1. Restore folder scope & playback mode
            if (typeof control.targetFolder === 'string') {
                this.targetFolder = control.targetFolder;
            }
            if (Array.isArray(control.targetFolders)) {
                this.targetFolders = control.targetFolders;
            }
            if (control.playbackMode) {
                this.playbackMode = control.playbackMode;
            }
            if (control.musicLabel) {
                this.musicLabel = control.musicLabel;
            }

            // Refresh base playlist for current target folder
            this.scanVaultAudioTracks();

            // 2. Restore Priority Queue
            const rawPriorityQueue = queue.priorityQueue ?? data.priorityQueue;
            if (Array.isArray(rawPriorityQueue)) {
                const restoredQueue: AudioTrack[] = [];
                for (const item of rawPriorityQueue) {
                    if (!item?.path) continue;
                    const af = this.app.vault.getAbstractFileByPath(item.path);
                    if (af instanceof TFile) {
                        restoredQueue.push({
                            id: af.path,
                            name: af.basename,
                            path: af.path,
                            folder: af.parent && af.parent.path !== '/' ? af.parent.path : 'Vault Root',
                            extension: (af.extension || '').toLowerCase(),
                            file: af,
                            duration: 0,
                            isPriority: true
                        });
                    }
                }
                this.priorityQueue = restoredQueue;
            }

            // 3. Restore History Stack
            const rawHistoryStack = queue.historyStack ?? data.historyStack;
            if (Array.isArray(rawHistoryStack)) {
                const restoredHistory: AudioTrack[] = [];
                for (const item of rawHistoryStack) {
                    if (!item?.path) continue;
                    const af = this.app.vault.getAbstractFileByPath(item.path);
                    if (af instanceof TFile) {
                        restoredHistory.push({
                            id: af.path,
                            name: af.basename,
                            path: af.path,
                            folder: af.parent && af.parent.path !== '/' ? af.parent.path : 'Vault Root',
                            extension: (af.extension || '').toLowerCase(),
                            file: af,
                            duration: 0
                        });
                    }
                }
                this.historyStack = restoredHistory;
            }

            // 4. Restore Volumes and Mutes
            if (typeof control.masterVolume === 'number') this.audioEngine.setMasterVolume(control.masterVolume);
            if (typeof control.musicVolume === 'number') this.audioEngine.setMusicVolume(control.musicVolume);
            if (typeof control.sfxVolume === 'number') this.audioEngine.setSfxVolume(control.sfxVolume);
            if (typeof control.isMuted === 'boolean') this.audioEngine.setMuted(control.isMuted);
            if (typeof control.isMusicMuted === 'boolean') this.audioEngine.setMusicMuted(control.isMusicMuted);
            if (typeof control.isSfxMuted === 'boolean') this.audioEngine.setSfxMuted(control.isSfxMuted);

            // 5. Restore Currently Playing / Loaded Track
            if (currentTrack?.path) {
                const trackFile = this.app.vault.getAbstractFileByPath(currentTrack.path);
                if (trackFile instanceof TFile) {
                    this.currentTrack = {
                        id: trackFile.path,
                        name: trackFile.basename,
                        path: trackFile.path,
                        folder: trackFile.parent && trackFile.parent.path !== '/' ? trackFile.parent.path : 'Vault Root',
                        extension: (trackFile.extension || '').toLowerCase(),
                        file: trackFile,
                        duration: currentTrack.duration || control.duration || 0
                    };
                    this.currentIndex = this.basePlaylist.findIndex((t) => t.path === trackFile.path);

                    const resourcePath = this.app.vault.getResourcePath(trackFile);
                    const savedTime = typeof control.currentTime === 'number' ? control.currentTime : (typeof data.currentTime === 'number' ? data.currentTime : 0);
                    await this.audioEngine.preloadTrack(resourcePath, savedTime);
                }
            }

            this.notifyState();
            return true;
        } catch (err) {
            console.warn('[PakCLI] Could not load audio state from artifact:', err);
            return false;
        }
    }

    public async init(): Promise<void> {
        this.scanVaultAudioTracks();
        await this.loadAudioStateArtifact();
    }
}
