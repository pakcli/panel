import { Plugin, Notice, Setting, PluginSettingTab, ButtonComponent, TFile, TFolder, TextComponent, setIcon, normalizePath } from 'obsidian';
import { PakCLITableSettings, DEFAULT_TABLE_SETTINGS, DEFAULT_BUBBLE_GRAPH_SETTINGS, RelationshipTierConfig, DEFAULT_RELATIONSHIP_TIERS, RelationshipFolderEntry, RelationshipViewStructure, RelationshipSortOrder } from './settings';
import { handleArtifactRename, moveArtifactsBetweenFolders } from './features/sqlseal/utils/views';
import { SplitViewManager } from './features/explorer/splitViewManager';
import { ExplorerSectionId, EXPLORER_SECTIONS_INFO, DEFAULT_EXPLORER_SECTION_ORDER } from './features/explorer/types';
import { ImageTriageModal } from './features/carousel/ImageTriageModal';
import { IMAGE_CAROUSEL_VIEW_TYPE, ImageCarouselView } from './features/carousel/ImageCarouselView';
import { RelationshipExplorerManager } from './features/relationship/relationshipExplorerManager';
import { RelationshipReorganizeModal } from './features/relationship/RelationshipReorganizeModal';
import { RelationshipSampleModal } from './features/relationship/RelationshipSampleModal';
import { AssignRelationshipModal } from './features/relationship/AssignRelationshipModal';

// Hub Imports
import { MasterDetailSettingsTab } from './features/hub/settingsHub';
import { eventBus } from './features/hub/eventBus';
import { saveVaultConfig, loadVaultConfig } from './features/hub/vaultConfig';

// Tree & Asset Router Imports
import { AssetRouter } from './features/tree/router';
import { TitleOverrideOption } from './features/tree/types';
import { DiagramRenderer } from './features/tree/renderers/DiagramRenderer';
import { registerCommands as registerTreeCommands } from './features/tree/commands/index';
import { FolderSuggest } from './features/tree/ui/folder-suggest';
import { ConfirmModal } from './features/tree/ui/modals';
import { TimelineNarrativeRenderer } from './features/timelineNarrative/TimelineNarrativeRenderer';
import { TimelineNarrativeEditorSuggest } from './features/timelineNarrative/timelineAutocomplete';

// SQLSeal & Database Imports
import { mainModule } from './features/sqlseal/modules/main/module';
import { SQLSealSettingsTab } from './features/sqlseal/modules/settings/SQLSealSettingsTab';
import { ColumnConfig, CalcPreset, normalizeColumnConfig, createDefaultColumnConfig } from './features/sqlseal/types';
import { CsvView, CSV_VIEW_TYPE } from './features/sqlseal/csv-view';
import { CustomCalcModal } from './features/sqlseal/components/CustomCalcModal';

// Leaflet Imports
import { BasesLeafletViewPlugin } from './features/leaflet/plugin';
import { BasesLeafletViewSettingsTab } from './features/leaflet/settings/basesLeafletViewSettingsTab';

// ASCII Draw Imports
import { registerAsciiDrawFeature } from './features/asciidraw';

// Codeblock Auto-Scaler
import { CodeblockScaler } from './features/codeblock/scaler';

// Bubble Graph View (Spec v18)
import { BUBBLE_GRAPH_VIEW_TYPE, BubbleGraphView } from './features/bubblegraph';

// A–Z Dictionary Imports
import { DictionaryPopupModal } from './features/dictionary/dictionaryPopupModal';
import { DictionaryExplorerManager } from './features/dictionary/dictionaryExplorerManager';

export default class PakCLITablePlugin extends Plugin {
	declare settings: PakCLITableSettings;
	router!: AssetRouter;
	codeblockScaler!: CodeblockScaler;
	leafletPlugin!: BasesLeafletViewPlugin;
	sqlsealTabInstance: SQLSealSettingsTab | null = null;
	leafletTabInstance: unknown = null;
	settingsTabInstance: MasterDetailSettingsTab | null = null;
	settingsPanelStates: Map<string, boolean> = new Map();
	splitViewManager!: SplitViewManager;
	relationshipExplorerManager!: RelationshipExplorerManager;
	dictionaryExplorerManager!: DictionaryExplorerManager;
	vaultRoot: string = '';
	bubbleRibbonEl: HTMLElement | null = null;

	openSettingsTab(sectionId?: string): void {
		const appWithPlugins = this.app as { setting?: { open?: () => void; openTabById?: (id: string) => void } };
		const setting = appWithPlugins.setting;
		if (setting && typeof setting.open === 'function') {
			setting.open();
			if (typeof setting.openTabById === 'function') {
				setting.openTabById(this.manifest.id);
			}
			if (sectionId && this.settingsTabInstance) {
				this.settingsTabInstance.openSection(sectionId);
			}
		}
	}

	async openBubbleGraphView(scopedFolder?: string): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
		let targetLeaf = existing.length > 0 ? existing[0] : null;
		if (targetLeaf) {
			this.app.workspace.revealLeaf(targetLeaf);
		} else {
			targetLeaf = this.app.workspace.getLeaf('tab');
			await targetLeaf.setViewState({
				type: BUBBLE_GRAPH_VIEW_TYPE,
				active: true
			});
			this.app.workspace.revealLeaf(targetLeaf);
		}

