import { ConnectorPath, DiagramLayout, NodeLayout, TimelineNode, TimelineTree } from './types';

export const NODE_WIDTH = 210;
export const NODE_MIN_HEIGHT = 64;
export const COLUMN_GAP = 90;
export const ROW_GAP = 32;
export const PADDING = 48;

/**
 * Computes SVG connector path between two points with authentic Detroit 45° chamfered bends
 */
export function buildDetroitChamferPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  chamferSize: number = 8
): string {
  if (Math.abs(y1 - y2) < 2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const midX = Math.round(x1 + (x2 - x1) / 2);
  const ch = Math.min(chamferSize, Math.abs(midX - x1) / 2, Math.abs(y2 - y1) / 2);

  if (y2 > y1) {
    // Going downward
    return [
      `M ${x1} ${y1}`,
      `L ${midX - ch} ${y1}`,
      `L ${midX} ${y1 + ch}`,
      `L ${midX} ${y2 - ch}`,
      `L ${midX + ch} ${y2}`,
      `L ${x2} ${y2}`,
    ].join(' ');
  } else {
    // Going upward
    return [
      `M ${x1} ${y1}`,
      `L ${midX - ch} ${y1}`,
      `L ${midX} ${y1 - ch}`,
      `L ${midX} ${y2 + ch}`,
      `L ${midX + ch} ${y2}`,
      `L ${x2} ${y2}`,
    ].join(' ');
  }
}

/**
 * Builds backward or loop-around jump path
 */
export function buildDetroitJumpPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  chamferSize: number = 8
): string {
  // If target is to the left or same column, route above or below
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
      `L ${x2} ${y2}`,
    ].join(' ');
  }

  return buildDetroitChamferPath(x1, y1, x2, y2, chamferSize);
}

export function computeTimelineLayout(tree: TimelineTree): DiagramLayout {
  const nodeLayouts = new Map<string, NodeLayout>();
  const connectors: ConnectorPath[] = [];

  let currentY = PADDING;
  const childYMap = new Map<string, number>();

  // Pass 1: measure vertical coordinates (bottom-up centering)
  function measurePass(node: TimelineNode): number {
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

  // Pass 2: assign positions
  function placePass(node: TimelineNode) {
    const y = childYMap.get(node.id) ?? PADDING;
    const x = PADDING + node.depth * (NODE_WIDTH + COLUMN_GAP);

    nodeLayouts.set(node.id, {
      node,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_MIN_HEIGHT,
      column: node.depth,
      row: 0,
    });

    node.children.forEach(placePass);
  }

  tree.roots.forEach(placePass);

  // 2. Generate Connectors for Parent -> Child
  tree.roots.forEach(function buildConnectors(node: TimelineNode) {
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
        isJump: false,
      });

      buildConnectors(child);
    });
  });

  // 3. Generate Connectors for Jumps
  tree.allNodes.forEach((node) => {
    if (!node.jumpTarget) return;

    const sourceLayout = nodeLayouts.get(node.id);
    if (!sourceLayout) return;

    const cleanJump = node.jumpTarget.replace(/^\[\[|\]\]$/g, '').trim();
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
      isJump: true,
    });
  });

  // Calculate canvas bounds
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
    totalHeight: Math.max(maxY, 350),
  };
}
