import { App, TFile } from 'obsidian';
import type PakCLITablePlugin from '../../main';
import { TierListSettings, DEFAULT_SETTINGS } from './settings';
import { generateTierListPostProcessor, redraw } from './post-processor';
import { insertTierListCommand, turnFileIntoFolderCommand } from './commands';
import { TurnFileIntoFolderModal } from './modals/turn-file-into-folder-modal';
import { FileCompareSelectModal, CompareModal, fileToTierListItem } from './modals/quick-compare-modal';

export class TierListManager {
	private plugin: PakCLITablePlugin;
	public app: App;
	public settings: TierListSettings;

	constructor(plugin: PakCLITablePlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (plugin.settings as any)?.tierListSettings);
	}

	public async init(): Promise<void> {
		// Register markdown post-processor for tier list codeblocks/lists
		this.plugin.registerMarkdownPostProcessor(generateTierListPostProcessor(this));

		// Register commands
		this.plugin.addCommand(insertTierListCommand(this.settings));
		this.plugin.addCommand(turnFileIntoFolderCommand(this.app));

		this.plugin.addCommand({
			id: 'tier-list-quick-compare-active-file',
			name: 'Quick compare active note with...',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === 'md') {
					if (!checking) {
						new FileCompareSelectModal(this.app, activeFile).open();
					}
					return true;
				}
				return false;
			}
		});

		// 1. Single file right-click in explorer
		this.plugin.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					menu.addItem((item) => {
						item.setTitle('Turn into folder note')
							.setIcon('folder-plus')
							.onClick(() => {
								new TurnFileIntoFolderModal(this.app, file).open();
							});
					});

					menu.addItem((item) => {
						item.setTitle('Quick compare with...')
							.setIcon('scale')
							.onClick(() => {
								new FileCompareSelectModal(this.app, file).open();
							});
					});
				}
			})
		);

		// 2. Multi-file right-click in explorer (Shift+click / Ctrl+click multiselect)
		this.plugin.registerEvent(
			this.app.workspace.on('files-menu', (menu, files) => {
				const mdFiles = files.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
				if (mdFiles.length >= 2) {
					menu.addItem((item) => {
						item.setTitle(`Quick compare selected (${mdFiles.length} files)`)
							.setIcon('scale')
							.onClick(() => {
								const selectedItems = mdFiles.map((f) => fileToTierListItem(this.app, f));
								new CompareModal(this.app, selectedItems, undefined, mdFiles[0].path).open();
							});
					});
				} else if (mdFiles.length === 1) {
					menu.addItem((item) => {
						item.setTitle('Quick compare with...')
							.setIcon('scale')
							.onClick(() => {
								new FileCompareSelectModal(this.app, mdFiles[0]).open();
							});
					});
				}
			})
		);

		this.resize();
	}

	public destroy(): void {
		// Clean up resources if needed
	}

	public async saveSettings(): Promise<void> {
		(this.plugin.settings as any).tierListSettings = this.settings;
		await this.plugin.saveSettings();
		this.resize();
	}

	public resize(): void {
		redraw(document.documentElement, this.settings);
	}
}