		if (scopedFolder && targetLeaf.view instanceof BubbleGraphView) {
			targetLeaf.view.scopeToFolder(scopedFolder);
		}
	}

	updateBubbleRibbon(): void {
		if (this.bubbleRibbonEl) {
			this.bubbleRibbonEl.remove();
			this.bubbleRibbonEl = null;
		}

		if (this.settings.bubbleGraphMode === 'second') {
			const icon = this.settings.bubbleRibbonIcon || 'circle-dot';
			this.bubbleRibbonEl = this.addRibbonIcon(
				icon,
				'Open Bubble Graph View',
				() => { this.openBubbleGraphView(); }
			);
		}
	}

	async onload(): Promise<void> {
		// 1. Resolve Vault Root Path
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		if (typeof adapter.getBasePath === 'function') {
			this.vaultRoot = adapter.getBasePath();
		}

		// 2. Load Settings (with Vault Config fallback)
		await this.loadSettings();

		// 3. Initialize Event Bus
		eventBus.emit('table:loaded', { version: this.manifest.version });

		// 4. Initialize Codeblock Scaler
		this.codeblockScaler = new CodeblockScaler(this);
		this.codeblockScaler.init();
		this.applyCodeblockStyle();

		// 5. Initialize Tree Diagrams & Asset Router
		this.router = new AssetRouter(this.app, () => this.settings);
		this.router.registerEvents(this);

		this.registerMarkdownCodeBlockProcessor('tree', async (source, el, ctx) => {
			ctx.addChild(new DiagramRenderer(this, source, el, ctx));
		});

		this.registerMarkdownCodeBlockProcessor('timeline-narrative', async (source, el, ctx) => {
			ctx.addChild(new TimelineNarrativeRenderer(this.app, source, el, ctx));
		});

		this.registerMarkdownCodeBlockProcessor('timeline-tree', async (source, el, ctx) => {
			ctx.addChild(new TimelineNarrativeRenderer(this.app, source, el, ctx));
		});

		this.registerEditorSuggest(new TimelineNarrativeEditorSuggest(this.app));

		registerTreeCommands(this);

		// 6. Initialize SQLSeal & Database Explorer
		try {
			const container = (mainModule as any).build({
				'obsidian.app': (d: { value: (v: unknown) => unknown }) => d.value(this.app),
				'obsidian.plugin': (d: { value: (v: unknown) => unknown }) => d.value(this),
				'obsidian.vault': (d: { value: (v: unknown) => unknown }) => d.value(this.app.vault)
			});

			const init = await container.get('init');
			init();

			this.sqlsealTabInstance = await container.get('settings.settingsTab');
		} catch (err) {
			console.error('[PakCLI Table] Failed to initialize SQLSeal:', err);
		}

		// Register CSV View
		this.registerView(CSV_VIEW_TYPE, (leaf) => new CsvView(leaf, this));
		this.registerExtensions(['csv'], CSV_VIEW_TYPE);

		// 7. Initialize Leaflet Mapping Engine
		try {
			this.leafletPlugin = new BasesLeafletViewPlugin(this.app, this.manifest);
			await this.leafletPlugin.onload();
			if (this.leafletPlugin.settingsManager) {
				this.leafletTabInstance = new BasesLeafletViewSettingsTab(this.leafletPlugin, this.leafletPlugin.settingsManager);
			}
		} catch (err) {
			console.error('[PakCLI Table] Failed to initialize Leaflet:', err);
		}

		// 8. Initialize ASCII Draw & Motion Studio
		registerAsciiDrawFeature(this);

		// 9. Initialize Graph Topology & Bubble View (Spec v18)
		this.registerView(BUBBLE_GRAPH_VIEW_TYPE, (leaf) => new BubbleGraphView(leaf, this));
		this.registerView(IMAGE_CAROUSEL_VIEW_TYPE, (leaf) => new ImageCarouselView(leaf));

		this.addCommand({
			id: 'open-bubble-graph',
			name: 'Open Bubble Graph View (Spec v18)',
			callback: () => {
				this.openBubbleGraphView();
			}
		});

		this.addCommand({
			id: 'reset-bubble-graph-settings',
			name: 'Reset Bubble Graph View Settings to Default',
			callback: async () => {
				const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
				for (const leaf of leaves) {
					if (leaf.view instanceof BubbleGraphView) {
						await leaf.view.resetViewSettings();
					}
				}
				if (leaves.length === 0) {
					this.settings.bubbleMaxDragDepth = 2;
					this.settings.bubbleShowLines = true;
					this.settings.bubbleShowLabels = true;
					this.settings.bubbleUseCaptainColors = false;
					this.settings.bubbleLabelRangeLevel = 2;
					this.settings.bubbleLabelMinLevel = 1;
					this.settings.bubbleLabelMaxLevel = 2;
					this.settings.bubbleLabelFontSize = 11;
					this.settings.bubbleInspectorOpen = true;
					this.settings.bubbleHeaderSettingsOpen = true;
					this.settings.bubbleFooterOpen = true;
					await this.saveSettings();
					new Notice('Bubble View settings reset to default');
				}
			}
		});

		// Settings Tab Navigation Commands
		this.addCommand({
			id: 'open-asset-router-settings',
			name: 'Open Settings: Asset Router & Attachments',
			callback: () => {
				this.openSettingsTab('table-asset-router');
			}
		});

		this.addCommand({
			id: 'open-codeblock-settings',
			name: 'Open Settings: Codeblock Scaler & Themes',
			callback: () => {
				this.openSettingsTab('table-codeblock');
			}
		});

		this.addCommand({
			id: 'open-ascii-settings',
			name: 'Open Settings: ASCII Motion & Canvas Studio',
			callback: () => {
				this.openSettingsTab('table-ascii');
			}
		});

		this.addCommand({
			id: 'open-tree-settings',
			name: 'Open Settings: Tree Hierarchy Explorer',
			callback: () => {
				this.openSettingsTab('table-tree');
			}
		});

		this.addCommand({
			id: 'open-csv-settings',
			name: 'Open Settings: CSV & Tablite Editor',
			callback: () => {
				this.openSettingsTab('table-csv');
			}
		});

		this.addCommand({
			id: 'open-explorer-settings',
			name: 'Open Settings: Explorer Additions & Split View',
			callback: () => {
				this.openSettingsTab('table-explorer');
			}
		});

		this.addCommand({
			id: 'toggle-explorer-split-view',
			name: 'Toggle File Explorer Split View (Recent Files)',
			callback: async () => {
				this.settings.explorerSplitEnabled = !this.settings.explorerSplitEnabled;
				await this.saveSettings();
				if (this.splitViewManager) {
					this.splitViewManager.applyLayout();
				}
				new Notice(`Explorer Split View: ${this.settings.explorerSplitEnabled ? 'Enabled' : 'Disabled'}`);
			}
		});

		this.addCommand({
			id: 'debug-codeblocks',
			name: 'Debug Codeblocks: Inspect Styling & Language Rules',
			callback: () => {
				this.codeblockScaler.rescaleAll();
				const report = this.codeblockScaler.debugInspect();
				new Notice(
					`[PakCLI Codeblock Debug]\nDefault: ${this.settings.codeblockWrapMode || 'flowclip'}\nRules: ${this.settings.codeblockLanguageRules?.length || 0}\nFound: ${report.codeblocksFound} <pre>, ${report.cmLinesFound} lines.\nSee DevTools Console (Ctrl+Shift+I) for full table!`,
					7000
				);
			}
		});

		// A–Z Dictionary Navigator Ribbon Icon & Command
		this.addRibbonIcon('book-marked', 'Open A–Z Dictionary Navigator (Popup)', () => {
			new DictionaryPopupModal(this).open();
		});

		this.addCommand({
			id: 'open-az-dictionary-navigator',
			name: 'Open A–Z Dictionary Navigator',
			callback: () => {
				new DictionaryPopupModal(this).open();
			},
		});

		this.addRibbonIcon('git-fork', 'Create New Timeline Narrative Note', async () => {
			const sample = [
				'# Timeline Narrative Decision Tree',
				'',
				'```timeline-narrative',
				'_2027-03-01_09-40_ Mission Start',
				'\tTalk to Captain',
				'\t\tSearch for Clues',
				'\t\t\tConfront Deviant Outside',
				'\t\t\t\tNegotiate',
				'\t\t\t\t\tBe Honest > Deviant Jumps (honesty risks trust)',
				'\t\t\t\t\tBuild Trust > Deviant Jumps',
				'\t\t\t\t\t[[Use Gun Ending]]',
				'\t\t\t\t\t[[Sacrifice Self Ending]] (no return from here)',
				'',
				'Deviant Jumps',
				'\t[[Connor Leapt and Fell]]',
				'\t[[Snipers Shot Deviant]]',
				'```',
				''
			].join('\n');
			let path = 'Timeline Narrative Demo.md';
			let count = 1;
			while (this.app.vault.getAbstractFileByPath(path)) {
				path = `Timeline Narrative Demo ${count++}.md`;
			}
			const file = await this.app.vault.create(path, sample);
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			new Notice('Created and opened Timeline Narrative note!');
		});

		this.addCommand({
			id: 'insert-timeline-narrative-template',
			name: 'Insert Timeline Narrative Decision Tree (Detroit Style)',
			editorCallback: (editor) => {
				const sample = [
					'```timeline-narrative',
					'_2027-03-01_09-40_ Mission Start',
					'\tTalk to Captain',
					'\t\tSearch for Clues',
					'\t\t\tConfront Deviant Outside',
					'\t\t\t\tNegotiate',
					'\t\t\t\t\tBe Honest > Deviant Jumps (honesty risks trust)',
					'\t\t\t\t\tBuild Trust > Deviant Jumps',
					'\t\t\t\t\t[[Use Gun Ending]]',
					'\t\t\t\t\t[[Sacrifice Self Ending]] (no return from here)',
					'',
					'Deviant Jumps',
					'\t[[Connor Leapt and Fell]]',
					'\t[[Snipers Shot Deviant]]',
					'```',
					''
				].join('\n');
				editor.replaceSelection(sample);
			}
		});

		this.addCommand({
			id: 'create-timeline-narrative-note',
			name: 'Create New Timeline Narrative Note (Detroit Style)',
			callback: async () => {
				const sample = [
					'# Timeline Narrative Decision Tree',
					'',
					'```timeline-narrative',
					'_2027-03-01_09-40_ Mission Start',
					'\tTalk to Captain',
					'\t\tSearch for Clues',
					'\t\t\tConfront Deviant Outside',
					'\t\t\t\tNegotiate',
					'\t\t\t\t\tBe Honest > Deviant Jumps (honesty risks trust)',
					'\t\t\t\t\tBuild Trust > Deviant Jumps',
					'\t\t\t\t\t[[Use Gun Ending]]',
					'\t\t\t\t\t[[Sacrifice Self Ending]] (no return from here)',
					'',
					'Deviant Jumps',
					'\t[[Connor Leapt and Fell]]',
					'\t[[Snipers Shot Deviant]]',
					'```',
					''
				].join('\n');
				let path = 'Timeline Narrative Demo.md';
				let count = 1;
				while (this.app.vault.getAbstractFileByPath(path)) {
					path = `Timeline Narrative Demo ${count++}.md`;
				}
				const file = await this.app.vault.create(path, sample);
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(file);
				new Notice('Created and opened Timeline Narrative note!');
			}
		});

		this.addCommand({
			id: 'reorganize-relationship-files-disk',
			name: 'Reorganize Relationship Notes on Disk (Physical Switcher)',
			callback: () => {
				const target = this.settings.relationshipMode === 'subfolders' ? '1dir' : 'subfolders';
				new RelationshipReorganizeModal(this.app, this, target).open();
			}
		});

		this.addCommand({
			id: 'assign-relationship-notes',
			name: 'Assign Relationship (Auto-Detect Closeness Score)',
			callback: () => {
				new AssignRelationshipModal(this.app, this).open();
			}
		});

		this.updateBubbleRibbon();

		// Initialize Explorer Additions & Split View Manager
		this.splitViewManager = new SplitViewManager(this);
		this.splitViewManager.init();

		// Initialize Relationship Virtual Explorer Manager
		this.relationshipExplorerManager = new RelationshipExplorerManager(this);
		this.relationshipExplorerManager.init();

		// Initialize Dictionary Virtual Explorer Manager
		this.dictionaryExplorerManager = new DictionaryExplorerManager(this);
		this.dictionaryExplorerManager.init();

		// Replace Vanilla GraphView listener if enabled
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				if (this.settings.bubbleGraphMode === 'replace') {
					const graphLeaves = this.app.workspace.getLeavesOfType('graph');
					for (const leaf of graphLeaves) {
						leaf.setViewState({
							type: BUBBLE_GRAPH_VIEW_TYPE,
							active: true
						});
					}
				}
			})
		);

		// Synchronize CSV view artifact file on CSV file rename
		this.registerEvent(
			this.app.vault.on('rename', async (file, oldPath) => {
				if (file instanceof TFile && file.extension?.toLowerCase() === 'csv') {
					await handleArtifactRename(this.app, oldPath, file.path, this.settings.csvArtifactFolderPath);
				}
			})
		);

		// Helper to open Image Carousel & Folder Triage as a workspace tab page
		const openImageCarouselTab = async (folder: TFolder, mode: 'view' | 'edit') => {
			const orientation = this.settings.carouselOrientation || 'horizontal';
			const rawSide = this.settings.carouselVisibleSideCards;
			const sideCards = typeof rawSide === 'number' ? rawSide : parseInt(String(rawSide || '5'), 10);
			const safeSide = isNaN(sideCards) ? 5 : sideCards;
			const direction = this.settings.carouselDirection || 'left-right';
			const curve = this.settings.carouselAnimationCurve || 'exponential';
			const rawSwitch = this.settings.carouselSwitchDuration;
			const switchDuration = typeof rawSwitch === 'number' ? rawSwitch : parseFloat(String(rawSwitch ?? '0.5'));
			const rawHold = this.settings.carouselHoldDuration;
			const holdDuration = typeof rawHold === 'number' ? rawHold : parseFloat(String(rawHold ?? '1.0'));
			const autoPlay = this.settings.carouselAutoPlay !== false;

			const existingLeaf = this.app.workspace.getLeavesOfType(IMAGE_CAROUSEL_VIEW_TYPE).find((l) => {
				const state = l.getViewState().state;
				return state && state.folderPath === folder.path;
			});

			if (existingLeaf) {
				await existingLeaf.setViewState({
					type: IMAGE_CAROUSEL_VIEW_TYPE,
					active: true,
					state: {
						folderPath: folder.path,
						mode,
						orientation,
						sideCards: safeSide,
						direction,
						curve,
						switchDuration: isNaN(switchDuration) ? 0.5 : switchDuration,
						holdDuration: isNaN(holdDuration) ? 1.0 : holdDuration,
						autoPlay,
					},
				});
				this.app.workspace.revealLeaf(existingLeaf);
				return;
			}

			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.setViewState({
				type: IMAGE_CAROUSEL_VIEW_TYPE,
				active: true,
				state: {
					folderPath: folder.path,
					mode,
					orientation,
					sideCards: safeSide,
					direction,
					curve,
					switchDuration: isNaN(switchDuration) ? 0.5 : switchDuration,
					holdDuration: isNaN(holdDuration) ? 1.0 : holdDuration,
					autoPlay,
				},
			});
			this.app.workspace.revealLeaf(leaf);
		};

		(this as any).openImageCarouselTab = openImageCarouselTab;

		// Context menu for files and folders
		const addFolderMenuItems = (menu: any, folder: TFolder) => {
			if (menu.__pakcli_folder_menu_added) return;
			menu.__pakcli_folder_menu_added = true;

			const isFiltered = (this.settings.customRecentPaths || []).includes(folder.path);

			menu.addItem((item: any) => {
				item.setTitle('Scope Folder Image View')
					.setIcon('image')
					.onClick(() => {
						openImageCarouselTab(folder, 'view');
					});
			});

			menu.addItem((item: any) => {
				item.setTitle('Scope Folder Image Edit')
					.setIcon('gallery-thumbnails')
					.onClick(() => {
						openImageCarouselTab(folder, 'edit');
					});
			});

			menu.addItem((item: any) => {
				item.setTitle(isFiltered ? 'Remove from Recent Dropdown' : 'Add to Recent Dropdown')
					.setIcon(isFiltered ? 'minus-circle' : 'plus-circle')
					.onClick(() => {
						if (isFiltered) {
							this.splitViewManager?.removeFolderFromRecentFilter(folder.path);
						} else {
							this.splitViewManager?.addFolderToRecentFilter(folder.path, false);
						}
					});
			});

			menu.addItem((item: any) => {
				item.setTitle('Add to Recent Dropdown & Activate')
					.setIcon('filter')
					.onClick(() => {
						this.splitViewManager?.addFolderToRecentFilter(folder.path, true);
					});
			});

			menu.addItem((item: any) => {
				item.setTitle('Select / Filter Recent by this Folder')
					.setIcon('folder')
					.onClick(async () => {
						this.settings.activeRecentFolderFilter = folder.path;
						await this.saveSettings();
						this.splitViewManager?.updateDropdownOptions();
						this.splitViewManager?.renderRecentList();
					});
			});

			menu.addItem((item: any) => {
				item.setTitle('Move Folder to Backlog')
					.setIcon('archive')
					.onClick(() => {
						this.splitViewManager?.moveToBacklog(folder, false);
					});
			});

			menu.addItem((item: any) => {
				item.setTitle('Move Folder to Backlog (Rename YYYY-MM-DD_HH-mm)')
					.setIcon('clock')
					.onClick(() => {
						this.splitViewManager?.moveToBacklog(folder, true);
					});
			});

			menu.addItem((item: any) => {
				item.setTitle('Scope Bubble View to this folder')
					.setIcon('circle-dot')
					.onClick(async () => {
						await this.openBubbleGraphView(folder.path);
					});
			});
		};

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item.setTitle('Scope Bubble View to parent folder')
							.setIcon('circle-dot')
							.onClick(async () => {
								const parentFolder = file.parent && file.parent.path !== '/' ? file.parent.path : '';
								await this.openBubbleGraphView(parentFolder);
							});
					});
					menu.addItem((item) => {
						item.setTitle('Move to Backlog')
							.setIcon('archive')
							.onClick(() => {
								this.splitViewManager?.moveToBacklog(file, false);
							});
					});
					menu.addItem((item) => {
						item.setTitle('Move to Backlog (Rename YYYY-MM-DD_HH-mm)')
							.setIcon('clock')
							.onClick(() => {
								this.splitViewManager?.moveToBacklog(file, true);
							});
					});
				} else if (file instanceof TFolder) {
					addFolderMenuItems(menu, file);
				}
			})
		);

		this.registerEvent(
			(this.app.workspace as any).on('folder-menu', (menu: any, folder: any) => {
				if (folder instanceof TFolder) {
					addFolderMenuItems(menu, folder);
				}
			})
		);

		// 10. Register Master-Detail Settings Tab
		this.registerSettingsHub();
	}

	async onunload() {
		// 1. Remove ribbon icon if present
		if (this.bubbleRibbonEl) {
			this.bubbleRibbonEl.remove();
			this.bubbleRibbonEl = null;
		}

		// 2. Persistent Snapshot on App Close / Unload
		try {
			await saveVaultConfig(this.app, 'pakcli-panel', this.settings, 'session-close');
		} catch {
			// Vault config save failure ignored on unload
		}
		if (this.leafletPlugin) {
			this.leafletPlugin.onunload();
		}
		if (this.splitViewManager) {
			this.splitViewManager.destroy();
		}
		if (this.relationshipExplorerManager) {
			this.relationshipExplorerManager.destroy();
		}
		if (this.dictionaryExplorerManager) {
			this.dictionaryExplorerManager.destroy();
		}
		eventBus.emit('table:unloaded', { version: this.manifest.version });
	}

	async loadSettings() {
		const stored = await this.loadData();
		const fallback = await loadVaultConfig(this.app, 'pakcli-panel');
		this.settings = Object.assign({}, DEFAULT_TABLE_SETTINGS, fallback, stored);

		// Auto-migrate relationship tiers if outdated (e.g. still has 'enemy' instead of 'unsure' and 'bad')
		if (this.settings.relationshipTiers && this.settings.relationshipTiers.length > 0) {
			const hasEnemy = this.settings.relationshipTiers.some(t => t.id === 'enemy');
			const hasUnsure = this.settings.relationshipTiers.some(t => t.id === 'unsure');
			const hasBad = this.settings.relationshipTiers.some(t => t.id === 'bad');
			if (hasEnemy || !hasUnsure || !hasBad) {
				this.settings.relationshipTiers = this.settings.relationshipTiers.filter(t => t.id !== 'enemy');
				if (!this.settings.relationshipTiers.some(t => t.id === 'unsure')) {
					this.settings.relationshipTiers.push({ id: 'unsure', name: 'Unsure', min: 0.00, max: 0.00, color: '#94a3b8', folderName: '6 - Unsure' });
				}
				if (!this.settings.relationshipTiers.some(t => t.id === 'bad')) {
					this.settings.relationshipTiers.push({ id: 'bad', name: 'Bad', min: -1.00, max: -0.01, color: '#ef4444', folderName: '7 - Bad' });
				}
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await saveVaultConfig(this.app, 'pakcli-panel', this.settings);
	}

	applyCodeblockStyle() {
		const mode = this.settings.codeblockWrapMode || 'flowclip';
		document.body.classList.remove(
			'pakcli-flowclip', 'pakcli-wrap', 'pakcli-scalefit',
			'codeblock-flowclip', 'codeblock-wrap', 'codeblock-scalefit'
		);
		document.body.classList.add(`pakcli-${mode}`, `codeblock-${mode}`);
	}

	getFileColumnConfig(filePath: string, columnCount: number): ColumnConfig {
		const fileConfigs = (this.settings.fileConfigs as Record<string, ColumnConfig>) || {};
		const saved = fileConfigs[filePath];
		if (saved && !Array.isArray(saved)) {
			return normalizeColumnConfig(saved, columnCount);
		}
		return createDefaultColumnConfig(columnCount);
	}

	async setFileColumnConfig(filePath: string, nextColumnCount: number, config: ColumnConfig): Promise<void> {
		if (!this.settings.fileConfigs) {
			this.settings.fileConfigs = {};
		}
		(this.settings.fileConfigs as Record<string, ColumnConfig>)[filePath] = config;
		await this.saveSettings();
	}

	private registerSettingsHub() {
		const settingsTab = new MasterDetailSettingsTab(this.app, this);
		this.settingsTabInstance = settingsTab;

		// 0. Bubble Graph & Venn Topology Handler (table-bubble-graph)
		settingsTab.registerLocalSection({
			id: 'table-bubble-graph',
			category: 'table',
			title: 'Graph Topology & Bubble View',
			icon: 'circle-dot',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Graph Topology & Bubble View (Spec v18)')
					.setDesc('Organized Venn-like cluster topology, organic contour hulls, smart 3-tier link hierarchy, and interactive graph inspector.')
					.setHeading();

				// Quick launch button
				new Setting(containerEl)
					.setName('Launch Bubble Graph View')
					.setDesc('Open the full-screen interactive Bubble Graph workspace.')
					.addButton((b) => {
						b.setButtonText('Open Bubble Graph ↗')
							.setCta()
							.onClick(() => {
								this.openBubbleGraphView();
							});
					});

				// Reset view settings button
				new Setting(containerEl)
					.setName('Reset Bubble View Controls')
					.setDesc('Reset all toolbar controls (drag depth, lines, labels, captain colors, text level, font size) to their defaults.')
					.addButton((b) => {
						b.setButtonText('Reset to Defaults')
							.setWarning()
							.onClick(async () => {
								this.settings.bubbleMaxDragDepth = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleMaxDragDepth;
								this.settings.bubbleShowLines = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleShowLines;
								this.settings.bubbleShowLabels = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleShowLabels;
								this.settings.bubbleUseCaptainColors = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleUseCaptainColors;
								this.settings.bubbleLabelRangeLevel = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelRangeLevel;
								this.settings.bubbleLabelMinLevel = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelMinLevel;
								this.settings.bubbleLabelMaxLevel = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelMaxLevel;
								this.settings.bubbleLabelFontSize = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleLabelFontSize;
								this.settings.bubbleInspectorOpen = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleInspectorOpen;
								this.settings.bubbleHeaderSettingsOpen = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleHeaderSettingsOpen;
								this.settings.bubbleFloatingToolsOpen = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleFloatingToolsOpen;
								this.settings.bubbleFooterOpen = DEFAULT_BUBBLE_GRAPH_SETTINGS.bubbleFooterOpen;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								for (const leaf of leaves) {
									if (leaf.view instanceof BubbleGraphView) {
										await leaf.view.resetViewSettings();
									}
								}
								new Notice('Bubble View controls reset to default');
							});
					});

				// Integration Mode Radio Cards (DEACTIVATE, REPLACE, SECOND)
				new Setting(containerEl)
					.setName('Bubble Graph Integration Mode')
					.setDesc('Choose how Bubble Graph View is integrated into your Obsidian workspace.')
					.setHeading();

				const radioContainer = containerEl.createDiv({ cls: 'pakcli-radio-cards-container' });

				const modes: Array<{
					id: 'deactivate' | 'replace' | 'second';
					title: string;
					desc: string;
				}> = [
						{
							id: 'deactivate',
							title: 'Deactivate',
							desc: 'Bubble Graph feature is completely disabled. No ribbon icons or view overrides.'
						},
						{
							id: 'replace',
							title: 'Replace Vanilla GraphView',
							desc: 'Automatically route and replace Obsidian standard graph view with Bubble Graph.'
						},
						{
							id: 'second',
							title: 'Add New as Second GraphView',
							desc: 'Keep vanilla graph intact and add a dedicated icon to the Obsidian ribbon bar.'
						}
					];

				const ribbonSettingContainer = containerEl.createDiv({ cls: 'pakcli-ribbon-setting-wrap' });

				const updateRibbonDropdownVisibility = () => {
					ribbonSettingContainer.empty();
					if (this.settings.bubbleGraphMode === 'second') {
						new Setting(ribbonSettingContainer)
							.setName('Ribbon Bar Icon')
							.setDesc('Choose which icon represents the Bubble Graph in the Obsidian ribbon.')
							.addDropdown((d) => {
								d.addOption('circle-dot', 'Circle Dot (Bubble Dot)')
									.addOption('bubbles', 'Bubbles (Cluster Bubbles)')
									.addOption('dot-network', 'Dot Network (Network Mesh)')
									.addOption('git-fork', 'Git Fork (Branching Fork)')
									.addOption('network', 'Network (Network Web)')
									.addOption('sparkles', 'Sparkles (Magic Glow)')
									.addOption('share-2', 'Share 2 (Connected Nodes)')
									.addOption('boxes', 'Boxes (Clustered Cells)')
									.addOption('compass', 'Compass (Atlas Compass)')
									.addOption('orbit', 'Orbit (Planetary Orbits)')
									.setValue(this.settings.bubbleRibbonIcon || 'circle-dot')
									.onChange(async (v) => {
										this.settings.bubbleRibbonIcon = v;
										await this.saveSettings();
										this.updateBubbleRibbon();
									});
							});
					}
				};

				const renderRadioCards = () => {
					radioContainer.empty();
					modes.forEach((m) => {
						const isSelected = (this.settings.bubbleGraphMode || 'second') === m.id;
						const card = radioContainer.createDiv({
							cls: `pakcli-radio-card ${isSelected ? 'is-selected' : ''}`
						});

						const cardHeader = card.createDiv({ cls: 'pakcli-radio-card-header' });
						cardHeader.createSpan({ cls: 'pakcli-radio-circle' });
						cardHeader.createSpan({ text: m.title, cls: 'pakcli-radio-card-title' });

						card.createDiv({ text: m.desc, cls: 'pakcli-radio-card-desc' });

						card.onclick = async () => {
							this.settings.bubbleGraphMode = m.id;
							await this.saveSettings();
							this.updateBubbleRibbon();
							renderRadioCards();
							updateRibbonDropdownVisibility();
						};
					});
				};

				renderRadioCards();
				updateRibbonDropdownVisibility();

				new Setting(containerEl)
					.setName('Topology & Physics Controls')
					.setHeading();

				new Setting(containerEl)
					.setName('Max Drag Depth Limit')
					.setDesc('Configure how dragging interacts with hierarchy (0 = Lock all, 1 = Folder only, 2 = Subfolder, 3 = Child node).')
					.addDropdown((d) => {
						d.addOption('0', '0: Lock all positions (Pure physics)')
							.addOption('1', '1: Folder only (Move parent cluster)')
							.addOption('2', '2: Subfolder (Default: Contained items)')
							.addOption('3', '3: Child (Deep note dragging)')
							.setValue(String(this.settings.bubbleMaxDragDepth ?? 2))
							.onChange(async (v) => {
								this.settings.bubbleMaxDragDepth = parseInt(v, 10);
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Default Layout Mode')
					.setDesc('Default layout view when opening graph.')
					.addDropdown((d) => {
						d.addOption('bubble', 'Venn-Cluster Bubble Topology')
							.addOption('default', 'Standard Force-Directed Graph')
							.setValue(this.settings.bubbleDefaultLayout || 'bubble')
							.onChange(async (v: string) => {
								this.settings.bubbleDefaultLayout = v as 'bubble' | 'default';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Show Inter-Folder Venn Bridges')
					.setDesc('Render high-contrast glowing neon bridge lines for links connecting different top-level folders.')
					.addToggle((t) => {
						t.setValue(this.settings.bubbleShowVennBridges !== false)
							.onChange(async (v) => {
								this.settings.bubbleShowVennBridges = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Captain Folder Colors')
					.setDesc('When enabled, Captain Folders with a custom color set will highlight their bubbles in the Graph Topology. All other folders remain dark gray.')
					.addToggle((t) => {
						t.setValue(this.settings.bubbleUseCaptainColors === true)
							.onChange(async (v) => {
								this.settings.bubbleUseCaptainColors = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Relationship All Scope State (Concentric Rings in All Scopes)')
					.setDesc('When disabled (default), concentric relationship rings (Friends ➔ Household, Unsure, Bad) are only displayed when the Bubble Graph is scoped to the virtual relationship folder. When enabled, concentric rings are displayed in all scope states, including the vault root All Notes scope.')
					.addToggle((t) => {
						t.setValue(this.settings.bubbleRelationshipAllScopeState === true)
							.onChange(async (v) => {
								this.settings.bubbleRelationshipAllScopeState = v;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.reloadGraphData();
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Max Bubble Depth')
					.setDesc('Maximum folder hierarchy nesting depth for bubbles (1 to 5). 1 = top folders only, up to 5 levels for deep folder structures.')
					.addSlider((s) => {
						s.setLimits(1, 5, 1)
							.setValue(this.settings.bubbleMaxClusterDepth ?? 3)
							.setDynamicTooltip()
							.onChange(async (v) => {
								this.settings.bubbleMaxClusterDepth = v;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.reloadGraphData();
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Dense Bubble Size Scale')
					.setDesc('Scale multiplier for crowded/dense bubbles (with 4+ notes or hub nodes) to provide comfortable breathing room. Range: 0.01 (ultra-compact) to 10.0 (wide expansive breathing room). Default: 1.15.')
					.addSlider((s) => {
						s.setLimits(0.01, 10.0, 0.01)
							.setValue(this.settings.bubbleDenseScale ?? 1.15)
							.setDynamicTooltip()
							.onChange(async (v) => {
								this.settings.bubbleDenseScale = v;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.setDenseScale(v, false);
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Show Scoped Breadcrumbs Bar')
					.setDesc('Display the interactive breadcrumb navigation bar and Out button in the Bubble Graph header when scoped to a folder.')
					.addToggle((t) => {
						t.setValue(this.settings.bubbleShowBreadcrumbs !== false)
							.onChange(async (v) => {
								this.settings.bubbleShowBreadcrumbs = v;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.reloadGraphData();
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Inter-Folder Link Neon Glow')
					.setDesc('Apply luminous neon glow shader on inter-cluster cross links.')
					.addToggle((t) => {
						t.setValue(this.settings.bubbleInterLinkGlow !== false)
							.onChange(async (v) => {
								this.settings.bubbleInterLinkGlow = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Bubble Contour Hull Opacity')
					.setDesc('Adjust the glassmorphic background intensity for regional folder bubbles.')
					.addSlider((s) => {
						s.setLimits(0.04, 0.35, 0.02)
							.setValue(this.settings.bubbleHullOpacity || 0.12)
							.setDynamicTooltip()
							.onChange(async (v) => {
								this.settings.bubbleHullOpacity = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Timelapse Animation Mode')
					.setDesc('Choose between Date-based time interpolation and Vanilla sequential node spawn.')
					.addDropdown((d) => {
						d.addOption('date', 'Default: Date-based timeline interpolation')
							.addOption('vanilla', 'Vanilla: Sequential spawn (0.025s per node / folder in chronological order)')
							.setValue(this.settings.bubbleTimelapseMode || 'date')
							.onChange(async (v: string) => {
								this.settings.bubbleTimelapseMode = v as 'date' | 'vanilla';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Vanilla Timelapse Spawn Speed')
					.setDesc('Delay in seconds per node/folder in Vanilla sequential mode (Default: 0.025s / 25ms).')
					.addText((t) => {
						t.setValue((this.settings.bubbleTimelapseVanillaSpeed ?? 0.025).toString())
							.setPlaceholder('0.025')
							.onChange(async (v) => {
								const parsed = parseFloat(v);
								if (!isNaN(parsed) && parsed > 0) {
									this.settings.bubbleTimelapseVanillaSpeed = parsed;
									await this.saveSettings();
								}
							});
					});

				new Setting(containerEl)
					.setName('Timeline Date Format')
					.setDesc('Date format for the timelapse handle and date badges in Date mode (e.g. DD - MM - YYYY, YYYY-MM-DD, DD/MM/YYYY).')
					.addText((t) => {
						t.setValue(this.settings.bubbleTimelapseDateFormat || 'DD - MM - YYYY')
							.setPlaceholder('DD - MM - YYYY')
							.onChange(async (v) => {
								this.settings.bubbleTimelapseDateFormat = v.trim() || 'DD - MM - YYYY';
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.updateTimelineUI();
										leaf.view.drawHeatmap();
									}
								});
							});
					});

				// Node Glyph / Symbol Styles Section
				new Setting(containerEl)
					.setName('Node Symbol & Glyph Conditions')
					.setDesc('Customize the visual interior icon of nodes depending on their link state and backlinks.')
					.setHeading();

				new Setting(containerEl)
					.setName('No link & Not mentioned (Isolated)')
					.setDesc('Symbol for orphan notes that have 0 outgoing links and 0 backlinks (Default: No dot).')
					.addDropdown((d) => {
						d.addOption('no-dot', 'No dot (Clean circle)')
							.addOption('dot', 'Dot (•)')
							.addOption('plus', 'Plus (+)')
							.addOption('minus', 'Minus (-)')
							.addOption('i', 'Info (i)')
							.addOption('ring', 'Ring (○)')
							.addOption('star', 'Star (*)')
							.addOption('square', 'Square (▫)')
							.setValue(this.settings.bubbleGlyphIsolated || 'no-dot')
							.onChange(async (v: string) => {
								this.settings.bubbleGlyphIsolated = v as any;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.reloadGraphData();
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Has Wikilink (Outgoing only)')
					.setDesc('Symbol for notes that have outgoing links but are not mentioned anywhere (Default: Plus).')
					.addDropdown((d) => {
						d.addOption('plus', 'Plus (+)')
							.addOption('no-dot', 'No dot (Clean circle)')
							.addOption('dot', 'Dot (•)')
							.addOption('minus', 'Minus (-)')
							.addOption('i', 'Info (i)')
							.addOption('ring', 'Ring (○)')
							.addOption('star', 'Star (*)')
							.addOption('square', 'Square (▫)')
							.setValue(this.settings.bubbleGlyphOutgoing || 'plus')
							.onChange(async (v: string) => {
								this.settings.bubbleGlyphOutgoing = v as any;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.reloadGraphData();
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Mentioned Anywhere (Incoming only)')
					.setDesc('Symbol for notes that have backlinks/mentions from other notes but no outgoing links (Default: Minus).')
					.addDropdown((d) => {
						d.addOption('minus', 'Minus (-)')
							.addOption('no-dot', 'No dot (Clean circle)')
							.addOption('dot', 'Dot (•)')
							.addOption('plus', 'Plus (+)')
							.addOption('i', 'Info (i)')
							.addOption('ring', 'Ring (○)')
							.addOption('star', 'Star (*)')
							.addOption('square', 'Square (▫)')
							.setValue(this.settings.bubbleGlyphIncoming || 'minus')
							.onChange(async (v: string) => {
								this.settings.bubbleGlyphIncoming = v as any;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.reloadGraphData();
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Both Linked & Mentioned (Two-way)')
					.setDesc('Symbol for notes that have outgoing links AND are mentioned by other notes (Default: i).')
					.addDropdown((d) => {
						d.addOption('i', 'Info (i)')
							.addOption('no-dot', 'No dot (Clean circle)')
							.addOption('dot', 'Dot (•)')
							.addOption('plus', 'Plus (+)')
							.addOption('minus', 'Minus (-)')
							.addOption('ring', 'Ring (○)')
							.addOption('star', 'Star (*)')
							.addOption('square', 'Square (▫)')
							.setValue(this.settings.bubbleGlyphBoth || 'i')
							.onChange(async (v: string) => {
								this.settings.bubbleGlyphBoth = v as any;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.reloadGraphData();
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Enable Node Image Cover')
					.setDesc('Override the center symbol of notes with cover images defined in frontmatter (Priority: img > image > img-preview > icon > image-preview). Falls back to the symbol glyph if not found or invalid.')
					.addToggle((t) => {
						t.setValue(this.settings.bubbleEnableNodeImageCover !== false)
							.onChange(async (v) => {
								this.settings.bubbleEnableNodeImageCover = v;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.reloadGraphData();
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Node Image Border Style')
					.setDesc('Border thickness for notes with cover images: no border (clean circle), thin border, or thick border (bold - default).')
					.addDropdown((d) => {
						d.addOption('noborder', 'No border (Clean circle)')
							.addOption('thin', 'Border thin (1px subtle rim)')
							.addOption('thick', 'Border tebel (Bold 2.4px - Default)')
							.setValue(this.settings.bubbleNodeImageBorder || 'thick')
							.onChange(async (v: string) => {
								this.settings.bubbleNodeImageBorder = v as any;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.setNodeImageBorder(v as any);
									}
								});
							});
					});

				// Sound Effects (SFX) Section
				new Setting(containerEl)
					.setName('Procedural Sound Effects (SFX)')
					.setDesc('Tactile audio synthesized via Web Audio API for node spawns, collisions, and folder boundary interactions.')
					.setHeading();

				new Setting(containerEl)
					.setName('Enable Procedural Sound Effects (SFX)')
					.setDesc('Play tactile audio for node spawns, collisions, link connections, and folder interactions.')
					.addToggle((t) => {
						t.setValue(this.settings.bubbleEnableSfx !== false)
							.onChange(async (v) => {
								this.settings.bubbleEnableSfx = v;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.setSfxEnabled(v);
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Sound FX Master Volume')
					.setDesc('Adjust the master volume of procedural audio effects (0% = mute, 100% = full volume).')
					.addSlider((s) => {
						s.setLimits(0, 100, 5)
							.setValue(Math.round((this.settings.bubbleSfxVolume ?? 0.35) * 100))
							.setDynamicTooltip()
							.onChange(async (v) => {
								this.settings.bubbleSfxVolume = v / 100;
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.setSfxVolume(v / 100);
									}
								});
							});
					});

				new Setting(containerEl)
					.setName('Sound FX Movement Threshold')
					.setDesc('Minimum relative velocity required to trigger collision sounds (in px/frame). Increase to keep dense vaults or resting nodes completely silent until deliberate movement occurs.')
					.addSlider((s) => {
						s.setLimits(0.2, 3.0, 0.1)
							.setValue(this.settings.bubbleSfxThreshold ?? 1.0)
							.setDynamicTooltip()
							.onChange(async (v) => {
								this.settings.bubbleSfxThreshold = Number(v.toFixed(1));
								await this.saveSettings();
								const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
								leaves.forEach((leaf) => {
									if (leaf.view instanceof BubbleGraphView) {
										leaf.view.setSfxThreshold(Number(v.toFixed(1)));
									}
								});
							});
					});
			}
		});

		// 0.5. Relationship Handler (table-relationship)
		settingsTab.registerLocalSection({
			id: 'table-relationship',
			category: 'table',
			title: 'Relationship',
			icon: 'users',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Relationship (Concentric Radar & Closeness Tiers)')
					.setDesc('Map personal relationships, family, and friend circles into interactive nested concentric bubbles with customizable closeness tiers, multi-handle visual slider, and batch mode switcher.')
					.setHeading();

				// Ensure settings defaults
				if (!this.settings.familyCirclesRootFolder) {
					this.settings.familyCirclesRootFolder = 'Relationships';
				}
				if (!this.settings.relationshipMode) {
					this.settings.relationshipMode = '1dir';
				}
				if (!this.settings.relationshipPropertyKey) {
					this.settings.relationshipPropertyKey = 'closeness';
				}
				if (!this.settings.relationshipTiers || this.settings.relationshipTiers.length === 0) {
					this.settings.relationshipTiers = JSON.parse(JSON.stringify(DEFAULT_RELATIONSHIP_TIERS));
				}

				// 4 Possibility Matrix Callout Box
				const matrixBox = containerEl.createDiv({ cls: 'pakcli-matrix-callout' });
				matrixBox.style.cssText = 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px 16px; margin: 12px 0 16px 0; font-size: 12px;';
				matrixBox.innerHTML = `
					<div style="font-weight: 600; margin-bottom: 6px; color: var(--text-normal); display: flex; align-items: center; gap: 6px;">
						<span>💡 4 Relationship Organization Modes (2 Independent Toggles):</span>
					</div>
					<div style="color: var(--text-muted); line-height: 1.5;">
						<b>1. Raw 1 Folder (Default)</b>: Flat notes on disk, normal flat folder in File Explorer.<br>
						<b>2. Raw 1 Folder + Virtual Folders</b>: Flat notes on disk, dynamically categorized into <span class="pakcli-virtual-badge">🔮 Virtual</span> folders in File Explorer.<br>
						<b>3. Physical Subfolders</b>: Actual folders on disk (<code>1 - Household/</code>, <code>2 - Family/</code>), native File Explorer display.<br>
						<b>4. Physical Subfolders + Virtual Folders</b>: Notes organized on disk and also presented via dynamic virtual closeness folders.
					</div>
				`;

				// Toggle 1: Explorer Relationship Virtual Folders
				new Setting(containerEl)
					.setName('Explorer Relationship Virtual Folders')
					.setDesc('Group notes inside the relationship folder into virtual closeness folders in Obsidian\'s File Explorer (with [🔮 Virtual] badge). Non-destructive, does not modify actual files on disk. (Default: Disabled)')
					.addToggle((toggle) => {
						toggle.setValue(this.settings.explorerRelationshipVirtualFolders === true)
							.onChange(async (val) => {
								this.settings.explorerRelationshipVirtualFolders = val;
								await this.saveSettings();
								if (this.relationshipExplorerManager) {
									this.relationshipExplorerManager.refreshVirtualFolders();
								}
								new Notice(val ? '🔮 Explorer virtual folders enabled!' : 'Explorer virtual folders disabled.');
							});
					});

				// Toggle 2: Physical Subfolders Mode (Raw Files on Disk) with Confirmation Brief Modal
				let subfoldersToggleRef: any = null;
				new Setting(containerEl)
					.setName('Physical Subfolders Mode (Raw Files on Disk)')
					.setDesc('Reorganize actual note files on disk into physical tier subdirectories (e.g. 1 - Household, 2 - Family). Opens confirmation modal with brief before moving any files. (Default: Disabled / 1 Directory)')
					.addToggle((toggle) => {
						subfoldersToggleRef = toggle;
						toggle.setValue(this.settings.relationshipMode === 'subfolders')
							.onChange(async (val) => {
								const targetMode = val ? 'subfolders' : '1dir';
								const modal = new RelationshipReorganizeModal(
									this.app,
									this,
									targetMode,
									async () => {
										toggle.setValue(this.settings.relationshipMode === 'subfolders');
										renderFullSection();
										if (this.relationshipExplorerManager) {
											this.relationshipExplorerManager.refreshVirtualFolders();
										}
									},
									() => {
										// On cancel, revert toggle back to previous state
										toggle.setValue(this.settings.relationshipMode === 'subfolders');
									}
								);
								modal.open();
							});
					});

				// Manual Switcher Button
				new Setting(containerEl)
					.setName('Physical Storage Switcher')
					.setDesc('Scan and reorganize relationship files on disk into their matching tier subdirectories (or consolidate to 1 directory). Shows preview brief before moving files.')
					.addButton((btn) => {
						btn.setButtonText('📁 Reorganize Files on Disk (Physical Switcher)...')
							.setCta()
							.onClick(() => {
								const targetMode = this.settings.relationshipMode === 'subfolders' ? '1dir' : 'subfolders';
								const modal = new RelationshipReorganizeModal(
									this.app,
									this,
									targetMode,
									async () => {
										if (subfoldersToggleRef) {
											subfoldersToggleRef.setValue(this.settings.relationshipMode === 'subfolders');
										}
										renderFullSection();
										if (this.relationshipExplorerManager) {
											this.relationshipExplorerManager.refreshVirtualFolders();
										}
									},
									() => {
										if (subfoldersToggleRef) {
											subfoldersToggleRef.setValue(this.settings.relationshipMode === 'subfolders');
										}
									}
								);
								modal.open();
							});
					});

				let rootFolderVal = (this.settings.familyCirclesRootFolder || 'Relationships').trim() || 'Relationships';

				new Setting(containerEl)
					.setName('Root Folder Name')
					.setDesc('Base folder name in your vault where relationship notes are stored (e.g. Relationships or People).')
					.addText((text) => {
						text.setPlaceholder('Relationships')
							.setValue(rootFolderVal)
							.onChange(async (val) => {
								rootFolderVal = val.trim() || 'Relationships';
								this.settings.familyCirclesRootFolder = rootFolderVal;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Frontmatter Property Key')
					.setDesc('Property name in note frontmatter used for the closeness score (0.00 to 1.00). Default is "closeness".')
					.addText((text) => {
						text.setPlaceholder('closeness')
							.setValue(this.settings.relationshipPropertyKey || 'closeness')
							.onChange(async (val) => {
								this.settings.relationshipPropertyKey = val.trim() || 'closeness';
								await this.saveSettings();
							});
					});

				// Virtual Folder Styling Toggles (dot, color text, line)
				new Setting(containerEl)
					.setName('Show Tier Dot 🟠')
					.setDesc('Display a colored indicator dot next to virtual folder names in File Explorer (Default: Off).')
					.addToggle((toggle) => {
						toggle.setValue(this.settings.explorerVirtualFolderShowDot === true)
							.onChange(async (val) => {
								this.settings.explorerVirtualFolderShowDot = val;
								await this.saveSettings();
								if (this.relationshipExplorerManager) {
									this.relationshipExplorerManager.refreshVirtualFolders();
								}
							});
					});

				new Setting(containerEl)
					.setName('Color Folder Name Text')
					.setDesc('Color virtual folder name text with its corresponding relationship tier color in File Explorer (Default: Off).')
					.addToggle((toggle) => {
						toggle.setValue(this.settings.explorerVirtualFolderColorText === true)
							.onChange(async (val) => {
								this.settings.explorerVirtualFolderColorText = val;
								await this.saveSettings();
								if (this.relationshipExplorerManager) {
									this.relationshipExplorerManager.refreshVirtualFolders();
								}
							});
					});

				new Setting(containerEl)
					.setName('Show Connecting Accent Line')
					.setDesc('Display a colored horizontal connecting line between the folder text and the [i virtual] badge (Default: On).')
					.addToggle((toggle) => {
						toggle.setValue(this.settings.explorerVirtualFolderShowLine !== false)
							.onChange(async (val) => {
								this.settings.explorerVirtualFolderShowLine = val;
								await this.saveSettings();
								if (this.relationshipExplorerManager) {
									this.relationshipExplorerManager.refreshVirtualFolders();
								}
							});
					});

				new Setting(containerEl)
					.setName('Allow Drag & Drop between Virtual Folders')
					.setDesc('Drag notes directly onto relationship virtual folders in File Explorer to update their closeness affinity.')
					.addToggle((toggle) => {
						toggle.setValue(this.settings.explorerVirtualFolderDragDrop !== false)
							.onChange(async (val) => {
								this.settings.explorerVirtualFolderDragDrop = val;
								await this.saveSettings();
								if (this.relationshipExplorerManager) {
									this.relationshipExplorerManager.refreshVirtualFolders();
								}
							});
					});

				let populateDropdowns: (() => void) | null = null;
				const tiersSectionWrap = containerEl.createDiv({ cls: 'pakcli-tiers-section-wrap' });

				const renderFullSection = () => {
					tiersSectionWrap.empty();

					const currentTiers: RelationshipTierConfig[] = this.settings.relationshipTiers || DEFAULT_RELATIONSHIP_TIERS;

					// Validation helper: check for overlaps
					const validateOverlap = (tiers: RelationshipTierConfig[]): { valid: boolean; error?: string } => {
						for (const t of tiers) {
							if (t.min < 0 || t.max > 1 || t.min > t.max) {
								return { valid: false, error: `Tier "${t.name}" has invalid range: min (${t.min}) must be between 0 and 1, and <= max (${t.max}).` };
							}
						}
						// Check intersections between any two tiers
						for (let i = 0; i < tiers.length; i++) {
							for (let j = i + 1; j < tiers.length; j++) {
								const t1 = tiers[i];
								const t2 = tiers[j];
								// Allow touching only if exact boundary or single point
								if (Math.max(t1.min, t2.min) < Math.min(t1.max, t2.max)) {
									return { valid: false, error: `Overlap detected between "${t1.name}" [${t1.min.toFixed(2)} - ${t1.max.toFixed(2)}] and "${t2.name}" [${t2.min.toFixed(2)} - ${t2.max.toFixed(2)}]! Rules cannot overlap.` };
								}
							}
						}
						return { valid: true };
					};

					const validation = validateOverlap(currentTiers);

					// Warning banner if overlapping
					if (!validation.valid && validation.error) {
						const warnBox = tiersSectionWrap.createDiv({ cls: 'pakcli-tiers-warning' });
						warnBox.style.cssText = 'background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 10px 14px; border-radius: 6px; margin: 12px 0; font-weight: 500; font-size: 13px;';
						warnBox.setText(`⚠️ ${validation.error}`);
					}

					// Multi-Handle Visual Range Track
					const sliderWrap = tiersSectionWrap.createDiv({ cls: 'pakcli-multi-range-slider-wrap' });
					sliderWrap.style.cssText = 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; margin: 16px 0;';

					const sliderTitle = sliderWrap.createEl('h4', { text: 'Visual Closeness Multi-Range Slider (0.00 ➔ 1.00):' });
					sliderTitle.style.cssText = 'margin: 0 0 12px 0; font-size: 13px; color: var(--text-normal);';

					const trackContainer = sliderWrap.createDiv({ cls: 'pakcli-range-track' });
					trackContainer.style.cssText = 'position: relative; width: 100%; height: 32px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden; display: flex; align-items: stretch;';

					// Sort tiers ascending for the slider display
					const sortedForSlider = [...currentTiers].sort((a, b) => a.min - b.min);

					let lastEnd = 0;
					for (const tier of sortedForSlider) {
						// Gap before this tier if any
						if (tier.min > lastEnd) {
							const gapPct = (tier.min - lastEnd) * 100;
							const gapEl = trackContainer.createDiv();
							gapEl.style.cssText = `width: ${gapPct}%; background: rgba(128, 128, 128, 0.15); border-right: 1px dashed var(--background-modifier-border);`;
							gapEl.title = `Gap: ${lastEnd.toFixed(2)} - ${tier.min.toFixed(2)}`;
						}

						const widthPct = Math.max(1, (tier.max - tier.min) * 100);
						const segEl = trackContainer.createDiv();
						segEl.style.cssText = `width: ${widthPct}%; background: ${tier.color}; opacity: 0.88; display: flex; align-items: center; justify-content: center; color: #ffffff; font-size: 11px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 4px; cursor: default; transition: opacity 0.15s;`;
						segEl.title = `${tier.name}: ${tier.min.toFixed(2)} - ${tier.max.toFixed(2)}`;
						segEl.setText(widthPct > 8 ? `${tier.name} (${tier.min.toFixed(2)}-${tier.max.toFixed(2)})` : tier.name);

						lastEnd = Math.max(lastEnd, tier.max);
					}

					// Bottom scale ticks
					const scaleLabels = sliderWrap.createDiv();
					scaleLabels.style.cssText = 'display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--text-muted); font-family: var(--font-monospace);';
					scaleLabels.innerHTML = '<span>0.00 (Outermost)</span><span>0.20</span><span>0.40</span><span>0.60</span><span>0.80</span><span>1.00 (Core / Me)</span>';

					// Dynamic Tiers Table
					const tableWrap = tiersSectionWrap.createDiv();
					tableWrap.style.cssText = 'margin: 16px 0;';

					const tiersHeaderRow = tableWrap.createDiv();
					tiersHeaderRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';
					
					const listTitle = tiersHeaderRow.createEl('h4', { text: 'Customizable Tier Ranges & Rules:' });
					listTitle.style.cssText = 'margin: 0; font-size: 14px;';

					const addTierBtn = tiersHeaderRow.createEl('button', { text: '+ Add Tier', cls: 'mod-cta' });
					addTierBtn.style.cssText = 'font-size: 12px; padding: 4px 10px;';
					addTierBtn.onclick = async () => {
						const nextMin = currentTiers.length > 0 ? Math.min(1.0, Math.max(...currentTiers.map(t => t.max)) + 0.01) : 0.0;
						const nextMax = Math.min(1.0, nextMin + 0.1);
						currentTiers.push({
							id: `tier_${Date.now()}`,
							name: `Tier ${currentTiers.length + 1}`,
							min: parseFloat(nextMin.toFixed(2)),
							max: parseFloat(nextMax.toFixed(2)),
							color: '#3b82f6',
							folderName: `${currentTiers.length + 1} - Custom`
						});
						this.settings.relationshipTiers = currentTiers;
						await this.saveSettings();
						renderFullSection();
					};

					// Render each tier row
					currentTiers.forEach((tier, index) => {
						const row = tableWrap.createDiv();
						row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px; background: var(--background-secondary); border-radius: 6px; border: 1px solid var(--background-modifier-border); flex-wrap: wrap;';

						// Color picker
						const colorInput = row.createEl('input', { type: 'color' });
						colorInput.value = tier.color || '#10b981';
						colorInput.style.cssText = 'width: 28px; height: 28px; border: none; border-radius: 4px; cursor: pointer; padding: 0; background: none;';
						colorInput.onchange = async () => {
							tier.color = colorInput.value;
							this.settings.relationshipTiers = currentTiers;
							await this.saveSettings();
							renderFullSection();
						};

						// Tier Name
						const nameLabel = row.createSpan({ text: 'Name:' });
						nameLabel.style.cssText = 'font-size: 12px; color: var(--text-muted);';
						const nameInput = row.createEl('input', { type: 'text', value: tier.name });
						nameInput.style.cssText = 'width: 120px; font-size: 12px; padding: 4px;';
						nameInput.onchange = async () => {
							tier.name = nameInput.value.trim() || tier.name;
							this.settings.relationshipTiers = currentTiers;
							await this.saveSettings();
						};

						// Range Min
						const minLabel = row.createSpan({ text: 'Min:' });
						minLabel.style.cssText = 'font-size: 12px; color: var(--text-muted);';
						const minInput = row.createEl('input', { type: 'number', value: String(tier.min) });
						minInput.step = '0.01';
						minInput.min = '0.00';
						minInput.max = '1.00';
						minInput.style.cssText = 'width: 65px; font-size: 12px; padding: 4px; font-family: var(--font-monospace);';
						minInput.onchange = async () => {
							tier.min = parseFloat(parseFloat(minInput.value).toFixed(2)) || 0;
							this.settings.relationshipTiers = currentTiers;
							await this.saveSettings();
							renderFullSection();
						};

						// Range Max
						const maxLabel = row.createSpan({ text: 'Max:' });
						maxLabel.style.cssText = 'font-size: 12px; color: var(--text-muted);';
						const maxInput = row.createEl('input', { type: 'number', value: String(tier.max) });
						maxInput.step = '0.01';
						maxInput.min = '0.00';
						maxInput.max = '1.00';
						maxInput.style.cssText = 'width: 65px; font-size: 12px; padding: 4px; font-family: var(--font-monospace);';
						maxInput.onchange = async () => {
							tier.max = parseFloat(parseFloat(maxInput.value).toFixed(2)) || 0;
							this.settings.relationshipTiers = currentTiers;
							await this.saveSettings();
							renderFullSection();
						};

						// Subfolder Name (for subfolder mode)
						const folderLabel = row.createSpan({ text: 'Folder:' });
						folderLabel.style.cssText = 'font-size: 12px; color: var(--text-muted);';
						const folderInput = row.createEl('input', { type: 'text', value: tier.folderName });
						folderInput.style.cssText = 'width: 130px; font-size: 12px; padding: 4px;';
						folderInput.onchange = async () => {
							tier.folderName = folderInput.value.trim() || tier.folderName;
							this.settings.relationshipTiers = currentTiers;
							await this.saveSettings();
						};

						// Delete Button
						if (currentTiers.length > 2) {
							const delBtn = row.createEl('button', { text: '✕' });
							delBtn.style.cssText = 'color: #ef4444; padding: 2px 8px; font-size: 12px; margin-left: auto;';
							delBtn.title = 'Remove this tier';
							delBtn.onclick = async () => {
								currentTiers.splice(index, 1);
								this.settings.relationshipTiers = currentTiers;
								await this.saveSettings();
								renderFullSection();
							};
						}
					});

					if (populateDropdowns) {
						populateDropdowns();
					}
				};

				renderFullSection();

				// 2. CLOSENESS LEVEL SWITCHER (2 DROPDOWNS + SWITCH BUTTON)
				const switcherBox = containerEl.createDiv({ cls: 'pakcli-tier-switcher-box' });
				switcherBox.style.cssText = 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; margin: 20px 0;';

				const switcherTitle = switcherBox.createEl('h4', { text: '🔁 Closeness Level Switcher (Swap Tier Ranges):' });
				switcherTitle.style.cssText = 'margin: 0 0 6px 0; font-size: 14px;';

				const switcherDesc = switcherBox.createEl('p', { text: 'Select two closeness levels to switch or swap their ranges (e.g. switch Enemy with Know, or swap Know range with Close Friends).' });
				switcherDesc.style.cssText = 'margin: 0 0 14px 0; font-size: 12px; color: var(--text-muted);';

				const dropdownsRow = switcherBox.createDiv();
				dropdownsRow.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap;';

				const fromLabel = dropdownsRow.createSpan({ text: 'Level 1:' });
				fromLabel.style.cssText = 'font-size: 13px; font-weight: 500;';
				const sourceSelect = dropdownsRow.createEl('select');
				sourceSelect.style.cssText = 'font-size: 12px; padding: 5px 10px; border-radius: 4px;';

				const arrowSpan = dropdownsRow.createSpan({ text: '⇄' });
				arrowSpan.style.cssText = 'font-size: 16px; color: var(--text-accent); font-weight: bold; padding: 0 4px;';

				const toLabel = dropdownsRow.createSpan({ text: 'Level 2:' });
				toLabel.style.cssText = 'font-size: 13px; font-weight: 500;';
				const targetSelect = dropdownsRow.createEl('select');
				targetSelect.style.cssText = 'font-size: 12px; padding: 5px 10px; border-radius: 4px;';

				populateDropdowns = () => {
					const prevA = sourceSelect.value;
					const prevB = targetSelect.value;
					sourceSelect.empty();
					targetSelect.empty();
					const tiers: RelationshipTierConfig[] = this.settings.relationshipTiers || DEFAULT_RELATIONSHIP_TIERS;
					tiers.forEach((t) => {
						sourceSelect.createEl('option', { 
							text: `${t.name} (${t.min.toFixed(2)} - ${t.max.toFixed(2)})`, 
							value: t.id 
						});
						targetSelect.createEl('option', { 
							text: `${t.name} (${t.min.toFixed(2)} - ${t.max.toFixed(2)})`, 
							value: t.id 
						});
					});
					if (prevA && tiers.some(t => t.id === prevA)) {
						sourceSelect.value = prevA;
					} else if (tiers.length > 0) {
						sourceSelect.value = tiers[tiers.length - 1].id;
					}
					if (prevB && tiers.some(t => t.id === prevB)) {
						targetSelect.value = prevB;
					} else if (tiers.length > 1) {
						targetSelect.value = tiers[tiers.length - 2].id;
					}
				};

				populateDropdowns();

				const switchBtn = switcherBox.createEl('button', { text: '🔁 Switch Closeness Levels', cls: 'mod-cta' });
				switchBtn.style.cssText = 'font-size: 13px; font-weight: 600; padding: 6px 14px;';
				switchBtn.onclick = async () => {
					const idA = sourceSelect.value;
					const idB = targetSelect.value;
					if (idA === idB) {
						new Notice('Please select two different closeness levels to switch.');
						return;
					}

					const tiers: RelationshipTierConfig[] = this.settings.relationshipTiers || DEFAULT_RELATIONSHIP_TIERS;
					const tierA = tiers.find(t => t.id === idA);
					const tierB = tiers.find(t => t.id === idB);

					if (!tierA || !tierB) {
						new Notice('Could not find selected tiers.');
						return;
					}

					// Swap their min and max ranges!
					const tempMin = tierA.min;
					const tempMax = tierA.max;
					tierA.min = tierB.min;
					tierA.max = tierB.max;
					tierB.min = tempMin;
					tierB.max = tempMax;

					this.settings.relationshipTiers = tiers;
					await this.saveSettings();

					// Re-render UI and multi-handle slider
					renderFullSection();
					if (populateDropdowns) {
						populateDropdowns();
						sourceSelect.value = idA;
						targetSelect.value = idB;
					}

					// Refresh open bubble graph
					const leaves = this.app.workspace.getLeavesOfType(BUBBLE_GRAPH_VIEW_TYPE);
					leaves.forEach((leaf) => {
						if (leaf.view instanceof BubbleGraphView) {
							leaf.view.reloadGraphData();
						}
					});

					new Notice(`🎉 Switched closeness ranges between "${tierA.name}" and "${tierB.name}"!`);
				};

				// 3. MULTI-RELATIONSHIP FOLDERS & RECORDS MANAGEMENT TABLE VIEW
				const tableManagementBox = containerEl.createDiv({ cls: 'pakcli-folders-table-box' });
				tableManagementBox.style.cssText = 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; margin: 24px 0 16px 0;';

				const renderFoldersAndRecordsTable = () => {
					tableManagementBox.empty();

					let folders: RelationshipFolderEntry[] = this.settings.relationshipFolders || [];
					const currentActivePath = normalizePath(this.settings.familyCirclesRootFolder || 'Relationships');

					// Ensure active folder is registered in folders list
					if (!folders.some(f => normalizePath(f.path) === currentActivePath)) {
						folders.push({
							id: `rel_${Date.now()}`,
							path: currentActivePath,
							mode: this.settings.relationshipMode || '1dir',
							viewStructure: this.settings.relationshipViewStructure || 'concentric',
							label: currentActivePath.split('/').pop() || 'Relationships',
							createdAt: Date.now()
						});
						this.settings.relationshipFolders = folders;
						this.saveSettings();
					}

					// Header with title and Action Buttons
					const headerRow = tableManagementBox.createDiv();
					headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;';

					const titleEl = headerRow.createEl('h4', { text: '📁 Managed Relationship Folders' });
					titleEl.style.cssText = 'margin: 0; font-size: 14px;';

					const btnGroup = headerRow.createDiv();
					btnGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';

					// "+ Add Folder" button
					const addFolderBtn = btnGroup.createEl('button', { text: '+ Add Folder' });
					addFolderBtn.style.cssText = 'font-size: 12px; padding: 4px 10px;';
					addFolderBtn.onclick = () => {
						const inputPath = prompt('Enter vault folder path for relationships (e.g. Social Circles, Contacts):', 'Relationships');
						if (inputPath && inputPath.trim()) {
							const cleanPath = normalizePath(inputPath.trim());
							if (!folders.some(f => normalizePath(f.path) === cleanPath)) {
								folders.push({
									id: `rel_${Date.now()}`,
									path: cleanPath,
									mode: '1dir',
									viewStructure: 'concentric',
									label: cleanPath.split('/').pop() || cleanPath,
									createdAt: Date.now()
								});
								this.settings.relationshipFolders = folders;
								this.saveSettings();
								renderFoldersAndRecordsTable();
								new Notice(`Registered relationship folder "${cleanPath}"!`);
							} else {
								new Notice('Folder already registered.');
							}
						}
					};

					// "✨ Create Sample Preset..." button (opens RelationshipSampleModal!)
					const createSampleBtn = btnGroup.createEl('button', { text: '✨ Create Sample...' });
					createSampleBtn.style.cssText = 'font-size: 12px; font-weight: 600; padding: 4px 12px;';
					createSampleBtn.onclick = () => {
						new RelationshipSampleModal(
							this.app,
							this,
							this.settings.familyCirclesRootFolder || 'Relationships',
							() => {
								renderFullSection();
								renderFoldersAndRecordsTable();
								if (this.relationshipExplorerManager) {
									this.relationshipExplorerManager.refreshVirtualFolders();
								}
							}
						).open();
					};

					// "👤 Assign Relationship" button (Auto-detects closeness notes for flat mode)
					const assignRelBtn = btnGroup.createEl('button', { text: '👤 Assign Relationship', cls: 'mod-cta' });
					assignRelBtn.style.cssText = 'font-size: 12px; font-weight: 600; padding: 4px 12px;';
					assignRelBtn.title = 'Auto-detect notes with closeness score across vault and assign them to your flat relationship folder';
					assignRelBtn.onclick = () => {
						new AssignRelationshipModal(
							this.app,
							this,
							this.settings.familyCirclesRootFolder || 'Relationships',
							() => {
								renderFoldersAndRecordsTable();
								if (this.relationshipExplorerManager) {
									this.relationshipExplorerManager.refreshVirtualFolders();
								}
							}
						).open();
					};

					// Explanatory note
					const descEl = tableManagementBox.createEl('p', {
						text: 'Manage multiple relationship folders. Use "Delete Record Only" to untrack a folder without deleting any files from disk, or "Delete File & Record" to permanently remove it.'
					});
					descEl.style.cssText = 'margin: 0 0 14px 0; font-size: 12px; color: var(--text-muted);';

					// Table Container
					const tableEl = tableManagementBox.createEl('table');
					tableEl.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;';

					const thead = tableEl.createEl('thead');
					const theadRow = thead.createEl('tr');
					theadRow.style.cssText = 'border-bottom: 2px solid var(--background-modifier-border); text-align: left; color: var(--text-muted); font-size: 11px; text-transform: uppercase;';
					theadRow.createEl('th', { text: 'Folder Path' }).style.cssText = 'padding: 6px 8px;';
					theadRow.createEl('th', { text: 'Storage' }).style.cssText = 'padding: 6px 8px;';
					theadRow.createEl('th', { text: 'Viewing' }).style.cssText = 'padding: 6px 8px;';
					theadRow.createEl('th', { text: 'Sort Order' }).style.cssText = 'padding: 6px 8px;';
					theadRow.createEl('th', { text: 'Notes' }).style.cssText = 'padding: 6px 8px;';
					theadRow.createEl('th', { text: 'Active' }).style.cssText = 'padding: 6px 8px;';
					theadRow.createEl('th', { text: 'Actions' }).style.cssText = 'padding: 6px 8px; text-align: right;';

					const tbody = tableEl.createEl('tbody');

					folders.forEach((fEntry, idx) => {
						const tr = tbody.createEl('tr');
						tr.style.cssText = 'border-bottom: 1px solid var(--background-modifier-border); transition: background-color 0.1s ease;';

						const normPath = normalizePath(fEntry.path);
						const isActive = normPath === currentActivePath;

						// 1. Folder Path
						const tdPath = tr.createEl('td');
						tdPath.style.cssText = 'padding: 8px; font-weight: 500; display: flex; align-items: center; gap: 6px;';
						const folderIcon = tdPath.createSpan({ text: '📂' });
						const pathLink = tdPath.createSpan({ text: fEntry.path });
						pathLink.style.cssText = 'cursor: pointer; color: var(--text-normal);';
						pathLink.title = 'Click to set active';
						pathLink.onclick = async () => {
							this.settings.familyCirclesRootFolder = fEntry.path;
							if (fEntry.mode) this.settings.relationshipMode = fEntry.mode;
							if (fEntry.viewStructure) {
								this.settings.relationshipViewStructure = fEntry.viewStructure;
								this.settings.explorerRelationshipVirtualFolders = fEntry.viewStructure !== 'flat';
							}
							if (fEntry.sortOrder) {
								this.settings.relationshipSortOrder = fEntry.sortOrder;
							}
							await this.saveSettings();
							renderFullSection();
							renderFoldersAndRecordsTable();
							if (this.relationshipExplorerManager) {
								this.relationshipExplorerManager.refreshVirtualFolders();
							}
							const leaves = this.app.workspace.getLeavesOfType('pakcli-bubble-graph-view');
							leaves.forEach(leaf => {
								if (leaf.view && typeof (leaf.view as any).reloadGraphData === 'function') {
									(leaf.view as any).reloadGraphData();
								} else if (leaf.view && typeof (leaf.view as any).renderGraph === 'function') {
									(leaf.view as any).renderGraph();
								}
							});
						};

						// 2. Storage Mode
						const tdMode = tr.createEl('td');
						tdMode.style.cssText = 'padding: 8px;';
						const modeBadge = tdMode.createSpan({ text: fEntry.mode === 'subfolders' ? 'Subfolders' : '1 Directory' });
						modeBadge.style.cssText = 'background: var(--background-primary); border: 1px solid var(--background-modifier-border); padding: 2px 6px; border-radius: 4px; font-size: 11px;';

						// 3. Viewing Mode (Flat / Range / Concentric)
						const tdViewing = tr.createEl('td');
						tdViewing.style.cssText = 'padding: 8px;';
						const viewSelect = tdViewing.createEl('select');
						viewSelect.style.cssText = 'font-size: 11px; padding: 2px 6px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 4px; color: var(--text-normal); cursor: pointer;';

						const viewOptions: { value: RelationshipViewStructure; label: string }[] = [
							{ value: 'flat', label: 'Flat (Default)' },
							{ value: 'concentric', label: 'Concentric Circles' },
							{ value: 'range', label: 'Cluster Subfolders (Parallel)' }
						];
						viewOptions.forEach(opt => {
							const optEl = viewSelect.createEl('option', { value: opt.value, text: opt.label });
							if ((fEntry.viewStructure || 'flat') === opt.value) {
								optEl.selected = true;
							}
						});
						viewSelect.onchange = async () => {
							const chosen = viewSelect.value as RelationshipViewStructure;
							fEntry.viewStructure = chosen;
							if (isActive) {
								this.settings.relationshipViewStructure = chosen;
								this.settings.explorerRelationshipVirtualFolders = chosen !== 'flat';
							}
							await this.saveSettings();
							if (this.relationshipExplorerManager) {
								this.relationshipExplorerManager.refreshVirtualFolders();
							}
							// Also reload & refresh bubble graph view if active
							const leaves = this.app.workspace.getLeavesOfType('pakcli-bubble-graph-view');
							leaves.forEach(leaf => {
								if (leaf.view && typeof (leaf.view as any).reloadGraphData === 'function') {
									(leaf.view as any).reloadGraphData();
								} else if (leaf.view && typeof (leaf.view as any).renderGraph === 'function') {
									(leaf.view as any).renderGraph();
								}
							});
							new Notice(`Viewing mode for "${fEntry.path}" set to ${chosen}`);
						};

						// 3b. Sort Order
						const tdSort = tr.createEl('td');
						tdSort.style.cssText = 'padding: 8px;';
						const sortSelect = tdSort.createEl('select');
						sortSelect.style.cssText = 'font-size: 11px; padding: 2px 6px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 4px; color: var(--text-normal); cursor: pointer;';

						const sortOptions: { value: RelationshipSortOrder; label: string }[] = [
							{ value: 'closeness_desc', label: 'Score Desc (+1 ➔ -1)' },
							{ value: 'closeness_asc', label: 'Score Asc (-1 ➔ +1)' },
							{ value: 'filename_asc', label: 'File Name (A ➔ Z)' },
							{ value: 'filename_desc', label: 'File Name (Z ➔ A)' },
							{ value: 'title_asc', label: 'Frontmatter Title (A ➔ Z)' },
							{ value: 'title_desc', label: 'Frontmatter Title (Z ➔ A)' }
						];
						sortOptions.forEach(opt => {
							const optEl = sortSelect.createEl('option', { value: opt.value, text: opt.label });
							if ((fEntry.sortOrder || 'closeness_desc') === opt.value) {
								optEl.selected = true;
							}
						});
						sortSelect.onchange = async () => {
							const chosen = sortSelect.value as RelationshipSortOrder;
							fEntry.sortOrder = chosen;
							if (isActive) {
								this.settings.relationshipSortOrder = chosen;
							}
							await this.saveSettings();
							if (this.relationshipExplorerManager) {
								this.relationshipExplorerManager.refreshVirtualFolders();
							}
							new Notice(`Sort order for "${fEntry.path}" set to ${sortSelect.options[sortSelect.selectedIndex].text}`);
						};

						// 4. Notes Count
						const tdCount = tr.createEl('td');
						tdCount.style.cssText = 'padding: 8px;';
						const folderAbstract = this.app.vault.getAbstractFileByPath(normPath);
						let noteCount = 0;
						if (folderAbstract instanceof TFolder) {
							const countMds = (fld: TFolder) => {
								for (const c of fld.children) {
									if (c instanceof TFile && c.extension === 'md') noteCount++;
									else if (c instanceof TFolder) countMds(c);
								}
							};
							countMds(folderAbstract);
						}
						const countBadge = tdCount.createSpan({ text: `${noteCount} note${noteCount === 1 ? '' : 's'}` });
						countBadge.style.cssText = 'font-size: 11px; color: var(--text-muted);';

						// 5. Active Status / Switcher
						const tdActive = tr.createEl('td');
						tdActive.style.cssText = 'padding: 8px;';
						if (isActive) {
							const activeBadge = tdActive.createSpan({ text: '🟢 Active' });
							activeBadge.style.cssText = 'font-weight: 600; color: #10b981; font-size: 11px;';
						} else {
							const setActiveBtn = tdActive.createEl('button', { text: '⭐ Set Active' });
							setActiveBtn.style.cssText = 'font-size: 11px; padding: 2px 8px;';
							setActiveBtn.onclick = async () => {
								this.settings.familyCirclesRootFolder = fEntry.path;
								if (fEntry.mode) this.settings.relationshipMode = fEntry.mode;
								if (fEntry.viewStructure) {
									this.settings.relationshipViewStructure = fEntry.viewStructure;
									this.settings.explorerRelationshipVirtualFolders = fEntry.viewStructure !== 'flat';
								}
								if (fEntry.sortOrder) {
									this.settings.relationshipSortOrder = fEntry.sortOrder;
								}
								await this.saveSettings();
								renderFullSection();
								renderFoldersAndRecordsTable();
								if (this.relationshipExplorerManager) {
									this.relationshipExplorerManager.refreshVirtualFolders();
								}
								const leaves = this.app.workspace.getLeavesOfType('pakcli-bubble-graph-view');
								leaves.forEach(leaf => {
									if (leaf.view && typeof (leaf.view as any).reloadGraphData === 'function') {
										(leaf.view as any).reloadGraphData();
									} else if (leaf.view && typeof (leaf.view as any).renderGraph === 'function') {
										(leaf.view as any).renderGraph();
									}
								});
								new Notice(`Switched active relationship folder to "${fEntry.path}"`);
							};
						}

						// 6. Actions (Delete Record Only vs Delete File & Record)
						const tdActions = tr.createEl('td');
						tdActions.style.cssText = 'padding: 8px; text-align: right; display: flex; justify-content: flex-end; gap: 6px;';

						// Action A: Delete Record Only (Untrack from settings, never touch disk)
						const delRecordBtn = tdActions.createEl('button', { text: '🗑️ Delete Record Only' });
						delRecordBtn.style.cssText = 'font-size: 11px; padding: 2px 8px; color: var(--text-normal);';
						delRecordBtn.title = 'Remove this folder from relationship tracking without deleting files on disk';
						delRecordBtn.onclick = async () => {
							folders.splice(idx, 1);
							this.settings.relationshipFolders = folders;
							if (isActive && folders.length > 0) {
								this.settings.familyCirclesRootFolder = folders[0].path;
							}
							await this.saveSettings();
							renderFullSection();
							renderFoldersAndRecordsTable();
							new Notice(`Removed relationship record for "${fEntry.path}". Files on disk were NOT deleted.`);
						};

						// Action B: Delete File & Record (Permanently delete files & folder from vault)
						const delFileBtn = tdActions.createEl('button', { text: '💥 Delete File & Record' });
						delFileBtn.style.cssText = 'font-size: 11px; padding: 2px 8px; color: #ef4444;';
						delFileBtn.title = 'Permanently delete this folder and its files from vault';
						delFileBtn.onclick = async () => {
							const confirmed = confirm(`⚠️ PERMANENT DELETE:\nAre you sure you want to permanently delete folder "${fEntry.path}" and all its files from your vault?`);
							if (confirmed) {
								if (folderAbstract) {
									await this.app.vault.delete(folderAbstract, true);
								}
								folders.splice(idx, 1);
								this.settings.relationshipFolders = folders;
								if (isActive && folders.length > 0) {
									this.settings.familyCirclesRootFolder = folders[0].path;
								}
								await this.saveSettings();
								renderFullSection();
								renderFoldersAndRecordsTable();
								new Notice(`💥 Deleted folder "${fEntry.path}" and removed record.`);
							}
						};
					});

					// ── SUB-TABLE: Notes Breakdown inside Active Folder ──
					const activeFolderAbstract = this.app.vault.getAbstractFileByPath(currentActivePath);
					if (activeFolderAbstract instanceof TFolder) {
						const notesBox = tableManagementBox.createDiv();
						notesBox.style.cssText = 'margin-top: 14px; border-top: 1px dashed var(--background-modifier-border); padding-top: 12px;';

						const notesHeader = notesBox.createEl('h5', { text: `📋 Notes inside Active Folder (${currentActivePath}):` });
						notesHeader.style.cssText = 'margin: 0 0 10px 0; font-size: 13px; display: flex; align-items: center; justify-content: space-between;';

						const notesList: TFile[] = [];
						const collectNotes = (fld: TFolder) => {
							for (const c of fld.children) {
								if (c instanceof TFile && c.extension === 'md') notesList.push(c);
								else if (c instanceof TFolder) collectNotes(c);
							}
						};
						collectNotes(activeFolderAbstract);

						if (notesList.length === 0) {
							const noNotes = notesBox.createDiv();
							noNotes.style.cssText = 'color: var(--text-muted); font-style: italic; font-size: 12px;';
							noNotes.setText('No markdown notes found in active relationship folder. Click "Create Sample" to generate starter notes.');
						} else {
							const notesTable = notesBox.createEl('table');
							notesTable.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 11px;';

							const nHead = notesTable.createEl('thead');
							const nHeadRow = nHead.createEl('tr');
							nHeadRow.style.cssText = 'border-bottom: 1px solid var(--background-modifier-border); color: var(--text-muted); text-align: left;';
							nHeadRow.createEl('th', { text: 'Note Name' }).style.cssText = 'padding: 4px 6px;';
							nHeadRow.createEl('th', { text: 'Closeness Score' }).style.cssText = 'padding: 4px 6px;';
							nHeadRow.createEl('th', { text: 'Matched Tier' }).style.cssText = 'padding: 4px 6px;';
							nHeadRow.createEl('th', { text: 'Actions' }).style.cssText = 'padding: 4px 6px; text-align: right;';

							const nBody = notesTable.createEl('tbody');
							const tiers: RelationshipTierConfig[] = this.settings.relationshipTiers || DEFAULT_RELATIONSHIP_TIERS;
							const propKey = this.settings.relationshipPropertyKey || 'closeness';

							notesList.forEach((nFile) => {
								const nTr = nBody.createEl('tr');
								nTr.style.cssText = 'border-bottom: 1px solid var(--background-modifier-border);';

								const cache = this.app.metadataCache.getFileCache(nFile);
								const rawCloseness = cache?.frontmatter?.[propKey] ?? 
								                     cache?.frontmatter?.closeness ?? 
								                     cache?.frontmatter?.score ??
								                     cache?.frontmatter?.affinity;
								let score = 0.25;
								const lowerName = nFile.basename.toLowerCase();
								const lowerRole = String(cache?.frontmatter?.role || '').toLowerCase();
								const isMeNote = lowerName === 'me' || lowerRole.includes('self') || lowerRole.includes('me') || lowerName.includes('myself');

								if (rawCloseness !== undefined && rawCloseness !== null && !isNaN(Number(rawCloseness))) {
									score = Math.max(0, Math.min(1, Number(rawCloseness)));
								} else if (isMeNote) {
									score = 1.0;
								}

								let matchedTier = tiers.find(t => score >= Math.min(t.min, t.max) && score <= Math.max(t.min, t.max));
								if (!matchedTier && tiers.length > 0) matchedTier = tiers[0];

								// Note Name
								const tdName = nTr.createEl('td');
								tdName.style.cssText = 'padding: 5px 6px; font-weight: 500; cursor: pointer; color: var(--text-accent);';
								tdName.setText(nFile.name);
								tdName.onclick = () => {
									this.app.workspace.openLinkText(nFile.path, '', false);
								};

								// Score
								const tdScore = nTr.createEl('td');
								tdScore.style.cssText = 'padding: 5px 6px; font-family: var(--font-monospace);';
								tdScore.setText(rawCloseness !== undefined ? `${score.toFixed(2)}` : 'None (default)');

								// Matched Tier
								const tdTier = nTr.createEl('td');
								tdTier.style.cssText = 'padding: 5px 6px; display: flex; align-items: center; gap: 4px;';
								const dot = tdTier.createSpan();
								dot.style.cssText = `width: 7px; height: 7px; border-radius: 50%; background-color: ${matchedTier?.color || '#64748b'};`;
								tdTier.createSpan({ text: matchedTier?.name || 'Unknown' });

								// Actions (Delete Record vs Delete File)
								const tdNoteActions = nTr.createEl('td');
								tdNoteActions.style.cssText = 'padding: 5px 6px; text-align: right; display: flex; justify-content: flex-end; gap: 4px;';

								// Delete Record Only (clear frontmatter property)
								const delRecBtn = tdNoteActions.createEl('button', { text: 'Del Record' });
								delRecBtn.style.cssText = 'font-size: 10px; padding: 1px 6px;';
								delRecBtn.title = 'Remove closeness metadata from frontmatter (keeps note file on disk)';
								delRecBtn.onclick = async () => {
									await this.app.fileManager.processFrontMatter(nFile, (fm) => {
										delete fm[propKey];
										delete fm['closeness'];
										delete fm['score'];
									});
									renderFoldersAndRecordsTable();
									new Notice(`Removed closeness record from "${nFile.name}".`);
								};

								// Delete File & Record (delete file from vault)
								const delFBtn = tdNoteActions.createEl('button', { text: 'Del File' });
								delFBtn.style.cssText = 'font-size: 10px; padding: 1px 6px; color: #ef4444;';
								delFBtn.title = 'Delete note file from vault';
								delFBtn.onclick = async () => {
									await this.app.vault.delete(nFile, true);
									renderFoldersAndRecordsTable();
									new Notice(`Deleted file "${nFile.name}".`);
								};
							});
						}
					}
				};

				renderFoldersAndRecordsTable();

				new Setting(containerEl)
					.setName('Open Bubble Graph View')
					.setDesc('View your concentric relationship circles in full-screen interactive topology.')
					.addButton((b) => {
						b.setButtonText('Open Bubble Graph ↗')
							.onClick(() => {
								this.openBubbleGraphView();
							});
					});
			}
		});

		// 1. CSV & Tablite Editor Handler (table-csv)
		settingsTab.registerLocalSection({
			id: 'table-csv',
			category: 'table',
			title: 'CSV & Tablite Table Editor',
			icon: 'table',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('CSV & Tablite Grid Engine')
					.setDesc('Fast in-vault spreadsheet and database grid editor for CSV, TSV and JSON files.')
					.setHeading();

				new Setting(containerEl)
					.setName('Enable CSV Table Editor')
					.setDesc('Open .csv files in the interactive AG-Grid / Tablite spreadsheet viewer.')
					.addToggle((t) => {
						t.setValue(this.settings.enableCsvEditor !== false)
							.onChange(async (v) => {
								this.settings.enableCsvEditor = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Default Grid Theme')
					.setDesc('Visual styling for table cells and header chrome.')
					.addDropdown((d) => {
						d.addOption('ag-theme-quartz', 'Obsidian Dark Quartz')
							.addOption('ag-theme-alpine', 'Alpine Crisp')
							.addOption('ag-theme-balham', 'Compact Balham')
							.setValue(this.settings.gridTheme || 'ag-theme-quartz')
							.onChange(async (v) => {
								this.settings.gridTheme = v;
								await this.saveSettings();
							});
					});

				let folderTextInput: TextComponent | null = null;
				const artifactFolderSetting = new Setting(containerEl)
					.setName('CSV View Artifacts Folder')
					.setDesc('Vault folder where custom column order, sizing, hidden columns, filters, custom views, and calculations are saved (default: csv_view_artifacts).')
					.addText((text) => {
						folderTextInput = text;
						text.setPlaceholder('csv_view_artifacts')
							.setValue(this.settings.csvArtifactFolderPath || 'csv_view_artifacts')
							.onChange(async (v) => {
								this.settings.csvArtifactFolderPath = v.trim();
								await this.saveSettings();
							});
					})
					.addButton((btn) => {
						btn.setButtonText('Move Default → Custom')
							.setTooltip('Migrate all artifact JSON files from default (csv_view_artifacts) to this custom folder')
							.setCta()
							.onClick(async () => {
								const customFolder = (this.settings.csvArtifactFolderPath || '').trim().replace(/^\/+|\/+$/g, '');
								if (!customFolder || customFolder === 'csv_view_artifacts') {
									new Notice('⚠️ Destination is already the default folder ("csv_view_artifacts"). Please specify a different custom folder first.');
									return;
								}
								btn.setDisabled(true);
								try {
									const result = await moveArtifactsBetweenFolders(this.app, 'csv_view_artifacts', customFolder);
									if (result.moved > 0) {
										new Notice(`🚚 Successfully moved ${result.moved} artifact file(s) to "${customFolder}"!`);
									} else if (result.errors > 0) {
										new Notice(`⚠️ Encountered errors moving some files. Check developer console for details.`);
									} else {
										new Notice(`ℹ️ No artifact files found in "csv_view_artifacts" or files have already been moved.`);
									}
								} catch (err) {
									console.error('Error during artifact migration:', err);
									new Notice(`❌ Failed to move artifacts: ${String(err)}`);
								} finally {
									btn.setDisabled(false);
								}
							});
					})
					.addButton((btn) => {
						btn.setButtonText('Reset')
							.setTooltip('Reset folder path back to default (csv_view_artifacts)')
							.onClick(async () => {
								this.settings.csvArtifactFolderPath = 'csv_view_artifacts';
								if (folderTextInput) {
									folderTextInput.setValue('csv_view_artifacts');
								}
								await this.saveSettings();
								new Notice('🔄 Reset artifacts folder to "csv_view_artifacts".');
							});
					});
				artifactFolderSetting.settingEl.addClass('tablite-artifact-folder-setting');

				new Setting(containerEl)
					.setName('Calculation Engine & Aggregate Dashboards')
					.setDesc('Configure standard aggregations (SUM, MID, AVG, MAX, MIN, COUNT) and custom math formulas.')
					.setHeading();

				new Setting(containerEl)
					.setName('Default Calculation Row Position')
					.setDesc('Default placement of the calculation row across CSV files.')
					.addDropdown((d) => {
						d.addOption('below', 'Below Last Row')
							.addOption('above', 'Above Header')
							.addOption('both', 'Both (Above & Below)')
							.addOption('none', 'Off / Hidden')
							.setValue(this.settings.defaultCalcPosition || 'above')
							.onChange(async (v: string) => {
								this.settings.defaultCalcPosition = v as 'below' | 'above' | 'both' | 'none';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Freeze Calculation Row')
					.setDesc('Pin calculation row to top or bottom while scrolling through table data.')
					.addToggle((t) => {
						t.setValue(this.settings.defaultCalcFreeze !== false)
							.onChange(async (v) => {
								this.settings.defaultCalcFreeze = v;
								await this.saveSettings();
							});
					});

				const renderPresetsList = (listContainer: HTMLElement) => {
					listContainer.empty();

					new Setting(listContainer)
						.setName('Custom Calculation Presets (*preset_name)')
						.setDesc('Formulas support arithmetic operators (+, -, *, /, %, ^) with tokens: SUM, MID, AVG, MAX, MIN, COUNT.')
						.addButton((btn) => {
							btn.setButtonText('+ Add Calc Preset')
								.setCta()
								.onClick(() => {
									new CustomCalcModal(this.app, this, undefined, () => {
										renderPresetsList(listContainer);
									}).open();
								});
						});

					const presets: CalcPreset[] = this.settings.calcPresets || [];
					if (presets.length === 0) {
						listContainer.createEl('div', {
							text: 'No custom calculation presets configured. Click "+ Add Calc Preset" to create one.',
							cls: 'tablite-calc-empty-note'
						});
						return;
					}

					for (const preset of presets) {
						const setting = new Setting(listContainer)
							.setName(preset.name)
							.setDesc(`Formula: ${preset.formula}${preset.description ? ` — ${preset.description}` : ''}`);

						setting.addExtraButton((btn) => {
							btn.setIcon('pencil')
								.setTooltip('Edit Preset Formula')
								.onClick(() => {
									new CustomCalcModal(this.app, this, preset, () => {
										renderPresetsList(listContainer);
									}).open();
								});
						});

						setting.addExtraButton((btn) => {
							btn.setIcon('trash')
								.setTooltip('Delete Preset')
								.onClick(async () => {
									this.settings.calcPresets = (this.settings.calcPresets || []).filter(p => p.id !== preset.id);
									await this.saveSettings();
									renderPresetsList(listContainer);
									new Notice(`Preset "${preset.name}" deleted.`);
								});
						});
					}
				};

				const presetsSectionEl = containerEl.createDiv({ cls: 'tablite-presets-settings-section' });
				renderPresetsList(presetsSectionEl);
			}
		});

		// 2. Explorer Additions & Split View (table-explorer)
		settingsTab.registerLocalSection({
			id: 'table-explorer',
			category: 'table',
			title: 'Explorer Additions',
			icon: 'rows-2',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Explorer Additions & Split View')
					.setDesc('Multi-pane split view for the Obsidian File Explorer with recent files, folder-qualified index.md titles, and customizable layout order.')
					.setHeading();

				new Setting(containerEl)
					.setName('Apply Explorer Split View')
					.setDesc('Enable split view in the File Explorer sidebar. When toggled off, the File Explorer returns to the original single-pane tree.')
					.addToggle((t) => {
						t.setValue(this.settings.explorerSplitEnabled === true)
							.onChange(async (val) => {
								this.settings.explorerSplitEnabled = val;
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyLayout();
								}
							});
					});

				new Setting(containerEl)
					.setName('Explorer Section Layout & Sorter')
					.setDesc('Customize the vertical layout order of file explorer components. Default: Header Control → Recent Files → Original Explorer.')
					.setHeading();

				const renderSectionOrderList = (parentEl: HTMLElement) => {
					parentEl.empty();
					const listEl = parentEl.createDiv({ cls: 'pakcli-section-order-list' });

					const currentOrder: ExplorerSectionId[] = (
						this.settings.explorerSectionOrder && this.settings.explorerSectionOrder.length === 3
							? this.settings.explorerSectionOrder
							: [...DEFAULT_EXPLORER_SECTION_ORDER]
					);

					currentOrder.forEach((secId, index) => {
						const info = EXPLORER_SECTIONS_INFO[secId];
						const rowEl = listEl.createDiv({ cls: 'pakcli-section-order-item' });

						// Left side (Drag handle + Badge + Names)
						const leftEl = rowEl.createDiv({ cls: 'pakcli-section-left' });
						const handle = leftEl.createDiv({ cls: 'pakcli-drag-handle' });
						setIcon(handle, 'grip-vertical');

						const badge = leftEl.createDiv({ cls: 'pakcli-section-badge' });
						badge.textContent = `${index + 1}`;

						const infoEl = leftEl.createDiv({ cls: 'pakcli-section-info' });
						const nameEl = infoEl.createSpan({ cls: 'pakcli-section-name' });
						nameEl.textContent = info ? info.name : secId;

						const descEl = infoEl.createSpan({ cls: 'pakcli-section-desc' });
						descEl.textContent = info ? info.description : '';

						// Right side (Up / Down controls)
						const rightEl = rowEl.createDiv({ cls: 'pakcli-section-right' });

						const upBtn = rightEl.createEl('button', { cls: 'clickable-icon' });
						setIcon(upBtn, 'arrow-up');
						upBtn.setAttribute('aria-label', 'Move Section Up');
						if (index === 0) {
							upBtn.disabled = true;
						} else {
							upBtn.addEventListener('click', async () => {
								const temp = currentOrder[index];
								currentOrder[index] = currentOrder[index - 1];
								currentOrder[index - 1] = temp;
								this.settings.explorerSectionOrder = [...currentOrder];
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyLayout();
								}
								renderSectionOrderList(parentEl);
							});
						}

						const downBtn = rightEl.createEl('button', { cls: 'clickable-icon' });
						setIcon(downBtn, 'arrow-down');
						downBtn.setAttribute('aria-label', 'Move Section Down');
						if (index === currentOrder.length - 1) {
							downBtn.disabled = true;
						} else {
							downBtn.addEventListener('click', async () => {
								const temp = currentOrder[index];
								currentOrder[index] = currentOrder[index + 1];
								currentOrder[index + 1] = temp;
								this.settings.explorerSectionOrder = [...currentOrder];
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyLayout();
								}
								renderSectionOrderList(parentEl);
							});
						}

						// HTML5 Drag and drop
						rowEl.setAttribute('draggable', 'true');
						rowEl.addEventListener('dragstart', (e) => {
							e.dataTransfer?.setData('text/plain', String(index));
						});
						rowEl.addEventListener('dragover', (e) => {
							e.preventDefault();
							rowEl.addClass('is-drag-over');
						});
						rowEl.addEventListener('dragleave', () => {
							rowEl.removeClass('is-drag-over');
						});
						rowEl.addEventListener('drop', async (e) => {
							e.preventDefault();
							rowEl.removeClass('is-drag-over');
							const fromIdx = parseInt(e.dataTransfer?.getData('text/plain') || '-1', 10);
							if (fromIdx !== -1 && fromIdx !== index) {
								const [moved] = currentOrder.splice(fromIdx, 1);
								currentOrder.splice(index, 0, moved);
								this.settings.explorerSectionOrder = [...currentOrder];
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyLayout();
								}
								renderSectionOrderList(parentEl);
							}
						});
					});

					// Reset button
					const footer = parentEl.createDiv({ cls: 'pakcli-section-footer' });
					new Setting(footer)
						.setName('Reset Section Order')
						.setDesc('Restore default layout: Header Control → Recent Files → Original Explorer.')
						.addButton((b) => {
							b.setButtonText('Reset Order to Default')
								.onClick(async () => {
									this.settings.explorerSectionOrder = [...DEFAULT_EXPLORER_SECTION_ORDER];
									await this.saveSettings();
									if (this.splitViewManager) {
										this.splitViewManager.applyLayout();
									}
									renderSectionOrderList(parentEl);
									new Notice('Explorer section order reset to default.');
								});
						});
				};

				const orderContainerEl = containerEl.createDiv();
				renderSectionOrderList(orderContainerEl);

				new Setting(containerEl)
					.setName('Recent Files Pane Preferences')
					.setHeading();

				let recentsFolderInput: TextComponent | null = null;
				new Setting(containerEl)
					.setName('Recent Files CSV Artifact Folder')
					.setDesc('Vault folder where the recent files history CSV artifact (recents.csv with path, time last open, date last open) is stored (default: artifacts/pakcli-panel).')
					.addText((text) => {
						recentsFolderInput = text;
						text.setPlaceholder('artifacts/pakcli-panel')
							.setValue(this.settings.recentsArtifactFolderPath || 'artifacts/pakcli-panel')
							.onChange(async (val) => {
								this.settings.recentsArtifactFolderPath = val.trim() || 'artifacts/pakcli-panel';
								await this.saveSettings();
								if (this.splitViewManager) {
									await this.splitViewManager.saveRecentsCsvArtifact();
								}
							});
					})
					.addButton((btn) => {
						btn.setButtonText('Open CSV')
							.setTooltip('Open recents.csv in the workspace')
							.onClick(async () => {
								if (this.splitViewManager) {
									const file = await this.splitViewManager.saveRecentsCsvArtifact();
									if (file) {
										const leaf = this.app.workspace.getLeaf(false);
										await leaf.openFile(file);
										new Notice('Opened Recents CSV artifact');
									}
								}
							});
					})
					.addButton((btn) => {
						btn.setButtonText('Reset')
							.setTooltip('Reset folder back to default (artifacts/pakcli-panel)')
							.onClick(async () => {
								this.settings.recentsArtifactFolderPath = 'artifacts/pakcli-panel';
								if (recentsFolderInput) {
									recentsFolderInput.setValue('artifacts/pakcli-panel');
								}
								await this.saveSettings();
								if (this.splitViewManager) {
									await this.splitViewManager.saveRecentsCsvArtifact();
								}
								new Notice('🔄 Reset recents CSV artifact folder to "artifacts/pakcli-panel".');
							});
					});

				new Setting(containerEl)
					.setName('Max Recent Files')
					.setDesc('Maximum number of recently opened files to display in the pane (5 - 50).')
					.addSlider((slider) => {
						slider.setLimits(5, 50, 5)
							.setValue(this.settings.explorerMaxRecentFiles || 20)
							.setDynamicTooltip()
							.onChange(async (val) => {
								this.settings.explorerMaxRecentFiles = val;
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.renderRecentList();
								}
							});
					});

				new Setting(containerEl)
					.setName('Recent Files Pane Height')
					.setDesc('Default height in pixels for the recent files section (also resizable by dragging the splitter bar).')
					.addText((text) => {
						text.setPlaceholder('180')
							.setValue(String(this.settings.explorerSplitHeight || 180))
							.onChange(async (val) => {
								const num = parseInt(val, 10);
								if (!isNaN(num) && num >= 70 && num <= 600) {
									this.settings.explorerSplitHeight = num;
									await this.saveSettings();
									if (this.splitViewManager) {
										this.splitViewManager.applyLayout();
									}
								}
							});
					});

				new Setting(containerEl)
					.setName('Show File Icons')
					.setDesc('Display file type icons (Markdown, Table, Canvas, Images) next to filenames.')
					.addToggle((t) => {
						t.setValue(this.settings.explorerRecentShowIcons !== false)
							.onChange(async (val) => {
								this.settings.explorerRecentShowIcons = val;
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.renderRecentList();
								}
							});
					});

				new Setting(containerEl)
					.setName('Backlog Migration & Archive')
					.setHeading();

				new Setting(containerEl)
					.setName('Backlog Target Folder Path')
					.setDesc('Vault folder path where files/folders are moved when using "Move to Backlog" (default: Backlog).')
					.addText((text) => {
						text.setPlaceholder('Backlog')
							.setValue(this.settings.backlogFolderPath || 'Backlog')
							.onChange(async (val) => {
								this.settings.backlogFolderPath = val.trim() || 'Backlog';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Base Explorer Filter Mode')
					.setHeading();

				new Setting(containerEl)
					.setName('Enable Base Explorer Mode Feature')
					.setDesc('Allows filtering the Obsidian file explorer tree to display folders and Base files only (.base, .base.json, .base.md, index.md).')
					.addToggle((t) => {
						t.setValue(this.settings.enableBaseExplorerMode === true)
							.onChange(async (val) => {
								this.settings.enableBaseExplorerMode = val;
								if (!val) {
									this.settings.baseExplorerActive = false;
								}
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyBaseExplorerFilter();
								}
							});
					});

				new Setting(containerEl)
					.setName('Add Index Setup (Folder Auto Index)')
					.setHeading();

				new Setting(containerEl)
					.setName('Enable Auto Index Creation on Folder Click')
					.setDesc('Clicking folder name in file explorer will check if index.md exists. If missing, automatically creates index.md with title frontmatter and opens it.')
					.addToggle((t) => {
						t.setValue(this.settings.enableAutoFolderIndex === true)
							.onChange(async (val) => {
								this.settings.enableAutoFolderIndex = val;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Merge Folder Index & Base Files in Explorer Row')
					.setDesc('Merges index.md and index.base / thebase.base into the folder row as interactive [i] and [base] boxes, hiding the duplicate files from the folder children list.')
					.addToggle((t) => {
						t.setValue(this.settings.enableMergeFolderIndex !== false)
							.onChange(async (val) => {
								this.settings.enableMergeFolderIndex = val;
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.refreshFolderBadges();
									this.splitViewManager.applyBaseExplorerFilter();
								}
							});
					});

				new Setting(containerEl)
					.setName('Show index.md & index.base Rows in Explorer')
					.setDesc('Keep index.md and index.base files visible as rows in the folder tree without hiding the [i] and [base] badges on the folder row. Can also be toggled from the explorer toolbar icon.')
					.addToggle((t) => {
						t.setValue(this.settings.showMergedIndexRows === true)
							.onChange(async (val) => {
								this.settings.showMergedIndexRows = val;
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.updateButtonState();
									this.splitViewManager.refreshFolderBadges();
									this.splitViewManager.applyBaseExplorerFilter();
								}
							});
					});

				new Setting(containerEl)
					.setName('Show Baseless Folders in Base Filter Mode')
					.setDesc('When Base filter is active: show ALL folder rows including those without an index.base file. When disabled (default), only folders that have a base file (or contain a subfolder with one) are shown.')
					.addToggle((t) => {
						t.setValue(this.settings.showBaselessFolderBadge === true)
							.onChange(async (val) => {
								this.settings.showBaselessFolderBadge = val;
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.applyBaseExplorerFilter();
								}
							});
					});

				new Setting(containerEl)
					.setName('Folder Badge Position')
					.setDesc('Where [i] and [base] badges appear on each folder row.')
					.addDropdown((d) => {
						d.addOption('left', 'Left of the text')
							.addOption('right-inline', 'Right beside the text')
							.addOption('right-align', 'Right align of the row')
							.addOption('hidden', 'Hidden')
							.setValue(this.settings.folderBadgePosition ?? 'right-inline')
							.onChange(async (val) => {
								this.settings.folderBadgePosition = val as 'left' | 'right-inline' | 'right-align' | 'hidden';
								await this.saveSettings();
								if (this.splitViewManager) {
									this.splitViewManager.refreshFolderBadges();
								}
							});
					});

				new Setting(containerEl)
					.setName('Show [i] Badge')
					.setDesc('Show the index.md badge on folder rows.')
					.addToggle((t) => {
						t.setValue(this.settings.showFolderBadgeI !== false)
							.onChange(async (val) => {
								this.settings.showFolderBadgeI = val;
								await this.saveSettings();
								if (this.splitViewManager) this.splitViewManager.refreshFolderBadges();
							});
					});

				new Setting(containerEl)
					.setName('Show [base] Badge')
					.setDesc('Show the index.base badge on folder rows.')
					.addToggle((t) => {
						t.setValue(this.settings.showFolderBadgeBase !== false)
							.onChange(async (val) => {
								this.settings.showFolderBadgeBase = val;
								await this.saveSettings();
								if (this.splitViewManager) this.splitViewManager.refreshFolderBadges();
							});
					});

				new Setting(containerEl)
					.setName('Affect Third-Party Count Badge')
					.setDesc('When enabled, aligns folder note count badges from other plugins to the far right of the row. When disabled (default), third-party count badges are completely untouched.')
					.addToggle((t) => {
						t.setValue(this.settings.affectExternalCountBadge === true)
							.onChange(async (val) => {
								this.settings.affectExternalCountBadge = val;
								await this.saveSettings();
								if (this.splitViewManager) this.splitViewManager.refreshFolderBadges();
							});
					});

				new Setting(containerEl)
					.setName('Apply Default Filter on Base Creation')
					.setDesc('When creating a new index.base file via the folder [base] badge, automatically add a folder-scoped filter to all views.')
					.addToggle((t) => {
						t.setValue(this.settings.enableBaseDefaultFilter !== false)
							.onChange(async (val) => {
								this.settings.enableBaseDefaultFilter = val;
								await this.saveSettings();
							});
					});

				const baseFilterSetting = new Setting(containerEl)
					.setName('Default Base Filter Formula')
					.setDesc('1 baris formula filter global ("filters:") yang otomatis berlaku untuk semua view (all views) saat membuat file index.base baru.');

				// Informational Note explaining the formula
				const noteEl = baseFilterSetting.descEl.createDiv({ cls: 'pakcli-base-filter-note' });
				noteEl.style.marginTop = '8px';
				noteEl.style.fontSize = '12px';
				noteEl.style.lineHeight = '1.5';
				noteEl.style.color = 'var(--text-muted)';
				
				const noteTitle = noteEl.createEl('div', { text: 'Note / Penjelasan Formula (All Views):' });
				noteTitle.style.fontWeight = '600';
				noteTitle.style.color = 'var(--text-normal)';
				noteTitle.style.marginBottom = '4px';

				const noteList = noteEl.createEl('ul');
				noteList.style.margin = '0 0 8px 18px';
				noteList.style.padding = '0';

				const liFolder = noteList.createEl('li');
				liFolder.createEl('code', { text: 'file.folder == this.file.folder' }).style.fontWeight = 'bold';
				liFolder.appendText(' : Filter database agar hanya menampilkan catatan yang berada di dalam folder yang sama.');

				const liIndex = noteList.createEl('li');
				liIndex.createEl('code', { text: '!file.name.contains("index")' }).style.fontWeight = 'bold';
				liIndex.appendText(' : Mengecualikan file index (index.md, index.base) agar tidak mengotori atau duplikat di dalam tabel data.');

				const liGlobal = noteList.createEl('li');
				liGlobal.createEl('code', { text: 'filters: <formula>' }).style.fontWeight = 'bold';
				liGlobal.appendText(' : Diletakkan di level root/global sehingga otomatis mewarisi ke semua view (all views) dalam 1 baris ringkas.');

				// Copy-pasteable formula box with 1-click copy button
				const formulaBox = baseFilterSetting.descEl.createDiv({ cls: 'pakcli-base-formula-box' });
				formulaBox.style.display = 'flex';
				formulaBox.style.alignItems = 'center';
				formulaBox.style.gap = '10px';
				formulaBox.style.marginTop = '6px';
				formulaBox.style.padding = '6px 12px';
				formulaBox.style.background = 'var(--background-secondary)';
				formulaBox.style.border = '1px solid var(--background-modifier-border)';
				formulaBox.style.borderRadius = '6px';

				const formulaCode = formulaBox.createEl('code', {
					text: this.settings.baseDefaultFilterFormula || 'file.folder == this.file.folder && !file.name.contains("index")'
				});
				formulaCode.style.flex = '1';
				formulaCode.style.userSelect = 'all';
				formulaCode.style.fontFamily = 'var(--font-monospace)';
				formulaCode.style.fontSize = '12px';
				formulaCode.style.color = 'var(--text-accent)';
				formulaCode.style.overflowWrap = 'anywhere';

				const copyBtn = formulaBox.createEl('button', {
					text: 'Copy Formula',
					cls: 'mod-cta'
				});
				copyBtn.style.fontSize = '11px';
				copyBtn.style.padding = '4px 10px';
				copyBtn.style.cursor = 'pointer';
				copyBtn.style.whiteSpace = 'nowrap';
				copyBtn.addEventListener('click', async (evt) => {
					evt.preventDefault();
					const textToCopy = this.settings.baseDefaultFilterFormula || 'file.folder == this.file.folder && !file.name.contains("index")';
					try {
						await navigator.clipboard.writeText(textToCopy);
						new Notice('Copied formula to clipboard!');
						copyBtn.setText('Copied!');
						setTimeout(() => copyBtn.setText('Copy Formula'), 1600);
					} catch (err) {
						new Notice('Failed to copy formula: ' + String(err));
					}
				});

				baseFilterSetting.addText((text) => {
					text.setPlaceholder('file.folder == this.file.folder && !file.name.contains("index")')
						.setValue(this.settings.baseDefaultFilterFormula || 'file.folder == this.file.folder && !file.name.contains("index")')
						.onChange(async (val) => {
							this.settings.baseDefaultFilterFormula = val;
							formulaCode.setText(val || 'file.folder == this.file.folder && !file.name.contains("index")');
							await this.saveSettings();
						});
					text.inputEl.style.width = '260px';
				});

				new Setting(containerEl)
					.setName('Hover Preview for [i] Badge')
					.setDesc('Show note page preview popup when hovering over the [i] badge on folder rows.')
					.addToggle((t) => {
						t.setValue(this.settings.enableFolderIndexHoverPreview !== false)
							.onChange(async (val) => {
								this.settings.enableFolderIndexHoverPreview = val;
								await this.saveSettings();
								if (this.splitViewManager) this.splitViewManager.refreshFolderBadges();
							});
					});

				new Setting(containerEl)
					.setName('Folder Index Title Prefix')
					.setDesc('Custom prefix to add before the folder name in index.md title frontmatter.')
					.addText((text) => {
						text.setPlaceholder('e.g. Project - ')
							.setValue(this.settings.folderIndexPrefix || '')
							.onChange(async (val) => {
								this.settings.folderIndexPrefix = val;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Folder Index Title Suffix')
					.setDesc('Custom suffix to add after the folder name in index.md title frontmatter.')
					.addText((text) => {
						text.setPlaceholder('e.g. - Notes')
							.setValue(this.settings.folderIndexSuffix || '')
							.onChange(async (val) => {
								this.settings.folderIndexSuffix = val;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Include Timestamp Prefix (YYYY-MM-DD_HH-mm_)')
					.setDesc('Prepend current timestamp YYYY-MM-DD_HH-mm_ to index.md title frontmatter.')
					.addToggle((t) => {
						t.setValue(this.settings.folderIndexUseTimestamp === true)
							.onChange(async (val) => {
								this.settings.folderIndexUseTimestamp = val;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('A–Z Dictionary Settings')
					.setDesc('Configure the A–Z Dictionary Navigator popup, scope, and folder path.')
					.setHeading();

				new Setting(containerEl)
					.setName('Dictionary Scope Mode')
					.setDesc('Choose whether the A–Z Dictionary indexes a designated folder or dynamically tracks the currently active note folder.')
					.addDropdown((d) => {
						d.addOption('specific', 'Specific Folder (Folder Khusus)')
							.addOption('active', 'Active Folder (Folder Aktif)')
							.setValue(this.settings.dictionaryScope || 'specific')
							.onChange(async (val) => {
								this.settings.dictionaryScope = val as 'specific' | 'active';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Target Dictionary Folder')
					.setDesc('Folder path to index when Scope Mode is set to "Specific Folder".')
					.addText((text) => {
						text.setPlaceholder('Dictionary')
							.setValue(this.settings.dictionaryFolderPath || 'Dictionary')
							.onChange(async (val) => {
								this.settings.dictionaryFolderPath = val.trim() || 'Dictionary';
								await this.saveSettings();
								if (this.dictionaryExplorerManager) {
									this.dictionaryExplorerManager.refreshVirtualFolders();
								}
							});
					});

				new Setting(containerEl)
					.setName('Virtual A–Z Folders in File Explorer')
					.setDesc('Organize files inside the Dictionary folder under virtual letter folders (A, B, C...) in the Obsidian file tree without moving physical files.')
					.addToggle((t) => {
						t.setValue(this.settings.enableDictionaryVirtualFolders !== false)
							.onChange(async (val) => {
								this.settings.enableDictionaryVirtualFolders = val;
								await this.saveSettings();
								if (this.dictionaryExplorerManager) {
									this.dictionaryExplorerManager.refreshVirtualFolders();
								}
							});
					});

				new Setting(containerEl)
					.setName('Custom Recent Folder Filters')
					.setDesc('Manage folder paths available in the Recent Files timeframe/folder dropdown.')
					.setHeading();

				const renderFolderFiltersList = (listEl: HTMLElement) => {
					listEl.empty();
					const customPaths = this.settings.customRecentPaths || [];
					if (customPaths.length === 0) {
						listEl.createDiv({
							text: 'No custom folder filters added. Right-click any folder in File Explorer and choose "Add to Recent Dropdown".',
							cls: 'pakcli-calc-empty-note'
						});
						return;
					}

					for (const p of customPaths) {
						new Setting(listEl)
							.setName(p)
							.addButton((btn) => {
								btn.setButtonText('Remove')
									.setWarning()
									.onClick(async () => {
										if (this.splitViewManager) {
											await this.splitViewManager.removeFolderFromRecentFilter(p);
										} else {
											this.settings.customRecentPaths = (this.settings.customRecentPaths || []).filter(item => item !== p);
											await this.saveSettings();
										}
										renderFolderFiltersList(listEl);
									});
							});
					}
				};

				const foldersListContainer = containerEl.createDiv();
				renderFolderFiltersList(foldersListContainer);
			}
		});

		// 2.5 Image Carousel & Folder Triage (table-image-carousel)
		settingsTab.registerLocalSection({
			id: 'table-image-carousel',
			category: 'table',
			title: 'Image Carousel & Folder Triage',
			icon: 'gallery-thumbnails',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Image Carousel & Folder Triage')
					.setDesc('Interactive card deck swiper and photo carousel for sorting, triaging, renaming, and trashing folder image assets.')
					.setHeading();

				new Setting(containerEl)
					.setName('Image Carousel Deck Orientation')
					.setDesc('Choose default layout for Scope Folder Image View/Edit: Horizontal (Desktop Filmstrip) or Vertical (Mobile Card Stack).')
					.addDropdown((d) => {
						d.addOption('horizontal', 'Horizontal (Desktop Filmstrip)')
							.addOption('vertical', 'Vertical (Mobile Card Stack)')
							.setValue(this.settings.carouselOrientation || 'horizontal')
							.onChange(async (val) => {
								this.settings.carouselOrientation = val as 'horizontal' | 'vertical';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Total Visible Side Cards (0 - 10 Slider)')
					.setDesc('Set number of 3D cards visible on the left and right on the perspective rail (0 = active card only, 1-10 max).')
					.addDropdown((d) => {
						for (let i = 0; i <= 10; i++) {
							d.addOption(String(i), String(i));
						}
						d.setValue(String(this.settings.carouselVisibleSideCards ?? 5))
							.onChange(async (val) => {
								this.settings.carouselVisibleSideCards = Number(val);
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Direction')
					.setDesc('Choose direction for carousel auto-advance: Left Right (ping-pong bolak-balik), Left, or Right.')
					.addDropdown((d) => {
						d.addOption('left-right', 'Left Right (default ping-pong bolak-balik)')
							.addOption('left', 'Left')
							.addOption('right', 'Right')
							.setValue(this.settings.carouselDirection || 'left-right')
							.onChange(async (val) => {
								this.settings.carouselDirection = val as 'left-right' | 'left' | 'right';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Animation Setting')
					.setDesc('Transition curve: exponential up and down (default kurva halus S-curve) or linear.')
					.addDropdown((d) => {
						d.addOption('exponential', 'exponential up and down (default kurva halus S-curve)')
							.addOption('linear', 'linear')
							.setValue(this.settings.carouselAnimationCurve || 'exponential')
							.onChange(async (val) => {
								this.settings.carouselAnimationCurve = val as 'exponential' | 'linear';
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Switch Duration (Seconds)')
					.setDesc('Slide transition time for each card switch (0 - 5s).')
					.addDropdown((d) => {
						const options = ['0', '0.1', '0.25', '0.5', '0.75', '1', '1.5', '2', '3', '4', '5'];
						for (const opt of options) {
							d.addOption(opt, `${opt} s`);
						}
						d.setValue(String(this.settings.carouselSwitchDuration ?? 0.5))
							.onChange(async (val) => {
								this.settings.carouselSwitchDuration = Number(val);
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Hold Duration (Seconds)')
					.setDesc('Hold/pause time on each card before advancing (0 - 3s).')
					.addDropdown((d) => {
						const options = ['0', '0.25', '0.5', '1', '1.5', '2', '3'];
						for (const opt of options) {
							d.addOption(opt, `${opt} s`);
						}
						d.setValue(String(this.settings.carouselHoldDuration ?? 1.0))
							.onChange(async (val) => {
								this.settings.carouselHoldDuration = Number(val);
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Enable Carousel Autoplay')
					.setDesc('Automatically advance cards according to the timing and direction settings.')
					.addToggle((t) => {
						t.setValue(this.settings.carouselAutoPlay !== false)
							.onChange(async (val) => {
								this.settings.carouselAutoPlay = val;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Enable Cursor Follow / Mouse Parallax Effect')
					.setDesc('Allow 3D cards on the carousel stage to shift/follow mouse movement (disabled by default).')
					.addToggle((t) => {
						t.setValue(Boolean(this.settings.carouselCursorFollow))
							.onChange(async (val) => {
								this.settings.carouselCursorFollow = val;
								await this.saveSettings();
							});
					});
			}
		});

		// 3. Tree Diagram & Hierarchy Explorer (table-tree)
		settingsTab.registerLocalSection({
			id: 'table-tree',
			category: 'table',
			title: 'Tree Diagram & Hierarchy Explorer',
			icon: 'folder-tree',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Tree Diagram & Hierarchy Explorer')
					.setDesc('Visual folder structure diagrams and tree view generators for markdown codeblocks.')
					.setHeading();

				new Setting(containerEl)
					.setName('Enable Tree Post-processor')
					.setDesc('Render tree codeblocks as interactive diagrams and folder views.')
					.addToggle((t) => {
						t.setValue(this.settings.enableTreeProcessor !== false)
							.onChange(async (v) => {
								this.settings.enableTreeProcessor = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Default Tree Layout')
					.setDesc('Default layout orientation for generated hierarchy diagrams.')
					.addDropdown((d) => {
						d.addOption('Left-to-Right', 'Left-to-Right (Horizontal)')
							.addOption('Top-to-Bottom', 'Top-to-Bottom (Vertical)')
							.addOption('Folder Box', 'Folder Box (Nested)')
							.setValue(this.settings.defaultTreeLayout || 'Left-to-Right')
							.onChange(async (v) => {
								this.settings.defaultTreeLayout = v;
								await this.saveSettings();
							});
					});
			}
		});

		settingsTab.registerLocalSection({
			id: 'table-asset-router',
			category: 'table',
			title: 'Asset Router & Attachments',
			icon: 'folder-input',
			isInstalled: true,
			render: (containerEl) => {
				const pluginSettings = this.settings;
				const saveSettings = async () => await this.saveSettings();

				new Setting(containerEl)
					.setName('Asset Router & Attachment Manager')
					.setDesc('Automatic attachment routing, centralized media vault, Captain Folders nested mode, and note link auto-updating.')
					.setHeading();

				// 1. Centralized Mode
				new Setting(containerEl).setName('Centralized Mode (Default)').setHeading();

				new Setting(containerEl)
					.setName('Enable Centralized Routing')
					.setDesc('Route all attachments to a single global directory by default.')
					.addToggle(toggle => toggle
						.setValue(pluginSettings.centralAssetFolderEnabled)
						.onChange(async (value) => {
							pluginSettings.centralAssetFolderEnabled = value;
							await saveSettings();
						}));

				new Setting(containerEl)
					.setName('Central Asset Folder')
					.setDesc('Directory at the vault root where default assets will be saved.')
					.addText(text => {
						text.setPlaceholder('assets')
							.setValue(pluginSettings.centralAssetFolder || 'assets')
							.onChange(async (value) => {
								pluginSettings.centralAssetFolder = value.trim() || 'assets';
								await saveSettings();
							});
						new FolderSuggest(this.app, text.inputEl);
					});

				new Setting(containerEl)
					.setName('Use Note Title in Centralized Mode')
					.setDesc('Use note frontmatter "title" property when renaming attachments instead of filename.')
					.addToggle(toggle => toggle
						.setValue(pluginSettings.useNoteTitleGlobalCentral)
						.onChange(async (value) => {
							pluginSettings.useNoteTitleGlobalCentral = value;
							await saveSettings();
						}));

				new Setting(containerEl)
					.setName('Rescan Centralized Assets')
					.setDesc('Scan the vault and organize all attachments for notes in Centralized Mode (excluding Captain Folders).')
					.addButton(button => button
						.setButtonText('Rescan Centralized')
						.onClick(async () => {
							button.setDisabled(true);
							await this.router.rescanCentralizedAssets();
							button.setDisabled(false);
						}));

				// 2. Global Nested Mode Settings
				new Setting(containerEl).setName('Nested Mode Globals').setHeading();

				new Setting(containerEl)
					.setName('Use Note Title in Nested Mode (Default)')
					.setDesc('Default setting for Captain Folders to use frontmatter "title" property.')
					.addToggle(toggle => toggle
						.setValue(pluginSettings.useNoteTitleGlobalNested)
						.onChange(async (value) => {
							pluginSettings.useNoteTitleGlobalNested = value;
							await saveSettings();
						}));

				new Setting(containerEl)
					.setName('Path Delimiter')
					.setDesc('Character used to join directories and file titles.')
					.addDropdown(dropdown => dropdown
						.addOption('-', '-')
						.addOption('_', '_')
						.setValue(pluginSettings.delimiter || '-')
						.onChange(async (value) => {
							pluginSettings.delimiter = value;
							await saveSettings();
						}));

				new Setting(containerEl)
					.setName('Monitored File Extensions')
					.setDesc('Comma-separated list of file extensions that the plugin should route.')
					.addTextArea(text => text
						.setPlaceholder('png, jpg, jpeg, pdf')
						.setValue((pluginSettings.assetExtensions || []).join(', '))
						.onChange(async (value) => {
							pluginSettings.assetExtensions = value
								.split(',')
								.map(ext => ext.trim().toLowerCase())
								.filter(ext => ext !== '');
							await saveSettings();
						}));

				// 3. Captain Folders (Rules) Settings
				new Setting(containerEl).setName('Nested Mode Override Rules (Captain Folders)').setHeading();

				const bulkContainer = containerEl.createDiv({ cls: 'asset-router-bulk-container' });
				bulkContainer.style.marginBottom = '10px';

				new ButtonComponent(bulkContainer)
					.setButtonText('Turn On All Rules')
					.setCta()
					.onClick(() => {
						new ConfirmModal(
							this.app,
							'Are you sure you want to enable ALL Captain Folder rules?',
							async () => {
								(pluginSettings.rules || []).forEach(r => r.enabled = true);
								await saveSettings();
								renderRulesTable();
								new Notice('All rules enabled');
							}
						).open();
					});

				const turnOffBtn = new ButtonComponent(bulkContainer)
					.setButtonText('Turn Off All Rules')
					.onClick(() => {
						new ConfirmModal(
							this.app,
							'Are you sure you want to disable ALL Captain Folder rules?',
							async () => {
								(pluginSettings.rules || []).forEach(r => r.enabled = false);
								await saveSettings();
								renderRulesTable();
								new Notice('All rules disabled');
							}
						).open();
					});
				turnOffBtn.buttonEl.style.marginLeft = '10px';

				const rescanAllBtn = new ButtonComponent(bulkContainer)
					.setButtonText('Rescan All Nested')
					.onClick(async () => {
						rescanAllBtn.setDisabled(true);
						await this.router.rescanAllNestedAssets();
						rescanAllBtn.setDisabled(false);
					});
				rescanAllBtn.buttonEl.style.marginLeft = '10px';

				// Form to add new rule
				new Setting(containerEl).setName('Add New Captain Folder Rule').setHeading();
				const addRuleDiv = containerEl.createDiv();
				addRuleDiv.style.border = '1px solid var(--background-modifier-border)';
				addRuleDiv.style.padding = '15px';
				addRuleDiv.style.borderRadius = '8px';
				addRuleDiv.style.marginBottom = '20px';

				let newPath = '';
				let newScope = 'children';
				let newSubCaptain = false;
				let newTitleOverride: TitleOverrideOption = 'inherit';
				let newColor = '#4a5568';

				new Setting(addRuleDiv)
					.setName('Folder Path')
					.setDesc('Relative path from vault root (e.g. folderb or folderb/*)')
					.addText(text => {
						text.setPlaceholder('e.g. folderb/projects')
							.onChange(value => newPath = value.trim());
						new FolderSuggest(this.app, text.inputEl);
					});

				new Setting(addRuleDiv)
					.setName('Rule Scope')
					.setDesc('Should this rule apply to subfolders too?')
					.addDropdown(dropdown => dropdown
						.addOption('folder', 'Folder Only (Exclude Children)')
						.addOption('children', 'Include Children')
						.setValue(newScope)
						.onChange(value => newScope = value));

				new Setting(addRuleDiv)
					.setName('Auto Sub-Captain Mode')
					.setDesc('Treat each subfolder under this Captain Folder as an independent Sub-Captain with its own assets/ directory.')
					.addToggle(toggle => toggle
						.setValue(newSubCaptain)
						.onChange(value => newSubCaptain = value));

				new Setting(addRuleDiv)
					.setName('Note Title Override')
					.setDesc('How to handle Note Title frontmatter parsing for this folder.')
					.addDropdown(dropdown => dropdown
						.addOption('inherit', 'Inherit Default')
						.addOption('always', 'Always Use Title')
						.addOption('never', 'Never Use Title')
						.setValue(newTitleOverride)
						.onChange((value: string) => newTitleOverride = value as TitleOverrideOption));

				const colorPickerSetting = addRuleDiv.createDiv({ cls: 'setting-item' });
				const colorPickerInfo = colorPickerSetting.createDiv({ cls: 'setting-item-info' });
				colorPickerInfo.createDiv({ cls: 'setting-item-name', text: 'Captain Folder Color' });
				colorPickerInfo.createDiv({ cls: 'setting-item-description', text: 'Color shown in Bubble Graph when \'Captain Colors\' toggle is active. Default: dark gray.' });
				const colorPickerControl = colorPickerSetting.createDiv({ cls: 'setting-item-control' });
				const colorPreviewSpan = colorPickerControl.createEl('span', { cls: 'asset-router-color-preview' });
				colorPreviewSpan.style.cssText = `display:inline-block;width:22px;height:22px;border-radius:4px;border:1px solid var(--background-modifier-border);background:${newColor};margin-right:8px;vertical-align:middle;`;
				const colorInput = colorPickerControl.createEl('input');
				colorInput.type = 'color';
				colorInput.value = newColor;
				colorInput.style.cssText = 'width:40px;height:28px;cursor:pointer;border:none;background:none;padding:0;';
				colorInput.oninput = () => {
					newColor = colorInput.value;
					colorPreviewSpan.style.background = newColor;
				};
				const resetColorBtn = colorPickerControl.createEl('button', { text: 'Reset', cls: 'mod-warning' });
				resetColorBtn.style.cssText = 'font-size:11px;padding:2px 8px;margin-left:8px;';
				resetColorBtn.onclick = () => {
					newColor = '#4a5568';
					colorInput.value = '#4a5568';
					colorPreviewSpan.style.background = '#4a5568';
				};

				const addBtnContainer = addRuleDiv.createDiv();
				addBtnContainer.style.textAlign = 'right';
				addBtnContainer.style.marginTop = '10px';

				const rulesTableContainer = containerEl.createDiv({ cls: 'asset-router-rules-table-container' });

				const renderRulesTable = () => {
					rulesTableContainer.empty();
					if (!pluginSettings.rules || pluginSettings.rules.length === 0) {
						rulesTableContainer.createEl('p', { text: 'No Captain Folder rules configured yet.', cls: 'setting-item-description' });
						return;
					}

					const table = rulesTableContainer.createEl('table');
					table.style.width = '100%';
					const thead = table.createEl('thead');
					const headerRow = thead.createEl('tr');
					headerRow.createEl('th', { text: 'Active' });
					headerRow.createEl('th', { text: 'Folder Path' });
					headerRow.createEl('th', { text: 'Scope' });
					headerRow.createEl('th', { text: 'Sub-Captain' });
					headerRow.createEl('th', { text: 'Title' });
					headerRow.createEl('th', { text: 'Color' });
					headerRow.createEl('th', { text: 'Actions' });

					const tbody = table.createEl('tbody');
					pluginSettings.rules.forEach((rule, idx) => {
						const row = tbody.createEl('tr');
						const activeTd = row.createEl('td');
						const toggle = activeTd.createEl('input');
						toggle.type = 'checkbox';
						toggle.checked = rule.enabled;
						toggle.onchange = async () => {
							rule.enabled = toggle.checked;
							await saveSettings();
						};

						row.createEl('td', { text: rule.path === '' ? '/' : rule.path });
						row.createEl('td', { text: rule.includeChildren ? 'Children' : 'Folder' });
						row.createEl('td', { text: rule.subCaptainMode ? 'Yes' : 'No' });
						row.createEl('td', { text: rule.useNoteTitle });

						// Color picker cell
						const colorTd = row.createEl('td');
						colorTd.style.cssText = 'text-align:center;vertical-align:middle;';
						const colorSwatch = colorTd.createEl('span');
						const currentColor = rule.color || '#4a5568';
						colorSwatch.style.cssText = `display:inline-block;width:18px;height:18px;border-radius:3px;border:1px solid var(--background-modifier-border);background:${currentColor};margin-right:4px;vertical-align:middle;cursor:pointer;`;
						const rowColorInput = colorTd.createEl('input');
						rowColorInput.type = 'color';
						rowColorInput.value = currentColor;
						rowColorInput.title = 'Set Captain Folder color for Bubble Graph';
						rowColorInput.style.cssText = 'width:28px;height:22px;cursor:pointer;border:none;background:none;padding:0;vertical-align:middle;';
						rowColorInput.oninput = async () => {
							rule.color = rowColorInput.value;
							colorSwatch.style.background = rowColorInput.value;
							await saveSettings();
						};
						// Click swatch to open picker
						colorSwatch.onclick = () => rowColorInput.click();

						const actionsTd = row.createEl('td');
						const rescanBtn = new ButtonComponent(actionsTd)
							.setButtonText('Rescan')
							.onClick(async () => {
								rescanBtn.setDisabled(true);
								await this.router.rescanFolderRuleAssets(rule);
								rescanBtn.setDisabled(false);
							});
						rescanBtn.buttonEl.style.marginRight = '8px';

						const delBtn = new ButtonComponent(actionsTd)
							.setButtonText('Delete')
							.setWarning()
							.onClick(async () => {
								pluginSettings.rules.splice(idx, 1);
								await saveSettings();
								renderRulesTable();
							});
					});
				};

				new ButtonComponent(addBtnContainer)
					.setButtonText('Add Rule')
					.setCta()
					.onClick(async () => {
						if (!pluginSettings.rules) pluginSettings.rules = [];
						pluginSettings.rules.push({
							path: newPath,
							isNested: true,
							includeChildren: newScope === 'children',
							subCaptainMode: newSubCaptain,
							useNoteTitle: newTitleOverride,
							enabled: true,
							color: newColor,
						});
						await saveSettings();
						renderRulesTable();
						new Notice(`Rule added: ${newPath || '/'}`);
					});

				renderRulesTable();
			}
		});

		// 3. Codeblock Scaler & Themes (table-codeblock)
		settingsTab.registerLocalSection({
			id: 'table-codeblock',
			category: 'table',
			title: 'Codeblock Scaler & Themes',
			icon: 'code',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('Codeblock Scaler & Styling')
					.setDesc('Auto-scaler, syntax themes, flowclip viewer, and responsive codeblock wrapping.')
					.setHeading();

				new Setting(containerEl)
					.setName('Default Codeblock Wrap & Flow Mode')
					.setDesc('Choose how long code lines are handled in Live Preview and Reading views.')
					.addDropdown((d) => {
						d.addOption('flowclip', 'Flow Clip (Horizontal Scrollbar)')
							.addOption('wrap', 'Word Wrap (Wrap Lines)')
							.addOption('scalefit', 'Scale Fit (Auto Font Scaling)')
							.setValue(this.settings.codeblockWrapMode || 'flowclip')
							.onChange(async (v: string) => {
								this.settings.codeblockWrapMode = v as 'flowclip' | 'wrap' | 'scalefit';
								this.applyCodeblockStyle();
								await this.saveSettings();
								this.codeblockScaler.scheduleRescale();
							});
					});

				new Setting(containerEl)
					.setName('Enable Native Asset Drag & Drop')
					.setDesc('Allow dragging images, PDFs, and media directly out of rendered codeblocks.')
					.addToggle((t) => {
						t.setValue(this.settings.enableAssetDrag !== false)
							.onChange(async (v) => {
								this.settings.enableAssetDrag = v;
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Per-Language Rules')
					.setDesc('Customize behavior for specific languages (e.g., ascii, python, sql, markdown).')
					.setHeading();

				const rulesBox = containerEl.createDiv({ cls: 'pakcli-codeblock-rules-section' });

				const renderLangRules = () => {
					console.log('[PakCLI DBG] renderLangRules called');
					rulesBox.empty();
					const rules = this.settings.codeblockLanguageRules || [];
					console.log('[PakCLI DBG] rules array:', JSON.stringify(rules));

					if (rules.length === 0) {
						rulesBox.createEl('p', {
							text: 'No per-language rules configured. Default wrap mode applies to all languages.',
							cls: 'setting-item-description'
						});
					} else {
						const table = rulesBox.createEl('table');
						table.style.width = '100%';
						table.style.marginBottom = '12px';
						table.style.borderCollapse = 'collapse';
						const thead = table.createEl('thead');
						const hRow = thead.createEl('tr');
						hRow.createEl('th', { text: 'Language' });
						hRow.createEl('th', { text: 'Behavior' });
						const thClip = hRow.createEl('th', { text: 'On Clipboard' });
						thClip.title = 'Custom script triggered on copy. Use .{ scripts } or { scripts }invoke()';
						const thReplace = hRow.createEl('th', { text: 'Replace Wrapper' });
						thReplace.title = 'If Yes, scans prefix and suffix (.{}, {}.invoke(), @{}) and replaces already written wrappers instead of double-wrapping.';
						hRow.createEl('th', { text: 'Delete' });

						const tbody = table.createEl('tbody');
						rules.forEach((rule, idx) => {
							console.log(`[PakCLI DBG] rendering row ${idx}:`, JSON.stringify(rule));
							const row = tbody.createEl('tr');
							row.createEl('td', { text: rule.language });

							const behaviorTd = row.createEl('td');
							const sel = behaviorTd.createEl('select', { cls: 'dropdown' });
							[
								{ text: 'Scale Fit (Auto Vector)', value: 'scalefit' },
								{ text: 'Flow Clip (Scrollbar)', value: 'flowclip' },
								{ text: 'Word Wrap', value: 'wrap' },
							].forEach(({ text, value }) => {
								const opt = sel.createEl('option', { text });
								opt.value = value;
								opt.selected = rule.behavior === value;
								console.log(`[PakCLI DBG] option created: text="${text}" value="${opt.value}" selected=${opt.selected}`);
							});
							console.log(`[PakCLI DBG] sel.value after options set = "${sel.value}"`);
							sel.addEventListener('change', async () => {
								console.log(`[PakCLI DBG] behavior change fired: sel.value="${sel.value}" rule was:`, JSON.stringify(rule));
								try {
									rule.behavior = sel.value as 'scalefit' | 'flowclip' | 'wrap';
									console.log('[PakCLI DBG] calling saveSettings...');
									await this.saveSettings();
									console.log('[PakCLI DBG] saveSettings done, calling scheduleRescale...');
									this.codeblockScaler.scheduleRescale();
									console.log('[PakCLI DBG] scheduleRescale done. settings now:', JSON.stringify(this.settings.codeblockLanguageRules));
								} catch (err) {
									console.error('[PakCLI] behavior save error:', err);
									new Notice('Failed to save behavior setting.');
								}
							});
							console.log('[PakCLI DBG] behavior change listener registered on sel');

							// On Clipboard column
							const clipTd = row.createEl('td', { cls: 'pakcli-cb-clip-td' });

							const isPs = ['powershell', 'ps1', 'pwsh', 'ps'].includes(rule.language.trim().toLowerCase());

							if (isPs) {
								// Hardcoded PowerShell presets as a dropdown
								const PS_PRESETS: { label: string; value: string }[] = [
									{ label: '— none —',    value: '' },
									{ label: '{}.invoke()', value: 'invoke' },
									{ label: '.{}',         value: 'dot' },
									{ label: '@{}',         value: 'at' },
								];

								const psSel = clipTd.createEl('select', { cls: 'dropdown pakcli-cb-ps-select' });
								const currentVal = (rule.onClipboard ?? '').trim();
								PS_PRESETS.forEach((preset) => {
									const opt = psSel.createEl('option', { text: preset.label });
									opt.value = preset.value;
									const isSelected =
										currentVal === preset.value ||
										(preset.value === 'invoke' && (currentVal.includes('invoke') || currentVal === '{}.invoke()' || currentVal === '{}.incvoke' || currentVal === 'invoke')) ||
										(preset.value === 'dot' && (currentVal.startsWith('.{') || currentVal === '.{}' || currentVal.includes('. prefix') || currentVal === 'dot')) ||
										(preset.value === 'at' && (currentVal.startsWith('@{') || currentVal === '@{}' || currentVal.includes('@ prefix') || currentVal.includes("'@'") || currentVal === 'at'));
									opt.selected = isSelected;
								});
								psSel.addEventListener('change', async () => {
									try {
										rule.onClipboard = psSel.value;
										await this.saveSettings();
										this.codeblockScaler.scheduleRescale();
										new Notice(`Saved PowerShell clipboard setting: ${psSel.options[psSel.selectedIndex]?.text}`);
									} catch (err) {
										console.error('[PakCLI] onClipboard save error:', err);
										new Notice('Failed to save clipboard setting.');
									}
								});
							} else {
								// Free textarea for all other languages
								const clipArea = clipTd.createEl('textarea', { cls: 'pakcli-cb-clip-area' });
								clipArea.placeholder = '.{\n\tscripts\n}\n// or\n{\n\tscripts\n}invoke()';
								clipArea.value = rule.onClipboard || '';
								clipArea.rows = 2;
								clipArea.title = 'Custom clipboard template. Use "scripts" where code should be inserted.';
								const saveClipScript = async () => {
									try {
										rule.onClipboard = clipArea.value.trim();
										await this.saveSettings();
										this.codeblockScaler.scheduleRescale();
										new Notice('Saved clipboard template.');
									} catch (err) {
										console.error('[PakCLI] clipboard script save error:', err);
										new Notice('Failed to save clipboard script.');
									}
								};
								clipArea.addEventListener('change', saveClipScript);
								clipArea.addEventListener('blur',   saveClipScript);
							}

							// Replace Wrapper column (Yes / No)
							const replaceTd = row.createEl('td', { cls: 'pakcli-cb-replace-td' });
							if (isPs) {
								const repSel = replaceTd.createEl('select', { cls: 'dropdown pakcli-cb-replace-select' });
								[
									{ label: 'Yes', value: 'true' },
									{ label: 'No',  value: 'false' },
								].forEach((optData) => {
									const opt = repSel.createEl('option', { text: optData.label });
									opt.value = optData.value;
									opt.selected = (rule.replaceExisting !== false && optData.value === 'true') ||
									               (rule.replaceExisting === false && optData.value === 'false');
								});
								repSel.addEventListener('change', async () => {
									try {
										rule.replaceExisting = repSel.value === 'true';
										await this.saveSettings();
										this.codeblockScaler.scheduleRescale();
										new Notice(`PowerShell replace wrapper: ${rule.replaceExisting ? 'Yes' : 'No'}`);
									} catch (err) {
										console.error('[PakCLI] replaceExisting save error:', err);
										new Notice('Failed to save replace setting.');
									}
								});
							} else {
								replaceTd.createEl('span', { text: '—', cls: 'pakcli-cb-dash' });
							}

							const actTd = row.createEl('td');
							const delBtn = new ButtonComponent(actTd)
								.setButtonText('Delete')
								.setWarning()
								.onClick(async () => {
									this.settings.codeblockLanguageRules.splice(idx, 1);
									await this.saveSettings();
									this.codeblockScaler.scheduleRescale();
									renderLangRules();
								});
						});
					}

					// Add new rule form
					let newLang = '';
					let newBehavior: 'scalefit' | 'flowclip' | 'wrap' = 'scalefit';

					new Setting(rulesBox)
						.setName('Add Language Rule')
						.setDesc('Define a custom behavior for a specific language tag.')
						.addText((t) => {
							t.setPlaceholder('e.g. ascii, python, sql')
								.onChange((v) => { newLang = v.trim().toLowerCase(); });
						})
						.addDropdown((d) => {
							d.addOption('scalefit', 'Scale Fit')
								.addOption('flowclip', 'Flow Clip')
								.addOption('wrap', 'Word Wrap')
								.setValue(newBehavior)
								.onChange((v) => { newBehavior = v as 'scalefit' | 'flowclip' | 'wrap'; });
						})
						.addButton((b) => {
							b.setButtonText('+ Add Rule')
								.setCta()
								.onClick(async () => {
									if (!newLang) {
										new Notice('Please enter a language identifier.');
										return;
									}
									if (!this.settings.codeblockLanguageRules) {
										this.settings.codeblockLanguageRules = [];
									}
									this.settings.codeblockLanguageRules.push({
										id: String(Date.now()),
										language: newLang,
										behavior: newBehavior
									});
									await this.saveSettings();
									this.codeblockScaler.scheduleRescale();
									renderLangRules();
									new Notice(`Added rule for "${newLang}".`);
								});
						});
				};

				renderLangRules();
			}
		});

		// 4. ASCII Motion & Canvas Studio (table-ascii)
		settingsTab.registerLocalSection({
			id: 'table-ascii',
			category: 'table',
			title: 'ASCII Motion & Canvas Studio',
			icon: 'sparkles',
			isInstalled: true,
			render: (containerEl) => {
				new Setting(containerEl)
					.setName('ASCII Studio & Motion Canvas')
					.setDesc('Render ASCII and ASCI codeblocks as animated retro-futuristic canvas diagrams.')
					.setHeading();

				new Setting(containerEl)
					.setName('Enable ASCII Canvas Renderer')
					.setDesc('Render ASCII diagrams with interactive playback controls and copy buttons.')
					.addToggle((t) => {
						t.setValue(true)
							.onChange(async (v) => {
								await this.saveSettings();
							});
					});

				new Setting(containerEl)
					.setName('Default ASCII Canvas Theme')
					.setDesc('Color theme for ASCII diagrams.')
					.addDropdown((d) => {
						d.addOption('Monochrome Matrix', 'Monochrome Matrix (Green/Black)')
							.addOption('Cyberpunk Amber', 'Cyberpunk Amber (Amber Glow)')
							.addOption('Chalkboard White', 'Chalkboard White (Classic)')
							.addOption('Dracula Neon', 'Dracula Neon (Purple/Cyan)')
							.setValue('Monochrome Matrix')
							.onChange(async (v) => {
								await this.saveSettings();
							});
					});
			}
		});

		// 5. SQLSeal & SQLite Database Handler (table-sqlseal)
		if (this.sqlsealTabInstance) {
			settingsTab.registerLocalSection({
				id: 'table-sqlseal',
				category: 'table',
				title: 'SQLSeal & Database Explorer',
				icon: 'database',
				isInstalled: true,
				render: (containerEl) => {
					(this.sqlsealTabInstance as PluginSettingTab)?.display();
				}
			});
		}

		// 6. Leaflet Mapping Handler (table-leaflet)
		if (this.leafletTabInstance) {
			settingsTab.registerLocalSection({
				id: 'table-leaflet',
				category: 'table',
				title: 'Leaflet Map Bases',
				icon: 'map-pin',
				isInstalled: true,
				render: (containerEl) => {
					(this.leafletTabInstance as PluginSettingTab)?.display();
				}
			});
		}

		this.addSettingTab(settingsTab);
	}
}