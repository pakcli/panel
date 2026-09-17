import { TFile } from 'obsidian';

export type AudioExtension = 'mp3' | 'm4a' | 'wav' | 'ogg' | 'flac';

export const SUPPORTED_AUDIO_EXTENSIONS = new Set<string>(['mp3', 'm4a', 'wav', 'ogg', 'flac']);

export type PlaybackMode = 'loop_all' | 'loop_one' | 'shuffle' | 'linear';

export interface AudioTrack {
    id: string; // Unique path in vault
    name: string; // Display title (cleaned filename)
    path: string;
    folder: string;
    extension: string;
    file: TFile;
    duration: number; // Duration in seconds (0 until loaded)
    isPriority?: boolean;
}

export interface AudioPlayerState {
    currentTrack: AudioTrack | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    playbackMode: PlaybackMode;
    masterVolume: number; // 0.0 to 1.0
    isMuted: boolean;
    musicVolume: number; // 0.0 to 1.0
    sfxVolume: number; // 0.0 to 1.0
    basePlaylist: AudioTrack[];
    priorityQueue: AudioTrack[];
    historyStack: AudioTrack[];
    targetFolder: string; // '' or 'None' for entire vault
}

export interface AudioPluginSettings {
    audioTargetFolder: string;
    audioPlaybackMode: PlaybackMode;
    audioMasterVolume: number;
    audioIsMuted: boolean;
    audioMusicVolume: number;
    audioSfxVolume: number;
    sfxSnapEnabled: boolean;
    sfxChimeEnabled: boolean;
    sfxPaperSlideEnabled: boolean;
    sfxPaperScrunchEnabled: boolean;
    sfxSuppressWhileTyping: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioPluginSettings = {
    audioTargetFolder: '',
    audioPlaybackMode: 'loop_all',
    audioMasterVolume: 0.70,
    audioIsMuted: false,
    audioMusicVolume: 0.85,
    audioSfxVolume: 0.60,
    sfxSnapEnabled: true,
    sfxChimeEnabled: true,
    sfxPaperSlideEnabled: true,
    sfxPaperScrunchEnabled: true,
    sfxSuppressWhileTyping: true,
};
