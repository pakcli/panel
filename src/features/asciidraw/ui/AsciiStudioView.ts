import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { AsciiStudioWorkspace } from './AsciiStudioWorkspace';
import type TablitePlugin from '../../../main';

export const ASCII_STUDIO_VIEW_TYPE = 'asciidraw-studio-view';

export class AsciiStudioView extends ItemView {
	private plugin: TablitePlugin;
	private workspace: AsciiStudioWorkspace | null = null;
	private targetFile: string | null = null;
	private pendingContent: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TablitePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return ASCII_STUDIO_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'ASCII Studio';
	}

	getIcon(): string {
		return 'pencil';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('asciidraw-studio-tab-view');

		const initialTemplate = this.pendingContent || `┌──────────────────────────┐\n│  ASCII Drawing Canvas    │\n└──────────────────────────┘`;

		this.workspace = new AsciiStudioWorkspace({
			app: this.app,
			containerEl: this.contentEl,
			config: {
				initialContent: initialTemplate,
				targetFile: this.targetFile || undefined
			},
			isTabView: true,
			onSave: async (savedContent: string) => {
				if (this.targetFile) {
					const file = this.app.vault.getAbstractFileByPath(this.targetFile);
					if (file instanceof TFile) {
						try {
							await this.app.vault.process(file, (content) => {
								const blockRegex = /(```(?:asciidraw|ascii-draw|ascii-canvas)[\r\n]+)([\s\S]*?)([\r\n]+```)/m;
								if (blockRegex.test(content)) {
									return content.replace(blockRegex, `$1${savedContent}$3`);
								}
								return content + `\n\n\`\`\`asciidraw\n${savedContent}\n\`\`\`\n`;
							});
							new Notice(`✓ Saved ASCII drawing to note: ${file.basename}`);
							return;
						} catch (err) {
							console.error('Failed to save to note:', err);
						}
					}
				}

				try {
					const electron = (window as any).require?.('electron');
					if (electron?.clipboard?.writeText) {
						electron.clipboard.writeText(`\`\`\`asciidraw\n${savedContent}\n\`\`\``);
					} else if (navigator?.clipboard?.writeText) {
						await navigator.clipboard.writeText(`\`\`\`asciidraw\n${savedContent}\n\`\`\``);
					}
					new Notice('✓ Copied ASCII codeblock to clipboard!');
				} catch (err) {
					console.error('Failed to copy to clipboard:', err);
				}
			}
		});

		this.workspace.init();
	}

	public setContent(content: string, targetFile?: string): void {
		this.pendingContent = content;
		this.targetFile = targetFile || null;
		if (this.workspace) {
			this.workspace.loadContent(content);
		}
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
		this.workspace = null;
	}
}
