import { MarkdownView, Notice, Plugin, WorkspaceLeaf, type MarkdownPostProcessorContext } from 'obsidian';
import { AsciiCodeblockRenderer } from './ui/AsciiCodeblockRenderer';
import { AsciiDrawModal } from './ui/AsciiDrawModal';
import { AsciiStudioView, ASCII_STUDIO_VIEW_TYPE } from './ui/AsciiStudioView';

export { ASCII_STUDIO_VIEW_TYPE, AsciiStudioView };

export function registerAsciiDrawFeature(plugin: Plugin): void {
	// 1. Register Codeblock Processors
	const asciiLangs = ['asciidraw', 'ascii-draw', 'ascii-canvas'];

	asciiLangs.forEach(lang => {
		try {
			plugin.registerMarkdownCodeBlockProcessor(lang, (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				const renderer = new AsciiCodeblockRenderer(el, source, lang, ctx, plugin.app);
				ctx.addChild(renderer);
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[ASCII Draw] Failed to register codeblock processor for "${lang}": ${msg}`);
		}
	});

	// 2. Register Workspace Tab View (Embed in Tab Page)
	plugin.registerView(
		ASCII_STUDIO_VIEW_TYPE,
		(leaf: WorkspaceLeaf) => new AsciiStudioView(leaf, plugin as any)
	);

	// 3. Add Ribbon Icon
	plugin.addRibbonIcon('pencil', 'ASCII Studio: New Drawing Canvas', () => {
		openAsciiStudioModal(plugin, false);
	});

	// 4. Add Commands
	plugin.addCommand({
		id: 'asciidraw-open-tab-view',
		name: 'ASCII Studio: Open Drawing Studio in New Tab',
		callback: async () => {
			await openAsciiStudioTab(plugin.app);
		}
	});

	plugin.addCommand({
		id: 'asciidraw-insert-new-canvas',
		name: 'ASCII Studio: Insert New Drawing Canvas at Cursor',
		callback: () => {
			insertNewAsciiBlock(plugin);
		}
	});

	plugin.addCommand({
		id: 'asciidraw-open-fullscreen-studio',
		name: 'ASCII Studio: Open Fullscreen Drawing Studio',
		callback: () => {
			openAsciiStudioModal(plugin, true);
		}
	});
}

export async function openAsciiStudioTab(app: any, initialContent?: string, targetFile?: string): Promise<void> {
	let targetLeaf = app.workspace.getLeaf('tab');
	await targetLeaf.setViewState({
		type: ASCII_STUDIO_VIEW_TYPE,
		active: true
	});
	app.workspace.revealLeaf(targetLeaf);
	if (initialContent && targetLeaf.view instanceof AsciiStudioView) {
		targetLeaf.view.setContent(initialContent, targetFile);
	}
}

export function openAsciiStudioModal(plugin: Plugin, startFullscreen = false, initialContent?: string, targetFile?: string): void {
	const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	const initialTemplate = initialContent || `┌──────────────────────────┐\n│  ASCII Drawing Canvas    │\n└──────────────────────────┘`;

	const modal = new AsciiDrawModal(plugin.app, {
		initialContent: initialTemplate,
		targetFile: targetFile || activeView?.file?.path,
		onSave: async (savedContent: string) => {
			if (activeView && activeView.editor) {
				const editor = activeView.editor;
				const block = `\`\`\`asciidraw\n${savedContent}\n\`\`\`\n`;
				editor.replaceRange(block, editor.getCursor());
				new Notice('Inserted ASCII drawing at cursor.');
			}
		}
	});

	modal.open();

	if (startFullscreen) {
		window.setTimeout(() => {
			modal.modalEl.addClass('is-fullscreen-immersive');
		}, 50);
	}
}

function insertNewAsciiBlock(plugin: Plugin): void {
	const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView || !activeView.editor) {
		new Notice('Please open a markdown note to insert ASCII canvas.');
		return;
	}

	const initialContent = `┌──────────────────────────┐\n│  ASCII Drawing Canvas    │\n└──────────────────────────┘`;

	const modal = new AsciiDrawModal(plugin.app, {
		initialContent,
		targetFile: activeView.file?.path,
		onSave: (savedContent: string) => {
			const editor = activeView.editor;
			const block = `\`\`\`asciidraw\n${savedContent}\n\`\`\`\n`;
			editor.replaceRange(block, editor.getCursor());
			new Notice('✓ Inserted ASCII drawing codeblock!');
		}
	});

	modal.open();
}
