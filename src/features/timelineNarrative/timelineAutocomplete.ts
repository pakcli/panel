import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { parseTimelineSource } from './parser';

export type SuggestionType = 'node' | 'jump' | 'note' | 'wikilink';

export interface TimelineSuggestionItem {
  type: SuggestionType;
  text: string;           // The text to insert
  displayText: string;    // Text shown in dropdown
  detail: string;         // Descriptive category label
  suffix?: string;        // Optional auto-closing suffix (like ')' or ']]')
  score?: number;
}

export interface AutocompleteContext {
  contextType: SuggestionType;
  query: string;
  lineIndex: number;
  colStart: number;
  colEnd: number;
  items: TimelineSuggestionItem[];
  suffix?: string;
}

/* --------------------------------------------------------------------------- */
/* 1. Candidate Extraction from Timeline Source                                 */
/* --------------------------------------------------------------------------- */

export function extractTimelineCandidates(source: string): TimelineSuggestionItem[] {
  const items: TimelineSuggestionItem[] = [];
  const seen = new Set<string>();

  const addUnique = (item: TimelineSuggestionItem) => {
    const key = `${item.type}:${item.text.toLowerCase().trim()}`;
    if (!seen.has(key) && item.text.trim().length > 0) {
      seen.add(key);
      items.push(item);
    }
  };

  // 1. Line-by-line regex scanning
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // A. Note: (text)
    const noteMatch = trimmed.match(/\(([^)]+)\)\s*$/);
    if (noteMatch) {
      const noteText = noteMatch[1].trim();
      addUnique({
        type: 'note',
        text: noteText,
        displayText: `(${noteText})`,
        detail: 'Connection Note',
      });
    }

    // B. Jump: > Target
    const jumpMatch = trimmed.match(/>\s*([^[>(]+|\[\[[^\]]+\]\])/);
    if (jumpMatch) {
      const jumpText = jumpMatch[1].trim();
      addUnique({
        type: 'jump',
        text: jumpText,
        displayText: `> ${jumpText}`,
        detail: 'Jump Target',
      });
    }

    // C. Wikilinks [[target]]
    const wikilinkMatches = trimmed.matchAll(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g);
    for (const match of wikilinkMatches) {
      const target = match[1].trim();
      const alias = match[2]?.trim();
      addUnique({
        type: 'wikilink',
        text: `[[${target}${alias ? `|${alias}` : ''}]]`,
        displayText: alias ? `[[${target}|${alias}]]` : `[[${target}]]`,
        detail: 'Wikilink Node',
      });
    }
  }

  // 2. Structural Tree Parsing (all recognized node labels and jumps)
  try {
    const tree = parseTimelineSource(source);
    tree.allNodes.forEach((node) => {
      if (node.label && node.label.trim()) {
        addUnique({
          type: 'node',
          text: node.label.trim(),
          displayText: node.label.trim(),
          detail: 'Node / Sentence',
        });
      }
      if (node.jumpTarget && node.jumpTarget.trim()) {
        addUnique({
          type: 'jump',
          text: node.jumpTarget.trim(),
          displayText: `> ${node.jumpTarget.trim()}`,
          detail: 'Jump Target',
        });
      }
      if (node.note && node.note.trim()) {
        addUnique({
          type: 'note',
          text: node.note.trim(),
          displayText: `(${node.note.trim()})`,
          detail: 'Connection Note',
        });
      }
    });
  } catch (err) {
    // Ignore parser exceptions while user is actively typing partial syntax
  }

  return items;
}

/* --------------------------------------------------------------------------- */
/* 2. Context Detection & Candidate Filtering                                   */
/* --------------------------------------------------------------------------- */

