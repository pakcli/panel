import { AudioPluginSettings } from './types';

/**
 * AudioEngine:
 * Central Web Audio API Pipeline & HTML5 Audio Element Controller for PakCLI Panel.
 * Handles zero-latency procedural tactile micro-SFX and native Vault track playback.
 */
export class AudioEngine {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private musicGain: GainNode | null = null;
    private sfxGain: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private mediaSource: MediaElementAudioSourceNode | null = null;

    private audioEl: HTMLAudioElement;

    private masterVolume: number = 0.70;
    private isMuted: boolean = false;
    private musicVolume: number = 0.85;
    private isMusicMuted: boolean = false;
    private sfxVolume: number = 0.60;
    private isSfxMuted: boolean = false;

    // SFX Throttles to avoid acoustic clutter
    private lastSnapTime: number = 0;
    private lastChimeTime: number = 0;
    private lastPaperSlideTime: number = 0;
    private lastPaperScrunchTime: number = 0;

    // Callbacks
    private timeUpdateListeners: Set<(currentTime: number, duration: number) => void> = new Set();
    private trackEndedListeners: Set<() => void> = new Set();
    private playStateListeners: Set<(isPlaying: boolean) => void> = new Set();
    private errorListeners: Set<(err: any) => void> = new Set();

    constructor(settings?: Partial<AudioPluginSettings>) {
        if (settings) {
            if (settings.audioMasterVolume !== undefined) this.masterVolume = settings.audioMasterVolume;
            if (settings.audioIsMuted !== undefined) this.isMuted = settings.audioIsMuted;
            if (settings.audioMusicVolume !== undefined) this.musicVolume = settings.audioMusicVolume;
            if (settings.audioMusicMuted !== undefined) this.isMusicMuted = settings.audioMusicMuted;
            if (settings.audioSfxVolume !== undefined) this.sfxVolume = settings.audioSfxVolume;
            if (settings.audioSfxMuted !== undefined) this.isSfxMuted = settings.audioSfxMuted;
        }

        this.audioEl = new Audio();
        this.audioEl.preload = 'metadata';
        this.setupAudioElementEvents();
    }

