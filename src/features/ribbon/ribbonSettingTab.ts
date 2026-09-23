import { App, Plugin, PluginSettingTab, Setting, ButtonComponent, ToggleComponent, setIcon } from 'obsidian';
import { RibbonManager } from './ribbonManager';
import { RibbonGroupConfig, RibbonGroupSpacing, RibbonDividerStyle } from './types';

export class RibbonManagerSettingTab extends PluginSettingTab {
	private ribbonManager: RibbonManager;
	private searchQuery: string = '';

	constructor(app: App, plugin: Plugin, ribbonManager: RibbonManager) {
		super(app, plugin);
		this.ribbonManager = ribbonManager;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('pakcli-ribbon-settings-tab');

		// 1. Header Banner
		const headerWrap = containerEl.createDiv({ cls: 'pakcli-ribbon-header-wrap' });
		const titleEl = headerWrap.createEl('h2', { text: 'PakCLI Ribbon Manager' });
		titleEl.style.marginTop = '0';
		headerWrap.createEl('p', {
			cls: 'setting-item-description',
			text: 'Organize your vertical ribbon bar into neat groups (Vanilla & Community Plugins) with clean spacing, toggle button visibility, and customize order without hidden subfolders.'
		});

		const currentSettings = (this.plugin as any).settings;

		// 2. Master Toggle
		new Setting(containerEl)
			.setName('Enable Ribbon Grouping & Spacing')
			.setDesc('Automatically organize ribbon action buttons into Vanilla and Plugin groups separated by visual spacing.')
			.addToggle((toggle: ToggleComponent) => {
				toggle.setValue(currentSettings?.enableRibbonGrouping !== false)
					.onChange(async (val: boolean) => {
						await this.ribbonManager.setEnableGrouping(val);
						this.display();
					});
			});

		// 3. Layout & Divider Options
		new Setting(containerEl)
			.setName('Group Spacing Size')
			.setDesc('Vertical space separation between different plugin groups.')
			.addDropdown((dropdown) => {
				dropdown.addOption('compact', 'Compact (4px)')
					.addOption('medium', 'Medium (8px) - Default')
					.addOption('large', 'Large (14px)')
					.setValue(currentSettings?.ribbonGroupSpacing || 'medium')
					.onChange(async (val: string) => {
						await this.ribbonManager.setGroupSpacing(val as RibbonGroupSpacing);
					});
			});

		new Setting(containerEl)
			.setName('Group Divider Style')
			.setDesc('Visual separator appearance rendered between ribbon groups.')
			.addDropdown((dropdown) => {
				dropdown.addOption('space', 'Empty Spacing Only')
					.addOption('hairline', 'Subtle Hairline - Default')
					.addOption('dot', 'Subtle Accent Dot')
					.setValue(currentSettings?.ribbonDividerStyle || 'hairline')
					.onChange(async (val: string) => {
						await this.ribbonManager.setDividerStyle(val as RibbonDividerStyle);
					});
			});

		// 4. Action bar (Search & Controls)
		const actionToolbar = containerEl.createDiv({ cls: 'pakcli-ribbon-toolbar' });
		
		const searchInput = actionToolbar.createEl('input', {
			type: 'text',
			placeholder: '🔍 Search buttons or plugins...',
			cls: 'pakcli-ribbon-search-input'
		});
		searchInput.value = this.searchQuery;
		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value.trim().toLowerCase();
			this.renderGroupsList(groupsContainer);
		});

		const btnRow = actionToolbar.createDiv({ cls: 'pakcli-ribbon-btn-row' });

		new ButtonComponent(btnRow)
			.setButtonText('🔄 Refresh Detection')
			.setTooltip('Scan DOM for recently loaded plugins or ribbon buttons')
			.onClick(() => {
				this.ribbonManager.scheduleApplyLayout();
				this.display();
			});

		new ButtonComponent(btnRow)
			.setButtonText('↺ Reset to Defaults')
			.setWarning()
			.setTooltip('Reset group order, item order, and show all hidden buttons')
			.onClick(async () => {
				await this.ribbonManager.resetToDefaults();
				this.display();
			});

		// 5. Detected Groups Container
		const groupsContainer = containerEl.createDiv({ cls: 'pakcli-ribbon-groups-container' });
		this.renderGroupsList(groupsContainer);
	}

	/**
	 * Render the list of detected groups and their individual buttons.
	 */
	public renderGroupsList(container: HTMLElement): void {
		container.empty();

		const groups = this.ribbonManager.getDiscoveredGroups();
		const currentSettings = (this.plugin as any).settings;
		const hiddenSet = new Set(currentSettings?.ribbonHiddenItemIds || []);

		if (groups.length === 0) {
			const emptyBox = container.createDiv({ cls: 'pakcli-ribbon-empty-card' });
			emptyBox.createEl('p', { text: 'No ribbon action buttons detected in the left ribbon bar.' });
			return;
		}

		// Filter groups if search query is provided
		let filteredGroups = groups;
		if (this.searchQuery) {
			filteredGroups = groups.map(grp => {
				const matchesGrpName = grp.name.toLowerCase().includes(this.searchQuery);
				const matchedItems = grp.items.filter(item =>
					item.title.toLowerCase().includes(this.searchQuery) ||
					item.pluginName.toLowerCase().includes(this.searchQuery)
				);
				if (matchesGrpName) return grp;
				if (matchedItems.length > 0) return { ...grp, items: matchedItems };
				return null;
			}).filter(Boolean) as RibbonGroupConfig[];
		}

		filteredGroups.forEach((group, groupIdx) => {
			const groupCard = container.createDiv({ cls: 'pakcli-ribbon-group-card' });
			if (group.isVanilla) {
				groupCard.addClass('is-vanilla');
			}

			// Group Header
			const groupHeader = groupCard.createDiv({ cls: 'pakcli-ribbon-group-header' });

			const groupTitleWrap = groupHeader.createDiv({ cls: 'pakcli-ribbon-group-title-wrap' });
			const iconSpan = groupTitleWrap.createSpan({ cls: 'pakcli-ribbon-group-badge-icon' });
			iconSpan.setText(group.isVanilla ? '🏛️' : '🔌');

			const groupTitle = groupTitleWrap.createEl('strong', {
				text: group.name,
				cls: 'pakcli-ribbon-group-title'
			});

			const badge = groupTitleWrap.createSpan({ cls: 'pakcli-ribbon-count-badge' });
			const visibleCount = group.items.filter(it => !hiddenSet.has(it.id)).length;
			badge.setText(`${visibleCount} / ${group.items.length} active`);

			// Group Reorder Controls (Move Up / Down)
			const groupControls = groupHeader.createDiv({ cls: 'pakcli-ribbon-group-controls' });

			if (groupIdx > 0) {
				const upBtn = groupControls.createEl('button', {
					text: '↑',
					cls: 'pakcli-ribbon-move-btn',
					title: 'Move group up'
				});
				upBtn.onclick = async () => {
					const allGroups = this.ribbonManager.getDiscoveredGroups();
					const curIdx = allGroups.findIndex(g => g.id === group.id);
					if (curIdx > 0) {
						const temp = allGroups[curIdx];
						allGroups[curIdx] = allGroups[curIdx - 1];
						allGroups[curIdx - 1] = temp;
						await this.ribbonManager.reorderGroups(allGroups.map(g => g.id));
						this.renderGroupsList(container);
					}
				};
			}

			if (groupIdx < filteredGroups.length - 1) {
				const downBtn = groupControls.createEl('button', {
					text: '↓',
					cls: 'pakcli-ribbon-move-btn',
					title: 'Move group down'
				});
				downBtn.onclick = async () => {
					const allGroups = this.ribbonManager.getDiscoveredGroups();
					const curIdx = allGroups.findIndex(g => g.id === group.id);
					if (curIdx !== -1 && curIdx < allGroups.length - 1) {
						const temp = allGroups[curIdx];
						allGroups[curIdx] = allGroups[curIdx + 1];
						allGroups[curIdx + 1] = temp;
						await this.ribbonManager.reorderGroups(allGroups.map(g => g.id));
						this.renderGroupsList(container);
					}
				};
			}

			// Group Items List
			const itemsList = groupCard.createDiv({ cls: 'pakcli-ribbon-items-list' });

			group.items.forEach((item, itemIdx) => {
				const isVisible = !hiddenSet.has(item.id);
				const itemRow = itemsList.createDiv({ cls: 'pakcli-ribbon-item-row' });
				if (!isVisible) {
					itemRow.addClass('is-hidden');
				}

				// Item Icon Preview & Title
				const itemInfo = itemRow.createDiv({ cls: 'pakcli-ribbon-item-info' });

				const iconPreview = itemInfo.createSpan({ cls: 'pakcli-ribbon-icon-preview' });
				if (item.svgHtml) {
					iconPreview.innerHTML = item.svgHtml;
				} else {
					setIcon(iconPreview, 'file-text');
				}

				const titleText = itemInfo.createSpan({
					cls: 'pakcli-ribbon-item-title',
					text: item.title
				});
				titleText.title = item.id;

				// Controls: Move Up/Down + Toggle Switch
				const itemControls = itemRow.createDiv({ cls: 'pakcli-ribbon-item-controls' });

				if (itemIdx > 0) {
					const itemUpBtn = itemControls.createEl('button', {
						text: '↑',
						cls: 'pakcli-ribbon-item-move-btn',
						title: 'Move button up'
					});
					itemUpBtn.onclick = async () => {
						const curItems = [...group.items];
						const temp = curItems[itemIdx];
						curItems[itemIdx] = curItems[itemIdx - 1];
						curItems[itemIdx - 1] = temp;
						await this.ribbonManager.reorderItemsInGroup(group.id, curItems.map(it => it.id));
						this.renderGroupsList(container);
					};
				}

				if (itemIdx < group.items.length - 1) {
					const itemDownBtn = itemControls.createEl('button', {
						text: '↓',
						cls: 'pakcli-ribbon-item-move-btn',
						title: 'Move button down'
					});
					itemDownBtn.onclick = async () => {
						const curItems = [...group.items];
						const temp = curItems[itemIdx];
						curItems[itemIdx] = curItems[itemIdx + 1];
						curItems[itemIdx + 1] = temp;
						await this.ribbonManager.reorderItemsInGroup(group.id, curItems.map(it => it.id));
						this.renderGroupsList(container);
					};
				}

				// Toggle ON/OFF
				new ToggleComponent(itemControls)
					.setValue(isVisible)
					.setTooltip(isVisible ? 'Hide this button from ribbon' : 'Show this button in ribbon')
					.onChange(async (checked: boolean) => {
						await this.ribbonManager.toggleItemVisibility(item.id, checked);
						if (checked) {
							itemRow.removeClass('is-hidden');
						} else {
							itemRow.addClass('is-hidden');
						}
						// Update active count badge
						const updatedVisible = group.items.filter(it => (it.id === item.id ? checked : !hiddenSet.has(it.id))).length;
						badge.setText(`${updatedVisible} / ${group.items.length} active`);
					});
			});
		});
	}
}
