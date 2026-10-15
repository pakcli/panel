import { App, Modal } from 'obsidian';
import { AsciiStudioConfig } from '../types';
import { AsciiStudioWorkspace } from './AsciiStudioWorkspace';
import { openAsciiStudioTab } from '../index';

export class AsciiDrawModal extends Modal {
	private config: AsciiStudioConfig;
	private workspace!: AsciiStudioWorkspace;

	constructor(app: App, config: AsciiStudioConfig = {}) {
		super(app);
		this.config = config;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('asciidraw-modal-window');
		contentEl.empty();

		this.workspace = new AsciiStudioWorkspace({
			app: this.app,
			containerEl: contentEl,
			config: this.config,
			isTabView: false,
			onSave: async (savedContent: string) => {
				if (this.config.onSave) {
					await this.config.onSave(savedContent);
				}
				this.close();
			},
			onClose: () => {
				this.close();
			},
			onOpenInTab: async (content: string) => {
				this.close();
				await openAsciiStudioTab(this.app, content, this.config.targetFile);
			}
		});

		this.workspace.init();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
