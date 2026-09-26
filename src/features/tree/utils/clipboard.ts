import { Notice } from 'obsidian';

/**
 * Copy text to clipboard with modern navigator.clipboard and textarea fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      new Notice('Copied to clipboard!');
      return true;
    }
  } catch (e) {
    console.warn('[Tree] navigator.clipboard failed, attempting fallback...', e);
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful) {
      new Notice('Copied to clipboard!');
      return true;
    }
  } catch (err) {
    console.error('[Tree] Failed to copy to clipboard', err);
  }

  new Notice('Failed to copy to clipboard');
  return false;
}

