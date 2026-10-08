import { App, normalizePath, Notice, setIcon, Setting } from 'obsidian';
import type PakCLITablePlugin from '../../../main';
import {
  deserializeDirectoryRules,
  FrontmatterSuggestDirectory,
  FrontmatterSuggestRule,
  serializeDirectoryRules
} from '../types';
import { FolderSuggest } from './FolderSuggest';

export class FrontmatterSuggestCardRenderer {
  private app: App;
  private plugin: PakCLITablePlugin;

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  public render(containerEl: HTMLElement, onSave: () => Promise<void>): void {
    containerEl.empty();

    const settings = this.plugin.settings as any;
    if (!settings.frontmatterSuggestRules) {
      settings.frontmatterSuggestRules = [];
    }

    // 1. Header & Master Toggle
    new Setting(containerEl)
      .setName('Scoped Property Suggestions (v11)')
      .setDesc('Scope Obsidian Base and note property dropdowns (e.g. "category") to specific vault directories, eliminating vault-wide autocomplete noise.')
      .setHeading();

    const masterToggleSetting = new Setting(containerEl)
      .setName('Enable Scoped Property Suggestions')
      .setDesc('When enabled, property fields configured below will strictly suggest values discovered from their designated directories.')
      .addToggle((toggle) => {
        toggle
          .setValue(settings.enableFrontmatterSuggester !== false)
          .onChange(async (val) => {
            settings.enableFrontmatterSuggester = val;
            await onSave();
            this.plugin.frontmatterSuggestManager?.invalidateCache();
            this.render(containerEl, onSave);
            new Notice(val ? 'Property scoper enabled!' : 'Property scoper disabled.');
          });
      });

    // Button to Add New Rule
    const addRuleBtn = masterToggleSetting.controlEl.createEl('button', {
      text: '+ Add Property Rule',
      cls: 'mod-cta'
    });
    addRuleBtn.style.cssText = 'font-size: 12px; margin-left: 12px;';
    addRuleBtn.onclick = async () => {
      const newRule: FrontmatterSuggestRule = {
        id: `rule_${Date.now()}`,
        propertyKey: 'category',
        enabled: true,
        applyToAllBases: true,
        directories: [{ path: 'Dictionary', active: true, includeSubfolders: true }],
        viewMode: 'card'
      };
      settings.frontmatterSuggestRules.push(newRule);
      await onSave();
      this.plugin.frontmatterSuggestManager?.invalidateCache();
      this.render(containerEl, onSave);
    };

    if (settings.enableFrontmatterSuggester === false) {
      return;
    }

    // 2. Rules List Container
    const rulesContainer = containerEl.createDiv({ cls: 'pakcli-suggest-rules-container' });
    rulesContainer.style.cssText = 'margin-top: 16px; display: flex; flex-direction: column; gap: 18px;';

    const rules: FrontmatterSuggestRule[] = settings.frontmatterSuggestRules;

    if (rules.length === 0) {
      const emptyState = rulesContainer.createDiv();
      emptyState.style.cssText =
        'background: var(--background-secondary); border: 1px dashed var(--background-modifier-border); border-radius: 8px; padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;';
      emptyState.setText('No frontmatter rules configured yet. Click "+ Add Property Rule" to create one!');
      return;
    }

    rules.forEach((rule, ruleIdx) => {
      this.renderRuleCard(rulesContainer, rule, ruleIdx, onSave, () => {
        this.render(containerEl, onSave);
      });
    });
  }

