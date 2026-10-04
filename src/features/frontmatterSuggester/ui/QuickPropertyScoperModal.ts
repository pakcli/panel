import { App, Modal, Notice, setIcon, Setting, normalizePath, TFolder } from 'obsidian';
import type PakCLITablePlugin from '../../../main';
import { FrontmatterSuggestDirectory, FrontmatterSuggestRule } from '../types';
import { FolderSuggest } from './FolderSuggest';

export class QuickPropertyScoperModal extends Modal {
  private plugin: PakCLITablePlugin;
  private propertyKey: string;
  private rule: FrontmatterSuggestRule;
  private isNewRule: boolean;

  constructor(app: App, plugin: PakCLITablePlugin, propertyKey: string) {
    super(app);
    this.plugin = plugin;
    this.propertyKey = propertyKey.trim().toLowerCase();

    // Check if an existing rule already matches this key
    const existing = (this.plugin.settings.frontmatterSuggestRules || []).find((r) => {
      const keys = (r.propertyKey || '').split(',').map((k) => k.trim().toLowerCase());
      return keys.includes(this.propertyKey);
    });

    if (existing) {
      this.isNewRule = false;
      // Deep clone rule so modal modifications are non-destructive until user clicks "Save & Apply"
      this.rule = JSON.parse(JSON.stringify(existing));
    } else {
      this.isNewRule = true;
      // Pre-fill a new rule
      const activeFile = this.plugin.frontmatterSuggestManager?.getActiveFileOrBase();
      const currentFolderPath = activeFile?.parent && !activeFile.parent.isRoot() ? activeFile.parent.path : 'Dictionary';
      this.rule = {
        id: `rule_${Date.now()}`,
        propertyKey: this.propertyKey,
        enabled: true,
        applyToAllBases: true,
        directories: [{ path: currentFolderPath, active: true, includeSubfolders: true }],
        viewMode: 'card'
      };
    }
  }

  public onOpen(): void {
    this.modalEl.style.cssText += 'width: 580px; max-width: 95vw; padding: 20px 24px;';
    this.renderModal();
  }

  public onClose(): void {
    this.contentEl.empty();
  }

  private renderModal(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ─── Header ───
    const headerEl = contentEl.createDiv({ cls: 'pakcli-quick-scoper-header' });
    headerEl.style.cssText = 'margin-bottom: 14px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px;';

    const titleEl = headerEl.createEl('h2', { text: `🏷️ Scope Suggestions: "${this.propertyKey}"` });
    titleEl.style.cssText = 'margin: 0 0 4px 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;';

    const descEl = headerEl.createEl('p', {
      text: 'Constrain property autocomplete dropdowns to values discovered within designated vault folders.'
    });
    descEl.style.cssText = 'margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.4;';

    // ─── Controls Row: Active Toggle, All Bases Toggle, Quick Add Folder ───
    const controlsRow = contentEl.createDiv();
    controlsRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 14px;';

    // Left: Active Switch & All Bases Switch
    const switchesGroup = controlsRow.createDiv();
    switchesGroup.style.cssText = 'display: flex; align-items: center; gap: 16px; font-size: 12px;';

    const activeLabel = switchesGroup.createEl('label');
    activeLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 500;';
    const activeCheck = activeLabel.createEl('input', { type: 'checkbox' });
    activeCheck.checked = this.rule.enabled !== false;
    activeLabel.createSpan({ text: 'Active' });
    activeCheck.onchange = () => {
      this.rule.enabled = activeCheck.checked;
      this.renderModal();
    };

    const allBasesLabel = switchesGroup.createEl('label');
    allBasesLabel.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--text-muted);';
    allBasesLabel.title = 'When ON: Applies across all .base tables in your vault. When OFF: Only applies when editing notes or bases located inside the scoped directories.';
    const allBasesCheck = allBasesLabel.createEl('input', { type: 'checkbox' });
    allBasesCheck.checked = this.rule.applyToAllBases !== false;
    allBasesLabel.createSpan({ text: '⚡ All Bases in Vault' });
    allBasesCheck.onchange = () => {
      this.rule.applyToAllBases = allBasesCheck.checked;
    };

    // Right: Quick "+ Add Current Folder" button
    const activeFile = this.plugin.frontmatterSuggestManager?.getActiveFileOrBase();
    const currentFolderPath = activeFile?.parent && !activeFile.parent.isRoot() ? activeFile.parent.path : '';

