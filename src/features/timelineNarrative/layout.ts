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

export function getShortcutStartPoint(
  sourceLayout: NodeLayout,
  targetY: number
): { startX: number; startY: number } {
  const sourceCenterY = sourceLayout.y + sourceLayout.height / 2;
  const cornerX = Math.round(sourceLayout.x + sourceLayout.width - 24);

  // If target is above source center (by more than 10px) -> exit from TOP-RIGHT corner
  if (targetY < sourceCenterY - 10) {
    return {
      startX: cornerX,
      startY: sourceLayout.y,
    };
  }
  // If target is below source center (by more than 10px) -> exit from BOTTOM-RIGHT corner
  else if (targetY > sourceCenterY + 10) {
    return {
      startX: cornerX,
      startY: sourceLayout.y + sourceLayout.height,
    };
  }
  // If roughly in line horizontally -> exit from right center
  else {
    return {
      startX: sourceLayout.x + sourceLayout.width,
      startY: sourceCenterY,
    };
  }
}

/**
 * Builds authentic shortcut jump path: exits from corner (O),
 * goes vertically by 1/2 height to target Y, turns with Detroit 45° chamfer,
 * and fires straight horizontally into the target jump node.
 */
export function buildDetroitShortcutJumpPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  chamferSize: number = 8
): string {
  const ch = chamferSize;

  // Forward jump (target is to the right)
  if (endX > startX) {
    if (Math.abs(startY - endY) < 4) {
      return `M ${startX} ${startY} L ${endX} ${endY}`;
    }

    if (endY < startY) {
      // Exiting from top: goes UP, 45° chamfers to horizontal, fires straight across
      return [
        `M ${startX} ${startY}`,
        `L ${startX} ${endY + ch}`,
        `L ${startX + ch} ${endY}`,
        `L ${endX} ${endY}`,
      ].join(' ');
    } else {
      // Exiting from bottom: goes DOWN, 45° chamfers to horizontal, fires straight across
      return [
        `M ${startX} ${startY}`,
        `L ${startX} ${endY - ch}`,
        `L ${startX + ch} ${endY}`,
        `L ${endX} ${endY}`,
      ].join(' ');
    }
  }

  // Backward jump (target is behind or in same column: route above)
  const dropY = Math.min(startY, endY) - 36;
  return [
    `M ${startX} ${startY}`,
    `L ${startX} ${dropY + ch}`,
    `L ${startX - ch} ${dropY}`,
    `L ${endX - 16 + ch} ${dropY}`,
    `L ${endX - 16} ${dropY + ch}`,
    `L ${endX - 16} ${endY}`,
    `L ${endX} ${endY}`,
  ].join(' ');
}

/**
 * Builds an obstacle-clearing jump path that exits from top-right corner,
 * flies above intervening columns, and drops cleanly into the column gap before the target.
 */
export function buildDetroitOverTheTopJumpPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  clearY: number,
  chamferSize: number = 8
): string {
  const ch = chamferSize;
  const dropX = endX - 24;

  return [
    `M ${startX} ${startY}`,
    `L ${startX} ${clearY + ch}`,
    `L ${startX + ch} ${clearY}`,
    `L ${dropX - ch} ${clearY}`,
    `L ${dropX} ${clearY + ch}`,
    `L ${dropX} ${endY - ch}`,
    `L ${dropX + ch} ${endY}`,
    `L ${endX} ${endY}`,
  ].join(' ');
}

/**
 * Builds backward or loop-around jump path (fallback)
 */
export function buildDetroitJumpPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  chamferSize: number = 8
): string {
  return buildDetroitShortcutJumpPath(x1, y1, x2, y2, chamferSize);
}

export interface TimelineLayoutOptions {
  mergeJumps?: boolean;
}