export function detectAutocompleteContext(
  lineText: string,
  col: number,
  allCandidates: TimelineSuggestionItem[]
): AutocompleteContext | null {
  const lineBefore = lineText.slice(0, col);
  const lineAfter = lineText.slice(col);

  let contextType: SuggestionType = 'node';
  let query = '';
  let colStart = 0;
  let suffix: string | undefined = undefined;

  // Case A: Inside note parentheses (e.g. `(text` or `(`)
  const noteMatch = lineBefore.match(/\(([^)]*)$/);
  if (noteMatch) {
    contextType = 'note';
    query = noteMatch[1];
    colStart = (noteMatch.index ?? 0) + 1;
    if (!lineAfter.startsWith(')')) {
      suffix = ')';
    }
  }
  // Case B: After jump indicator > (e.g. `> text` or `>`)
  else if (/>\s*([^(\]]*)$/.test(lineBefore)) {
    const jumpMatch = lineBefore.match(/>\s*([^(\]]*)$/);
    if (jumpMatch) {
      contextType = 'jump';
      query = jumpMatch[1];
      colStart = lineBefore.length - query.length;
    }
  }
  // Case C: Inside wikilink [[ (e.g. `[[text` or `[[`)
  else if (/\[\[([^\]]*)$/.test(lineBefore)) {
    const linkMatch = lineBefore.match(/\[\[([^\]]*)$/);
    if (linkMatch) {
      contextType = 'wikilink';
      query = linkMatch[1];
      colStart = (linkMatch.index ?? 0) + 2;
      if (!lineAfter.startsWith(']]')) {
        suffix = ']]';
      }
    }
  }
  // Case D: Main node label / sentence (e.g. `Be`, `Deviant`, `Talk`)
  else {
    contextType = 'node';
    // Strip leading indent and optional timestamp
    const indentMatch = lineBefore.match(/^[\t ]*/);
    const indentLen = indentMatch ? indentMatch[0].length : 0;
    const afterIndent = lineBefore.slice(indentLen);

    const timeMatch = afterIndent.match(/^_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_\s*/);
    const prefixOffset = indentLen + (timeMatch ? timeMatch[0].length : 0);

    query = lineBefore.slice(prefixOffset);
    colStart = prefixOffset;
  }

  const trimmedQuery = query.trim();

  // If query is empty and context is main node, don't pop up spontaneously unless user typed
  if (contextType === 'node' && trimmedQuery.length === 0) {
    return null;
  }

  const qLower = trimmedQuery.toLowerCase();

  // Filter candidates relevant to the context
  let pool = allCandidates;
  if (contextType === 'note') {
    // Prefer notes, but can also offer node labels
    const notes = allCandidates.filter((c) => c.type === 'note');
    pool = notes.length > 0 ? notes : allCandidates;
  } else if (contextType === 'jump') {
    // A jump targets any node in the flowchart
    pool = allCandidates.filter((c) => c.type === 'node' || c.type === 'jump' || c.type === 'wikilink');
  } else if (contextType === 'wikilink') {
    pool = allCandidates.filter((c) => c.type === 'wikilink' || c.type === 'node');
  }

  // Score each candidate
  const scoredItems: TimelineSuggestionItem[] = [];

  for (const item of pool) {
    const compareText = item.text.replace(/^\[\[|\]\]$/g, '').toLowerCase();
    const displayLower = item.displayText.toLowerCase();

    let score = 0;

    if (trimmedQuery.length === 0) {
      score = 50;
    } else if (compareText.startsWith(qLower) || displayLower.startsWith(qLower)) {
      score = 100 - (compareText.length - qLower.length) * 0.1;
    } else if (new RegExp(`\\b${escapeRegex(qLower)}`).test(compareText)) {
      score = 80;
    } else if (compareText.includes(qLower) || displayLower.includes(qLower)) {
      score = 60;
    }

    if (score > 0) {
      scoredItems.push({
        ...item,
        score,
        suffix,
      });
    }
  }

  // Sort by score descending
  scoredItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (scoredItems.length === 0) {
    return null;
  }

  return {
    contextType,
    query,
    lineIndex: 0,
    colStart,
    colEnd: col,
    items: scoredItems.slice(0, 8),
    suffix,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* --------------------------------------------------------------------------- */
/* 3. Caret Coordinate Computation for HTML TextArea                          */
/* --------------------------------------------------------------------------- */

function getCaretCoordinates(textarea: HTMLTextAreaElement, position: number): { top: number; left: number; lineHeight: number } {
  const div = document.createElement('div');
  const style = window.getComputedStyle(textarea);

  const properties = [
    'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
    'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
    'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize',
    'whiteSpace', 'wordBreak', 'overflowWrap',
  ];

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.top = '0px';
  div.style.left = '-9999px';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';

  properties.forEach((prop) => {
    (div.style as any)[prop] = (style as any)[prop];
  });

  const textBefore = textarea.value.substring(0, position);
  div.textContent = textBefore;

  const span = document.createElement('span');
  span.textContent = textarea.value.substring(position) || '.';
  div.appendChild(span);

  document.body.appendChild(div);

  const spanOffsetTop = span.offsetTop;
  const spanOffsetLeft = span.offsetLeft;
  const parsedLineHeight = parseInt(style.lineHeight, 10) || 20;

  document.body.removeChild(div);

  return {
    top: spanOffsetTop - textarea.scrollTop,
    left: spanOffsetLeft - textarea.scrollLeft,
    lineHeight: parsedLineHeight,
  };
}

/* --------------------------------------------------------------------------- */
/* 4. Textarea Autocomplete Controller                                         */
/* --------------------------------------------------------------------------- */

export class RawTextareaAutocomplete {
  private textarea: HTMLTextAreaElement;
  private popupEl: HTMLElement | null = null;
  private currentContext: AutocompleteContext | null = null;
  private activeIndex = 0;
  private isDestroyed = false;

  constructor(textarea: HTMLTextAreaElement) {
    this.textarea = textarea;
    this.attachEvents();
  }

  private attachEvents() {
    this.textarea.addEventListener('input', this.handleInput);
    this.textarea.addEventListener('keydown', this.handleKeyDown);
    this.textarea.addEventListener('keyup', this.handleKeyUp);
    this.textarea.addEventListener('click', this.handleClick);
    this.textarea.addEventListener('blur', this.handleBlur);
    this.textarea.addEventListener('scroll', this.handleScroll);
  }

  public destroy() {
    this.isDestroyed = true;
    this.hidePopup();
    this.textarea.removeEventListener('input', this.handleInput);
    this.textarea.removeEventListener('keydown', this.handleKeyDown);
    this.textarea.removeEventListener('keyup', this.handleKeyUp);
    this.textarea.removeEventListener('click', this.handleClick);
    this.textarea.removeEventListener('blur', this.handleBlur);
    this.textarea.removeEventListener('scroll', this.handleScroll);
  }

  private handleInput = () => {
    this.checkAndShowSuggestions();
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
      return;
    }
    this.checkAndShowSuggestions();
  };

  private handleClick = () => {
    this.checkAndShowSuggestions();
  };

  private handleBlur = () => {
    setTimeout(() => {
      if (!this.isDestroyed) {
        this.hidePopup();
      }
    }, 200);
  };

  private handleScroll = () => {
    if (this.popupEl) {
      this.updatePopupPosition();
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.popupEl || !this.currentContext || this.currentContext.items.length === 0) {
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % this.currentContext.items.length;
      this.renderPopupItems();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.activeIndex = (this.activeIndex - 1 + this.currentContext.items.length) % this.currentContext.items.length;
      this.renderPopupItems();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      this.applySuggestion(this.currentContext.items[this.activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.hidePopup();
    }
  };

  private checkAndShowSuggestions() {
    const text = this.textarea.value;
    const caret = this.textarea.selectionStart;

    const lines = text.slice(0, caret).split('\n');
    const lineIndex = lines.length - 1;
    const currentLineBefore = lines[lineIndex];

    const allLines = text.split('\n');
    const fullLine = allLines[lineIndex] || '';

    const allCandidates = extractTimelineCandidates(text);
    const context = detectAutocompleteContext(fullLine, currentLineBefore.length, allCandidates);

    if (!context || context.items.length === 0) {
      this.hidePopup();
      return;
    }

    context.lineIndex = lineIndex;
    this.currentContext = context;
    this.activeIndex = 0;
    this.showPopup();
  }

  private showPopup() {
    if (!this.popupEl) {
      this.popupEl = document.createElement('div');
      this.popupEl.className = 'timeline-autocomplete-popup';
      document.body.appendChild(this.popupEl);
    }

    this.renderPopupItems();
    this.updatePopupPosition();
  }

  private updatePopupPosition() {
    if (!this.popupEl) return;

    const caret = this.textarea.selectionStart;
    const coords = getCaretCoordinates(this.textarea, caret);
    const textareaRect = this.textarea.getBoundingClientRect();

    let top = textareaRect.top + coords.top + coords.lineHeight + 4;
    let left = textareaRect.left + coords.left;

    const popupWidth = 320;
    const popupHeight = 260;

    if (left + popupWidth > window.innerWidth - 16) {
      left = window.innerWidth - popupWidth - 16;
    }
    if (left < 16) left = 16;

    if (top + popupHeight > window.innerHeight - 16) {
      top = textareaRect.top + coords.top - popupHeight - 4;
    }

    this.popupEl.style.top = `${top}px`;
    this.popupEl.style.left = `${left}px`;
  }

  private renderPopupItems() {
    if (!this.popupEl || !this.currentContext) return;

    this.popupEl.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'autocomplete-header';
    const title = document.createElement('span');
    title.className = 'header-title';

    if (this.currentContext.contextType === 'jump') {
      title.textContent = '⑂ Jump Targets';
    } else if (this.currentContext.contextType === 'note') {
      title.textContent = '✎ Connection Notes';
    } else if (this.currentContext.contextType === 'wikilink') {
      title.textContent = '🔗 Wikilink Nodes';
    } else {
      title.textContent = '✦ Existing Sentences & Nodes';
    }

    const hint = document.createElement('span');
    hint.className = 'header-hint';
    hint.textContent = 'Tab / ↵ to insert';
    header.appendChild(title);
    header.appendChild(hint);
    this.popupEl.appendChild(header);

    // List
    const list = document.createElement('div');
    list.className = 'autocomplete-list';

    this.currentContext.items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `autocomplete-item ${index === this.activeIndex ? 'selected' : ''}`;

      const badge = document.createElement('span');
      badge.className = `item-badge badge-${item.type}`;
      badge.textContent = item.type === 'jump' ? 'Jump >' : item.type === 'note' ? 'Note' : item.type === 'wikilink' ? 'Link' : 'Node';
      row.appendChild(badge);

      const label = document.createElement('span');
      label.className = 'item-text';
      label.textContent = item.displayText;
      row.appendChild(label);

      const detail = document.createElement('span');
      detail.className = 'item-detail';
      detail.textContent = item.detail;
      row.appendChild(detail);

      row.onmousedown = (e) => {
        e.preventDefault();
        this.applySuggestion(item);
      };

      row.onmouseenter = () => {
        this.activeIndex = index;
        this.renderPopupItems();
      };

      list.appendChild(row);
    });

    this.popupEl.appendChild(list);
  }

  private hidePopup() {
    if (this.popupEl) {
      this.popupEl.remove();
      this.popupEl = null;
    }
    this.currentContext = null;
  }

  private applySuggestion(item: TimelineSuggestionItem) {
    if (!this.currentContext) return;

    const text = this.textarea.value;
    const lines = text.split('\n');
    const lineIndex = this.currentContext.lineIndex;
    const line = lines[lineIndex];

    if (line === undefined) return;

    let insertText = item.text;
    if (this.currentContext.suffix && !insertText.endsWith(this.currentContext.suffix)) {
      insertText += this.currentContext.suffix;
    }

    const beforePart = line.slice(0, this.currentContext.colStart);
    const afterPart = line.slice(this.currentContext.colEnd);
    const newLine = beforePart + insertText + afterPart;

    lines[lineIndex] = newLine;
    const newFullText = lines.join('\n');
    this.textarea.value = newFullText;

    let newCaret = 0;
    for (let i = 0; i < lineIndex; i++) {
      newCaret += lines[i].length + 1;
    }
    newCaret += beforePart.length + insertText.length;

    this.textarea.selectionStart = newCaret;
    this.textarea.selectionEnd = newCaret;
    this.textarea.focus();

    this.textarea.dispatchEvent(new Event('input', { bubbles: true }));

    this.hidePopup();
  }
}

/* --------------------------------------------------------------------------- */
/* 5. Obsidian Editor Suggest (for CodeMirror / Source Mode Markdown)           */
/* --------------------------------------------------------------------------- */

export class TimelineNarrativeEditorSuggest extends EditorSuggest<TimelineSuggestionItem> {
  constructor(app: App) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile): EditorSuggestTriggerInfo | null {
    const lineCount = editor.lineCount();
    let codeblockStart = -1;
    let codeblockEnd = -1;

    for (let l = cursor.line; l >= 0; l--) {
      const line = editor.getLine(l);
      if (/^```(?:timeline-narrative|timeline-tree)/.test(line)) {
        codeblockStart = l;
        break;
      }
      if (l < cursor.line && /^```/.test(line)) {
        break;
      }
    }

    if (codeblockStart === -1 || codeblockStart === cursor.line) {
      return null;
    }

    for (let l = cursor.line; l < lineCount; l++) {
      const line = editor.getLine(l);
      if (/^```$/.test(line.trim())) {
        codeblockEnd = l;
        break;
      }
    }

    if (codeblockEnd === -1 || cursor.line >= codeblockEnd) {
      return null;
    }

    const codeblockLines: string[] = [];
    for (let l = codeblockStart + 1; l < codeblockEnd; l++) {
      codeblockLines.push(editor.getLine(l));
    }
    const fullSource = codeblockLines.join('\n');
    const allCandidates = extractTimelineCandidates(fullSource);

    const currentLine = editor.getLine(cursor.line);
    const context = detectAutocompleteContext(currentLine, cursor.ch, allCandidates);

    if (!context || context.items.length === 0) {
      return null;
    }

    return {
      start: { line: cursor.line, ch: context.colStart },
      end: { line: cursor.line, ch: context.colEnd },
      query: context.query,
    };
  }

  getSuggestions(context: EditorSuggestContext): TimelineSuggestionItem[] {
    const editor = context.editor;
    const cursor = context.start;

    const lineCount = editor.lineCount();
    let codeblockStart = -1;
    let codeblockEnd = -1;

    for (let l = cursor.line; l >= 0; l--) {
      if (/^```(?:timeline-narrative|timeline-tree)/.test(editor.getLine(l))) {
        codeblockStart = l;
        break;
      }
    }
    for (let l = cursor.line; l < lineCount; l++) {
      if (/^```$/.test(editor.getLine(l).trim())) {
        codeblockEnd = l;
        break;
      }
    }

    if (codeblockStart === -1 || codeblockEnd === -1) return [];

    const codeblockLines: string[] = [];
    for (let l = codeblockStart + 1; l < codeblockEnd; l++) {
      codeblockLines.push(editor.getLine(l));
    }

    const allCandidates = extractTimelineCandidates(codeblockLines.join('\n'));
    const detected = detectAutocompleteContext(editor.getLine(cursor.line), context.end.ch, allCandidates);

    return detected ? detected.items : [];
  }

  renderSuggestion(item: TimelineSuggestionItem, el: HTMLElement): void {
    el.addClass('timeline-suggest-item');
    const badge = el.createSpan({ cls: `item-badge badge-${item.type}` });
    badge.setText(item.type === 'jump' ? 'Jump >' : item.type === 'note' ? 'Note' : item.type === 'wikilink' ? 'Link' : 'Node');

    const label = el.createSpan({ cls: 'item-text' });
    label.setText(item.displayText);

    const detail = el.createSpan({ cls: 'item-detail' });
    detail.setText(item.detail);
  }

  selectSuggestion(item: TimelineSuggestionItem, _evt: MouseEvent | KeyboardEvent): void {
    if (!this.context) return;
    const editor = this.context.editor;

    let insertText = item.text;
    if (item.suffix && !insertText.endsWith(item.suffix)) {
      insertText += item.suffix;
    }

    editor.replaceRange(insertText, this.context.start, this.context.end);
    editor.setCursor({
      line: this.context.start.line,
      ch: this.context.start.ch + insertText.length,
    });
  }
}
