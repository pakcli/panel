import { TimelineNode, TimelineTree, WikilinkTarget } from './types';

export function parseWikilink(text: string): WikilinkTarget | undefined {
  const match = text.match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
  if (!match) return undefined;
  return {
    raw: text,
    path: match[1].trim(),
    alias: match[2]?.trim(),
  };
}

export function formatTimestamp(rawTimestamp: string): string {
  // raw format: _yyyy-mm-dd_hh-mm_ or _hh-mm_ or _hh:mm_ or hh:mm
  const cleaned = rawTimestamp.replace(/^_|_$/g, '');
  const parts = cleaned.split('_');
  if (parts.length === 2) {
    const date = parts[0];
    const time = parts[1].replace('-', ':');
    return `${date} ${time}`;
  }
  if (parts.length === 1) {
    return parts[0].replace('-', ':');
  }
  return cleaned.replace(/_/g, ' ');
}

export function parseTimelineSource(source: string): TimelineTree {
  const lines = source.split(/\r?\n/);
  const roots: TimelineNode[] = [];
  const allNodes = new Map<string, TimelineNode>();
  const nodesByLabel = new Map<string, TimelineNode[]>();

  // Determine indentation unit from content if spaces are used
  let spaceIndentUnit = 4;
  for (const line of lines) {
    const spaceMatch = line.match(/^( +)[^\s]/);
    if (spaceMatch) {
      const len = spaceMatch[1].length;
      if (len === 2 || len === 3) {
        spaceIndentUnit = 2;
        break;
      }
    }
  }

  const stack: { depth: number; node: TimelineNode }[] = [];

  lines.forEach((originalLine, lineIndex) => {
    // Skip completely empty lines
    if (originalLine.trim() === '') return;

    // 1. Calculate depth
    let depth = 0;
    let content = originalLine;

    const tabMatch = content.match(/^(\t+)/);
    if (tabMatch) {
      depth = tabMatch[1].length;
      content = content.slice(depth);
    } else {
      const spaceMatch = content.match(/^( +)/);
      if (spaceMatch) {
        depth = Math.floor(spaceMatch[1].length / spaceIndentUnit);
        content = content.slice(spaceMatch[1].length);
      }
    }

    content = content.trim();
    if (!content) return;

    // 2. Extract Note at end: (text) or ([[wikilink]])
    let note: string | undefined;
    let noteWikilink: WikilinkTarget | undefined;
    const noteMatch = content.match(/\s*\(([^)]+)\)\s*$/);
    if (noteMatch) {
      note = noteMatch[1].trim();
      noteWikilink = parseWikilink(note);
      content = content.slice(0, noteMatch.index).trim();
    }

    // 3. Extract Jump before note: > Target Label
    let jumpTarget: string | undefined;
    const jumpMatch = content.match(/\s*>\s*([^[>]+|\[\[[^\]]+\]\])\s*$/);
    if (jumpMatch) {
      jumpTarget = jumpMatch[1].trim();
      content = content.slice(0, jumpMatch.index).trim();
    }

    // 4. Extract Timestamp at start: _yyyy-mm-dd_hh-mm_ or _hh-mm_ or hh:mm
    let rawTimestamp: string | undefined;
    let timestamp: string | undefined;
    const timeMatch = content.match(/^(_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_|_\d{2}-\d{2}_|_\d{2}:\d{2}_|\b\d{2}:\d{2}\b)\s*/);
    if (timeMatch) {
      rawTimestamp = timeMatch[1];
      timestamp = formatTimestamp(rawTimestamp);
      content = content.slice(timeMatch[0].length).trim();
    }

    // 5. Remaining string is the Label
    const rawLabel = content;
    const wikilink = parseWikilink(rawLabel);
    const cleanLabel = wikilink ? (wikilink.alias || wikilink.path) : rawLabel;

    // Check if a node with this label already exists (merge duplicate into one node)
    const existingList = nodesByLabel.get(cleanLabel) || (wikilink ? nodesByLabel.get(wikilink.path) : undefined);
    if (existingList && existingList.length > 0 && depth === 0) {
      const targetNode = existingList[0];
      if (jumpTarget) {
        if (!targetNode.jumpTargets) {
          targetNode.jumpTargets = targetNode.jumpTarget ? [targetNode.jumpTarget] : [];
        }
        if (!targetNode.jumpTargets.includes(jumpTarget)) {
          targetNode.jumpTargets.push(jumpTarget);
        }
        targetNode.jumpTarget = jumpTarget;
      }
      if (note && !targetNode.note) {
        targetNode.note = note;
        targetNode.noteWikilink = noteWikilink;
      }
      if (rawTimestamp && !targetNode.rawTimestamp) {
        targetNode.rawTimestamp = rawTimestamp;
        targetNode.timestamp = timestamp;
      }

      // Update stack so any subsequent indented lines attach to this merged node
      stack.length = 0;
      stack.push({ depth: 0, node: targetNode });
      return;
    }

    const node: TimelineNode = {
      id: `node-${lineIndex}-${Math.random().toString(36).slice(2, 7)}`,
      lineIndex,
      depth,
      rawText: originalLine,
      timestamp,
      rawTimestamp,
      label: cleanLabel,
      wikilink,
      jumpTarget,
      jumpTargets: jumpTarget ? [jumpTarget] : [],
      note,
      noteWikilink,
      children: [],
    };

    allNodes.set(node.id, node);

    // Index by label for jump resolution
    const existing = nodesByLabel.get(cleanLabel) || [];
    existing.push(node);
    nodesByLabel.set(cleanLabel, existing);
    if (wikilink && wikilink.path !== cleanLabel) {
      const existingPath = nodesByLabel.get(wikilink.path) || [];
      existingPath.push(node);
      nodesByLabel.set(wikilink.path, existingPath);
    }

    // 6. Stack-based Tree Hierarchy
    if (depth === 0) {
      roots.push(node);
      stack.length = 0;
      stack.push({ depth: 0, node });
    } else {
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }

      if (stack.length > 0) {
        const parent = stack[stack.length - 1].node;
        node.parent = parent;
        parent.children.push(node);
      } else {
        // Fallback to root if indented without parent
        roots.push(node);
      }

      stack.push({ depth, node });
    }
  });

  // 7. Resolve Jump Targets
  allNodes.forEach((node) => {
    if (node.jumpTarget) {
      const cleanJump = node.jumpTarget.replace(/^\[\[|\]\]$/g, '').trim();
      const targets = nodesByLabel.get(cleanJump) || nodesByLabel.get(node.jumpTarget);
      if (targets && targets.length > 0) {
        // Find nearest or first match
        targets[0].isJumpTarget = true;
      }
    }
  });

  return {
    roots,
    allNodes,
    nodesByLabel,
    rawLines: lines,
  };
}

export function serializeTimelineNode(node: {
  depth: number;
  rawTimestamp?: string;
  label: string;
  wikilink?: WikilinkTarget;
  jumpTarget?: string;
  note?: string;
}): string {
  const tabs = '\t'.repeat(node.depth);
  const time = node.rawTimestamp ? `${node.rawTimestamp} ` : '';
  const labelText = node.wikilink ? node.wikilink.raw : node.label;
  const jump = node.jumpTarget ? ` > ${node.jumpTarget}` : '';
  const noteText = node.note ? ` (${node.note})` : '';
  return `${tabs}${time}${labelText}${jump}${noteText}`;
}

export function serializeTimelineTree(roots: TimelineNode[]): string {
  const lines: string[] = [];

  function traverse(node: TimelineNode) {
    lines.push(serializeTimelineNode(node));
    node.children.forEach(traverse);
  }

  roots.forEach(traverse);
  return lines.join('\n');
}
