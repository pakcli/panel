import { BubbleNode, BubbleEdge, BubbleCluster } from './types';
import { updateClusterHulls } from './hullGenerator';
import { SfxManager } from './sfxManager';

export interface SimulationOptions {
    maxDragDepth?: number;
    isLocked?: boolean;
    layoutMode: 'bubble' | 'default';
    scopedFolder?: string | null;
    denseScale?: number;
    repulsionStrength?: number;
    linkStrength?: number;
    vennAttraction?: number;
    clusterCentroidStrength?: number;
    damping?: number;
    sfx?: SfxManager | null;
    sfxThreshold?: number;
}

/**
 * Density Scale Multiplier:
 * The factor by which dense leaf bubbles are scaled up to provide breathing room.
 * Default is 1.15 (+32% area). Can be tuned between 1.10 and 1.25.
 * Location: src/features/bubblegraph/simulation.ts (DENSE_BUBBLE_MULTIPLIER)
 */
export const DENSE_BUBBLE_MULTIPLIER = 1.15;

/**
 * Density Detector:
 * Determines if a set of nodes within a cluster is "dense" due to:
 * 1. Node count >= 4 (4+ notes in a bubble is a crowded cluster)
 * 2. Any cluster with count >= 2 where at least one node is a hub or has links
 *    (glyph === 'hub', glyph === 'active', radius >= 4.5, or totalDegree >= 2)
 * 3. Total node area footprint sumSq >= 100
 */
export function isNodeSetDense(nodes: BubbleNode[]): boolean {
    if (!nodes || nodes.length <= 1) return false;
    if (nodes.length >= 4) return true;

    let hubCount = 0;
    let linkedCount = 0;
    let sumSq = 0;
    for (const n of nodes) {
        const effR = n.radius + 3.0;
        sumSq += effR * effR;
        if (n.glyph === 'hub' || n.glyph === 'active' || n.radius >= 4.5 || (n.totalDegree && n.totalDegree >= 2)) {
            hubCount++;
        }
        if (n.totalDegree && n.totalDegree >= 1) {
            linkedCount++;
        }
    }

    if (hubCount >= 1 && nodes.length >= 2) return true;
    if (linkedCount >= 2 && nodes.length >= 3) return true;
    if (sumSq >= 100) return true;

    return false;
}

export function computeNodesRequiredRadius(nodes: BubbleNode[], denseScale: number = DENSE_BUBBLE_MULTIPLIER): number {
    if (!nodes || nodes.length === 0) return 0;
    if (nodes.length === 1) return Math.max(13, Math.round(nodes[0].radius + 6));

    let sumSq = 0;
    let maxR = 0;
    for (const n of nodes) {
        const effR = n.radius + 3.0;
        sumSq += effR * effR;
        if (n.radius > maxR) maxR = n.radius;
    }

    // Density Detector
    const isDense = isNodeSetDense(nodes);

    // Packing density: snug breathing room so nodes never feel cramped
    const density = nodes.length > 20 ? 0.44 : (nodes.length > 8 ? 0.48 : 0.52);
    const areaRadius = Math.ceil(Math.sqrt(sumSq / density) + 6);
    let r = Math.max(14, areaRadius, Math.round(maxR * 2.2 + 5));

    // If dense, apply multiplier (from settings or default DENSE_BUBBLE_MULTIPLIER)
    if (isDense) {
        r = Math.max(5, Math.round(r * denseScale));
    }

    return r;
}

export function computeLeafClusterRadius(nodeCount: number, depth: number = 2, denseScale: number = DENSE_BUBBLE_MULTIPLIER): number {
    if (nodeCount <= 0) return 0;
    if (nodeCount === 1) return depth === 1 ? 18 : 16;
    if (nodeCount === 2) return depth === 1 ? 22 : 18;
    if (nodeCount === 3) return depth === 1 ? 26 : 22;
    const base = Math.sqrt(nodeCount) * 7.5 + (depth === 1 ? 9 : 7);
    let r = Math.max(16, Math.round(base));
    if (nodeCount >= 4) {
        r = Math.max(5, Math.round(r * denseScale));
    }
    return r;
}

export function computeClusterRadius(nodeCount: number, depth: number = 2, denseScale: number = DENSE_BUBBLE_MULTIPLIER): number {
    return computeLeafClusterRadius(nodeCount, depth, denseScale);
}

export function computeAllClusterRadii(
    clusters: BubbleCluster[], 
    nodeMap?: Map<string, BubbleNode> | null,
    visibleNodeIds?: Set<string> | null,
    scopedFolder?: string | null,
    denseScale: number = DENSE_BUBBLE_MULTIPLIER
): void {
    const sorted = [...clusters].sort((a, b) => b.depth - a.depth);
    for (const c of sorted) {
        const visibleIds = visibleNodeIds ? c.nodeIds.filter(id => visibleNodeIds.has(id)) : c.nodeIds;
        if (visibleIds.length === 0) {
            c.radius = 0;
            c.isDense = false;
            c.baseRadius = 0;
            continue;
        }

        const childSubs = clusters.filter(s => s.parentClusterId === c.id && s.radius > 0);
        const directIds = c.directNodeIds 
            ? (visibleNodeIds ? c.directNodeIds.filter(id => visibleNodeIds.has(id)) : c.directNodeIds)
            : visibleIds.filter(id => !childSubs.some(s => s.nodeIds.includes(id)));

        const directNodes: BubbleNode[] = [];
        if (nodeMap) {
            for (const id of directIds) {
                const n = nodeMap.get(id);
                if (n) directNodes.push(n);
            }
        }

        const isDirectDense = directNodes.length > 0 
            ? isNodeSetDense(directNodes)
            : (directIds.length >= 4);

        const hasChildSubs = childSubs.length > 0;
        const baseR = directNodes.length > 0 
            ? computeNodesRequiredRadius(directNodes, denseScale)
            : (!hasChildSubs ? computeLeafClusterRadius(visibleIds.length, c.depth, denseScale) : 0);

        if (!hasChildSubs) {
            c.isDense = isDirectDense;
            c.baseRadius = baseR;
            c.radius = baseR;
            continue;
        }

        // Check if this cluster is the entered scoped root folder
        const isScopedRoot = Boolean(scopedFolder && (c.id === scopedFolder || (c.depth === 1 && clusters.filter(x => x.depth === 1).length === 1)));

        // Parent cluster density detection:
        const anyChildDense = childSubs.some(s => s.isDense);
        const isParentDense = isDirectDense || anyChildDense || childSubs.length >= 4 || directIds.length >= 8;
        c.isDense = isParentDense;

        if (childSubs.length === 1 && directNodes.length === 0) {
            const singleR = childSubs[0].radius + (isScopedRoot ? 14 : (isParentDense ? 8 : 5));
            c.baseRadius = singleR;
            c.radius = singleR;
            continue;
        }

        let totalSubArea = 0;
        let maxSubRadius = 0;
        for (const sub of childSubs) {
            const sr = sub.radius + (isScopedRoot ? 6.0 : (isParentDense ? 4.0 : 2.0));
            totalSubArea += Math.PI * sr * sr;
            if (sub.radius > maxSubRadius) maxSubRadius = sub.radius;
        }

        // Direct nodes area from actual node sizes
        let directArea = 0;
        if (directNodes.length > 0) {
            for (const n of directNodes) {
                const effR = n.radius + (isScopedRoot ? 5.0 : (isParentDense ? 4.0 : 2.5));
                directArea += Math.PI * effR * effR;
            }
        } else {
            const defaultNodeEffR = isScopedRoot ? 7.0 : (isParentDense ? 6.0 : 4.5);
            directArea = directIds.length * (Math.PI * defaultNodeEffR * defaultNodeEffR);
        }

        const totalArea = totalSubArea + directArea;
        // Packing density: children already have DENSE_BUBBLE_MULTIPLIER applied to their individual areas,
        // so packingR naturally expands to fit them. Do not multiply parent by DENSE_BUBBLE_MULTIPLIER again!
        const packDensity = isScopedRoot ? 0.48 : (isParentDense ? 0.54 : 0.60);
        let packingR = Math.ceil(Math.sqrt(totalArea / (Math.PI * packDensity)) + (isScopedRoot ? 14 : (isParentDense ? 8 : 4)));
        const directExtra = directArea > 0 ? Math.ceil(Math.sqrt(directArea / Math.PI) * (isScopedRoot ? 0.8 : (isParentDense ? 0.6 : 0.4))) : 0;
        const minClusterR = Math.max(5, Math.round(14 * Math.min(1.0, denseScale)));
        let finalR = Math.max(minClusterR, baseR, packingR, maxSubRadius + directExtra + (isScopedRoot ? 14 : (isParentDense ? 8 : 4)));

        c.baseRadius = finalR;
        c.radius = finalR;
    }
}