  private renderRuleCard(
    parentEl: HTMLElement,
    rule: FrontmatterSuggestRule,
    ruleIdx: number,
    onSave: () => Promise<void>,
    reRenderAll: () => void
  ): void {
    const card = parentEl.createDiv({ cls: 'pakcli-suggest-rule-card' });
    card.style.cssText =
      'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; transition: border-color 0.2s;';

    // -------------------------------------------------------------
    // ROW 1: Rule Controls (Property Key, All Bases Toggle, Enable Toggle, View Mode, Delete)
    // -------------------------------------------------------------
    const row1 = card.createDiv({ cls: 'pakcli-rule-row-header' });
    row1.style.cssText =
      'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px;';

    // Left group: Property Key Input
    const leftGroup = row1.createDiv();
    leftGroup.style.cssText = 'display: flex; align-items: center; gap: 8px; flex: 1; min-width: 240px;';

    const keyLabel = leftGroup.createSpan({ text: '🏷️ Frontmatter Column:' });
    keyLabel.style.cssText = 'font-weight: 600; font-size: 13px; color: var(--text-normal); white-space: nowrap;';

    const keyInput = leftGroup.createEl('input', { type: 'text', value: rule.propertyKey });
    keyInput.placeholder = 'e.g. category, categori';
    keyInput.style.cssText =
      'flex: 1; max-width: 220px; font-family: var(--font-monospace); font-size: 12px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary);';
    keyInput.onchange = async () => {
      rule.propertyKey = keyInput.value.trim() || 'category';
      await onSave();
      this.plugin.frontmatterSuggestManager?.invalidateCache();
      reRenderAll();
    };

    // Right group: Toggles & View Mode Switcher
    const rightGroup = row1.createDiv();
    rightGroup.style.cssText = 'display: flex; align-items: center; gap: 14px; flex-wrap: wrap;';

    // Toggle: All Bases in Vault
    const allBasesWrap = rightGroup.createDiv();
    allBasesWrap.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 12px;';
    allBasesWrap.title =
      'When ON: This rule applies across all .base tables in your vault. When OFF: It only applies when editing notes or bases located inside the scoped directories.';
    const allBasesLabel = allBasesWrap.createSpan({ text: '⚡ All Bases in Vault:' });
    allBasesLabel.style.cssText = 'color: var(--text-muted);';

    const allBasesCheckbox = allBasesWrap.createEl('input', { type: 'checkbox' });
    allBasesCheckbox.checked = rule.applyToAllBases !== false;
    allBasesCheckbox.onchange = async () => {
      rule.applyToAllBases = allBasesCheckbox.checked;
      await onSave();
      this.plugin.frontmatterSuggestManager?.invalidateCache();
    };

    // Toggle: Enable Rule Switch
    const enableWrap = rightGroup.createDiv();
    enableWrap.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 12px;';
    const enableLabel = enableWrap.createSpan({ text: 'Active:' });
    enableLabel.style.cssText = 'font-weight: 600; color: var(--text-normal);';

    const enableCheckbox = enableWrap.createEl('input', { type: 'checkbox' });
    enableCheckbox.checked = rule.enabled !== false;
    enableCheckbox.onchange = async () => {
      rule.enabled = enableCheckbox.checked;
      await onSave();
      this.plugin.frontmatterSuggestManager?.invalidateCache();
      reRenderAll();
    };

    // View Switcher (Card vs String)
    const viewSwitchBtn = rightGroup.createEl('button', {
      text: rule.viewMode === 'string' ? '📝 String View' : '🎴 Card View'
    });
    viewSwitchBtn.style.cssText = 'font-size: 11px; padding: 3px 8px;';
    viewSwitchBtn.onclick = async () => {
      rule.viewMode = rule.viewMode === 'string' ? 'card' : 'string';
      await onSave();
      reRenderAll();
    };

    // Delete Rule Button
    const delRuleBtn = rightGroup.createEl('button', { cls: 'clickable-icon' });
    delRuleBtn.style.cssText = 'padding: 4px; color: var(--text-muted); cursor: pointer;';
    setIcon(delRuleBtn, 'trash-2');
    delRuleBtn.title = 'Delete this property rule';
    delRuleBtn.onclick = async () => {
      const settings = this.plugin.settings as any;
      settings.frontmatterSuggestRules.splice(ruleIdx, 1);
      await onSave();
      this.plugin.frontmatterSuggestManager?.invalidateCache();
      reRenderAll();
      new Notice(`Removed rule for "${rule.propertyKey}".`);
    };

    // -------------------------------------------------------------
    // ROW 2: Directory List (Card View or String View)
    // -------------------------------------------------------------
    const row2 = card.createDiv({ cls: 'pakcli-rule-row-body' });

    if (rule.viewMode === 'string') {
      this.renderStringView(row2, rule, onSave, reRenderAll);
    } else {
      this.renderCardView(row2, rule, onSave, reRenderAll);
    }

    // -------------------------------------------------------------
    // ROW 3: Live Value Inspector Chips
    // -------------------------------------------------------------
    this.renderLiveValueInspector(card, rule);
  }

