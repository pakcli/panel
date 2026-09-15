// src/features/timelineNarrative/parser.ts
function parseWikilink(text) {
  const match = text.match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
  if (!match) return void 0;
  return {
    raw: text,
    path: match[1].trim(),
    alias: match[2]?.trim()
  };
}
function formatTimestamp(rawTimestamp) {
  const cleaned = rawTimestamp.replace(/^_|_$/g, "");
  const parts = cleaned.split("_");
  if (parts.length === 2) {
    const date = parts[0];
    const time = parts[1].replace("-", ":");
    return `${date} ${time}`;
  }
  return cleaned.replace(/_/g, " ");
}
function parseTimelineSource(source) {
  const lines = source.split(/\r?\n/);
  const roots = [];
  const allNodes = /* @__PURE__ */ new Map();
  const nodesByLabel = /* @__PURE__ */ new Map();
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
  const stack = [];
  lines.forEach((originalLine, lineIndex) => {
    if (originalLine.trim() === "") return;
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
    let note;
    let noteWikilink;
    const noteMatch = content.match(/\s*\(([^)]+)\)\s*$/);
    if (noteMatch) {
      note = noteMatch[1].trim();
      noteWikilink = parseWikilink(note);
      content = content.slice(0, noteMatch.index).trim();
    }
    let jumpTarget;
    const jumpMatch = content.match(/\s*>\s*([^[>]+|\[\[[^\]]+\]\])\s*$/);
    if (jumpMatch) {
      jumpTarget = jumpMatch[1].trim();
      content = content.slice(0, jumpMatch.index).trim();
    }
    let rawTimestamp;
    let timestamp;
    const timeMatch = content.match(/^(_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_)\s*/);
    if (timeMatch) {
      rawTimestamp = timeMatch[1];
      timestamp = formatTimestamp(rawTimestamp);
      content = content.slice(timeMatch[0].length).trim();
    }
    const rawLabel = content;
    const wikilink = parseWikilink(rawLabel);
    const cleanLabel = wikilink ? wikilink.alias || wikilink.path : rawLabel;
    const node = {
      id: `node-${lineIndex}-${Math.random().toString(36).slice(2, 7)}`,
      lineIndex,
      depth,
      rawText: originalLine,
      timestamp,
      rawTimestamp,
      label: cleanLabel,
      wikilink,
      jumpTarget,
      note,
      noteWikilink,
      children: []
    };
    allNodes.set(node.id, node);
    const existing = nodesByLabel.get(cleanLabel) || [];
    existing.push(node);
    nodesByLabel.set(cleanLabel, existing);
    if (wikilink && wikilink.path !== cleanLabel) {
      const existingPath = nodesByLabel.get(wikilink.path) || [];
      existingPath.push(node);
      nodesByLabel.set(wikilink.path, existingPath);
    }
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
        roots.push(node);
      }
      stack.push({ depth, node });
    }
  });
  allNodes.forEach((node) => {
    if (node.jumpTarget) {
      const cleanJump = node.jumpTarget.replace(/^\[\[|\]\]$/g, "").trim();
      const targets = nodesByLabel.get(cleanJump) || nodesByLabel.get(node.jumpTarget);
      if (targets && targets.length > 0) {
        targets[0].isJumpTarget = true;
      }
    }
  });
  return {
    roots,
    allNodes,
    nodesByLabel,
    rawLines: lines
  };
}
function serializeTimelineNode(node) {
  const tabs = "	".repeat(node.depth);
  const time = node.rawTimestamp ? `${node.rawTimestamp} ` : "";
  const labelText = node.wikilink ? node.wikilink.raw : node.label;
  const jump = node.jumpTarget ? ` > ${node.jumpTarget}` : "";
  const noteText = node.note ? ` (${node.note})` : "";
  return `${tabs}${time}${labelText}${jump}${noteText}`;
}
function serializeTimelineTree(roots) {
  const lines = [];
  function traverse(node) {
    lines.push(serializeTimelineNode(node));
    node.children.forEach(traverse);
  }
  roots.forEach(traverse);
  return lines.join("\n");
}
export {
  formatTimestamp,
  parseTimelineSource,
  parseWikilink,
  serializeTimelineNode,
  serializeTimelineTree
};
