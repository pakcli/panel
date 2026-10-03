import { App, Modal, normalizePath, Notice, setIcon, Setting, TFolder } from 'obsidian';
import type PakCLITablePlugin from '../../../main';
import { FolderRule, TitleOverrideOption } from '../types';
import { RoutingSimulationResult, simulateAssetRouting } from '../utils/routingSimulator';

export class AssetRouterQuickManageModal extends Modal {
  private plugin: PakCLITablePlugin;
  private folders: TFolder[];

  // Selected batch options
  private currentMode: 'nested' | 'central' | 'excluded' = 'nested';
  private useNoteTitle: TitleOverrideOption = 'inherit';
  private delimiter: string = '_';
  private includeChildren: boolean = true;
  private subCaptainMode: boolean = false;

  private simulationBoxEl: HTMLElement | null = null;

  constructor(app: App, plugin: PakCLITablePlugin, folders: TFolder[]) {
    super(app);
    this.plugin = plugin;
    this.folders = folders;

    // Detect initial mode from first folder if rules exist
    if (folders.length > 0) {
      const firstPath = normalizePath(folders[0].path);
      const isExcluded = (plugin.settings as any).excludedAssetDirectories?.includes(firstPath);
      const matchedRule = (plugin.settings.rules || []).find(r => normalizePath(r.path) === firstPath);

      if (isExcluded) {
        this.currentMode = 'excluded';
      } else if (matchedRule && matchedRule.isNested) {
        this.currentMode = 'nested';
        this.useNoteTitle = matchedRule.useNoteTitle || 'inherit';
        this.includeChildren = matchedRule.includeChildren !== false;
        this.subCaptainMode = matchedRule.subCaptainMode === true;
      } else {
        this.currentMode = 'central';
      }

      this.delimiter = plugin.settings.delimiter || '_';
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('pakcli-asset-router-modal');
    this.modalEl.style.maxWidth = '640px';

    const count = this.folders.length;

    // 1. Header
    const headerEl = contentEl.createDiv();
    headerEl.style.cssText = 'border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 12px; margin-bottom: 16px;';
    
    const title = headerEl.createEl('h2', {
      text: `📁 Asset Router Quick Manage (${count} Folder${count > 1 ? 's' : ''})`
    });
    title.style.cssText = 'margin: 0 0 4px 0; font-size: 18px; display: flex; align-items: center; gap: 8px;';

    const desc = headerEl.createEl('p', {
      text: 'Configure asset drop & paste routing rules for selected directories with real-time script simulation.'
    });
    desc.style.cssText = 'margin: 0; font-size: 12px; color: var(--text-muted);';

    // 2. Selected Folders Card
    this.renderFolderListCard(contentEl);

    // 3. Live Script Simulation Box ("Lihat Based on Script")
    this.renderSimulationBox(contentEl);

    // 4. Batch Settings Controls
    this.renderBatchControls(contentEl);

    // 5. Action Buttons (Footer)
    this.renderFooterActions(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /**
   * Renders the list of targeted folders with their current status tags
   */
  private renderFolderListCard(parentEl: HTMLElement): void {
    const wrap = parentEl.createDiv();
    wrap.style.cssText = 'margin-bottom: 16px;';

    const label = wrap.createEl('div', { text: '📂 Target Folders:' });
    label.style.cssText = 'font-weight: 600; font-size: 12px; margin-bottom: 6px; color: var(--text-muted);';

    const listContainer = wrap.createDiv();
    listContainer.style.cssText =
      'max-height: 110px; overflow-y: auto; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 10px; display: flex; flex-direction: column; gap: 4px;';

    for (const folder of this.folders) {
      const row = listContainer.createDiv();
      row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; font-size: 12px; padding: 2px 0;';

      const pathSpan = row.createSpan();
      pathSpan.style.cssText = 'font-family: var(--font-monospace); color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      pathSpan.setText(folder.path || 'Vault Root');

      const normPath = normalizePath(folder.path);
      const isExcluded = (this.plugin.settings as any).excludedAssetDirectories?.includes(normPath);
      const matchedRule = (this.plugin.settings.rules || []).find(r => normalizePath(r.path) === normPath && r.enabled);

      const badge = row.createSpan();
      if (isExcluded) {
        badge.setText('⛔ Excluded');
        badge.style.cssText = 'font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.15); color: #ef4444; font-weight: 600;';
      } else if (matchedRule && matchedRule.isNested) {
        badge.setText('⭐ Nested Captain');
        badge.style.cssText = 'font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(234, 179, 8, 0.15); color: #eab308; font-weight: 600;';
      } else {
        badge.setText('🏢 Central Vault');
        badge.style.cssText = 'font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.15); color: #3b82f6; font-weight: 600;';
      }
    }
  }

  /**
   * Renders the real-time simulation dry-run card ("Lihat Based on Script")
   */
  private renderSimulationBox(parentEl: HTMLElement): void {
    const wrap = parentEl.createDiv({ cls: 'pakcli-simulation-box-wrap' });
    wrap.style.cssText = 'margin-bottom: 16px;';

    const label = wrap.createEl('div', { text: '🔍 Live Script Simulation ("Lihat Based on Script"):' });
    label.style.cssText = 'font-weight: 600; font-size: 12px; margin-bottom: 6px; color: var(--text-accent); display: flex; align-items: center; gap: 6px;';

    this.simulationBoxEl = wrap.createDiv({ cls: 'pakcli-simulation-box' });
    this.simulationBoxEl.style.cssText =
      'background: var(--background-primary); border: 1px solid var(--interactive-accent); border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; transition: all 0.15s ease;';

    this.updateSimulationBox();
  }

  /**
   * Recalculates and updates the simulation card contents
   */
  private updateSimulationBox(): void {
    if (!this.simulationBoxEl) return;
    this.simulationBoxEl.empty();

    const sampleFolder = this.folders.length > 0 ? this.folders[0].path : 'Projects/Sample';

    const sim: RoutingSimulationResult = simulateAssetRouting({
      folderPath: sampleFolder,
      sampleNoteName: 'Dashboard',
      sampleAssetName: 'preview_mock.png',
      settings: this.plugin.settings,
      overrideMode: this.currentMode,
      overrideUseTitle: this.useNoteTitle,
      overrideDelimiter: this.delimiter,
      overrideRecursive: this.includeChildren,
      overrideSubCaptain: this.subCaptainMode,
    });

    // Row 1: Source & Asset
    const row1 = this.simulationBoxEl.createDiv();
    row1.style.cssText = 'display: flex; justify-content: space-between; gap: 8px; color: var(--text-muted); font-size: 11px; flex-wrap: wrap;';
    row1.innerHTML = `
      <span>📄 Note: <b>${sim.sourceNotePath}</b></span>
      <span>🖼️ Asset: <b>${sim.sampleAssetName}</b></span>
    `;

    // Row 2: Final Destination (Hero)
    const row2 = this.simulationBoxEl.createDiv();
    row2.style.cssText = 'margin: 4px 0; padding: 6px 10px; background: var(--background-secondary); border-radius: 6px; border-left: 3px solid var(--interactive-accent); font-family: var(--font-monospace); font-size: 12px; word-break: break-all;';
    row2.innerHTML = `
      <div style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 2px;">➔ Final Routed Destination:</div>
      <div style="color: var(--text-accent); font-weight: 600;">${sim.fullPath}</div>
    `;

    // Row 3: Engine Mode Summary
    const row3 = this.simulationBoxEl.createDiv();
    row3.style.cssText = 'font-size: 11px; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;';
    row3.innerHTML = `
      <span>Rule: <b>${sim.modeLabel}</b></span>
      <span>${sim.explanation}</span>
    `;
  }

  /**
   * Renders the batch configuration segmented button and toggles
   */
  private renderBatchControls(parentEl: HTMLElement): void {
    const controlsWrap = parentEl.createDiv();
    controlsWrap.style.cssText = 'margin-bottom: 18px; display: flex; flex-direction: column; gap: 10px;';

    // Mode Selector Segmented Group
    const modeSetting = new Setting(controlsWrap)
      .setName('Asset Routing Mode')
      .setDesc('Choose how dropped and pasted files are routed for the selected folder(s).');

    const btnGroup = modeSetting.controlEl.createDiv();
    btnGroup.style.cssText = 'display: flex; gap: 6px;';

    const modes: { id: 'nested' | 'central' | 'excluded'; label: string; icon: string }[] = [
      { id: 'nested', label: '⭐ Nested Captain', icon: 'folder-heart' },
      { id: 'central', label: '🏢 Central Vault', icon: 'folder-archive' },
      { id: 'excluded', label: '⛔ Excluded', icon: 'folder-x' },
    ];

    const updateModeBtns = () => {
      btnGroup.empty();
      for (const m of modes) {
        const btn = btnGroup.createEl('button', { text: m.label });
        btn.style.cssText = 'font-size: 11px; padding: 4px 8px; font-weight: 500;';
        if (this.currentMode === m.id) {
          btn.addClass('mod-cta');
          btn.style.fontWeight = '600';
        }
        btn.onclick = () => {
          this.currentMode = m.id;
          updateModeBtns();
          this.updateSimulationBox();
        };
      }
    };

    updateModeBtns();

    // Nested Options Group (Only visible if Nested Captain Mode is chosen)
    const nestedControls = controlsWrap.createDiv({ cls: 'pakcli-nested-controls-group' });
    nestedControls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    const updateNestedVisibility = () => {
      nestedControls.style.display = this.currentMode === 'nested' ? 'flex' : 'none';
    };

    // Note Title Prefix Rule
    new Setting(nestedControls)
      .setName('Note Title Prefix')
      .setDesc('Prefix note name to asset filename (e.g. Note_Image.png).')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('inherit', 'Inherit from Global Default')
          .addOption('always', 'Always Prefix Note Title')
          .addOption('never', 'Never Prefix Note Title')
          .setValue(this.useNoteTitle)
          .onChange((val) => {
            this.useNoteTitle = val as TitleOverrideOption;
            this.updateSimulationBox();
          });
      });

    // Delimiter Input
    new Setting(nestedControls)
      .setName('Delimiter Override')
      .setDesc('Character used to join prefix parts (default: _).')
      .addText((text) => {
        text
          .setValue(this.delimiter)
          .setPlaceholder('_')
          .onChange((val) => {
            this.delimiter = val.trim() || '_';
            this.updateSimulationBox();
          });
      });

    // Recursive Subfolders Toggle
    new Setting(nestedControls)
      .setName('Recursive Subfolders')
      .setDesc('Apply this captain folder rule to all child subfolders.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.includeChildren)
          .onChange((val) => {
            this.includeChildren = val;
            this.updateSimulationBox();
          });
      });

    // Sub-Captain Mode Toggle
    new Setting(nestedControls)
      .setName('Sub-Captain Mode')
      .setDesc('Each direct subfolder gets its own local assets/ folder.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.subCaptainMode)
          .onChange((val) => {
            this.subCaptainMode = val;
            this.updateSimulationBox();
          });
      });

