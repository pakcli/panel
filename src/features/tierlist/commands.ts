import { TierListSettings } from './settings';
import { App, Command, Editor, MarkdownView, TFile } from 'obsidian';
import { TurnFileIntoFolderModal } from './modals/turn-file-into-folder-modal';



export const insertTierListCommand = (settings: TierListSettings) => {
    return {
        id: 'tier-list-insert',
        name: 'Insert tier list',
        editorCallback: (editor: Editor, view: MarkdownView) => {
            const cursor = editor.getCursor();
            const text = constructTierList(settings);
            editor.replaceRange(text, cursor);
            const endPos = {
                line: cursor.line,
                ch: cursor.ch + text.length
            };
            editor.setCursor(endPos);
        },
    }
};

const constructTierList = (settings: TierListSettings) => {
    let text = '';
    settings.tiers.forEach(tier => {
        if (settings.useColors)
            text += `- <span style="background: ${tier.color};">${tier.name}</span>\n`;
        else
            text += `- ${tier.name}\n`;
    })
    text += `- ${settings.unordered} \n`;
    text += `\t- \n`;
    text += `- ${settings.settings} ${settings.tag}\n`;
    return text;
}
export const turnFileIntoFolderCommand = (app: App): Command => {
    return {
        id: 'tier-list-turn-into-folder-note',
        name: 'Turn active note into folder note',
        checkCallback: (checking: boolean) => {
            const activeFile = app.workspace.getActiveFile();
            if (activeFile && activeFile.extension === 'md') {
                if (!checking) {
                    new TurnFileIntoFolderModal(app, activeFile).open();
                }
                return true;
            }
            return false;
        }
    };
};
