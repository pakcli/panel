var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/features/timelineNarrative/layout.ts
var layout_exports = {};
__export(layout_exports, {
  COLUMN_GAP: () => COLUMN_GAP,
  NODE_MIN_HEIGHT: () => NODE_MIN_HEIGHT,
  NODE_WIDTH: () => NODE_WIDTH,
  PADDING: () => PADDING,
  ROW_GAP: () => ROW_GAP,
  buildDetroitChamferPath: () => buildDetroitChamferPath,
  buildDetroitJumpPath: () => buildDetroitJumpPath,
  computeTimelineLayout: () => computeTimelineLayout
});
module.exports = __toCommonJS(layout_exports);
var NODE_WIDTH = 210;
var NODE_MIN_HEIGHT = 64;
var COLUMN_GAP = 90;
var ROW_GAP = 32;
var PADDING = 48;
function buildDetroitChamferPath(x1, y1, x2, y2, chamferSize = 8) {
  if (Math.abs(y1 - y2) < 2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const midX = Math.round(x1 + (x2 - x1) / 2);
  const ch = Math.min(chamferSize, Math.abs(midX - x1) / 2, Math.abs(y2 - y1) / 2);
  if (y2 > y1) {
    return [
      `M ${x1} ${y1}`,
      `L ${midX - ch} ${y1}`,
      `L ${midX} ${y1 + ch}`,
      `L ${midX} ${y2 - ch}`,
      `L ${midX + ch} ${y2}`,
      `L ${x2} ${y2}`
    ].join(" ");
  } else {
    return [
      `M ${x1} ${y1}`,
      `L ${midX - ch} ${y1}`,
      `L ${midX} ${y1 - ch}`,
      `L ${midX} ${y2 + ch}`,
      `L ${midX + ch} ${y2}`,
      `L ${x2} ${y2}`
    ].join(" ");
  }
}
function buildDetroitJumpPath(x1, y1, x2, y2, chamferSize = 8) {
  if (x2 <= x1) {
    const dropY = Math.max(y1, y2) + 40;
    const ch = chamferSize;
    return [
      `M ${x1} ${y1}`,
      `L ${x1 + 16 - ch} ${y1}`,
      `L ${x1 + 16} ${y1 + ch}`,
      `L ${x1 + 16} ${dropY - ch}`,
      `L ${x1 + 16 - ch} ${dropY}`,
      `L ${x2 - 16 + ch} ${dropY}`,
      `L ${x2 - 16} ${dropY - ch}`,
      `L ${x2 - 16} ${y2 + ch}`,
      `L ${x2 - 16 + ch} ${y2}`,
      `L ${x2} ${y2}`
    ].join(" ");
  }
  return buildDetroitChamferPath(x1, y1, x2, y2, chamferSize);
}
function computeTimelineLayout(tree) {
  const nodeLayouts = /* @__PURE__ */ new Map();
  const connectors = [];
  let currentY = PADDING;
  function layoutSubtree(node) {
    if (node.children.length === 0) {
      const y = currentY;
      currentY += NODE_MIN_HEIGHT + ROW_GAP;
      return { minY: y, maxY: y, y };
    }
    const childResults = node.children.map((child) => layoutSubtree(child));
    const firstY = childResults[0].y;
    const lastY = childResults[childResults.length - 1].y;
    const nodeY = (firstY + lastY) / 2;
    return {
      minY: childResults[0].minY,
      maxY: childResults[childResults.length - 1].maxY,
      y: nodeY
    };
  }
  tree.roots.forEach((root) => {
    const rootPos = layoutSubtree(root);
    assignCoordinates(root, rootPos.y);
    currentY += ROW_GAP * 0.5;
  });
  function assignCoordinates(node, computedY) {
    const x = PADDING + node.depth * (NODE_WIDTH + COLUMN_GAP);
    const layout = {
      node,
      x,
      y: computedY,
      width: NODE_WIDTH,
      height: NODE_MIN_HEIGHT,
      column: node.depth,
      row: 0
    };
    nodeLayouts.set(node.id, layout);
    node.children.forEach((child) => {
      const existing = nodeLayouts.get(child.id);
      if (!existing) {
        assignCoordinates(child, childYMap.get(child.id) || computedY);
      }
    });
  }
  nodeLayouts.clear();
  currentY = PADDING;
  const childYMap = /* @__PURE__ */ new Map();
  function measurePass(node) {
    if (node.children.length === 0) {
      const y = currentY;
      childYMap.set(node.id, y);
      currentY += NODE_MIN_HEIGHT + ROW_GAP;
      return y;
    }
    const childYs = node.children.map((c) => measurePass(c));
    const centerY = (childYs[0] + childYs[childYs.length - 1]) / 2;
    childYMap.set(node.id, centerY);
    return centerY;
  }
  tree.roots.forEach((root) => {
    measurePass(root);
    currentY += ROW_GAP * 0.5;
  });
  function placePass(node) {
    const y = childYMap.get(node.id) ?? PADDING;
    const x = PADDING + node.depth * (NODE_WIDTH + COLUMN_GAP);
    nodeLayouts.set(node.id, {
      node,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_MIN_HEIGHT,
      column: node.depth,
      row: 0
    });
    node.children.forEach(placePass);
  }
  tree.roots.forEach(placePass);
  tree.roots.forEach(function buildConnectors(node) {
    const parentLayout = nodeLayouts.get(node.id);
    if (!parentLayout) return;
    const startX = parentLayout.x + parentLayout.width;
    const startY = parentLayout.y + parentLayout.height / 2;
    node.children.forEach((child) => {
      const childLayout = nodeLayouts.get(child.id);
      if (!childLayout) return;
      const endX = childLayout.x;
      const endY = childLayout.y + childLayout.height / 2;
      connectors.push({
        fromNodeId: node.id,
        toNodeId: child.id,
        startX,
        startY,
        endX,
        endY,
        d: buildDetroitChamferPath(startX, startY, endX, endY),
        isJump: false
      });
      buildConnectors(child);
    });
  });
  tree.allNodes.forEach((node) => {
    if (!node.jumpTarget) return;
    const sourceLayout = nodeLayouts.get(node.id);
    if (!sourceLayout) return;
    const cleanJump = node.jumpTarget.replace(/^\[\[|\]\]$/g, "").trim();
    const targets = tree.nodesByLabel.get(cleanJump) || tree.nodesByLabel.get(node.jumpTarget);
    if (!targets || targets.length === 0) return;
    const targetNode = targets[0];
    const targetLayout = nodeLayouts.get(targetNode.id);
    if (!targetLayout) return;
    const startX = sourceLayout.x + sourceLayout.width;
    const startY = sourceLayout.y + sourceLayout.height / 2;
    const endX = targetLayout.x;
    const endY = targetLayout.y + targetLayout.height / 2;
    connectors.push({
      fromNodeId: node.id,
      toNodeId: targetNode.id,
      startX,
      startY,
      endX,
      endY,
      d: buildDetroitJumpPath(startX, startY, endX, endY),
      isJump: true
    });
  });
  let maxX = 0;
  let maxY = 0;
  nodeLayouts.forEach((l) => {
    maxX = Math.max(maxX, l.x + l.width + PADDING);
    maxY = Math.max(maxY, l.y + l.height + PADDING);
  });
  return {
    nodes: Array.from(nodeLayouts.values()),
    connectors,
    totalWidth: Math.max(maxX, 600),
    totalHeight: Math.max(maxY, 350)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COLUMN_GAP,
  NODE_MIN_HEIGHT,
  NODE_WIDTH,
  PADDING,
  ROW_GAP,
  buildDetroitChamferPath,
  buildDetroitJumpPath,
  computeTimelineLayout
});