export function computeTimelineLayout(
  tree: TimelineTree,
  options?: TimelineLayoutOptions
): DiagramLayout {
  const mergeJumps = options?.mergeJumps ?? false;
  const nodeLayouts = new Map<string, NodeLayout>();
  const connectors: ConnectorPath[] = [];

  function createJumpConnector(
    srcId: string,
    targetId: string,
    srcLayout: NodeLayout,
    targetLayout: NodeLayout
  ) {
    const endX = targetLayout.x;
    const endY = targetLayout.y + targetLayout.height / 2;

    // 1. Forward jump into immediately adjacent column (col + 1):
    // Exits cleanly from right edge into the open column gap (no vertical lines between cards)
    if (targetLayout.column === srcLayout.column + 1) {
      const startX = srcLayout.x + srcLayout.width;
      const startY = srcLayout.y + srcLayout.height / 2;
      connectors.push({
        fromNodeId: srcId,
        toNodeId: targetId,
        startX,
        startY,
        endX,
        endY,
        d: buildDetroitChamferPath(startX, startY, endX, endY),
        isJump: true,
      });
      return;
    }

    // 2. Forward jump skipping intervening columns (targetCol > srcCol + 1):
    // Exits from top-right corner with anchor dot 'O', flies over intervening columns
    if (targetLayout.column > srcLayout.column + 1) {
      const startX = Math.round(srcLayout.x + srcLayout.width - 24);
      const startY = srcLayout.y;

      const interveningNodes = Array.from(nodeLayouts.values()).filter(
        (l) => l.column > srcLayout.column && l.column < targetLayout.column
      );
      const minY = interveningNodes.length > 0
        ? Math.min(...interveningNodes.map((l) => l.y), srcLayout.y)
        : Math.min(srcLayout.y, targetLayout.y);
      const clearY = Math.max(16, minY - 28);

      connectors.push({
        fromNodeId: srcId,
        toNodeId: targetId,
        startX,
        startY,
        endX,
        endY,
        d: buildDetroitOverTheTopJumpPath(startX, startY, endX, endY, clearY),
        isJump: true,
      });
      return;
    }

    // 3. Backward or same-column jump: route above and drop down
    const startX = srcLayout.x + srcLayout.width;
    const startY = srcLayout.y + srcLayout.height / 2;
    const dropY = Math.min(startY, endY) - 36;
    const ch = 8;
    const d = [
      `M ${startX} ${startY}`,
      `L ${startX + 16} ${startY}`,
      `L ${startX + 24} ${startY - ch}`,
      `L ${startX + 24} ${dropY + ch}`,
      `L ${startX + 16} ${dropY}`,
      `L ${endX - 16 + ch} ${dropY}`,
      `L ${endX - 16} ${dropY + ch}`,
      `L ${endX - 16} ${endY}`,
      `L ${endX} ${endY}`,
    ].join(' ');

    connectors.push({
      fromNodeId: srcId,
      toNodeId: targetId,
      startX,
      startY,
      endX,
      endY,
      d,
      isJump: true,
    });
  }

  if (!mergeJumps) {
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
      const targets = node.jumpTargets && node.jumpTargets.length > 0 ? node.jumpTargets : (node.jumpTarget ? [node.jumpTarget] : []);
      targets.forEach((jt) => {
        const sourceLayout = nodeLayouts.get(node.id);
        if (!sourceLayout) return;

        const cleanJump = jt.replace(/^\[\[|\]\]$/g, '').trim();
        const found = tree.nodesByLabel.get(cleanJump) || tree.nodesByLabel.get(jt);
        if (!found || found.length === 0) return;

        const targetNode = found[0];
        const targetLayout = nodeLayouts.get(targetNode.id);
        if (!targetLayout) return;

        createJumpConnector(node.id, targetNode.id, sourceLayout, targetLayout);
      });
    });
  } else {
    // MERGE JUMPS MODE:
    // 1. Identify which root nodes are targets of jumps from other trees
    const jumpTargetMap = new Map<string, TimelineNode[]>();
    tree.allNodes.forEach((node) => {
      const targets = node.jumpTargets && node.jumpTargets.length > 0 ? node.jumpTargets : (node.jumpTarget ? [node.jumpTarget] : []);
      targets.forEach((jt) => {
        const clean = jt.replace(/^\[\[|\]\]$/g, '').trim().toLowerCase();
        const existing = jumpTargetMap.get(clean) || [];
        existing.push(node);
        jumpTargetMap.set(clean, existing);
      });
    });

    const primaryRoots: TimelineNode[] = [];
    const mergedRoots = new Map<TimelineNode, TimelineNode[]>(); // root -> sourceNodes

    tree.roots.forEach((root, idx) => {
      const cleanRootLabel = root.label.replace(/^\[\[|\]\]$/g, '').trim().toLowerCase();
      if (idx > 0 && jumpTargetMap.has(cleanRootLabel)) {
        mergedRoots.set(root, jumpTargetMap.get(cleanRootLabel)!);
      } else {
        primaryRoots.push(root);
      }
    });

    // Layout primary roots first
    let currentY = PADDING;
    const childYMap = new Map<string, number>();

    function measurePrimary(node: TimelineNode): number {
      if (node.children.length === 0) {
        const y = currentY;
        childYMap.set(node.id, y);
        currentY += NODE_MIN_HEIGHT + ROW_GAP;
        return y;
      }

      const childYs = node.children.map((c) => measurePrimary(c));
      const centerY = (childYs[0] + childYs[childYs.length - 1]) / 2;
      childYMap.set(node.id, centerY);
      return centerY;
    }

    primaryRoots.forEach((root) => {
      measurePrimary(root);
      currentY += ROW_GAP * 0.5;
    });

    function placePrimary(node: TimelineNode) {
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

      node.children.forEach(placePrimary);
    }

    primaryRoots.forEach(placePrimary);

    // Layout merged roots directly after their jump sources
    mergedRoots.forEach((sources, root) => {
      const sourceLayouts = sources
        .map((s) => nodeLayouts.get(s.id))
        .filter((l): l is NodeLayout => l !== undefined);

      let targetCol = 1;
      let targetY = currentY;

      if (sourceLayouts.length > 0) {
        targetCol = Math.max(...sourceLayouts.map((l) => l.column)) + 1;
        targetY = sourceLayouts.reduce((sum, l) => sum + l.y, 0) / sourceLayouts.length;
      }

      // Check for collisions at targetCol
      const existingAtCol = Array.from(nodeLayouts.values()).filter((l) => l.column === targetCol);
      let adjustedY = targetY;
      while (existingAtCol.some((l) => Math.abs(l.y - adjustedY) < NODE_MIN_HEIGHT + ROW_GAP / 2)) {
        adjustedY += NODE_MIN_HEIGHT + ROW_GAP;
      }

      const rootX = PADDING + targetCol * (NODE_WIDTH + COLUMN_GAP);
      nodeLayouts.set(root.id, {
        node: root,
        x: rootX,
        y: adjustedY,
        width: NODE_WIDTH,
        height: NODE_MIN_HEIGHT,
        column: targetCol,
        row: 0,
      });

      // Place children of merged root
      function placeMergedChildren(parent: TimelineNode, parentCol: number, centerY: number) {
        if (parent.children.length === 0) return;

        const count = parent.children.length;
        const totalSpan = (count - 1) * (NODE_MIN_HEIGHT + ROW_GAP);
        const startY = centerY - totalSpan / 2;
        const childCol = parentCol + 1;
        const childX = PADDING + childCol * (NODE_WIDTH + COLUMN_GAP);

        parent.children.forEach((child, i) => {
          const childY = startY + i * (NODE_MIN_HEIGHT + ROW_GAP);
          nodeLayouts.set(child.id, {
            node: child,
            x: childX,
            y: childY,
            width: NODE_WIDTH,
            height: NODE_MIN_HEIGHT,
            column: childCol,
            row: 0,
          });

          placeMergedChildren(child, childCol, childY);
        });
      }

      placeMergedChildren(root, targetCol, adjustedY);

      // Connect jump sources into the merged target node
      sources.forEach((src) => {
        const srcLayout = nodeLayouts.get(src.id);
        const rootLayout = nodeLayouts.get(root.id);
        if (!srcLayout || !rootLayout) return;

        createJumpConnector(src.id, root.id, srcLayout, rootLayout);
      });
    });

    // Parent -> Child connectors for all placed nodes
    function addTreeConnectors(node: TimelineNode) {
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

        addTreeConnectors(child);
      });
    }

    tree.roots.forEach(addTreeConnectors);

    // Any remaining non-merged jump connectors
    tree.allNodes.forEach((node) => {
      const targets = node.jumpTargets && node.jumpTargets.length > 0 ? node.jumpTargets : (node.jumpTarget ? [node.jumpTarget] : []);
      targets.forEach((jt) => {
        const cleanJump = jt.replace(/^\[\[|\]\]$/g, '').trim();
        const found = tree.nodesByLabel.get(cleanJump) || tree.nodesByLabel.get(jt);
        if (!found || found.length === 0) return;

        const targetNode = found[0];
        if (mergedRoots.has(targetNode)) {
          return; // already connected forward above
        }

        const sourceLayout = nodeLayouts.get(node.id);
        const targetLayout = nodeLayouts.get(targetNode.id);
        if (!sourceLayout || !targetLayout) return;

        createJumpConnector(node.id, targetNode.id, sourceLayout, targetLayout);
      });
    });
  }

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
