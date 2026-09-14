/**
 * SfxManager:
 * Procedural tactile micro-audio synthesizer using the native Web Audio API.
 * Synthesizes zero-latency, ASMR-style acoustic feedback for:
 * 1. Node spawn (water droplet / pop)
 * 2. Bubble spawn (resonant airy chord chime)
 * 3. Node-to-node collision (wooden marimba / glass marble clack)
 * 4. Node-to-bubble membrane collision (squishy rubber bounce)
 * 5. Bubble-to-bubble collision (deep balloon thud)
 */

export class SfxManager {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;

    private enabled: boolean = true;
    private volume: number = 0.35; // 0.0 to 1.0

    // Anti-fatigue throttles (timestamps in ms)
    private lastNodeCollision: number = 0;
    private lastNodeBubbleCollision: number = 0;
    private lastBubbleCollision: number = 0;
    private lastNodeSpawn: number = 0;
    private lastBubbleSpawn: number = 0;
    private lastLinkSwitch: number = 0;

    constructor(enabled: boolean = true, volume: number = 0.35) {
        this.enabled = enabled;
        this.volume = Math.max(0, Math.min(1, volume));
    }

    private initContext(): boolean {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return false;
            try {
                this.ctx = new AudioCtx();

                // Master Compressor acts as a soft limiter to avoid any clipping/crackling
                this.compressor = this.ctx.createDynamicsCompressor();
                this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
                this.compressor.knee.setValueAtTime(8, this.ctx.currentTime);
                this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
                this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
                this.compressor.release.setValueAtTime(0.08, this.ctx.currentTime);

                // Master Gain
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.setValueAtTime(this.enabled ? this.volume * 0.45 : 0, this.ctx.currentTime);

                this.compressor.connect(this.masterGain);
                this.masterGain.connect(this.ctx.destination);
            } catch {
                return false;
            }
        }

        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }

        return true;
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (this.masterGain && this.ctx) {
            const targetGain = this.enabled ? this.volume * 0.45 : 0;
            this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.01);
        }
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public setVolume(vol: number): void {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.masterGain && this.ctx && this.enabled) {
            this.masterGain.gain.setTargetAtTime(this.volume * 0.45, this.ctx.currentTime, 0.01);
        }
    }

    public getVolume(): number {
        return this.volume;
    }

    /**
     * 1. Node Spawn SFX:
     * Musical water droplet / crisp soap bubble "bloop" (upward chirping sine).
     */
    public playNodeSpawn(seed: string = '', delayMs: number = 0): void {
        if (!this.enabled || !this.initContext() || !this.ctx || !this.compressor) return;

        const nowMs = performance.now();
        if (delayMs === 0 && nowMs - this.lastNodeSpawn < 18) return;
        if (delayMs === 0) this.lastNodeSpawn = nowMs;

        const ctx = this.ctx;
        const comp = this.compressor;
        const startTime = ctx.currentTime + (delayMs / 1000);

        // Deterministic pitch offset from seed string (arpeggiated pentatonic feel)
        let hash = 0;
        for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) & 0xffff;
        const scaleIntervals = [0, 2, 4, 7, 9, 12, 14, 16];
        const step = scaleIntervals[Math.abs(hash) % scaleIntervals.length];
        const baseFreq = 440 * Math.pow(2, step / 12); // A4 tuned pentatonic droplet

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseFreq * 0.85, startTime);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, startTime + 0.045);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.35, startTime + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.065);

        osc.connect(gain);
        gain.connect(comp);

        osc.start(startTime);
        osc.stop(startTime + 0.07);
    }

    /**
     * 2. Bubble Spawn SFX:
     * Airy, resonant dual-chord chime ("whoosh-pop") when a folder bubble appears.
     */
    public playBubbleSpawn(depth: number = 1): void {
        if (!this.enabled || !this.initContext() || !this.ctx || !this.compressor) return;

        const nowMs = performance.now();
        if (nowMs - this.lastBubbleSpawn < 65) return;
        this.lastBubbleSpawn = nowMs;

        const ctx = this.ctx;
        const comp = this.compressor;
        const startTime = ctx.currentTime;

        const rootFreq = depth === 1 ? 164.81 : (depth === 2 ? 220.0 : 293.66); // E3, A3, D4

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(rootFreq, startTime);
        osc1.frequency.exponentialRampToValueAtTime(rootFreq * 1.12, startTime + 0.08);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(rootFreq * 1.5, startTime); // Perfect fifth harmonic

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(600, startTime);
        filter.frequency.exponentialRampToValueAtTime(1400, startTime + 0.05);
        filter.frequency.exponentialRampToValueAtTime(400, startTime + 0.16);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.38, startTime + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(comp);

        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(startTime + 0.19);
        osc2.stop(startTime + 0.19);
    }

    /**
     * 3. Node-to-Node Collision SFX:
     * Crisp wooden marimba / glass bead tap ("tik" / "plink").
     */
    public playNodeCollision(intensity: number = 1.0, radiusA: number = 3.5, radiusB: number = 3.5): void {
        if (!this.enabled || !this.initContext() || !this.ctx || !this.compressor) return;

        const nowMs = performance.now();
        if (nowMs - this.lastNodeCollision < 50) return;
        this.lastNodeCollision = nowMs;

        const ctx = this.ctx;
        const comp = this.compressor;
        const startTime = ctx.currentTime;

        // Inversely scaled pitch: larger notes = deeper wooden clack, smaller notes = bright glass ping
        const avgR = (radiusA + radiusB) * 0.5;
        const pitch = Math.max(650, Math.min(1500, 1450 - avgR * 85));
        const impactGain = Math.max(0.12, Math.min(0.42, 0.22 + intensity * 0.15));

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Sine with slight frequency drop for a wooden/glass percussive bite
        osc.type = avgR > 5 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(pitch * 1.15, startTime);
        osc.frequency.exponentialRampToValueAtTime(pitch, startTime + 0.008);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(impactGain, startTime + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.038);

        osc.connect(gain);
        gain.connect(comp);

        osc.start(startTime);
        osc.stop(startTime + 0.04);
    }

    /**
     * 4. Node-to-Bubble Boundary Collision SFX:
     * Soft squishy rubbery bounce / gelatinous membrane hit ("blip-bounce").
     */
    public playNodeBubbleCollision(intensity: number = 1.0): void {
        if (!this.enabled || !this.initContext() || !this.ctx || !this.compressor) return;

        const nowMs = performance.now();
        if (nowMs - this.lastNodeBubbleCollision < 65) return;
        this.lastNodeBubbleCollision = nowMs;

        const ctx = this.ctx;
        const comp = this.compressor;
        const startTime = ctx.currentTime;

        const impactGain = Math.max(0.10, Math.min(0.35, 0.18 + intensity * 0.12));

        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        // Downward dipping pitch envelope mimics a flexing elastic membrane
        osc.type = 'sine';
        osc.frequency.setValueAtTime(360, startTime);
        osc.frequency.exponentialRampToValueAtTime(180, startTime + 0.045);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(550, startTime);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(impactGain, startTime + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.055);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(comp);

        osc.start(startTime);
        osc.stop(startTime + 0.06);
    }

    /**
     * 5. Bubble-to-Bubble Collision SFX:
     * Deep warm balloon thud / resonant bass bubble bump ("thump-wub").
     */
    public playBubbleBubbleCollision(intensity: number = 1.0): void {
        if (!this.enabled || !this.initContext() || !this.ctx || !this.compressor) return;

        const nowMs = performance.now();
        if (nowMs - this.lastBubbleCollision < 100) return;
        this.lastBubbleCollision = nowMs;

        const ctx = this.ctx;
        const comp = this.compressor;
        const startTime = ctx.currentTime;

        const impactGain = Math.max(0.12, Math.min(0.40, 0.20 + intensity * 0.18));

        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        // Deep warm sub-bass thump
        osc.type = 'sine';
        osc.frequency.setValueAtTime(110, startTime);
        osc.frequency.exponentialRampToValueAtTime(65, startTime + 0.08);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(260, startTime);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(impactGain, startTime + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.12);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(comp);

        osc.start(startTime);
        osc.stop(startTime + 0.13);
    }

    /**
     * 6. Link Line Switch SFX:
     * Crisp, tactile mechanical switch snap ("click-snap" like a mechanical microswitch / relay)
     * when notes connect or link via an edge line.
     */
    public playLinkSwitch(intensity: number = 1.0): void {
        if (!this.enabled || !this.initContext() || !this.ctx || !this.compressor) return;

        const nowMs = performance.now();
        if (nowMs - this.lastLinkSwitch < 35) return;
        this.lastLinkSwitch = nowMs;

        const ctx = this.ctx;
        const comp = this.compressor;
        const startTime = ctx.currentTime;

        const impactGain = Math.max(0.08, Math.min(0.35, 0.20 * intensity));

        // 1. Primary tactile microswitch click (downward sweep 1850Hz -> 920Hz in 8ms)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();

        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(1850, startTime);
        osc1.frequency.exponentialRampToValueAtTime(920, startTime + 0.008);

        gain1.gain.setValueAtTime(0.0001, startTime);
        gain1.gain.exponentialRampToValueAtTime(impactGain, startTime + 0.001);
        gain1.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.016);

        osc1.connect(gain1);
        gain1.connect(comp);
        osc1.start(startTime);
        osc1.stop(startTime + 0.018);

        // 2. Secondary contact leaf spring tick (2400Hz micro-ping 3ms later)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(2400, startTime + 0.003);
        osc2.frequency.exponentialRampToValueAtTime(1600, startTime + 0.012);

        gain2.gain.setValueAtTime(0.0001, startTime + 0.003);
        gain2.gain.exponentialRampToValueAtTime(impactGain * 0.55, startTime + 0.005);
        gain2.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.018);

        osc2.connect(gain2);
        gain2.connect(comp);
        osc2.start(startTime + 0.003);
        osc2.stop(startTime + 0.020);
    }

    public dispose(): void {
        this.destroy();
    }

    public destroy(): void {
        if (this.ctx) {
            this.ctx.close().catch(() => {});
            this.ctx = null;
        }
    }
}
