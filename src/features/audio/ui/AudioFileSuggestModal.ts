import { App, FuzzySuggestModal, TFile } from 'obsidian';
import { SUPPORTED_AUDIO_EXTENSIONS, AudioTrack } from '../types';

export class AudioFileSuggestModal extends FuzzySuggestModal<TFile> {
    private onChoose: (track: AudioTrack) => void;

    constructor(app: App, onChoose: (track: AudioTrack) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder('Search audio files in vault to add to queue...');
    }

    getItems(): TFile[] {
        return this.app.vault.getFiles().filter(file => {
            const ext = (file.extension || '').toLowerCase();
            return SUPPORTED_AUDIO_EXTENSIONS.has(ext);
        });
    }

    getItemText(item: TFile): string {
        return `${item.basename} (${item.path})`;
    }

    onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent): void {
        const track: AudioTrack = {
            id: item.path,
            name: item.basename,
            path: item.path,
            folder: item.parent?.path || 'Vault Root',
            extension: item.extension || '',
            file: item,
            duration: 0,
            isPriority: true
        };
        this.onChoose(track);
    }
}
