import { App, MarkdownPostProcessorContext, Notice, TFile } from 'obsidian';

export async function updateCodeblockSource(
  app: App,
  ctx: MarkdownPostProcessorContext,
  containerEl: HTMLElement,
  newCodeblockContent: string
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(file instanceof TFile)) {
    new Notice('Timeline Narrative: Cannot locate source file for live update.');
    return false;
  }

  const sectionInfo = ctx.getSectionInfo(containerEl);
  if (!sectionInfo) {
    // Fallback: search for the codeblock in the file
    try {
      const fullText = await app.vault.read(file);
      const codeblockRegex = /(```(?:timeline-narrative|timeline-tree)[\s\S]*?```)/;
      const match = fullText.match(codeblockRegex);
      if (match) {
        const replacement = `\`\`\`timeline-narrative\n${newCodeblockContent.trim()}\n\`\`\``;
        const updatedText = fullText.replace(match[0], replacement);
        await app.vault.modify(file, updatedText);
        return true;
      }
    } catch (err) {
      console.error('[Timeline Narrative] Fallback write-back failed:', err);
    }
    return false;
  }

  try {
    const fullText = await app.vault.read(file);
    const lines = fullText.split(/\r?\n/);

    const { lineStart, lineEnd } = sectionInfo;
    // lineStart is ```timeline-narrative
    // lineEnd is ```
    const headerLine = lines[lineStart] || '```timeline-narrative';
    const footerLine = lines[lineEnd] || '```';

    const before = lines.slice(0, lineStart + 1);
    const after = lines.slice(lineEnd);

    const newBlockLines = newCodeblockContent.split(/\r?\n/);
    const updatedLines = [...before, ...newBlockLines, ...after];

    await app.vault.modify(file, updatedLines.join('\n'));
    return true;
  } catch (err) {
    console.error('[Timeline Narrative] Error writing back to source:', err);
    new Notice('Timeline Narrative: Failed to write changes to note.');
    return false;
  }
}