export function computeTopClusterRadius(
    c: BubbleCluster, 
    subClusters: BubbleCluster[], 
    visibleNodeCount: number,
    nodeMap?: Map<string, BubbleNode> | null,
    denseScale: number = DENSE_BUBBLE_MULTIPLIER
): number {
    const childSubs = subClusters.filter(s => s.parentClusterId === c.id && s.radius > 0);
    const subNodeCount = childSubs.reduce((sum, s) => sum + s.nodeIds.length, 0);
    const directCount = Math.max(0, visibleNodeCount - subNodeCount);

    if (childSubs.length === 0) return computeLeafClusterRadius(visibleNodeCount, 1, denseScale);
    const baseR = directCount > 0 ? computeLeafClusterRadius(directCount, 1, denseScale) : 0;

    const anyChildDense = childSubs.some(s => s.isDense);
    const isDense = anyChildDense || childSubs.length >= 3 || directCount >= 6;

    if (childSubs.length === 1 && directCount === 0) {
        return childSubs[0].radius + (isDense ? 10 : 6);
    }

    let totalSubArea = 0;
    let maxSubRadius = 0;
    for (const sub of childSubs) {
        const sr = sub.radius + (isDense ? 4.0 : 2.0);
        totalSubArea += Math.PI * sr * sr;
        if (sub.radius > maxSubRadius) maxSubRadius = sub.radius;
    }

    const looseArea = directCount * (Math.PI * 6.5 * 6.5);
    const totalArea = totalSubArea + looseArea;
    const packingR = Math.ceil(Math.sqrt(totalArea / (Math.PI * 0.58)) + (isDense ? 8 : 4));
    const directExtra = directCount > 0 ? Math.ceil(Math.sqrt(directCount) * (isDense ? 4 : 3)) : 0;

    let finalR = Math.max(baseR, packingR, maxSubRadius + directExtra + (isDense ? 8 : 4));
    return finalR;
}


export class BubbleSimulation {
    private nodes: BubbleNode[] = [];
    private edges: BubbleEdge[] = [];
    private clusters: BubbleCluster[] = [];
    private nodeMap: Map<string, BubbleNode> = new Map();
    private options: SimulationOptions;

    private alpha: number = 1.0;
    private alphaMin: number = 0.001;
    private alphaDecay: number = 0.012;

    private draggedNodes: Array<{ node: BubbleNode; offsetX: number; offsetY: number }> = [];
    private draggedCluster: BubbleCluster | null = null;
    private draggedParentCluster: BubbleCluster | null = null;
    private draggedDescendantClusters: BubbleCluster[] = [];
    private lastDragWorldPos: { x: number; y: number } = { x: 0, y: 0 };
    private descendantClusterOffsets: Map<string, { x: number; y: number }> = new Map();
    private clusterNodeOffsets: Map<string, { x: number; y: number }> = new Map();
    private isDragging: boolean = false;

    constructor(
        nodes: BubbleNode[],
        edges: BubbleEdge[],
        clusters: BubbleCluster[],
        options: SimulationOptions
    ) {
        this.nodes = nodes;
        this.edges = edges;
        this.clusters = clusters;
        this.options = options;
        for (const node of this.nodes) {
            this.nodeMap.set(node.id, node);
        }
        for (const edge of this.edges) {
            edge.sourceNode = this.nodeMap.get(edge.source);
            edge.targetNode = this.nodeMap.get(edge.target);
        }
        this.initializePositions();
    }

    private initializePositions(): void {
        if (this.options.layoutMode === 'default') {
            const count = this.nodes.length;
            if (count === 0) return;
            const radius = Math.max(50, Math.sqrt(count) * 7.5);
            this.nodes.forEach((node, idx) => {
                const angle = idx * 2.3999632;
                const dist = Math.sqrt((idx + 0.5) / count) * radius;
                node.x = Math.cos(angle) * dist + (Math.random() - 0.5) * 4;
                node.y = Math.sin(angle) * dist + (Math.random() - 0.5) * 4;
                node.vx = (Math.random() - 0.5) * 1.0;
                node.vy = (Math.random() - 0.5) * 1.0;
                node.fx = null;
                node.fy = null;
            });
            this.alpha = 1.0;
            return;
        }

        const topClusters = this.clusters.filter(c => c.depth === 1);
        if (topClusters.length === 0) return;

        // 1. Precompute all cluster radii bottom-up across all depths (1 to 5)
        computeAllClusterRadii(this.clusters, this.nodeMap, null, this.options.scopedFolder, this.options.denseScale ?? DENSE_BUBBLE_MULTIPLIER);
        for (const c of this.clusters) {
            c.vx = 0;
            c.vy = 0;
        }

        // 2. Position top-level clusters (depth 1) around orbit
        let totalDiameter = 0;
        const gap = 10;
        topClusters.forEach(c => {
            totalDiameter += (2 * c.radius + gap);
        });

        const orbitRadius = topClusters.length === 1 ? 0 : Math.max(20, (totalDiameter / (2 * Math.PI)) * 0.16);
        let currentAngle = 0;

        const safeTotalDiameter = Math.max(1, totalDiameter);
        topClusters.forEach((cluster) => {
            if (topClusters.length === 1) {
                cluster.centroid = { x: 0, y: 0 };
                return;
            }
            const r = cluster.radius;
            const arc = ((2 * r + gap) / safeTotalDiameter) * Math.PI * 2;
            const angle = currentAngle + arc / 2;
            currentAngle += arc;

            const cx = Math.cos(angle) * orbitRadius;
            const cy = Math.sin(angle) * orbitRadius;
            cluster.centroid = { x: isFinite(cx) ? cx : 0, y: isFinite(cy) ? cy : 0 };
        });

        // 3. Position nested clusters hierarchically (depth 2 up to max depth)
        const maxDepth = Math.max(1, ...this.clusters.map(c => c.depth));
        for (let d = 2; d <= maxDepth; d++) {
            const parents = this.clusters.filter(c => c.depth === d - 1);
            for (const parent of parents) {
                const children = this.clusters.filter(c => c.depth === d && c.parentClusterId === parent.id && c.radius > 0);
                if (children.length === 0) continue;

                const isParentScoped = Boolean(this.options.scopedFolder && (parent.id === this.options.scopedFolder || parent.depth === 1));
                const numChildren = children.length;
                if (numChildren === 1) {
                    children[0].centroid = { x: parent.centroid.x, y: parent.centroid.y };
                } else {
                    const maxSubD = Math.max(15, parent.radius - Math.max(...children.map(c => c.radius)) - (isParentScoped ? 6 : 4));
                    children.forEach((child, idx) => {
                        const phi = idx * 2.3999632;
                        const spreadK = isParentScoped ? 0.72 : 0.65;
                        const dist = Math.sqrt((idx + 0.5) / numChildren) * maxSubD * spreadK;
                        child.centroid = {
                            x: parent.centroid.x + Math.cos(phi) * dist,
                            y: parent.centroid.y + Math.sin(phi) * dist
                        };
                    });

                    // PBD relaxation among sibling clusters inside parent
                    for (let iter = 0; iter < 15; iter++) {
                        for (let i = 0; i < children.length; i++) {
                            const ca = children[i];
                            for (let j = i + 1; j < children.length; j++) {
                                const cb = children[j];
                                const isRel = Boolean(ca.isRelTier || cb.isRelTier);
                                const minD = ca.radius + cb.radius + (isRel ? 22.0 : (isParentScoped ? 4.0 : (ca.isDense || cb.isDense ? 3.0 : 2.0)));
                                const dx = cb.centroid.x - ca.centroid.x;
                                const dy = cb.centroid.y - ca.centroid.y;
                                const d2 = dx * dx + dy * dy;
                                if (d2 < minD * minD) {
                                    const dist = Math.sqrt(d2) || 0.001;
                                    const s = ((minD - dist) * 0.5) / dist;
                                    ca.centroid.x -= dx * s; ca.centroid.y -= dy * s;
                                    cb.centroid.x += dx * s; cb.centroid.y += dy * s;
                                }
                            }
                        }
                        for (const child of children) {
                            const maxSubD = Math.max(0, parent.radius - child.radius - 4);
                            const dx = child.centroid.x - parent.centroid.x;
                            const dy = child.centroid.y - parent.centroid.y;
                            const dist = Math.hypot(dx, dy) || 0.001;
                            if (dist > maxSubD) {
                                const scale = maxSubD / dist;
                                child.centroid.x = parent.centroid.x + dx * scale;
                                child.centroid.y = parent.centroid.y + dy * scale;
                            }
                        }
                    }
                }
            }
        }

        // 4. Place nodes inside their immediate deepest container cluster
        const clusterById = new Map<string, BubbleCluster>();
        for (const c of this.clusters) clusterById.set(c.id, c);

        const clusterDirectNodes = new Map<string, BubbleNode[]>();
        for (const c of this.clusters) clusterDirectNodes.set(c.id, []);

        for (const node of this.nodes) {
            if (!node.topLevelFolder || node.topLevelFolder === '/') continue;
            let targetCluster: BubbleCluster | undefined = clusterById.get(node.subClusterId);
            if (!targetCluster) {
                targetCluster = clusterById.get(node.clusterId);
            }
            if (targetCluster) {
                clusterDirectNodes.get(targetCluster.id)?.push(node);
            }
        }

        for (const [clusterId, directNodes] of clusterDirectNodes.entries()) {
            const cluster = clusterById.get(clusterId);
            if (!cluster || directNodes.length === 0) continue;

            const count = directNodes.length;
            if (count === 1) {
                directNodes[0].x = cluster.centroid.x;
                directNodes[0].y = cluster.centroid.y;
                directNodes[0].vx = 0;
                directNodes[0].vy = 0;
            } else {
                const maxSpread = Math.max(3, cluster.radius - 6);
                directNodes.forEach((node, idx) => {
                    const phi = idx * 2.3999632;
                    const dist = Math.sqrt((idx + 0.5) / count) * maxSpread * 0.68;
                    node.x = cluster.centroid.x + Math.cos(phi) * dist;
                    node.y = cluster.centroid.y + Math.sin(phi) * dist;
                    node.vx = 0;
                    node.vy = 0;
                });
            }

            // Immediately run 20 PBD passes so nodes NEVER start overlapping!
            const childSubs = this.clusters.filter(s => s.parentClusterId === cluster.id && s.radius > 0);
            for (let iter = 0; iter < 20; iter++) {
                for (let i = 0; i < count; i++) {
                    const na = directNodes[i];
                    for (let j = i + 1; j < count; j++) {
                        const nb = directNodes[j];
                        const isHub = (na.glyph === 'hub' || na.radius >= 5.5 || (na.totalDegree && na.totalDegree >= 3)) ||
                                      (nb.glyph === 'hub' || nb.radius >= 5.5 || (nb.totalDegree && nb.totalDegree >= 3));
                        const minD = na.radius + nb.radius + (isHub ? 4.0 : 2.5);
                        const dx = nb.x - na.x;
                        const dy = nb.y - na.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < minD * minD) {
                            const d = Math.sqrt(d2) || 0.001;
                            const s = ((minD - d) * 0.5) / d;
                            na.x -= dx * s; na.y -= dy * s;
                            nb.x += dx * s; nb.y += dy * s;
                        }
                    }
                }
                for (const sub of childSubs) {
                    for (const node of directNodes) {
                        const sdx = node.x - sub.centroid.x;
                        const sdy = node.y - sub.centroid.y;
                        const sd = Math.hypot(sdx, sdy) || 0.001;
                        const minSd = sub.radius + node.radius + 3.0;
                        if (sd < minSd) {
                            const push = (minSd - sd) / sd;
                            node.x += sdx * push;
                            node.y += sdy * push;
                        }
                    }
                }
                for (const node of directNodes) {
                    const maxR = Math.max(2, cluster.radius - node.radius - (cluster.isDense ? 4.0 : 2.5));
                    const cdx = node.x - cluster.centroid.x;
                    const cdy = node.y - cluster.centroid.y;
                    const cd = Math.hypot(cdx, cdy) || 0.001;
                    if (cd > maxR) {
                        const scale = maxR / cd;
                        node.x = cluster.centroid.x + cdx * scale;
                        node.y = cluster.centroid.y + cdy * scale;
                    }
                }
            }
        }

