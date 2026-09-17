import { setIcon } from 'obsidian';
import { AudioEngine } from '../audioEngine';
import { PlaylistManager } from '../playlistManager';
import { AudioPlayerState, PlaybackMode } from '../types';
import { AudioFileSuggestModal } from './AudioFileSuggestModal';

export function formatAudioTime(sec: number): string {
    if (isNaN(sec) || !isFinite(sec) || sec <= 0) return '00:00';
    const totalSec = Math.floor(sec);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const mm = m < 10 ? `0${m}` : `${m}`;
    const ss = s < 10 ? `0${s}` : `${s}`;
    return `${mm}:${ss}`;
}

export interface AudioPlayerRenderContext {
    containerEl: HTMLElement;
    audioEngine: AudioEngine;
    playlistManager: PlaylistManager;
    onDock?: () => void;
    onMinimize?: () => void;
    onClose?: () => void;
    isDocked?: boolean;
}

export function renderAudioPlayerContent(ctx: AudioPlayerRenderContext): () => void {
    const { containerEl, audioEngine, playlistManager } = ctx;
    containerEl.empty();
    containerEl.addClass('pakcli-audio-player-root');

    // 1. Header (if actions provided)
    if (ctx.onDock || ctx.onMinimize || ctx.onClose) {
        const headerEl = containerEl.createDiv({ cls: 'pakcli-audio-header' });
        const titleGroup = headerEl.createDiv({ cls: 'pakcli-audio-title-group' });
        titleGroup.createSpan({ cls: 'pakcli-audio-title-icon', text: '🎵' });
        titleGroup.createSpan({ cls: 'pakcli-audio-title-text', text: 'PakCLI Audio & Ambient' });

        const actionsEl = headerEl.createDiv({ cls: 'pakcli-audio-header-actions' });

        if (ctx.onDock) {
            const dockBtn = actionsEl.createEl('button', {
                cls: 'clickable-icon pakcli-audio-btn-dock',
                title: ctx.isDocked ? 'Undock to 50% Popup' : 'Dock as Tab Leaf'
            });
            setIcon(dockBtn, ctx.isDocked ? 'external-link' : 'layout-panel-left');
            dockBtn.onclick = () => ctx.onDock!();
        }

        if (ctx.onMinimize) {
            const minBtn = actionsEl.createEl('button', {
                cls: 'clickable-icon pakcli-audio-btn-min',
                title: 'Minimize to Footer Status Bar'
            });
            setIcon(minBtn, 'minus');
            minBtn.onclick = () => ctx.onMinimize!();
        }

        if (ctx.onClose) {
            const closeBtn = actionsEl.createEl('button', {
                cls: 'clickable-icon pakcli-audio-btn-close',
                title: 'Close Player'
            });
            setIcon(closeBtn, 'x');
            closeBtn.onclick = () => ctx.onClose!();
        }
    }

    const scrollContainer = containerEl.createDiv({ cls: 'pakcli-audio-scroll-container' });

    // 2. NOW PLAYING CARD
    const nowPlayingCard = scrollContainer.createDiv({ cls: 'pakcli-audio-card pakcli-now-playing-card' });
    const npHeader = nowPlayingCard.createDiv({ cls: 'pakcli-card-header' });
    npHeader.createSpan({ text: 'NOW PLAYING', cls: 'pakcli-card-section-label' });

    const trackInfoBox = nowPlayingCard.createDiv({ cls: 'pakcli-track-info-box' });
    const discIcon = trackInfoBox.createSpan({ cls: 'pakcli-disc-icon', text: '💿' });
    const trackDetails = trackInfoBox.createDiv({ cls: 'pakcli-track-details' });
    const trackTitleEl = trackDetails.createDiv({ cls: 'pakcli-track-title', text: 'No track selected' });

    const trackSubDetails = trackDetails.createDiv({ cls: 'pakcli-track-meta-row' });
    const trackFolderEl = trackSubDetails.createSpan({ cls: 'pakcli-track-folder', text: 'Folder: -' });

    // Playlist Scope Selector Dropdown
    const playlistScopeWrap = trackSubDetails.createSpan({ cls: 'pakcli-playlist-scope-wrap' });
    playlistScopeWrap.createSpan({ text: ' • Scope: ' });
    const scopeSelect = playlistScopeWrap.createEl('select', { cls: 'pakcli-audio-select' });

    const updateFolderOptions = () => {
        const folders = playlistManager.getAvailableFolders();
        scopeSelect.empty();
        scopeSelect.createEl('option', { value: '', text: 'Entire Vault' });
        for (const f of folders) {
            scopeSelect.createEl('option', { value: f, text: f });
        }
        scopeSelect.value = playlistManager.getState().targetFolder;
    };
    updateFolderOptions();

    scopeSelect.onchange = () => {
        playlistManager.setTargetFolder(scopeSelect.value);
    };

    // Scrubber Row
    const scrubberContainer = nowPlayingCard.createDiv({ cls: 'pakcli-scrubber-container' });
    const timeCurEl = scrubberContainer.createSpan({ cls: 'pakcli-time-display', text: '00:00' });
    const scrubberInput = scrubberContainer.createEl('input', {
        type: 'range',
        cls: 'pakcli-scrubber-range'
    });
    scrubberInput.min = '0';
    scrubberInput.max = '100';
    scrubberInput.value = '0';
    const timeDurEl = scrubberContainer.createSpan({ cls: 'pakcli-time-display', text: '00:00' });

    let isDraggingScrubber = false;
    scrubberInput.oninput = () => {
        isDraggingScrubber = true;
        const seekVal = parseFloat(scrubberInput.value);
        timeCurEl.setText(formatAudioTime(seekVal));
    };
    scrubberInput.onchange = () => {
        isDraggingScrubber = false;
        const seekVal = parseFloat(scrubberInput.value);
        audioEngine.seek(seekVal);
    };

    // Transport Controls
    const transportRow = nowPlayingCard.createDiv({ cls: 'pakcli-transport-row' });

    const prevBtn = transportRow.createEl('button', { cls: 'pakcli-btn-transport pakcli-btn-prev', title: 'Previous Track' });
    setIcon(prevBtn, 'skip-back');
    prevBtn.onclick = () => {
        audioEngine.playClickSnap();
        playlistManager.previous();
    };

    const stopBtn = transportRow.createEl('button', { cls: 'pakcli-btn-transport pakcli-btn-stop', title: 'Stop' });
    setIcon(stopBtn, 'square');
    stopBtn.onclick = () => {
        audioEngine.playClickSnap();
        playlistManager.stop();
    };

    const playPauseBtn = transportRow.createEl('button', { cls: 'pakcli-btn-transport pakcli-btn-play mod-cta', title: 'Play / Pause' });
    setIcon(playPauseBtn, 'play');
    playPauseBtn.onclick = () => {
        audioEngine.playClickSnap();
        playlistManager.togglePlay();
    };

    const nextBtn = transportRow.createEl('button', { cls: 'pakcli-btn-transport pakcli-btn-next', title: 'Next Track' });
    setIcon(nextBtn, 'skip-forward');
    nextBtn.onclick = () => {
        audioEngine.playClickSnap();
        playlistManager.next();
    };

    // Playback Modes Row
    const modeRow = nowPlayingCard.createDiv({ cls: 'pakcli-mode-row' });
    modeRow.createSpan({ text: 'MODE:', cls: 'pakcli-mode-label' });

    const modes: { id: PlaybackMode; label: string; icon: string; title: string }[] = [
        { id: 'loop_all', label: 'Loop All', icon: 'repeat', title: 'Loop entire playlist sequentially' },
        { id: 'loop_one', label: 'Loop 1', icon: 'repeat-1', title: 'Loop active track continuously' },
        { id: 'shuffle', label: 'Shuffle', icon: 'shuffle', title: 'Shuffle tracks randomly without repeat' },
        { id: 'linear', label: 'Linear', icon: 'arrow-right', title: 'Play once to the end then stop' }
    ];

    const modeBtns: Map<PlaybackMode, HTMLButtonElement> = new Map();

    for (const m of modes) {
        const btn = modeRow.createEl('button', {
            cls: 'pakcli-btn-mode',
            title: m.title
        });
        const iconSpan = btn.createSpan({ cls: 'pakcli-mode-icon' });
        setIcon(iconSpan, m.icon);
        btn.createSpan({ text: m.label });

        btn.onclick = () => {
            audioEngine.playClickSnap();
            playlistManager.setPlaybackMode(m.id);
        };
        modeBtns.set(m.id, btn);
    }

    // 3. VOLUME CONTROLS CARD
    const volumeCard = scrollContainer.createDiv({ cls: 'pakcli-audio-card pakcli-volume-card' });
    volumeCard.createDiv({ cls: 'pakcli-card-section-label', text: 'VOLUME CONTROLS' });

    // Master Volume
    const masterVolRow = volumeCard.createDiv({ cls: 'pakcli-volume-row' });
    masterVolRow.createSpan({ text: '🔊 Master:', cls: 'pakcli-vol-label' });
    const masterSlider = masterVolRow.createEl('input', { type: 'range', cls: 'pakcli-vol-slider' });
    masterSlider.min = '0';
    masterSlider.max = '100';
    const masterValEl = masterVolRow.createSpan({ cls: 'pakcli-vol-val', text: '70%' });

    const muteBtn = masterVolRow.createEl('button', { cls: 'pakcli-btn-mute', text: '🔈 Mute' });
    muteBtn.onclick = () => {
        const isMuted = audioEngine.toggleMute();
        audioEngine.playClickSnap();
        muteBtn.setText(isMuted ? '🔇 Unmute' : '🔈 Mute');
        muteBtn.toggleClass('is-muted', isMuted);
    };

    masterSlider.oninput = () => {
        const val = parseInt(masterSlider.value, 10);
        masterValEl.setText(`${val}%`);
        audioEngine.setMasterVolume(val / 100);
    };

    // Music Volume
    const musicVolRow = volumeCard.createDiv({ cls: 'pakcli-volume-row' });
    musicVolRow.createSpan({ text: '🎵 Music:', cls: 'pakcli-vol-label' });
    const musicSlider = musicVolRow.createEl('input', { type: 'range', cls: 'pakcli-vol-slider' });
    musicSlider.min = '0';
    musicSlider.max = '100';
    const musicValEl = musicVolRow.createSpan({ cls: 'pakcli-vol-val', text: '85%' });

    musicSlider.oninput = () => {
        const val = parseInt(musicSlider.value, 10);
        musicValEl.setText(`${val}%`);
        audioEngine.setMusicVolume(val / 100);
    };

    // SFX Volume
    const sfxVolRow = volumeCard.createDiv({ cls: 'pakcli-volume-row' });
    sfxVolRow.createSpan({ text: '✨ SFX:', cls: 'pakcli-vol-label' });
    const sfxSlider = sfxVolRow.createEl('input', { type: 'range', cls: 'pakcli-vol-slider' });
    sfxSlider.min = '0';
    sfxSlider.max = '100';
    const sfxValEl = sfxVolRow.createSpan({ cls: 'pakcli-vol-val', text: '60%' });

    const testClicksBtn = sfxVolRow.createEl('button', { cls: 'pakcli-btn-test-sfx', text: 'Test Clicks' });
    testClicksBtn.onclick = () => {
        audioEngine.playClickSnap();
        window.setTimeout(() => audioEngine.playToggleChime(true), 120);
    };

    sfxSlider.oninput = () => {
        const val = parseInt(sfxSlider.value, 10);
        sfxValEl.setText(`${val}%`);
        audioEngine.setSfxVolume(val / 100);
    };

    // 4. UP NEXT QUEUE CARD
    const queueCard = scrollContainer.createDiv({ cls: 'pakcli-audio-card pakcli-queue-card' });
    const queueHeader = queueCard.createDiv({ cls: 'pakcli-queue-header' });
    const queueCountEl = queueHeader.createDiv({ cls: 'pakcli-card-section-label', text: 'UP NEXT QUEUE (0 items)' });

    const queueActions = queueHeader.createDiv({ cls: 'pakcli-queue-actions' });
    const addBtn = queueActions.createEl('button', { cls: 'pakcli-btn-sm', text: '+ Add' });
    addBtn.onclick = () => {
        audioEngine.playClickSnap();
        new AudioFileSuggestModal(playlistManager['app'], (track) => {
            playlistManager.addToQueue(track);
        }).open();
    };

    const clearBtn = queueActions.createEl('button', { cls: 'pakcli-btn-sm', text: '🗑 Clear' });
    clearBtn.onclick = () => {
        audioEngine.playClickSnap();
        playlistManager.clearQueue();
    };

    const queueListEl = queueCard.createDiv({ cls: 'pakcli-queue-list' });

    // Sync State function
    const updateUIWithState = (state: AudioPlayerState) => {
        // Update Now Playing Info
        if (state.currentTrack) {
            trackTitleEl.setText(state.currentTrack.name);
            trackTitleEl.title = state.currentTrack.path;
            trackFolderEl.setText(`Folder: ${state.currentTrack.folder}`);
        } else {
            trackTitleEl.setText('No track playing');
            trackTitleEl.title = '';
            trackFolderEl.setText('Select a track to start playback');
        }

        // Disc rotation state
        discIcon.toggleClass('is-spinning', state.isPlaying);

        // Play/Pause button icon
        setIcon(playPauseBtn, state.isPlaying ? 'pause' : 'play');
        playPauseBtn.title = state.isPlaying ? 'Pause' : 'Play';

        // Playback Mode Buttons
        for (const [m, b] of modeBtns.entries()) {
            b.toggleClass('is-active', state.playbackMode === m);
        }

        // Volumes
        masterSlider.value = Math.round(state.masterVolume * 100).toString();
        masterValEl.setText(`${masterSlider.value}%`);
        muteBtn.setText(state.isMuted ? '🔇 Unmute' : '🔈 Mute');
        muteBtn.toggleClass('is-muted', state.isMuted);

        musicSlider.value = Math.round(state.musicVolume * 100).toString();
        musicValEl.setText(`${musicSlider.value}%`);

        sfxSlider.value = Math.round(state.sfxVolume * 100).toString();
        sfxValEl.setText(`${sfxSlider.value}%`);

        // Queue List
        const totalQueue = state.priorityQueue.length;
        queueCountEl.setText(`UP NEXT QUEUE (${totalQueue} items)`);
        queueListEl.empty();

        if (totalQueue === 0) {
            const emptyMsg = queueListEl.createDiv({ cls: 'pakcli-queue-empty' });
            if (state.basePlaylist.length > 0) {
                emptyMsg.setText(`Base playlist active (${state.basePlaylist.length} tracks). Add songs above to insert priority tracks!`);
            } else {
                emptyMsg.setText('No audio files found. Add audio to vault or select another folder scope.');
            }
        } else {
            state.priorityQueue.forEach((t, idx) => {
                const row = queueListEl.createDiv({ cls: 'pakcli-queue-item' });
                row.createSpan({ cls: 'pakcli-queue-index', text: `${idx + 1}.` });

                if (t.isPriority) {
                    row.createSpan({ cls: 'pakcli-priority-badge', text: 'Priority' });
                }

                const titleSpan = row.createSpan({ cls: 'pakcli-queue-item-title', text: t.name });
                titleSpan.title = t.path;

                row.createSpan({ cls: 'pakcli-queue-item-ext', text: `.${t.extension}` });

                const removeBtn = row.createEl('button', { cls: 'clickable-icon pakcli-queue-item-remove', title: 'Remove from queue' });
                setIcon(removeBtn, 'x');
                removeBtn.onclick = (e) => {
                    e.stopPropagation();
                    audioEngine.playClickSnap();
                    playlistManager.removeQueueItem(idx);
                };

                row.onclick = () => {
                    audioEngine.playClickSnap();
                    playlistManager.playTrack(t, true);
                    playlistManager.removeQueueItem(idx);
                };
            });
        }
    };

    // Periodic / Scrubber time update handler
    const unsubTime = audioEngine.onTimeUpdate((cur, dur) => {
        if (!isDraggingScrubber) {
            timeCurEl.setText(formatAudioTime(cur));
            timeDurEl.setText(formatAudioTime(dur));
            scrubberInput.max = dur > 0 ? dur.toString() : '100';
            scrubberInput.value = cur.toString();
        }
    });

    const unsubState = playlistManager.onStateChange((state) => {
        updateUIWithState(state);
    });

    // Cleanup function
    return () => {
        unsubTime();
        unsubState();
    };
}
