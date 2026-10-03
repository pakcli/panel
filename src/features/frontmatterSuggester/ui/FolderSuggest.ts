import { AbstractInputSuggest, App, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private customOnSelect?: (folder: TFolder) => void;

  constructor(app: App, textInputEl: HTMLInputElement, onSelect?: (folder: TFolder) => void) {
    super(app, textInputEl);
    this.customOnSelect = onSelect;
  }

  protected getSuggestions(query: string): TFolder[] {
    const lower = query.toLowerCase().trim();
    const folders: TFolder[] = [];
    const allFiles = this.app.vault.getAllLoadedFiles();
    
    for (const item of allFiles) {
      if (item instanceof TFolder && !item.isRoot()) {
        if (!lower || item.path.toLowerCase().includes(lower)) {
          folders.push(item);
        }
      }
    }
    
    return folders.sort((a, b) => a.path.localeCompare(b.path));
  }

  public renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  public selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(folder.path);
    if (this.customOnSelect) {
      this.customOnSelect(folder);
    }
    this.close();
  }
}