    private initContext(): boolean {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return false;
            try {
                this.ctx = new AudioCtx();

                // 1. Dynamics Compressor as soft limiter / anti-clipping
                this.compressor = this.ctx.createDynamicsCompressor();
                this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
                this.compressor.knee.setValueAtTime(6, this.ctx.currentTime);
                this.compressor.ratio.setValueAtTime(8, this.ctx.currentTime);
                this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
                this.compressor.release.setValueAtTime(0.09, this.ctx.currentTime);

                // 2. Master Gain Node
                this.masterGain = this.ctx.createGain();
                const effMasterGain = this.isMuted ? 0 : this.masterVolume;
                this.masterGain.gain.setValueAtTime(effMasterGain, this.ctx.currentTime);

                // 3. Music Gain Node
                this.musicGain = this.ctx.createGain();
                const effMusicGain = this.isMusicMuted ? 0 : this.musicVolume;
                this.musicGain.gain.setValueAtTime(effMusicGain, this.ctx.currentTime);

                // 4. SFX Gain Node
                this.sfxGain = this.ctx.createGain();
                const effSfxGain = this.isSfxMuted ? 0 : this.sfxVolume;
                this.sfxGain.gain.setValueAtTime(effSfxGain, this.ctx.currentTime);

                // Wire up SFX and Music to Master
                this.sfxGain.connect(this.masterGain);
                this.musicGain.connect(this.masterGain);

                // Wire Master to Compressor then to Destination
                this.masterGain.connect(this.compressor);
                this.compressor.connect(this.ctx.destination);

                // Connect HTML5 Audio Element to Music Gain Node
                try {
                    this.mediaSource = this.ctx.createMediaElementSource(this.audioEl);
                    this.mediaSource.connect(this.musicGain);
                } catch {
                    // Fallback to direct element volume control if already connected or restricted
                    this.syncElementVolumeFallback();
                }
            } catch {
                return false;
            }
        }

        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }

        return true;
    }

    private syncElementVolumeFallback(): void {
        const effVol = (this.isMuted || this.isMusicMuted) ? 0 : Math.max(0, Math.min(1, this.masterVolume * this.musicVolume));
        this.audioEl.volume = effVol;
    }

    private setupAudioElementEvents(): void {
        this.audioEl.addEventListener('timeupdate', () => {
            const cur = this.audioEl.currentTime || 0;
            const dur = this.audioEl.duration || 0;
            for (const listener of this.timeUpdateListeners) {
                listener(cur, dur);
            }
        });

        this.audioEl.addEventListener('ended', () => {
            for (const listener of this.trackEndedListeners) {
                listener();
            }
        });

        this.audioEl.addEventListener('play', () => {
            for (const listener of this.playStateListeners) {
                listener(true);
            }
        });

        this.audioEl.addEventListener('pause', () => {
            for (const listener of this.playStateListeners) {
                listener(false);
            }
        });

        this.audioEl.addEventListener('error', (e) => {
            for (const listener of this.errorListeners) {
                listener(e);
            }
        });
    }

    // --- Public Music Transport Methods ---

    public async loadTrack(srcUrl: string, autoPlay: boolean = true): Promise<void> {
        this.initContext();
        this.audioEl.src = srcUrl;
        this.audioEl.load();

        if (autoPlay) {
            await this.play();
        }
    }

    public async preloadTrack(srcUrl: string, initialTime: number = 0): Promise<void> {
        this.initContext();
        this.audioEl.src = srcUrl;
        this.audioEl.load();

        if (initialTime > 0) {
            const onLoaded = () => {
                this.seek(initialTime);
                for (const listener of this.timeUpdateListeners) {
                    listener(initialTime, this.audioEl.duration || 0);
                }
            };
            this.audioEl.addEventListener('loadedmetadata', onLoaded, { once: true });
        }
    }

    public async play(): Promise<void> {
        this.initContext();
        try {
            await this.audioEl.play();
        } catch (err) {
            // Browser autoplay restrictions may wait for user interaction
        }
    }

    public pause(): void {
        this.audioEl.pause();
    }

    public stop(): void {
        this.audioEl.pause();
        this.audioEl.currentTime = 0;
        for (const listener of this.timeUpdateListeners) {
            listener(0, this.audioEl.duration || 0);
        }
    }

    public seek(seconds: number): void {
        if (!isNaN(seconds) && isFinite(seconds)) {
            this.audioEl.currentTime = Math.max(0, Math.min(seconds, this.audioEl.duration || seconds));
        }
    }

    public isPlaying(): boolean {
        return !this.audioEl.paused && !this.audioEl.ended && this.audioEl.readyState > 2;
    }

    public getCurrentTime(): number {
        return this.audioEl.currentTime || 0;
    }

    public getDuration(): number {
        return this.audioEl.duration || 0;
    }

    // --- Volume & Mute Controls ---

    public setMasterVolume(vol: number): void {
        this.masterVolume = Math.max(0, Math.min(1, vol));
        if (this.masterGain && this.ctx) {
            const target = this.isMuted ? 0 : this.masterVolume;
            this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
        }
        this.syncElementVolumeFallback();
    }

    public getMasterVolume(): number {
        return this.masterVolume;
    }

    public setMuted(muted: boolean): void {
        this.isMuted = muted;
        if (this.masterGain && this.ctx) {
            const target = this.isMuted ? 0 : this.masterVolume;
            this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
        }
        this.syncElementVolumeFallback();
    }

    public isAudioMuted(): boolean {
        return this.isMuted;
    }

    public toggleMute(): boolean {
        this.setMuted(!this.isMuted);
        return this.isMuted;
    }

    public setMusicVolume(vol: number): void {
        this.musicVolume = Math.max(0, Math.min(1, vol));
        if (this.musicGain && this.ctx) {
            const target = this.isMusicMuted ? 0 : this.musicVolume;
            this.musicGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
        }
        this.syncElementVolumeFallback();
    }

    public getMusicVolume(): number {
        return this.musicVolume;
    }

    public setMusicMuted(muted: boolean): void {
        this.isMusicMuted = muted;
        if (this.musicGain && this.ctx) {
            const target = this.isMusicMuted ? 0 : this.musicVolume;
            this.musicGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
        }
        this.syncElementVolumeFallback();
    }

    public isAudioMusicMuted(): boolean {
        return this.isMusicMuted;
    }

    public toggleMusicMute(): boolean {
        this.setMusicMuted(!this.isMusicMuted);
        return this.isMusicMuted;
    }

    public setSfxVolume(vol: number): void {
        this.sfxVolume = Math.max(0, Math.min(1, vol));
        if (this.sfxGain && this.ctx) {
            const target = this.isSfxMuted ? 0 : this.sfxVolume;
            this.sfxGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
        }
    }

    public getSfxVolume(): number {
        return this.sfxVolume;
    }

    public setSfxMuted(muted: boolean): void {
        this.isSfxMuted = muted;
        if (this.sfxGain && this.ctx) {
            const target = this.isSfxMuted ? 0 : this.sfxVolume;
            this.sfxGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
        }
    }

    public isAudioSfxMuted(): boolean {
        return this.isSfxMuted;
    }

    public toggleSfxMute(): boolean {
        this.setSfxMuted(!this.isSfxMuted);
        return this.isSfxMuted;
    }

    // --- Tactile Micro-SFX Synthesizers ---

    /**
     * Checks whether user is currently typing in an input, textarea, editor, or rename box
     */
    public isUserTyping(): boolean {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return true;
        if (el.getAttribute('contenteditable') === 'true') return true;
        if (el.closest('.cm-content') || el.closest('.is-renaming') || el.closest('.inline-title')) return true;
        return false;
    }

    /**
     * 1. Button Click Mechanical Snap (12ms impulse):
     * Sharp, tactile microswitch click (downward pitch sweep + leaf spring ping)
     */
    public playClickSnap(): void {
        if (this.isMuted || this.isSfxMuted || this.sfxVolume <= 0 || !this.initContext() || !this.ctx || !this.sfxGain) return;
        const now = performance.now();
        if (now - this.lastSnapTime < 25) return;
        this.lastSnapTime = now;

        const ctx = this.ctx;
        const startTime = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1850, startTime);
        osc.frequency.exponentialRampToValueAtTime(750, startTime + 0.010);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.28, startTime + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.014);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        osc.start(startTime);
        osc.stop(startTime + 0.016);
    }

    /**
     * 2. Toggle Switch Chime:
     * Ascending chime on switch turn on, descending chime on switch turn off
     */
    public playToggleChime(isAscending: boolean): void {
        if (this.isMuted || this.isSfxMuted || this.sfxVolume <= 0 || !this.initContext() || !this.ctx || !this.sfxGain) return;
        const now = performance.now();
        if (now - this.lastChimeTime < 40) return;
        this.lastChimeTime = now;

        const ctx = this.ctx;
        const startTime = ctx.currentTime;

        const freq1 = isAscending ? 523.25 : 783.99; // C5 or G5
        const freq2 = isAscending ? 783.99 : 523.25; // G5 or C5

        // Tone 1
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq1, startTime);
        gain1.gain.setValueAtTime(0.001, startTime);
        gain1.gain.exponentialRampToValueAtTime(0.22, startTime + 0.006);
        gain1.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.07);
        osc1.connect(gain1);
        gain1.connect(this.sfxGain);
        osc1.start(startTime);
        osc1.stop(startTime + 0.075);

        // Tone 2 (offset by 35ms)
        const t2 = startTime + 0.035;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq2, t2);
        gain2.gain.setValueAtTime(0.001, t2);
        gain2.gain.exponentialRampToValueAtTime(0.25, t2 + 0.006);
        gain2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.09);
        osc2.connect(gain2);
        gain2.connect(this.sfxGain);
        osc2.start(t2);
        osc2.stop(t2 + 0.095);
    }

    /**
     * 3. File Creation: Crisp Paper Slide
     * Delicate, organic paper sliding into a pocket
     */
    public playPaperSlide(): void {
        if (this.isMuted || this.isSfxMuted || this.sfxVolume <= 0 || !this.initContext() || !this.ctx || !this.sfxGain) return;
        const now = performance.now();
        if (now - this.lastPaperSlideTime < 80) return;
        this.lastPaperSlideTime = now;

        const ctx = this.ctx;
        const startTime = ctx.currentTime;
        const bufferSize = Math.floor(ctx.sampleRate * 0.12);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        // White noise with subtle pink roll-off
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.45));
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1200, startTime);
        filter.frequency.exponentialRampToValueAtTime(2400, startTime + 0.05);
        filter.frequency.exponentialRampToValueAtTime(800, startTime + 0.11);
        filter.Q.setValueAtTime(2.2, startTime);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.24, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.115);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);

        noise.start(startTime);
        noise.stop(startTime + 0.12);
    }

    /**
     * 4. File Deletion: Crumpled Paper Scrunch
     * Satisfying textured paper crumple / trash scrunch
     */
    public playPaperScrunch(): void {
        if (this.isMuted || this.isSfxMuted || this.sfxVolume <= 0 || !this.initContext() || !this.ctx || !this.sfxGain) return;
        const now = performance.now();
        if (now - this.lastPaperScrunchTime < 100) return;
        this.lastPaperScrunchTime = now;

        const ctx = this.ctx;
        const startTime = ctx.currentTime;
        const duration = 0.14;
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        // Granular crackle bursts
        for (let i = 0; i < bufferSize; i++) {
            const burst = (i % 380 < 40) ? 1.6 : 0.4;
            data[i] = (Math.random() * 2 - 1) * burst;
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1600, startTime);
        filter.frequency.exponentialRampToValueAtTime(600, startTime + duration);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.30, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);

        noise.start(startTime);
        noise.stop(startTime + duration);
    }

    // --- Subscription Listeners ---

    public onTimeUpdate(cb: (currentTime: number, duration: number) => void): () => void {
        this.timeUpdateListeners.add(cb);
        return () => this.timeUpdateListeners.delete(cb);
    }

    public onTrackEnded(cb: () => void): () => void {
        this.trackEndedListeners.add(cb);
        return () => this.trackEndedListeners.delete(cb);
    }

    public onPlayStateChange(cb: (isPlaying: boolean) => void): () => void {
        this.playStateListeners.add(cb);
        return () => this.playStateListeners.delete(cb);
    }

    public onError(cb: (err: any) => void): () => void {
        this.errorListeners.add(cb);
        return () => this.errorListeners.delete(cb);
    }

    public dispose(): void {
        this.stop();
        this.audioEl.src = '';
        if (this.ctx) {
            this.ctx.close().catch(() => {});
            this.ctx = null;
        }
        this.timeUpdateListeners.clear();
        this.trackEndedListeners.clear();
        this.playStateListeners.clear();
        this.errorListeners.clear();
    }
}