        const rootNodes = this.nodes.filter(n => !n.topLevelFolder || n.topLevelFolder === '/');
        rootNodes.forEach(n => {
            if (n.x === 0 && n.y === 0) {
                const angle = Math.random() * Math.PI * 2;
                const r = orbitRadius * 1.25 + Math.random() * 50;
                n.x = Math.cos(angle) * r;
                n.y = Math.sin(angle) * r;
                n.vx = 0; n.vy = 0;
            }
        });

        // PBD on root nodes
        for (let iter = 0; iter < 10; iter++) {
            for (let i = 0; i < rootNodes.length; i++) {
                const na = rootNodes[i];
                for (let j = i + 1; j < rootNodes.length; j++) {
                    const nb = rootNodes[j];
                    const minD = na.radius + nb.radius + 3;
                    const dx = nb.x - na.x;
                    const dy = nb.y - na.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < minD * minD) {
                        const d = Math.sqrt(d2) || 0.001;
                        const s = ((minD - d) * 0.5) / d;
                        na.x -= dx * s; na.y -= dy * s;
                        nb.x += dx * s; nb.y += dy * s;
                    }
                }
            }
        }

        updateClusterHulls(this.clusters, this.nodeMap, 18, null, this.options.layoutMode === 'bubble');
    }

    public setOptions(opts: Partial<SimulationOptions>): void {
        const prevMode = this.options.layoutMode;
        this.options = { ...this.options, ...opts };
        if (opts.isLocked) {
            this.endDrag();
        }
        if (opts.layoutMode && opts.layoutMode !== prevMode) {
            this.initializePositions();
            this.reheat(1.0);
        } else if (opts.sfxThreshold !== undefined && Object.keys(opts).length === 1) {
            // Adjusting sound threshold does not reheat settled physics
        } else if (!opts.isLocked) {
            this.reheat();
        }
    }

    public reheat(amount: number = 0.4): void {
        if (this.options.isLocked) return;
        this.alpha = Math.max(this.alpha, amount);
    }

    private isClusterInDraggedTree(c?: BubbleCluster | null): boolean {
        if (!c || !this.draggedCluster) return false;
        if (c.id === this.draggedCluster.id) return true;
        return this.draggedDescendantClusters.some(d => d.id === c.id);
    }

    private getDescendantClusters(root: BubbleCluster): BubbleCluster[] {
        const result: BubbleCluster[] = [];
        const queue: string[] = [root.id];
        const visited = new Set<string>([root.id]);

        while (queue.length > 0) {
            const parentId = queue.shift()!;
            for (const c of this.clusters) {
                if (c.parentClusterId === parentId && !visited.has(c.id)) {
                    visited.add(c.id);
                    result.push(c);
                    queue.push(c.id);
                }
            }
        }
        return result;
    }

    private getClusterMemberNodes(root: BubbleCluster, descendants: BubbleCluster[]): BubbleNode[] {
        const clusterIdSet = new Set<string>([root.id, ...descendants.map(c => c.id)]);
        const nodeIdSet = new Set<string>(root.nodeIds);
        for (const desc of descendants) {
            for (const id of desc.nodeIds) {
                nodeIdSet.add(id);
            }
        }

        return this.nodes.filter(n => {
            if (nodeIdSet.has(n.id)) return true;
            if (n.clusterId && clusterIdSet.has(n.clusterId)) return true;
            if (n.subClusterId && clusterIdSet.has(n.subClusterId)) return true;
            return false;
        });
    }

    public step(visibleNodeIds?: Set<string> | null): boolean {
        if (this.options.isLocked) {
            return false;
        }

        const isBubbleMode = this.options.layoutMode === 'bubble';

        // In bubble mode: run FOREVER so gravity continuously pulls clusters to center.
        // In default mode: stop when settled (alpha < alphaMin).
        if (!this.isDragging && this.alpha < this.alphaMin) {
            if (!isBubbleMode) return false;
        }

        const alpha = this.alpha;
        const damping = this.options.damping || 0.76;

        if (isBubbleMode) {
            const clusterById = new Map<string, BubbleCluster>();
            this.clusters.forEach(c => clusterById.set(c.id, c));

            const getVisibleCount = (c: BubbleCluster): number => {
                if (!visibleNodeIds) return c.nodeIds.length;
                return c.nodeIds.filter(id => visibleNodeIds.has(id)).length;
            };

            const topClusters = this.clusters.filter(c => c.depth === 1);
            const topCount = topClusters.length;
            const subClusters = this.clusters.filter(c => c.depth === 2);

            // =====================================================================
            // LEVEL 1: TOP CLUSTERS — POSITION-BASED DYNAMICS (PBD)
            //
            // Gravity  = group center pull + centroid *= (1 - k) [direct shrink to center]
            // Separate = 10-pass iterative position projection [guaranteed no overlap]
            // Nodes    = shift by total centroid delta (gravity + separation)
            //
            // PBD has NO velocity channel → cannot oscillate, circle, or earthquake.
            // =====================================================================

            // 0. Update all cluster radii strictly across all depths (1 to 5)
            computeAllClusterRadii(this.clusters, this.nodeMap, visibleNodeIds, this.options.scopedFolder, this.options.denseScale ?? DENSE_BUBBLE_MULTIPLIER);
            if (this.isDragging && this.draggedParentCluster && this.draggedParentCluster.baseRadius) {
                this.draggedParentCluster.radius = this.draggedParentCluster.baseRadius;
            }
            for (const c of this.clusters) { c.vx = 0; c.vy = 0; }

            // Snapshot ALL centroids before any change this frame
            const prevPos = new Map<string, { x: number; y: number }>();
            for (const c of this.clusters) prevPos.set(c.id, { x: c.centroid.x, y: c.centroid.y });

            // 1. Group-level centering: pull collective center of mass of top folders to (0, 0)
            const isSingleOrScoped = topClusters.length === 1 || Boolean(this.options.scopedFolder);
            let activeTopCount = 0;
            let comX = 0;
            let comY = 0;
            for (const c of topClusters) {
                if (c.radius === 0) continue;
                comX += c.centroid.x;
                comY += c.centroid.y;
                activeTopCount++;
            }
            if (activeTopCount > 0 && !this.isDragging && !isSingleOrScoped) {
                comX /= activeTopCount;
                comY /= activeTopCount;
                const groupPullK = 0.05;
                for (const c of topClusters) {
                    if (c.radius === 0) continue;
                    c.centroid.x -= comX * groupPullK;
                    c.centroid.y -= comY * groupPullK;
                }
            }

            // 2. Top-level individual cluster gravity: steady inward pull toward (0,0)
            for (const c of topClusters) {
                if (c.radius === 0) continue;
                if (this.isClusterInDraggedTree(c) || (this.draggedParentCluster && c.id === this.draggedParentCluster.id)) {
                    continue;
                }
                if (isSingleOrScoped) {
                    if (!this.isDragging) {
                        c.centroid.x = 0;
                        c.centroid.y = 0;
                    }
                    continue;
                }
                const d = Math.hypot(c.centroid.x, c.centroid.y);
                if (d < 0.5) {
                    c.centroid.x = 0;
                    c.centroid.y = 0;
                    continue;
                }
                // Proportional pull capped at d * 0.5 to prevent overshoot oscillation
                const pullSpeed = Math.min(d * 0.5, Math.max(0.1, d * 0.035 * Math.max(alpha, 0.3)));
                c.centroid.x -= (c.centroid.x / d) * pullSpeed;
                c.centroid.y -= (c.centroid.y / d) * pullSpeed;
            }

            // 3. Top-level separation: 12 PBD passes with tight spacing ("just touch", no overlap)
            for (let iter = 0; iter < 12; iter++) {
                for (let i = 0; i < topCount; i++) {
                    const ca = topClusters[i];
                    if (ca.radius === 0) continue;
                    for (let j = i + 1; j < topCount; j++) {
                        const cb = topClusters[j];
                        if (cb.radius === 0) continue;
                        const minD = ca.radius + cb.radius + (ca.isDense || cb.isDense ? 8 : 3);
                        const dx = cb.centroid.x - ca.centroid.x;
                        const dy = cb.centroid.y - ca.centroid.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < minD * minD) {
                            const d = Math.sqrt(d2) || 0.001;
                            const overlap = minD - d;
                            const isGraphMoving = this.isDragging || this.alpha > 0.15;
                            if (iter === 0 && overlap > 2.0 && this.options.sfx && isGraphMoving) {
                                const prevA = prevPos.get(ca.id);
                                const prevB = prevPos.get(cb.id);
                                const spdA = prevA ? Math.hypot(ca.centroid.x - prevA.x, ca.centroid.y - prevA.y) : 0;
                                const spdB = prevB ? Math.hypot(cb.centroid.x - prevB.x, cb.centroid.y - prevB.y) : 0;
                                const relSpeed = spdA + spdB;
                                const bubbleSpeedThresh = (this.options.sfxThreshold ?? 1.0) * 1.2;
                                if (relSpeed > bubbleSpeedThresh) {
                                    const intensity = Math.min(1.0, (overlap * relSpeed) / 8.0);
                                    this.options.sfx.playBubbleBubbleCollision(intensity);
                                }
                            }
                            const isCaDragged = this.isClusterInDraggedTree(ca) || Boolean(this.draggedParentCluster && ca.id === this.draggedParentCluster.id);
                            const isCbDragged = this.isClusterInDraggedTree(cb) || Boolean(this.draggedParentCluster && cb.id === this.draggedParentCluster.id);

                            if (isCaDragged && !isCbDragged) {
                                const s = overlap / d;
                                cb.centroid.x += dx * s;
                                cb.centroid.y += dy * s;
                            } else if (isCbDragged && !isCaDragged) {
                                const s = overlap / d;
                                ca.centroid.x -= dx * s;
                                ca.centroid.y -= dy * s;
                            } else if (!isCaDragged && !isCbDragged) {
                                const s = ((minD - d) * 0.5) / d;
                                ca.centroid.x -= dx * s; ca.centroid.y -= dy * s;
                                cb.centroid.x += dx * s; cb.centroid.y += dy * s;
                            }
                        }
                    }
                }
            }

            // =====================================================================
            // LEVEL 2: NESTED CLUSTERS (DEPTH 2 TO MAXDEPTH) — PBD INSIDE PARENT
            // =====================================================================
            const maxDepth = Math.max(1, ...this.clusters.map(c => c.depth));

            for (let d = 2; d <= maxDepth; d++) {
                const clustersAtDepth = this.clusters.filter(c => c.depth === d && c.radius > 0 && c.parentClusterId);

                // Co-move with parent's displacement
                for (const sub of clustersAtDepth) {
                    if (this.isClusterInDraggedTree(sub)) continue;
                    const parent = clusterById.get(sub.parentClusterId!);
                    if (!parent || parent.radius === 0) continue;
                    const pp = prevPos.get(parent.id);
                    if (pp) {
                        sub.centroid.x += parent.centroid.x - pp.x;
                        sub.centroid.y += parent.centroid.y - pp.y;
                    }
                }

                // Subfolder inward gravity toward parent center
                const subGravK = 0.02 * alpha;
                for (const sub of clustersAtDepth) {
                    if (this.isClusterInDraggedTree(sub)) continue;
                    const parent = clusterById.get(sub.parentClusterId!);
                    if (!parent || parent.radius === 0) continue;
                    const isParentScopedRoot = Boolean(this.options.scopedFolder && (parent.id === this.options.scopedFolder || parent.depth === 1));
                    const grav = isParentScopedRoot ? 0.008 * alpha : subGravK;
                    sub.centroid.x += (parent.centroid.x - sub.centroid.x) * grav;
                    sub.centroid.y += (parent.centroid.y - sub.centroid.y) * grav;
                }

                // Subfolder soft repulsion among siblings so they distribute nicely across parent bubble
                for (let i = 0; i < clustersAtDepth.length; i++) {
                    const sa = clustersAtDepth[i];
                    for (let j = i + 1; j < clustersAtDepth.length; j++) {
                        const sb = clustersAtDepth[j];
                        if (sa.parentClusterId !== sb.parentClusterId) continue;
                        const saIn = this.isClusterInDraggedTree(sa);
                        const sbIn = this.isClusterInDraggedTree(sb);
                        if (saIn || sbIn) continue;

                        const parent = clusterById.get(sa.parentClusterId);
                        if (!parent) continue;
                        const isParentScopedRoot = Boolean(this.options.scopedFolder && (parent.id === this.options.scopedFolder || parent.depth === 1));
                        const isRel = Boolean(sa.isRelTier || sb.isRelTier);
                        const extraSiblingMargin = isRel ? 32.0 : (isParentScopedRoot ? 10.0 : (sa.isDense || sb.isDense ? 5.0 : 2.5));
                        const minD = sa.radius + sb.radius + (isRel ? 18.0 : 3.0);
                        const parentBaseR = parent.baseRadius || parent.radius;
                        const idealD = Math.max(minD + extraSiblingMargin, (parentBaseR * 0.80) / Math.sqrt(Math.max(1, clustersAtDepth.length)));
                        const dx = sb.centroid.x - sa.centroid.x;
                        const dy = sb.centroid.y - sa.centroid.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < idealD * idealD && d2 > 0.01) {
                            const d = Math.sqrt(d2);
                            const repStrength = isParentScopedRoot ? 0.35 : 0.25;
                            const rep = ((idealD - d) / idealD) * repStrength * alpha;
                            const rx = (dx / d) * rep;
                            const ry = (dy / d) * rep;
                            if (!saIn) {
                                sa.centroid.x -= rx;
                                sa.centroid.y -= ry;
                            }
                            if (!sbIn) {
                                sb.centroid.x += rx;
                                sb.centroid.y += ry;
                            }
                        }
                    }
                }

                // Sibling separation & Container boundary constraint — 12 PBD passes [just touch]
                for (let iter = 0; iter < 12; iter++) {
                    for (let i = 0; i < clustersAtDepth.length; i++) {
                        const sa = clustersAtDepth[i];
                        for (let j = i + 1; j < clustersAtDepth.length; j++) {
                            const sb = clustersAtDepth[j];
                            if (sa.parentClusterId !== sb.parentClusterId) continue;
                            const saIn = this.isClusterInDraggedTree(sa);
                            const sbIn = this.isClusterInDraggedTree(sb);
                            if (saIn && sbIn) continue;

                            const parent = clusterById.get(sa.parentClusterId);
                            const isParentScopedRoot = Boolean(this.options.scopedFolder && parent && (parent.id === this.options.scopedFolder || parent.depth === 1));
                            const isRel = Boolean(sa.isRelTier || sb.isRelTier);
                            const minD = sa.radius + sb.radius + (isRel ? 20.0 : (isParentScopedRoot ? 8.0 : (sa.isDense || sb.isDense ? 5.0 : 3.0)));
                            const dx = sb.centroid.x - sa.centroid.x;
                            const dy = sb.centroid.y - sa.centroid.y;
                            const d2 = dx * dx + dy * dy;
                            if (d2 < minD * minD) {
                                const dist = Math.sqrt(d2) || 0.001;
                                const overlap = minD - dist;
                                const isGraphMoving = this.isDragging || this.alpha > 0.15;
                                if (iter === 0 && overlap > 2.0 && this.options.sfx && isGraphMoving) {
                                    const prevA = prevPos.get(sa.id);
                                    const prevB = prevPos.get(sb.id);
                                    const spdA = prevA ? Math.hypot(sa.centroid.x - prevA.x, sa.centroid.y - prevA.y) : 0;
                                    const spdB = prevB ? Math.hypot(sb.centroid.x - prevB.x, sb.centroid.y - prevB.y) : 0;
                                    const relSpeed = spdA + spdB;
                                    const bubbleSpeedThresh = (this.options.sfxThreshold ?? 1.0) * 1.2;
                                    if (relSpeed > bubbleSpeedThresh) {
                                        const intensity = Math.min(1.0, (overlap * relSpeed) / 8.0);
                                        this.options.sfx.playBubbleBubbleCollision(intensity);
                                    }
                                }
                                if (saIn && !sbIn) {
                                    const pushFactor = iter < 3 ? 0.6 : 0.25;
                                    sb.centroid.x += (dx / dist) * overlap * pushFactor;
                                    sb.centroid.y += (dy / dist) * overlap * pushFactor;
                                } else if (sbIn && !saIn) {
                                    const pushFactor = iter < 3 ? 0.6 : 0.25;
                                    sa.centroid.x -= (dx / dist) * overlap * pushFactor;
                                    sa.centroid.y -= (dy / dist) * overlap * pushFactor;
                                } else {
                                    const s = ((minD - dist) * 0.5) / dist;
                                    sa.centroid.x -= dx * s; sa.centroid.y -= dy * s;
                                    sb.centroid.x += dx * s; sb.centroid.y += dy * s;
                                }
                            }
                        }
                    }

                    // Hard boundary clamp: subfolder must strictly stay inside parent circle
                    for (const sub of clustersAtDepth) {
                        const parent = clusterById.get(sub.parentClusterId!);
                        if (!parent || parent.radius === 0) continue;

                        const isParentScopedRoot = Boolean(this.options.scopedFolder && (parent.id === this.options.scopedFolder || parent.depth === 1));
                        const effectiveParentR = parent.baseRadius || parent.radius;
                        const maxSubD = Math.max(0, effectiveParentR - sub.radius - (isParentScopedRoot ? 5.0 : 3.5));
                        const dx = sub.centroid.x - parent.centroid.x;
                        const dy = sub.centroid.y - parent.centroid.y;
                        const dist = Math.hypot(dx, dy) || 0.001;
                        if (dist > maxSubD) {
                            const pen = dist - maxSubD;
                            const isGraphMoving = this.isDragging || this.alpha > 0.15;
                            if (iter === 0 && pen > 2.5 && this.options.sfx && isGraphMoving) {
                                const prevSub = prevPos.get(sub.id);
                                const subSpeed = prevSub ? Math.hypot(sub.centroid.x - prevSub.x, sub.centroid.y - prevSub.y) : 0;
                                const bubbleSpeedThresh = (this.options.sfxThreshold ?? 1.0) * 1.2;
                                if (subSpeed > bubbleSpeedThresh) {
                                    this.options.sfx.playBubbleBubbleCollision(Math.min(1.0, (pen * subSpeed) / 8.0));
                                }
                            }
                            // Strict containment: guarantee subfolder NEVER leaves parent circle
                            const targetD = iter >= 6 ? maxSubD : Math.max(maxSubD, dist - Math.min(pen, Math.max(16, pen * 0.35 * Math.max(alpha, 0.4))));
                            const scale = targetD / dist;
                            sub.centroid.x = parent.centroid.x + dx * scale;
                            sub.centroid.y = parent.centroid.y + dy * scale;
                        }
                    }
                }
            }

            // Adapt parent centroid and radius bottom-up to snugly hug subclusters and direct nodes
            for (let d = maxDepth - 1; d >= 1; d--) {
                const parents = this.clusters.filter(c => c.depth === d && c.radius > 0);
                for (const p of parents) {
                    if (this.isClusterInDraggedTree(p) || (this.draggedParentCluster && p.id === this.draggedParentCluster.id)) continue;
                    const childSubs = this.clusters.filter(s => s.parentClusterId === p.id && s.radius > 0);
                    if (childSubs.length === 0) continue;

                    const pDirectNodes = this.nodes.filter(n => {
                        if (visibleNodeIds && !visibleNodeIds.has(n.id)) return false;
                        if (n.fx !== null) return false;
                        return (n.subClusterId === p.id) || (!n.subClusterId && n.clusterId === p.id);
                    });

                    // Enclosing radius with margin
                    let maxReqR = 0;
                    for (const sub of childSubs) {
                        if (this.isClusterInDraggedTree(sub)) continue;
                        const dist = Math.hypot(sub.centroid.x - p.centroid.x, sub.centroid.y - p.centroid.y);
                        const req = dist + sub.radius + (p.isDense ? 5.0 : 3.0);
                        if (req > maxReqR) maxReqR = req;
                    }
                    for (const n of pDirectNodes) {
                        const dist = Math.hypot(n.x - p.centroid.x, n.y - p.centroid.y);
                        const req = dist + n.radius + (p.isDense ? 4.5 : 2.5);
                        if (req > maxReqR) maxReqR = req;
                    }

                    maxReqR = Math.ceil(maxReqR);
                    const targetR = p.baseRadius || maxReqR;
                    const maxAllowedR = Math.round(targetR * 1.05);
                    const boundedReqR = Math.min(maxReqR, maxAllowedR);
                    if (boundedReqR > p.radius) {
                        p.radius = boundedReqR;
                    } else if (p.radius > targetR) {
                        p.radius = Math.max(targetR, Math.round(p.radius * 0.90 + targetR * 0.10));
                    }
                }
            }


            // Shift nodes by the displacement of their IMMEDIATE container cluster
            for (const node of this.nodes) {
                if (node.fx !== null) continue;
                let container: BubbleCluster | undefined = clusterById.get(node.subClusterId);
                if (!container || container.radius === 0) {
                    container = clusterById.get(node.clusterId);
                }
                if (container && container.radius > 0) {
                    const prev = prevPos.get(container.id);
                    if (prev) {
                        const sx = container.centroid.x - prev.x;
                        const sy = container.centroid.y - prev.y;
                        node.x += sx;
                        node.y += sy;
                    }
                }
            }

            // =====================================================================
            // LEVEL 3: NODES — PBD SEPARATION (GUARANTEED NO OVERLAPS, JUST TOUCH)
            // =====================================================================

            // A. Intra-folder springs along connected notes
            for (const edge of this.edges) {
                if (edge.tier !== 'tier1_intra') continue;
                const src = edge.sourceNode; const tgt = edge.targetNode;
                if (!src || !tgt) continue;
                if (visibleNodeIds && (!visibleNodeIds.has(src.id) || !visibleNodeIds.has(tgt.id))) continue;
                const dx = tgt.x - src.x; const dy = tgt.y - src.y;
                const d = Math.hypot(dx, dy) || 1;
                const f = (d - 18) * 0.012 * alpha;
                const fx = (dx / d) * f; const fy = (dy / d) * f;
                if (tgt.glyph === 'hub' && src.glyph !== 'hub') {
                    src.vx += fx * 1.2; src.vy += fy * 1.2;
                } else if (src.glyph === 'hub' && tgt.glyph !== 'hub') {
                    tgt.vx -= fx * 1.2; tgt.vy -= fy * 1.2;
                } else {
                    src.vx += fx; src.vy += fy; tgt.vx -= fx; tgt.vy -= fy;
                }
            }

            // B. Root/unclustered nodes center pull
            for (const node of this.nodes) {
                if (!node.topLevelFolder || node.topLevelFolder === '/') {
                    if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;
                    if (node.fx !== null) continue;
                    const d = Math.hypot(node.x, node.y) || 1;
                    const pull = Math.min(d * 0.012, 1.5) * Math.max(alpha, 0.4);
                    node.vx -= (node.x / d) * pull;
                    node.vy -= (node.y / d) * pull;
                }
            }

            // C. Velocity Integration with strict speed damping
            for (const node of this.nodes) {
                if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;
                if (node.fx !== null) continue;
                const spd = Math.hypot(node.vx, node.vy);
                if (spd > 2.0) { node.vx = (node.vx / spd) * 2.0; node.vy = (node.vy / spd) * 2.0; }
                node.x += node.vx; node.y += node.vy;
                node.vx *= 0.65; node.vy *= 0.65;
                if (spd < 0.02) { node.vx = 0; node.vy = 0; }
            }

            // D. Group direct nodes by their immediate container cluster
            const clusterDirectNodeMap = new Map<string, BubbleNode[]>();
            for (const c of this.clusters) clusterDirectNodeMap.set(c.id, []);

            for (const node of this.nodes) {
                if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;
                if (!node.topLevelFolder || node.topLevelFolder === '/') continue;

                let container: BubbleCluster | undefined = clusterById.get(node.subClusterId);
                if (!container || container.radius === 0) {
                    container = clusterById.get(node.clusterId);
                }
                if (container && container.radius > 0) {
                    clusterDirectNodeMap.get(container.id)?.push(node);
                }
            }

            // E. HARD PBD RELAXATION & SOFT REPULSION FOR ALL CLUSTERS
            for (const [clusterId, directNodes] of clusterDirectNodeMap.entries()) {
                const container = clusterById.get(clusterId);
                if (!container || directNodes.length === 0) continue;
                if (this.isClusterInDraggedTree(container)) continue;

                const count = directNodes.length;
                const childSubs = this.clusters.filter(s => s.parentClusterId === container.id && s.radius > 0);

                // 1 node leaf: center it cleanly
                if (count === 1 && childSubs.length === 0) {
                    const single = directNodes[0];
                    if (single.fx === null) {
                        single.x = container.centroid.x;
                        single.y = container.centroid.y;
                        single.vx = 0;
                        single.vy = 0;
                    }
                    container.radius = Math.max(13, Math.round(single.radius + 6));
                    continue;
                }

                // Soft repulsion between sibling notes so they spread evenly and do not clump
                const isContainerScopedRoot = Boolean(this.options.scopedFolder && (container.id === this.options.scopedFolder || container.depth === 1));
                const isDense = container.isDense || count >= 4;

                if (count > 1) {
                    const containerBaseR = container.baseRadius || container.radius;
                    const idealScale = isContainerScopedRoot ? 1.40 : (isDense ? 1.25 : 1.15);
                    for (let i = 0; i < count; i++) {
                        const na = directNodes[i];
                        for (let j = i + 1; j < count; j++) {
                            const nb = directNodes[j];
                            const isHub = (na.glyph === 'hub' || na.radius >= 4.5 || (na.totalDegree && na.totalDegree >= 2)) ||
                                          (nb.glyph === 'hub' || nb.radius >= 4.5 || (nb.totalDegree && nb.totalDegree >= 2));
                            const minCollision = na.radius + nb.radius + (isHub ? 4.0 : (isDense ? 3.0 : 2.0));
                            const pairIdeal = Math.max(minCollision + (isContainerScopedRoot ? 6.0 : (isDense ? 4.0 : 2.5)), (containerBaseR * idealScale) / Math.sqrt(count));
                            const pairIdealSq = pairIdeal * pairIdeal;
                            const dx = nb.x - na.x;
                            const dy = nb.y - na.y;
                            const d2 = dx * dx + dy * dy;
                            if (d2 < pairIdealSq && d2 > 0.01) {
                                const d = Math.sqrt(d2);
                                const repStrength = isContainerScopedRoot ? 0.35 : 0.30;
                                const rep = ((pairIdeal - d) / pairIdeal) * repStrength * alpha;
                                const rx = (dx / d) * rep;
                                const ry = (dy / d) * rep;
                                if (na.fx === null) { na.vx -= rx; na.vy -= ry; }
                                if (nb.fx === null) { nb.vx += rx; nb.vy += ry; }
                            }
                        }
                    }
                }

                // Gentle inward pull toward container centroid
                for (const node of directNodes) {
                    if (node.fx !== null) continue;
                    const cdx = node.x - container.centroid.x;
                    const cdy = node.y - container.centroid.y;
                    const cd = Math.hypot(cdx, cdy) || 0.001;
                    const pull = Math.min(cd * (isContainerScopedRoot ? 0.008 : 0.015), isContainerScopedRoot ? 0.25 : 0.4) * alpha;
                    node.vx -= (cdx / cd) * pull;
                    node.vy -= (cdy / cd) * pull;
                }

                for (let iter = 0; iter < 8; iter++) {
                    // 1. Node-to-node hard pairwise PBD projection
                    for (let i = 0; i < count; i++) {
                        const na = directNodes[i];
                        for (let j = i + 1; j < count; j++) {
                            const nb = directNodes[j];
                            const isHub = (na.glyph === 'hub' || na.radius >= 4.5 || (na.totalDegree && na.totalDegree >= 2)) ||
                                          (nb.glyph === 'hub' || nb.radius >= 4.5 || (nb.totalDegree && nb.totalDegree >= 2));
                            const extraGap = isHub ? 4.0 : (isDense ? 3.0 : 2.0);
                            const minD = na.radius + nb.radius + extraGap;
                            const dx = nb.x - na.x;
                            const dy = nb.y - na.y;
                            const d2 = dx * dx + dy * dy;
                            if (d2 < minD * minD) {
                                const dist = Math.sqrt(d2) || 0.001;
                                const overlap = minD - dist;
                                const relSpeed = Math.hypot(na.vx - nb.vx, na.vy - nb.vy);
                                const isGraphMoving = this.isDragging || this.alpha > 0.15;
                                const sfxThresh = this.options.sfxThreshold ?? 1.0;
                                if (iter === 0 && overlap > 1.2 && relSpeed > sfxThresh && this.options.sfx && isGraphMoving) {
                                    const intensity = Math.min(1.0, (overlap * relSpeed) / 3.0);
                                    this.options.sfx.playNodeCollision(intensity, na.radius, nb.radius);
                                }
                                const s = ((minD - dist) * 0.5) / dist;
                                if (na.fx === null && nb.fx === null) {
                                    na.x -= dx * s; na.y -= dy * s;
                                    nb.x += dx * s; nb.y += dy * s;
                                } else if (na.fx === null) {
                                    na.x -= dx * s * 2; na.y -= dy * s * 2;
                                } else if (nb.fx === null) {
                                    nb.x += dx * s * 2; nb.y += dy * s * 2;
                                }
                            }
                        }
                    }

                    // 2. Repel loose nodes from any nested child subclusters
                    for (const sub of childSubs) {
                        for (let i = 0; i < count; i++) {
                            const node = directNodes[i];
                            if (node.fx !== null) continue;
                            const sdx = node.x - sub.centroid.x;
                            const sdy = node.y - sub.centroid.y;
                            const sd = Math.hypot(sdx, sdy) || 0.001;
                            const minSd = sub.radius + node.radius + (isContainerScopedRoot ? 6.0 : (isDense ? 4.0 : 2.5));
                            if (sd < minSd) {
                                const pen = minSd - sd;
                                const nodeSpeed = Math.hypot(node.vx, node.vy);
                                const isGraphMoving = this.isDragging || this.alpha > 0.15;
                                const sfxThresh = this.options.sfxThreshold ?? 1.0;
                                if (iter === 0 && pen > 1.8 && nodeSpeed > sfxThresh && this.options.sfx && isGraphMoving) {
                                    this.options.sfx.playNodeBubbleCollision(Math.min(1.0, (pen * nodeSpeed) / 4.0));
                                }
                                const push = ((minSd - sd) * 0.6) / sd;
                                node.x += sdx * push;
                                node.y += sdy * push;
                            }
                        }
                    }

                    // 3. Hard clamp inside container bubble
                    for (let i = 0; i < count; i++) {
                        const node = directNodes[i];
                        if (node.fx !== null) continue;
                        const effectiveR = container.baseRadius || container.radius;
                        const maxR = Math.max(3.0, effectiveR - node.radius - (isContainerScopedRoot ? 5.0 : (isDense ? 4.0 : 2.5)));
                        const cdx = node.x - container.centroid.x;
                        const cdy = node.y - container.centroid.y;
                        const cd = Math.hypot(cdx, cdy) || 0.001;
                        if (cd > maxR) {
                            const pen = cd - maxR;
                            const nodeSpeed = Math.hypot(node.vx, node.vy);
                            const isGraphMoving = this.isDragging || this.alpha > 0.15;
                            const sfxThresh = (this.options.sfxThreshold ?? 1.0) * 1.1;
                            if (iter === 0 && pen > 2.0 && nodeSpeed > sfxThresh && this.options.sfx && isGraphMoving) {
                                this.options.sfx.playNodeBubbleCollision(Math.min(1.0, (pen * nodeSpeed) / 4.0));
                            }
                            const scale = maxR / cd;
                            node.x = container.centroid.x + cdx * scale;
                            node.y = container.centroid.y + cdy * scale;
                        }
                    }
                }

                // 4. Smooth 2-way leaf cluster radius fit (hug nodes comfortably, shrink when settled)
                if (childSubs.length === 0) {
                    if (this.isClusterInDraggedTree(container)) continue;
                    const baseR = container.baseRadius || computeNodesRequiredRadius(directNodes);
                    let maxReqR = baseR;
                    for (let i = 0; i < count; i++) {
                        const node = directNodes[i];
                        const dist = Math.hypot(node.x - container.centroid.x, node.y - container.centroid.y);
                        const req = Math.ceil(dist + node.radius + (isDense ? 5.0 : 3.5));
                        if (req > maxReqR) maxReqR = req;
                    }
                    const maxAllowedR = Math.round(baseR * 1.08);
                    const boundedReqR = Math.min(maxReqR, maxAllowedR);
                    if (boundedReqR > container.radius) {
                        container.radius = boundedReqR;
                    } else if (container.radius > baseR) {
                        container.radius = Math.max(baseR, Math.round(container.radius * 0.90 + baseR * 0.10));
                    }
                }
            }

            // F. Root/unclustered nodes pairwise PBD (4 passes)
            const rootNodes = this.nodes.filter(n => (!n.topLevelFolder || n.topLevelFolder === '/') && (visibleNodeIds ? visibleNodeIds.has(n.id) : true));
            for (let iter = 0; iter < 4; iter++) {
                for (let i = 0; i < rootNodes.length; i++) {
                    const na = rootNodes[i];
                    for (let j = i + 1; j < rootNodes.length; j++) {
                        const nb = rootNodes[j];
                        const minD = na.radius + nb.radius + 3;
                        const dx = nb.x - na.x;
                        const dy = nb.y - na.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < minD * minD) {
                            const dist = Math.sqrt(d2) || 0.001;
                            const overlap = minD - dist;
                            const relSpeed = Math.hypot(na.vx - nb.vx, na.vy - nb.vy);
                            const isGraphMoving = this.isDragging || this.alpha > 0.15;
                            const sfxThresh = this.options.sfxThreshold ?? 1.0;
                            if (iter === 0 && overlap > 1.2 && relSpeed > sfxThresh && this.options.sfx && isGraphMoving) {
                                const intensity = Math.min(1.0, (overlap * relSpeed) / 3.0);
                                this.options.sfx.playNodeCollision(intensity, na.radius, nb.radius);
                            }
                            const s = ((minD - dist) * 0.5) / dist;
                            if (na.fx === null) { na.x -= dx * s; na.y -= dy * s; }
                            if (nb.fx === null) { nb.x += dx * s; nb.y += dy * s; }
                        }
                    }
                }
            }

        } else {
            // =========================================================================
            // STANDARD OBSIDIAN FORCE-DIRECTED GRAPH PHYSICS
            // Literally simulates Obsidian Graph View:
            // 1. Center force (gravity pulling toward (0,0))
            // 2. Many-body repulsion (smooth 2D Coulomb charge with degree-mass weighting)
            // 3. Link spring force (elastic Hooke's law with resting distance & degree bias)
            // 4. Collision avoidance (prevents node overlap)
            // =========================================================================
            const nodeCount = this.nodes.length;
            const currentAlpha = alpha;

            // 1. Center Force (Gravity) — Keeps graph compact, pulls orphans inward toward the cluster
            const centerStrength = 0.032;
            for (let i = 0; i < nodeCount; i++) {
                const node = this.nodes[i];
                if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;
                if (node.fx !== null) continue;
                // Orphan nodes (0 links) get slightly stronger pull to stay nestled near the graph perimeter
                const cK = (!node.totalDegree || node.totalDegree === 0) ? centerStrength * 1.4 : centerStrength;
                node.vx -= node.x * cK * currentAlpha;
                node.vy -= node.y * cK * currentAlpha;
            }

            // 2. Many-body Repulsion (Obsidian Charge) — Bounded local repulsion, NO infinite outward blast!
            const repelStrength = 36;
            const maxRepelDist = 180;
            const maxRepelDistSq = maxRepelDist * maxRepelDist; // 32,400

            for (let i = 0; i < nodeCount; i++) {
                const na = this.nodes[i];
                if (visibleNodeIds && !visibleNodeIds.has(na.id)) continue;
                const massA = 1 + Math.min(1.5, Math.sqrt(na.totalDegree || 0) * 0.25);

                for (let j = i + 1; j < nodeCount; j++) {
                    const nb = this.nodes[j];
                    if (visibleNodeIds && !visibleNodeIds.has(nb.id)) continue;

                    const dx = nb.x - na.x;
                    const dy = nb.y - na.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq > maxRepelDistSq) continue; // Do not blast distant nodes!

                    const dist = Math.sqrt(distSq) || 0.1;
                    const massB = 1 + Math.min(1.5, Math.sqrt(nb.totalDegree || 0) * 0.25);

                    // Smooth falloff factor to zero between 100px and 180px
                    const fade = dist > 100 ? (1 - (dist - 100) / 80) : 1.0;
                    const charge = repelStrength * massA * massB;
                    const force = ((charge * currentAlpha) / Math.max(16, dist)) * fade;

                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;

                    if (na.fx === null) {
                        na.vx -= fx;
                        na.vy -= fy;
                    }
                    if (nb.fx === null) {
                        nb.vx += fx;
                        nb.vy += fy;
                    }
                }
            }

            // 3. Link Springs (Hooke's Law) — Connected notes attract each other
            const restingLinkDist = 38; // Classic Obsidian resting link distance
            const springStiffness = 0.42;
            for (const edge of this.edges) {
                const src = edge.sourceNode;
                const tgt = edge.targetNode;
                if (!src || !tgt) continue;
                if (visibleNodeIds && (!visibleNodeIds.has(src.id) || !visibleNodeIds.has(tgt.id))) continue;

                const dx = tgt.x - src.x;
                const dy = tgt.y - src.y;
                const dist = Math.hypot(dx, dy) || 0.001;
                const displacement = dist - restingLinkDist;
                const springForce = displacement * springStiffness * currentAlpha;

                // Degree weighting: Leaves are drawn strongly towards hubs, hubs stay rooted
                const degSrc = Math.max(1, src.totalDegree || 1);
                const degTgt = Math.max(1, tgt.totalDegree || 1);
                const bias = degTgt / (degSrc + degTgt);

                const fx = (dx / dist) * springForce;
                const fy = (dy / dist) * springForce;

                if (src.fx === null) {
                    src.vx += fx * bias;
                    src.vy += fy * bias;
                }
                if (tgt.fx === null) {
                    tgt.vx -= fx * (1 - bias);
                    tgt.vy -= fy * (1 - bias);
                }
            }

            // 4. Hard Collision Avoidance — Soft bounce to eliminate overlap
            for (let i = 0; i < nodeCount; i++) {
                const na = this.nodes[i];
                if (visibleNodeIds && !visibleNodeIds.has(na.id)) continue;
                for (let j = i + 1; j < nodeCount; j++) {
                    const nb = this.nodes[j];
                    if (visibleNodeIds && !visibleNodeIds.has(nb.id)) continue;

                    const minD = na.radius + nb.radius + 3.0;
                    const dx = nb.x - na.x;
                    const dy = nb.y - na.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < minD * minD && d2 > 0.0001) {
                        const d = Math.sqrt(d2);
                        const overlap = minD - d;
                        const relSpeed = Math.hypot(na.vx - nb.vx, na.vy - nb.vy);
                        const isGraphMoving = this.isDragging || this.alpha > 0.15;
                        const sfxThresh = this.options.sfxThreshold ?? 1.0;
                        if (overlap > 1.2 && relSpeed > sfxThresh && this.options.sfx && isGraphMoving) {
                            const intensity = Math.min(1.0, (overlap * relSpeed) / 3.0);
                            this.options.sfx.playNodeCollision(intensity, na.radius, nb.radius);
                        }
                        const push = (overlap * 0.5) / d;
                        if (na.fx === null) { na.vx -= dx * push; na.vy -= dy * push; }
                        if (nb.fx === null) { nb.vx += dx * push; nb.vy += dy * push; }
                    }
                }
            }
        }

        // =========================================================================
        // FINAL VELOCITY INTEGRATION (default mode nodes + unspawned node parking)
        // =========================================================================
        const maxSpeed = isBubbleMode ? 3.5 : 6.0;
        const defaultDamping = 0.62;
        for (const node of this.nodes) {
            if (visibleNodeIds && !visibleNodeIds.has(node.id)) {
                // Park unspawned node at cluster centroid
                const cluster = this.clusters.find(c => c.nodeIds.includes(node.id));
                if (cluster) {
                    node.x = cluster.centroid.x; node.y = cluster.centroid.y;
                    node.vx = 0; node.vy = 0;
                }
                continue;
            }

            if (node.fx !== null && node.fy !== null) {
                node.x = node.fx; node.y = node.fy;
                continue;
            }

            // Bubble mode nodes are integrated in Level 3 above
            if (isBubbleMode) continue;

            const speed = Math.hypot(node.vx, node.vy);
            if (speed > maxSpeed) {
                node.vx = (node.vx / speed) * maxSpeed;
                node.vy = (node.vy / speed) * maxSpeed;
            }
            node.x += node.vx;
            node.y += node.vy;
            node.vx *= defaultDamping;
            node.vy *= defaultDamping;
            if (speed < 0.01) {
                node.vx = 0;
                node.vy = 0;
            }
        }
        if (this.isDragging && this.draggedCluster) {
            const cluster = this.draggedCluster;
            for (const desc of this.draggedDescendantClusters) {
                const off = this.descendantClusterOffsets.get(desc.id);
                if (off) {
                    desc.centroid.x = cluster.centroid.x + off.x;
                    desc.centroid.y = cluster.centroid.y + off.y;
                }
            }
            for (const item of this.draggedNodes) {
                const off = this.clusterNodeOffsets.get(item.node.id);
                if (off) {
                    const nx = cluster.centroid.x + off.x;
                    const ny = cluster.centroid.y + off.y;
                    item.node.x = nx;
                    item.node.y = ny;
                    item.node.fx = nx;
                    item.node.fy = ny;
                    item.node.vx = 0;
                    item.node.vy = 0;
                }
            }
        }

        updateClusterHulls(this.clusters, this.nodeMap, 18, visibleNodeIds, isBubbleMode);
        if (this.isDragging) {
            this.alpha = Math.max(this.alpha, 0.28);
        } else {
            this.alpha *= (1 - this.alphaDecay);
        }
        // In bubble mode: always keep running (gravity is a continuous living force)
        return isBubbleMode ? true : (this.alpha >= this.alphaMin || this.isDragging);
    }

    public startDrag(targetNode: BubbleNode, worldX: number, worldY: number): void {
        if (this.options.isLocked) return;
        this.isDragging = true;
        this.draggedCluster = null;
        this.draggedDescendantClusters = [];
        this.descendantClusterOffsets.clear();
        this.clusterNodeOffsets.clear();

        this.draggedNodes = [{
            node: targetNode,
            offsetX: targetNode.x - worldX,
            offsetY: targetNode.y - worldY
        }];
        targetNode.fx = targetNode.x;
        targetNode.fy = targetNode.y;
        targetNode.vx = 0;
        targetNode.vy = 0;
        this.reheat(0.35);
    }

    public startDragCluster(cluster: BubbleCluster, worldX: number, worldY: number): void {
        if (this.options.isLocked) return;
        this.isDragging = true;
        this.draggedCluster = cluster;
        this.draggedDescendantClusters = this.getDescendantClusters(cluster);
        this.lastDragWorldPos = { x: worldX, y: worldY };

        // Parent cluster tracking: if dragged cluster is inside a parent bubble
        this.draggedParentCluster = cluster.parentClusterId ? (this.clusters.find(c => c.id === cluster.parentClusterId) || null) : null;
        if (this.draggedParentCluster) {
            const parent = this.draggedParentCluster;
            const fixedR = Math.max(parent.radius, parent.baseRadius || 0);
            parent.baseRadius = fixedR;
            parent.radius = fixedR;
            const parentR = fixedR;
            const maxAllowedD = Math.max(0, parentR - cluster.radius - 4.0);
            const dx = cluster.centroid.x - parent.centroid.x;
            const dy = cluster.centroid.y - parent.centroid.y;
            const d = Math.hypot(dx, dy) || 0.0001;
            if (d > maxAllowedD) {
                cluster.centroid.x = parent.centroid.x + (dx / d) * maxAllowedD;
                cluster.centroid.y = parent.centroid.y + (dy / d) * maxAllowedD;
            }
        }

        // 1. Offsets of all descendant subclusters relative to dragged cluster centroid
        this.descendantClusterOffsets.clear();
        for (const desc of this.draggedDescendantClusters) {
            this.descendantClusterOffsets.set(desc.id, {
                x: desc.centroid.x - cluster.centroid.x,
                y: desc.centroid.y - cluster.centroid.y
            });
        }

        // 2. Offsets of all member nodes relative to dragged cluster centroid
        this.clusterNodeOffsets.clear();
        this.draggedNodes = [];
        const memberNodes = this.getClusterMemberNodes(cluster, this.draggedDescendantClusters);
        for (const n of memberNodes) {
            this.clusterNodeOffsets.set(n.id, {
                x: n.x - cluster.centroid.x,
                y: n.y - cluster.centroid.y
            });
            this.draggedNodes.push({
                node: n,
                offsetX: n.x - worldX,
                offsetY: n.y - worldY
            });
            n.fx = n.x;
            n.fy = n.y;
            n.vx = 0;
            n.vy = 0;
        }

        this.reheat(0.35);
    }

    public updateDrag(worldX: number, worldY: number): void {
        if (!this.isDragging) return;

        if (this.draggedCluster) {
            const dx = worldX - this.lastDragWorldPos.x;
            const dy = worldY - this.lastDragWorldPos.y;
            this.lastDragWorldPos = { x: worldX, y: worldY };

            if (dx === 0 && dy === 0) return;

            const cluster = this.draggedCluster;
            const parent = this.draggedParentCluster;

            if (parent) {
                // Rule 1: Child cluster CANNOT leave parent bubble
                // Rule 2: Parent bubble won't resize (strictly keep fixed baseRadius)
                const parentR = parent.baseRadius || parent.radius;
                parent.radius = parentR;

                const maxAllowedD = Math.max(0, parentR - cluster.radius - 4.0);

                const targetX = cluster.centroid.x + dx;
                const targetY = cluster.centroid.y + dy;

                const offX = targetX - parent.centroid.x;
                const offY = targetY - parent.centroid.y;
                const dist = Math.hypot(offX, offY) || 0.0001;

                if (dist <= maxAllowedD) {
                    // Inside parent: child moves freely inside parent
                    cluster.centroid.x = targetX;
                    cluster.centroid.y = targetY;
                } else {
                    // Child reached inner boundary of parent:
                    // 1. Clamp child strictly to boundary (CANNOT leave parent)
                    cluster.centroid.x = parent.centroid.x + (offX / dist) * maxAllowedD;
                    cluster.centroid.y = parent.centroid.y + (offY / dist) * maxAllowedD;

                    // 2. The excess pull moves the parent!
                    const excess = dist - maxAllowedD;
                    let shiftX = (offX / dist) * excess;
                    let shiftY = (offY / dist) * excess;

                    // If parent itself has a grandparent cluster, clamp parent inside grandparent
                    if (parent.parentClusterId) {
                        const grandParent = this.clusters.find(c => c.id === parent.parentClusterId);
                        if (grandParent) {
                            const gpR = grandParent.baseRadius || grandParent.radius;
                            const maxParentD = Math.max(0, gpR - parent.radius - 4.0);
                            const gpTargetX = parent.centroid.x + shiftX;
                            const gpTargetY = parent.centroid.y + shiftY;
                            const gpOffX = gpTargetX - grandParent.centroid.x;
                            const gpOffY = gpTargetY - grandParent.centroid.y;
                            const gpDist = Math.hypot(gpOffX, gpOffY) || 0.0001;
                            if (gpDist > maxParentD) {
                                const allowedPX = grandParent.centroid.x + (gpOffX / gpDist) * maxParentD;
                                const allowedPY = grandParent.centroid.y + (gpOffY / gpDist) * maxParentD;
                                shiftX = allowedPX - parent.centroid.x;
                                shiftY = allowedPY - parent.centroid.y;
                            }
                        }
                    }

                    // Shift parent
                    parent.centroid.x += shiftX;
                    parent.centroid.y += shiftY;

                    // Child is pinned to boundary, so child also moves with parent
                    cluster.centroid.x += shiftX;
                    cluster.centroid.y += shiftY;

                    // All other clusters inside parent (all sibling subclusters and their descendants) co-move with parent
                    const parentDescendants = this.getDescendantClusters(parent);
                    const draggedClusterIdSet = new Set<string>([cluster.id, ...this.draggedDescendantClusters.map(d => d.id)]);
                    for (const otherCluster of parentDescendants) {
                        if (!draggedClusterIdSet.has(otherCluster.id)) {
                            otherCluster.centroid.x += shiftX;
                            otherCluster.centroid.y += shiftY;
                        }
                    }

                    // All other nodes inside parent (direct notes and all sibling/descendant member notes) co-move with parent
                    const draggedNodeIdSet = new Set<string>(this.draggedNodes.map(item => item.node.id));
                    const allParentNodes = this.getClusterMemberNodes(parent, parentDescendants);
                    for (const n of allParentNodes) {
                        if (!draggedNodeIdSet.has(n.id)) {
                            n.x += shiftX;
                            n.y += shiftY;
                        }
                    }
                }
            } else {
                // Top-level cluster drag (no parent)
                cluster.centroid.x += dx;
                cluster.centroid.y += dy;
            }

            // Sync all descendant clusters relative to cluster.centroid
            for (const desc of this.draggedDescendantClusters) {
                const off = this.descendantClusterOffsets.get(desc.id);
                if (off) {
                    desc.centroid.x = cluster.centroid.x + off.x;
                    desc.centroid.y = cluster.centroid.y + off.y;
                }
            }

            // Sync all member nodes relative to cluster.centroid
            for (const item of this.draggedNodes) {
                const off = this.clusterNodeOffsets.get(item.node.id);
                if (off) {
                    const nx = cluster.centroid.x + off.x;
                    const ny = cluster.centroid.y + off.y;
                    item.node.x = nx;
                    item.node.y = ny;
                    item.node.fx = nx;
                    item.node.fy = ny;
                    item.node.vx = 0;
                    item.node.vy = 0;
                }
            }
        } else if (this.draggedNodes.length > 0) {
            // Single node drag
            for (const item of this.draggedNodes) {
                const prevX = item.node.x;
                const prevY = item.node.y;
                let newX = worldX + item.offsetX;
                let newY = worldY + item.offsetY;

                // In bubble mode, single node also stays clamped to its container bubble
                const containerId = item.node.subClusterId || item.node.clusterId;
                const container = containerId ? this.clusters.find(c => c.id === containerId) : null;
                if (container && container.radius > 0) {
                    const maxR = Math.max(2.0, (container.baseRadius || container.radius) - item.node.radius - 2.0);
                    const cdx = newX - container.centroid.x;
                    const cdy = newY - container.centroid.y;
                    const cd = Math.hypot(cdx, cdy) || 0.001;
                    if (cd > maxR) {
                        newX = container.centroid.x + (cdx / cd) * maxR;
                        newY = container.centroid.y + (cdy / cd) * maxR;
                    }
                }

                item.node.vx = (newX - prevX) * 0.5;
                item.node.vy = (newY - prevY) * 0.5;
                item.node.fx = newX;
                item.node.fy = newY;
                item.node.x = newX;
                item.node.y = newY;
            }
        }

        this.reheat(0.35);
    }

    public endDrag(): void {
        this.isDragging = false;
        for (const item of this.draggedNodes) {
            item.node.fx = null;
            item.node.fy = null;
            item.node.vx = 0;
            item.node.vy = 0;
        }
        this.draggedNodes = [];
        this.draggedCluster = null;
        this.draggedParentCluster = null;
        this.draggedDescendantClusters = [];
        this.descendantClusterOffsets.clear();
        this.clusterNodeOffsets.clear();
        this.reheat(0.25);
    }
}