    updateNestedVisibility();
  }

  /**
   * Renders the footer action buttons
   */
  private renderFooterActions(parentEl: HTMLElement): void {
    const footer = parentEl.createDiv();
    footer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--background-modifier-border); padding-top: 14px; margin-top: 10px;';

    // Clear Rules Button (Left)
    const clearBtn = footer.createEl('button', { text: 'Clear Custom Rules' });
    clearBtn.style.cssText = 'font-size: 11px; color: var(--text-muted);';
    clearBtn.onclick = async () => {
      await this.clearRulesForFolders();
      this.close();
    };

    // Right Group: Cancel & Save
    const rightGroup = footer.createDiv();
    rightGroup.style.cssText = 'display: flex; gap: 8px;';

    const cancelBtn = rightGroup.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const count = this.folders.length;
    const saveBtn = rightGroup.createEl('button', {
      text: `💾 Apply to ${count} Folder${count > 1 ? 's' : ''}`,
      cls: 'mod-cta'
    });
    saveBtn.style.fontWeight = '600';
    saveBtn.onclick = async () => {
      await this.applyBatchRules();
      this.close();
    };
  }

  /**
   * Applies the batch rules to all selected folders and syncs router
   */
  private async applyBatchRules(): Promise<void> {
    const count = this.folders.length;
    if (count === 0) return;

    if (!this.plugin.settings.rules) {
      this.plugin.settings.rules = [];
    }
    if (!(this.plugin.settings as any).excludedAssetDirectories) {
      (this.plugin.settings as any).excludedAssetDirectories = [];
    }

    for (const folder of this.folders) {
      const cleanPath = normalizePath(folder.path);

      if (this.currentMode === 'excluded') {
        // Excluded: add to excludedAssetDirectories, remove from rules
        if (!(this.plugin.settings as any).excludedAssetDirectories.includes(cleanPath)) {
          (this.plugin.settings as any).excludedAssetDirectories.push(cleanPath);
        }
        this.plugin.settings.rules = this.plugin.settings.rules.filter(r => normalizePath(r.path) !== cleanPath);
      } else if (this.currentMode === 'nested') {
        // Nested Captain: remove from excludedAssetDirectories, upsert rule
        (this.plugin.settings as any).excludedAssetDirectories = (this.plugin.settings as any).excludedAssetDirectories.filter(
          (p: string) => p !== cleanPath
        );

        const existingIdx = this.plugin.settings.rules.findIndex(r => normalizePath(r.path) === cleanPath);
        const newRule: FolderRule = {
          path: cleanPath,
          isNested: true,
          includeChildren: this.includeChildren,
          subCaptainMode: this.subCaptainMode,
          useNoteTitle: this.useNoteTitle,
          enabled: true,
          assetRouterEnabled: true,
          source: 'manual',
        };

        if (existingIdx >= 0) {
          this.plugin.settings.rules[existingIdx] = Object.assign({}, this.plugin.settings.rules[existingIdx], newRule);
        } else {
          this.plugin.settings.rules.push(newRule);
        }
      } else {
        // Centralized: remove from excluded, remove or disable custom nested rule
        (this.plugin.settings as any).excludedAssetDirectories = (this.plugin.settings as any).excludedAssetDirectories.filter(
          (p: string) => p !== cleanPath
        );
        this.plugin.settings.rules = this.plugin.settings.rules.filter(r => normalizePath(r.path) !== cleanPath);
      }
    }

    await this.plugin.saveSettings();
    new Notice(`Updated Asset Router rules for ${count} folder${count > 1 ? 's' : ''}!`);
  }

  /**
   * Resets selected folders back to default central routing
   */
  private async clearRulesForFolders(): Promise<void> {
    const count = this.folders.length;
    for (const folder of this.folders) {
      const cleanPath = normalizePath(folder.path);
      (this.plugin.settings as any).excludedAssetDirectories = (
        (this.plugin.settings as any).excludedAssetDirectories || []
      ).filter((p: string) => p !== cleanPath);
      this.plugin.settings.rules = (this.plugin.settings.rules || []).filter(
        r => normalizePath(r.path) !== cleanPath
      );
    }
    await this.plugin.saveSettings();
    new Notice(`Reset ${count} folder${count > 1 ? 's' : ''} to Central Asset Router.`);
  }
}