    if (currentFolderPath) {
      const addCurrentBtn = controlsRow.createEl('button', {
        text: `+ Add Current Folder ("${currentFolderPath}")`
      });
      addCurrentBtn.style.cssText = 'font-size: 11px; padding: 3px 8px; font-weight: 500;';
      addCurrentBtn.onclick = () => {
        const norm = normalizePath(currentFolderPath);
        const existingDir = this.rule.directories.find((d) => normalizePath(d.path) === norm);
        if (existingDir) {
          existingDir.active = true;
        } else {
          this.rule.directories.push({ path: currentFolderPath, active: true, includeSubfolders: true });
        }
        this.renderModal();
      };
    }

    // ─── Scoped Directories List ───
    const dirSection = contentEl.createDiv();
    dirSection.style.cssText = 'margin-bottom: 14px;';

    const dirHeader = dirSection.createDiv();
    dirHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;';

    const dirTitle = dirHeader.createSpan({ text: '📁 Scoped Vault Directories:' });
    dirTitle.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--text-muted);';

    const addDirBtn = dirHeader.createEl('button', { text: '+ Add Directory' });
    addDirBtn.style.cssText = 'font-size: 11px; padding: 2px 8px;';
    addDirBtn.onclick = () => {
      this.rule.directories.push({ path: '', active: true, includeSubfolders: true });
      this.renderModal();
    };

    const dirListWrap = dirSection.createDiv();
    dirListWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto;';

    if (this.rule.directories.length === 0) {
      const emptyMsg = dirListWrap.createDiv();
      emptyMsg.style.cssText = 'padding: 12px; text-align: center; color: var(--text-faint); font-size: 12px; border: 1px dashed var(--background-modifier-border); border-radius: 6px;';
      emptyMsg.setText('No directories configured yet. Click "+ Add Directory" to scope this property.');
    } else {
      this.rule.directories.forEach((dir, dirIdx) => {
        const row = dirListWrap.createDiv();
        row.style.cssText = 'display: flex; align-items: center; gap: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 5px 8px;';

        const isValid = this.plugin.frontmatterSuggestManager?.isFolderValid(dir.path) ?? true;
        const isPathEmpty = !dir.path || !dir.path.trim();

        // Folder Icon
        const iconSpan = row.createSpan();
        setIcon(iconSpan, 'folder');
        iconSpan.style.cssText = `color: ${!isValid && !isPathEmpty ? '#ef4444' : 'var(--text-muted)'}; display: flex; align-items: center;`;

        // Autocomplete text input
        const input = row.createEl('input', { type: 'text', value: dir.path });
        input.placeholder = 'Type folder path (e.g. Dictionary)...';
        input.style.cssText = `flex: 1; font-size: 12px; padding: 4px 8px; border-radius: 4px; border: 1px solid ${
          !isValid && !isPathEmpty ? '#ef4444' : 'var(--background-modifier-border)'
        }; background: ${!isValid && !isPathEmpty ? 'rgba(239, 68, 68, 0.08)' : 'var(--background-primary)'}; font-family: var(--font-monospace);`;

        new FolderSuggest(this.app, input, (folder: TFolder) => {
          dir.path = folder.path;
          this.renderModal();
        });

        input.onchange = () => {
          dir.path = normalizePath(input.value.trim());
          this.renderModal();
        };

        // Status Badge
        if (!isPathEmpty) {
          const badge = row.createSpan();
          if (isValid) {
            badge.setText('✔ Valid');
            badge.style.cssText = 'font-size: 10px; font-weight: 600; color: #10b981; background: rgba(16, 185, 129, 0.12); padding: 2px 6px; border-radius: 4px; white-space: nowrap;';
          } else {
            badge.setText('⛔ Not Found');
            badge.style.cssText = 'font-size: 10px; font-weight: 600; color: #ef4444; background: rgba(239, 68, 68, 0.12); padding: 2px 6px; border-radius: 4px; white-space: nowrap;';
          }
        }

        // Active State Toggle
        const activeBtn = row.createEl('button');
        activeBtn.style.cssText = 'font-size: 11px; padding: 2px 6px; font-family: var(--font-monospace); font-weight: 600; white-space: nowrap;';
        if (dir.active) {
          activeBtn.setText('🟢 1');
          activeBtn.style.color = '#10b981';
          activeBtn.title = 'Active: Suggestions are pulled from this directory';
        } else {
          activeBtn.setText('⚪ 0');
          activeBtn.style.color = 'var(--text-muted)';
          activeBtn.title = 'Disabled: This directory is ignored';
        }
        activeBtn.onclick = () => {
          dir.active = !dir.active;
          this.renderModal();
        };

        // Remove Button
        const delBtn = row.createEl('button', { cls: 'clickable-icon' });
        delBtn.style.cssText = 'padding: 4px; color: var(--text-muted); cursor: pointer;';
        setIcon(delBtn, 'x');
        delBtn.title = 'Remove directory';
        delBtn.onclick = () => {
          this.rule.directories.splice(dirIdx, 1);
          this.renderModal();
        };
      });
    }

    // ─── Live Discovered Values Preview ───
    const inspectorWrap = contentEl.createDiv({ cls: 'pakcli-quick-inspector' });
    inspectorWrap.style.cssText = 'background: var(--background-secondary); border: 1px dashed var(--background-modifier-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 18px; display: flex; flex-direction: column; gap: 6px;';

    const values = this.plugin.frontmatterSuggestManager?.computeDiscoveredValues(this.rule) || [];

    const inspectorHeader = inspectorWrap.createDiv();
    inspectorHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; font-size: 11px;';

    const countLabel = inspectorHeader.createSpan();
    countLabel.style.cssText = 'color: var(--text-muted); font-weight: 500;';
    countLabel.innerHTML = `Live Discovered Values: <b style="color: var(--text-normal);">${values.length} found</b>`;

    if (values.length > 0) {
      const chipsWrap = inspectorWrap.createDiv();
      chipsWrap.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; max-height: 80px; overflow-y: auto;';

      values.slice(0, 30).forEach((val) => {
        const chip = chipsWrap.createSpan();
        chip.setText(val);
        chip.style.cssText = 'font-size: 10px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); padding: 2px 6px; border-radius: 4px; color: var(--text-normal); white-space: nowrap;';
      });

      if (values.length > 30) {
        const moreChip = chipsWrap.createSpan();
        moreChip.setText(`+${values.length - 30} more`);
        moreChip.style.cssText = 'font-size: 10px; color: var(--text-muted); padding: 2px 4px;';
      }
    } else {
      const emptyNotice = inspectorWrap.createSpan();
      emptyNotice.style.cssText = 'font-size: 11px; color: var(--text-faint); font-style: italic;';
      emptyNotice.setText('(No matching frontmatter values found in active directories)');
    }

    // ─── Modal Actions Footer ───
    const footerEl = contentEl.createDiv();
    footerEl.style.cssText = 'display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--background-modifier-border); padding-top: 12px;';

    // Left: Open full settings link
    const settingsLink = footerEl.createEl('a', { text: '⚙️ Open Full Settings' });
    settingsLink.style.cssText = 'font-size: 11px; color: var(--text-muted); cursor: pointer; text-decoration: underline;';
    settingsLink.onclick = () => {
      this.close();
      try {
        (this.app as any).setting?.open?.();
        (this.app as any).setting?.openTabById?.('pakcli-panel');
        this.plugin.settingsTabInstance?.openSection('table-frontmatter-suggest');
      } catch (_) {}
    };

    // Right: Cancel and Save buttons
    const btnGroup = footerEl.createDiv();
    btnGroup.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const cancelBtn = btnGroup.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const saveBtn = btnGroup.createEl('button', { text: 'Save & Apply', cls: 'mod-cta' });
    saveBtn.onclick = async () => {
      await this.saveRule();
    };
  }

  private async saveRule(): Promise<void> {
    const rules = this.plugin.settings.frontmatterSuggestRules || [];
    const existingIdx = rules.findIndex((r) => {
      const keys = (r.propertyKey || '').split(',').map((k) => k.trim().toLowerCase());
      return keys.includes(this.propertyKey);
    });

    if (existingIdx >= 0) {
      rules[existingIdx] = this.rule;
    } else {
      rules.push(this.rule);
    }

    this.plugin.settings.frontmatterSuggestRules = rules;
    await this.plugin.saveSettings();
    this.plugin.frontmatterSuggestManager?.invalidateCache();

    new Notice(`[PakCLI] Saved scoped suggestions for "${this.propertyKey}"!`, 2500);
    this.close();
  }
}