  /**
   * Renders the interactive Table / Card list of directories
   */
  private renderCardView(
    container: HTMLElement,
    rule: FrontmatterSuggestRule,
    onSave: () => Promise<void>,
    reRenderAll: () => void
  ): void {
    const listWrap = container.createDiv();
    listWrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    const header = listWrap.createDiv();
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;';

    const title = header.createSpan({ text: '📁 Scoped Directory Sources (Vault Folders):' });
    title.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--text-muted);';

    const addDirBtn = header.createEl('button', { text: '+ Add Directory' });
    addDirBtn.style.cssText = 'font-size: 11px; padding: 2px 8px;';
    addDirBtn.onclick = async () => {
      rule.directories.push({ path: '', active: true, includeSubfolders: true });
      await onSave();
      reRenderAll();
    };

    // Render each directory item
    rule.directories.forEach((dir, dirIdx) => {
      const itemRow = listWrap.createDiv();
      itemRow.style.cssText =
        'display: flex; align-items: center; gap: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 10px;';

      const isValid = this.plugin.frontmatterSuggestManager?.isFolderValid(dir.path) ?? true;
      const isPathEmpty = !dir.path || !dir.path.trim();

      // Folder icon
      const iconSpan = itemRow.createSpan();
      setIcon(iconSpan, 'folder');
      iconSpan.style.cssText = `color: ${!isValid && !isPathEmpty ? '#ef4444' : 'var(--text-muted)'}; display: flex; align-items: center;`;

      // Directory Input Box with FolderSuggest
      const dirInput = itemRow.createEl('input', { type: 'text', value: dir.path });
      dirInput.placeholder = 'Type folder path (e.g. Dictionary)...';
      dirInput.style.cssText = `flex: 1; font-size: 12px; padding: 4px 8px; border-radius: 4px; border: 1px solid ${
        !isValid && !isPathEmpty ? '#ef4444' : 'var(--background-modifier-border)'
      }; background: ${!isValid && !isPathEmpty ? 'rgba(239, 68, 68, 0.08)' : 'var(--background-primary)'}; font-family: var(--font-monospace);`;

      new FolderSuggest(this.app, dirInput, async (selectedFolder) => {
        dir.path = selectedFolder.path;
        await onSave();
        this.plugin.frontmatterSuggestManager?.invalidateCache();
        reRenderAll();
      });

      dirInput.onchange = async () => {
        dir.path = normalizePath(dirInput.value.trim());
        await onSave();
        this.plugin.frontmatterSuggestManager?.invalidateCache();
        reRenderAll();
      };

      // Error / Status Badge
      const badge = itemRow.createSpan();
      if (!isPathEmpty) {
        if (isValid) {
          badge.setText('✔ Valid');
          badge.style.cssText =
            'font-size: 10px; font-weight: 600; color: #10b981; background: rgba(16, 185, 129, 0.12); padding: 2px 6px; border-radius: 4px; white-space: nowrap;';
        } else {
          badge.setText('⛔ Not Found in Vault');
          badge.style.cssText =
            'font-size: 10px; font-weight: 600; color: #ef4444; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); padding: 2px 6px; border-radius: 4px; white-space: nowrap;';
        }
      }

      // Active / Inactive Switch Button (1 vs 0)
      const toggleActiveBtn = itemRow.createEl('button');
      toggleActiveBtn.style.cssText =
        'font-size: 11px; padding: 2px 8px; font-family: var(--font-monospace); font-weight: 600; white-space: nowrap; min-width: 110px; text-align: center; justify-content: center; display: inline-flex; align-items: center; box-sizing: border-box;';
      if (dir.active) {
        toggleActiveBtn.setText('🟢 1 (Active)');
        toggleActiveBtn.style.color = '#10b981';
      } else {
        toggleActiveBtn.setText('⚪ 0 (Disabled)');
        toggleActiveBtn.style.color = 'var(--text-muted)';
      }
      toggleActiveBtn.onclick = async () => {
        dir.active = !dir.active;
        await onSave();
        this.plugin.frontmatterSuggestManager?.invalidateCache();
        reRenderAll();
      };

      // Remove Directory button
      const removeBtn = itemRow.createEl('button', { cls: 'clickable-icon' });
      removeBtn.style.cssText = 'padding: 4px; color: var(--text-muted); cursor: pointer;';
      setIcon(removeBtn, 'x');
      removeBtn.title = 'Remove directory from rule';
      removeBtn.onclick = async () => {
        rule.directories.splice(dirIdx, 1);
        await onSave();
        this.plugin.frontmatterSuggestManager?.invalidateCache();
        reRenderAll();
      };
    });
  }

  /**
   * Renders the Raw Multiline String View (e.g. Dictionary:1\nFolder:0)
   */
  private renderStringView(
    container: HTMLElement,
    rule: FrontmatterSuggestRule,
    onSave: () => Promise<void>,
    reRenderAll: () => void
  ): void {
    const stringWrap = container.createDiv();
    stringWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    const info = stringWrap.createDiv();
    info.style.cssText = 'font-size: 11px; color: var(--text-muted); line-height: 1.4;';
    info.innerHTML =
      'Format: <code>path:1</code> (1 = Active, 0 = Disabled). One directory per line. Example:<br><code>Dictionary:1</code><br><code>Knowledge/Tech:1</code><br><code>Archive:0</code>';

    const textarea = stringWrap.createEl('textarea');
    textarea.rows = 4;
    textarea.value = serializeDirectoryRules(rule.directories);
    textarea.style.cssText =
      'width: 100%; font-family: var(--font-monospace); font-size: 12px; padding: 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); resize: vertical;';

    textarea.onchange = async () => {
      rule.directories = deserializeDirectoryRules(textarea.value);
      await onSave();
      this.plugin.frontmatterSuggestManager?.invalidateCache();
      reRenderAll();
    };

    // Live validation feedback for raw string lines
    const invalidDirs = rule.directories.filter(
      (d) => d.path.trim().length > 0 && !(this.plugin.frontmatterSuggestManager?.isFolderValid(d.path) ?? true)
    );

    if (invalidDirs.length > 0) {
      const errBox = stringWrap.createDiv();
      errBox.style.cssText =
        'display: flex; align-items: center; gap: 6px; font-size: 11px; color: #ef4444; background: rgba(239, 68, 68, 0.08); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.2);';
      errBox.innerHTML = `<span>⛔ Unrecognized folder path(s): <b>${invalidDirs.map((d) => d.path).join(', ')}</b></span>`;
    }
  }

  /**
   * Renders the live value inspector chips at the bottom of the rule card
   */
  private renderLiveValueInspector(parentEl: HTMLElement, rule: FrontmatterSuggestRule): void {
    const inspectorWrap = parentEl.createDiv({ cls: 'pakcli-rule-inspector' });
    inspectorWrap.style.cssText =
      'border-top: 1px dashed var(--background-modifier-border); padding-top: 8px; margin-top: 2px; display: flex; flex-direction: column; gap: 6px;';

    const values = this.plugin.frontmatterSuggestManager?.computeDiscoveredValues(rule) || [];

    const header = inspectorWrap.createDiv();
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; font-size: 11px;';

    const countSpan = header.createSpan();
    countSpan.style.cssText = 'color: var(--text-muted); font-weight: 500;';
    countSpan.innerHTML = `Live Discovered Values: <b style="color: var(--text-normal);">${values.length} found</b>`;

    if (values.length > 0) {
      const chipsWrap = inspectorWrap.createDiv();
      chipsWrap.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; max-height: 85px; overflow-y: auto;';

      values.slice(0, 30).forEach((val) => {
        const chip = chipsWrap.createSpan();
        chip.setText(val);
        chip.style.cssText =
          'font-size: 10px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); padding: 2px 6px; border-radius: 4px; color: var(--text-normal); white-space: nowrap;';
      });

      if (values.length > 30) {
        const moreChip = chipsWrap.createSpan();
        moreChip.setText(`+${values.length - 30} more`);
        moreChip.style.cssText = 'font-size: 10px; color: var(--text-muted); padding: 2px 4px;';
      }
    } else {
      const emptyNotice = inspectorWrap.createSpan();
      emptyNotice.style.cssText = 'font-size: 11px; color: var(--text-faint); font-style: italic;';
      emptyNotice.setText('(No matching frontmatter values found in active directories yet)');
    }
  }
}
