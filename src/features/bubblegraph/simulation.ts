import { BubbleNode, BubbleEdge, BubbleCluster } from './types';
import { updateClusterHulls } from './hullGenerator';

export interface SimulationOptions {
    maxDragDepth: number;
    layoutMode: 'bubble' | 'default';
    repulsionStrength?: number;
    linkStrength?: number;
    vennAttraction?: number;
    clusterCentroidStrength?: number;
    damping?: number;
}

export function computeLeafClusterRadius(nodeCount: number, depth: number = 2): number {
    if (nodeCount <= 0) return 0;
    if (nodeCount === 1) return depth === 1 ? 13 : 11;
    if (nodeCount === 2) return depth === 1 ? 17 : 15;
    if (nodeCount === 3) return depth === 1 ? 21 : 18;
    const base = Math.sqrt(nodeCount) * 5.6 + (depth === 1 ? 7 : 5);
    return Math.max(12, Math.round(base));
}

export function computeClusterRadius(nodeCount: number, depth: number = 2): number {
    return computeLeafClusterRadius(nodeCount, depth);
}

export function computeAllClusterRadii(clusters: BubbleCluster[], visibleNodeIds?: Set<string> | null): void {
    const sorted = [...clusters].sort((a, b) => b.depth - a.depth);
    for (const c of sorted) {
        const visibleIds = visibleNodeIds ? c.nodeIds.filter(id => visibleNodeIds.has(id)) : c.nodeIds;
        if (visibleIds.length === 0) {
            c.radius = 0;
            continue;
        }

        const childSubs = clusters.filter(s => s.parentClusterId === c.id && s.radius > 0);
        const directCount = c.directNodeIds 
            ? (visibleNodeIds ? c.directNodeIds.filter(id => visibleNodeIds.has(id)).length : c.directNodeIds.length)
            : Math.max(0, visibleIds.length - childSubs.reduce((sum, s) => sum + s.nodeIds.length, 0));

        const baseR = computeLeafClusterRadius(visibleIds.length, c.depth);
        if (childSubs.length === 0) {
            c.radius = baseR;
            continue;
        }

        if (childSubs.length === 1 && directCount === 0) {
            c.radius = childSubs[0].radius + 5;
            continue;
        }

        let totalSubArea = 0;
        let maxSubRadius = 0;
        for (const sub of childSubs) {
            const sr = sub.radius + 1.0;
            totalSubArea += Math.PI * sr * sr;
            if (sub.radius > maxSubRadius) maxSubRadius = sub.radius;
        }

        // Direct nodes area (~11px diameter footprint per loose node)
        const looseArea = directCount * (Math.PI * 5.5 * 5.5);
        const totalArea = totalSubArea + looseArea;
        // Snug packing density ~0.68 + 4px border margin
        const packingR = Math.ceil(Math.sqrt(totalArea / (Math.PI * 0.68)) + 4);
        const directExtra = directCount > 0 ? Math.ceil(Math.sqrt(directCount) * 3) : 0;
        c.radius = Math.max(baseR, packingR, maxSubRadius + directExtra + 5);
    }
}

export function computeTopClusterRadius(c: BubbleCluster, subClusters: BubbleCluster[], visibleNodeCount: number): number {
    const childSubs = subClusters.filter(s => s.parentClusterId === c.id && s.radius > 0);
    const subNodeCount = childSubs.reduce((sum, s) => sum + s.nodeIds.length, 0);
    const directCount = Math.max(0, visibleNodeCount - subNodeCount);

    const baseR = computeLeafClusterRadius(visibleNodeCount, 1);
    if (childSubs.length === 0) return baseR;

    if (childSubs.length === 1 && directCount === 0) {
        return childSubs[0].radius + 5;
    }

    let totalSubArea = 0;
    let maxSubRadius = 0;
    for (const sub of childSubs) {
        const sr = sub.radius + 1.0;
        totalSubArea += Math.PI * sr * sr;
        if (sub.radius > maxSubRadius) maxSubRadius = sub.radius;
    }

    const looseArea = directCount * (Math.PI * 5.5 * 5.5);
    const totalArea = totalSubArea + looseArea;
    const packingR = Math.ceil(Math.sqrt(totalArea / (Math.PI * 0.68)) + 4);
    const directExtra = directCount > 0 ? Math.ceil(Math.sqrt(directCount) * 3) : 0;

    return Math.max(baseR, packingR, maxSubRadius + directExtra + 5);
}


export class BubbleSimulation {
    private nodes: BubbleNode[] = [];
    private edges: BubbleEdge[] = [];
    private clusters: BubbleCluster[] = [];
    private nodeMap: Map<string, BubbleNode> = new Map();
    private options: SimulationOptions;

    private alpha: number = 1.0;
    private alphaMin: number = 0.001;
    private alphaDecay: number = 0.02;

    private draggedNodes: Array<{ node: BubbleNode; offsetX: number; offsetY: number }> = [];
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
        this.options = {
            repulsionStrength: 500,
            linkStrength: 0.03,
            vennAttraction: 0.0,
            clusterCentroidStrength: 0.08,
            damping: 0.76,
            ...options
        };
        this.nodes.forEach(n => this.nodeMap.set(n.id, n));
        this.initializePositions();
    }

    private initializePositions(): void {
        const topClusters = this.clusters.filter(c => c.depth === 1);
        if (topClusters.length === 0) return;

        // 1. Precompute all cluster radii bottom-up across all depths (1 to 5)
        computeAllClusterRadii(this.clusters);
        for (const c of this.clusters) {
            c.vx = 0;
            c.vy = 0;
        }

        // 2. Position top-level clusters (depth 1) around orbit
        let totalDiameter = 0;
        const gap = 8;
        topClusters.forEach(c => {
            totalDiameter += (2 * c.radius + gap);
        });

        const orbitRadius = topClusters.length === 1 ? 0 : Math.max(20, (totalDiameter / (2 * Math.PI)) * 0.16);
        let currentAngle = 0;

        topClusters.forEach((cluster) => {
            if (topClusters.length === 1) {
                cluster.centroid = { x: 0, y: 0 };
                return;
            }
            const r = cluster.radius;
            const arc = ((2 * r + gap) / totalDiameter) * Math.PI * 2;
            const angle = currentAngle + arc / 2;
            currentAngle += arc;

            const cx = Math.cos(angle) * orbitRadius;
            const cy = Math.sin(angle) * orbitRadius;
            cluster.centroid = { x: cx, y: cy };
        });

        // 3. Position nested clusters hierarchically (depth 2 up to max depth)
        const maxDepth = Math.max(1, ...this.clusters.map(c => c.depth));
        for (let d = 2; d <= maxDepth; d++) {
            const parents = this.clusters.filter(c => c.depth === d - 1);
            for (const parent of parents) {
                const children = this.clusters.filter(c => c.depth === d && c.parentClusterId === parent.id && c.radius > 0);
                if (children.length === 0) continue;

                const numChildren = children.length;
                if (numChildren === 1) {
                    children[0].centroid = { x: parent.centroid.x, y: parent.centroid.y };
                } else {
                    const maxSubD = Math.max(0, parent.radius - Math.max(...children.map(c => c.radius)) - 3);
                    children.forEach((child, idx) => {
                        const phi = idx * 2.3999632;
                        const dist = Math.sqrt((idx + 0.5) / numChildren) * maxSubD * 0.65;
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
                                const minD = ca.radius + cb.radius + 1.5;
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
                            const maxSubD = Math.max(0, parent.radius - child.radius - 3);
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
                const maxSpread = Math.max(2, cluster.radius - 5);
                directNodes.forEach((node, idx) => {
                    const phi = idx * 2.3999632;
                    const dist = Math.sqrt((idx + 0.5) / count) * maxSpread * 0.65;
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
                        const minD = na.radius + nb.radius + 2.0;
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
                    const maxR = Math.max(2, cluster.radius - node.radius - 2.5);
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
        this.options = { ...this.options, ...opts };
        this.reheat();
    }

    public reheat(amount: number = 0.4): void {
        this.alpha = Math.max(this.alpha, amount);
    }

    public step(visibleNodeIds?: Set<string> | null): boolean {
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
            computeAllClusterRadii(this.clusters, visibleNodeIds);
            for (const c of this.clusters) { c.vx = 0; c.vy = 0; }

            // Snapshot ALL centroids before any change this frame
            const prevPos = new Map<string, { x: number; y: number }>();
            for (const c of this.clusters) prevPos.set(c.id, { x: c.centroid.x, y: c.centroid.y });

            // 1. Group-level centering: pull collective center of mass of top folders to (0, 0)
            let activeTopCount = 0;
            let comX = 0;
            let comY = 0;
            for (const c of topClusters) {
                if (c.radius === 0) continue;
                comX += c.centroid.x;
                comY += c.centroid.y;
                activeTopCount++;
            }
            if (activeTopCount > 0 && !this.isDragging) {
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
                const d = Math.hypot(c.centroid.x, c.centroid.y) || 0.001;
                const pullSpeed = Math.min(d * 0.035 + 1.2, 7.0);
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
                        const minD = ca.radius + cb.radius + 2;
                        const dx = cb.centroid.x - ca.centroid.x;
                        const dy = cb.centroid.y - ca.centroid.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < minD * minD) {
                            const d = Math.sqrt(d2) || 0.001;
                            const s = ((minD - d) * 0.5) / d;
                            ca.centroid.x -= dx * s; ca.centroid.y -= dy * s;
                            cb.centroid.x += dx * s; cb.centroid.y += dy * s;
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
                    const parent = clusterById.get(sub.parentClusterId!);
                    if (!parent || parent.radius === 0) continue;
                    const pp = prevPos.get(parent.id);
                    if (pp) {
                        sub.centroid.x += parent.centroid.x - pp.x;
                        sub.centroid.y += parent.centroid.y - pp.y;
                    }
                }

                // Subfolder inward gravity toward parent center (active pull to eliminate empty space)
                const subGravK = 0.06;
                for (const sub of clustersAtDepth) {
                    const parent = clusterById.get(sub.parentClusterId!);
                    if (!parent || parent.radius === 0) continue;
                    sub.centroid.x += (parent.centroid.x - sub.centroid.x) * subGravK;
                    sub.centroid.y += (parent.centroid.y - sub.centroid.y) * subGravK;
                }

                // Sibling separation & Container boundary constraint — 12 PBD passes [just touch]
                for (let iter = 0; iter < 12; iter++) {
                    for (let i = 0; i < clustersAtDepth.length; i++) {
                        const sa = clustersAtDepth[i];
                        for (let j = i + 1; j < clustersAtDepth.length; j++) {
                            const sb = clustersAtDepth[j];
                            if (sa.parentClusterId !== sb.parentClusterId) continue;
                            const minD = sa.radius + sb.radius + 1.5;
                            const dx = sb.centroid.x - sa.centroid.x;
                            const dy = sb.centroid.y - sa.centroid.y;
                            const d2 = dx * dx + dy * dy;
                            if (d2 < minD * minD) {
                                const dist = Math.sqrt(d2) || 0.001;
                                const s = ((minD - dist) * 0.5) / dist;
                                sa.centroid.x -= dx * s; sa.centroid.y -= dy * s;
                                sb.centroid.x += dx * s; sb.centroid.y += dy * s;
                            }
                        }
                    }

                    // Hard boundary clamp: subfolder must strictly stay inside parent circle
                    for (const sub of clustersAtDepth) {
                        const parent = clusterById.get(sub.parentClusterId!);
                        if (!parent || parent.radius === 0) continue;
                        const maxSubD = Math.max(0, parent.radius - sub.radius - 3.0);
                        const dx = sub.centroid.x - parent.centroid.x;
                        const dy = sub.centroid.y - parent.centroid.y;
                        const dist = Math.hypot(dx, dy) || 0.001;
                        if (dist > maxSubD) {
                            const scale = maxSubD / dist;
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
                    const childSubs = this.clusters.filter(s => s.parentClusterId === p.id && s.radius > 0);
                    if (childSubs.length === 0) continue;

                    // Center of mass of child subclusters and direct notes
                    let sumX = 0;
                    let sumY = 0;
                    let totalW = 0;
                    for (const sub of childSubs) {
                        const w = Math.max(1, sub.radius);
                        sumX += sub.centroid.x * w;
                        sumY += sub.centroid.y * w;
                        totalW += w;
                    }

                    const pDirectNodes = this.nodes.filter(n => {
                        if (visibleNodeIds && !visibleNodeIds.has(n.id)) return false;
                        return n.clusterId === p.id && (!n.subClusterId || n.subClusterId === p.id);
                    });
                    for (const n of pDirectNodes) {
                        sumX += n.x * 4;
                        sumY += n.y * 4;
                        totalW += 4;
                    }

                    if (totalW > 0 && !this.isDragging) {
                        const comX = sumX / totalW;
                        const comY = sumY / totalW;
                        p.centroid.x = p.centroid.x * 0.90 + comX * 0.10;
                        p.centroid.y = p.centroid.y * 0.90 + comY * 0.10;
                    }

                    // Enclosing radius with 4-5px margin
                    let maxReqR = 0;
                    for (const sub of childSubs) {
                        const dist = Math.hypot(sub.centroid.x - p.centroid.x, sub.centroid.y - p.centroid.y);
                        const req = dist + sub.radius + 4.5;
                        if (req > maxReqR) maxReqR = req;
                    }
                    for (const n of pDirectNodes) {
                        const dist = Math.hypot(n.x - p.centroid.x, n.y - p.centroid.y);
                        const req = dist + n.radius + 4.0;
                        if (req > maxReqR) maxReqR = req;
                    }

                    maxReqR = Math.ceil(maxReqR);
                    if (maxReqR > p.radius) {
                        p.radius = maxReqR;
                    } else if (maxReqR < p.radius) {
                        // Smoothly contract to eliminate empty space!
                        p.radius = Math.max(maxReqR, Math.round(p.radius * 0.90 + maxReqR * 0.10));
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
                    container.radius = computeLeafClusterRadius(1, container.depth);
                    continue;
                }

                // Soft repulsion between sibling notes so they spread evenly and do not clump
                if (count > 1) {
                    const idealSpacing = Math.max(9, Math.min(22, (container.radius * 1.5) / Math.sqrt(count)));
                    const idealSq = idealSpacing * idealSpacing;
                    for (let i = 0; i < count; i++) {
                        const na = directNodes[i];
                        for (let j = i + 1; j < count; j++) {
                            const nb = directNodes[j];
                            const dx = nb.x - na.x;
                            const dy = nb.y - na.y;
                            const d2 = dx * dx + dy * dy;
                            if (d2 < idealSq && d2 > 0.01) {
                                const d = Math.sqrt(d2);
                                const rep = ((idealSpacing - d) / idealSpacing) * 0.25 * alpha;
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
                    const pull = Math.min(cd * 0.015, 0.4) * alpha;
                    node.vx -= (cdx / cd) * pull;
                    node.vy -= (cdy / cd) * pull;
                }

                for (let iter = 0; iter < 8; iter++) {
                    // 1. Node-to-node hard pairwise PBD projection
                    for (let i = 0; i < count; i++) {
                        const na = directNodes[i];
                        for (let j = i + 1; j < count; j++) {
                            const nb = directNodes[j];
                            // "Just touch" spacing: radius A + radius B + 2.0px hairline gap
                            const minD = na.radius + nb.radius + 2.0;
                            const dx = nb.x - na.x;
                            const dy = nb.y - na.y;
                            const d2 = dx * dx + dy * dy;
                            if (d2 < minD * minD) {
                                const dist = Math.sqrt(d2) || 0.001;
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
                            const minSd = sub.radius + node.radius + 3.0;
                            if (sd < minSd) {
                                const push = (minSd - sd) / sd;
                                node.x += sdx * push;
                                node.y += sdy * push;
                            }
                        }
                    }

                    // 3. Hard clamp inside container bubble
                    for (let i = 0; i < count; i++) {
                        const node = directNodes[i];
                        if (node.fx !== null) continue;
                        const maxR = Math.max(2.5, container.radius - node.radius - 2.5);
                        const cdx = node.x - container.centroid.x;
                        const cdy = node.y - container.centroid.y;
                        const cd = Math.hypot(cdx, cdy) || 0.001;
                        if (cd > maxR) {
                            const scale = maxR / cd;
                            node.x = container.centroid.x + cdx * scale;
                            node.y = container.centroid.y + cdy * scale;
                        }
                    }
                }

                // 4. Smooth 2-way leaf cluster radius fit (hug nodes snugly, shrink when settled)
                if (childSubs.length === 0) {
                    const baseR = computeLeafClusterRadius(count, container.depth);
                    let maxReqR = baseR;
                    for (let i = 0; i < count; i++) {
                        const node = directNodes[i];
                        const dist = Math.hypot(node.x - container.centroid.x, node.y - container.centroid.y);
                        const req = Math.ceil(dist + node.radius + 3.5);
                        if (req > maxReqR) maxReqR = req;
                    }
                    if (maxReqR > container.radius) {
                        container.radius = maxReqR;
                    } else if (maxReqR < container.radius) {
                        container.radius = Math.max(baseR, Math.round(container.radius * 0.90 + maxReqR * 0.10));
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
                            const s = ((minD - dist) * 0.5) / dist;
                            if (na.fx === null) { na.x -= dx * s; na.y -= dy * s; }
                            if (nb.fx === null) { nb.x += dx * s; nb.y += dy * s; }
                        }
                    }
                }
            }

        } else {
            // =========================================================================
            // STANDARD DEFAULT FORCE-DIRECTED GRAPH MODE
            // =========================================================================
            const nodeCount = this.nodes.length;
            for (let i = 0; i < nodeCount; i++) {
                const na = this.nodes[i];
                if (visibleNodeIds && !visibleNodeIds.has(na.id)) continue;
                for (let j = i + 1; j < nodeCount; j++) {
                    const nb = this.nodes[j];
                    if (visibleNodeIds && !visibleNodeIds.has(nb.id)) continue;
                    const dx = nb.x - na.x; const dy = nb.y - na.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < 200 * 200) {
                        const dist = Math.sqrt(distSq) || 1;
                        const force = (400 / distSq) * alpha;
                        na.vx -= (dx / dist) * force; na.vy -= (dy / dist) * force;
                        nb.vx += (dx / dist) * force; nb.vy += (dy / dist) * force;
                    }
                }
            }

            for (const edge of this.edges) {
                const src = edge.sourceNode; const tgt = edge.targetNode;
                if (!src || !tgt) continue;
                if (visibleNodeIds && (!visibleNodeIds.has(src.id) || !visibleNodeIds.has(tgt.id))) continue;
                const dx = tgt.x - src.x; const dy = tgt.y - src.y;
                const dist = Math.hypot(dx, dy) || 1;
                const targetDist = edge.tier === 'tier2_inter' ? 120 : 50;
                const force = (dist - targetDist) * 0.03 * alpha;
                src.vx += (dx / dist) * force; src.vy += (dy / dist) * force;
                tgt.vx -= (dx / dist) * force; tgt.vy -= (dy / dist) * force;
            }
        }

        // =========================================================================
        // FINAL VELOCITY INTEGRATION (default mode nodes + unspawned node parking)
        // =========================================================================
        const maxSpeed = 3.5;
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
                node.vx = 0; node.vy = 0;
                continue;
            }

            // Bubble mode nodes are integrated in Level 3 above
            if (isBubbleMode) continue;

            const speed = Math.hypot(node.vx, node.vy);
            if (speed > maxSpeed) { node.vx = (node.vx / speed) * maxSpeed; node.vy = (node.vy / speed) * maxSpeed; }
            node.x += node.vx; node.y += node.vy;
            node.vx *= damping; node.vy *= damping;
        }

        updateClusterHulls(this.clusters, this.nodeMap, 18, visibleNodeIds, isBubbleMode);
        this.alpha *= (1 - this.alphaDecay);
        // In bubble mode: always keep running (gravity is a continuous living force)
        return isBubbleMode ? true : (this.alpha >= this.alphaMin || this.isDragging);
    }

    public startDrag(targetNode: BubbleNode, worldX: number, worldY: number): void {
        const depth = this.options.maxDragDepth;
        if (depth === 0) return;
        this.isDragging = true;
        this.draggedNodes = [];

        if (depth >= 1 && depth <= 5) {
            const cluster = this.clusters.find(c => c.depth === depth && c.nodeIds.includes(targetNode.id));
            if (cluster) {
                const clusterNodes = this.nodes.filter(n => cluster.nodeIds.includes(n.id));
                for (const n of clusterNodes) {
                    this.draggedNodes.push({ node: n, offsetX: n.x - worldX, offsetY: n.y - worldY });
                    n.fx = n.x; n.fy = n.y;
                }
            } else {
                this.draggedNodes.push({ node: targetNode, offsetX: targetNode.x - worldX, offsetY: targetNode.y - worldY });
                targetNode.fx = targetNode.x; targetNode.fy = targetNode.y;
            }
        } else {
            this.draggedNodes.push({ node: targetNode, offsetX: targetNode.x - worldX, offsetY: targetNode.y - worldY });
            targetNode.fx = targetNode.x; targetNode.fy = targetNode.y;
        }
        this.reheat(0.3);
    }

    public updateDrag(worldX: number, worldY: number): void {
        if (!this.isDragging || this.draggedNodes.length === 0) return;
        for (const item of this.draggedNodes) {
            item.node.fx = worldX + item.offsetX;
            item.node.fy = worldY + item.offsetY;
            item.node.x = item.node.fx;
            item.node.y = item.node.fy;
        }
        const depth = this.options.maxDragDepth;
        if (depth >= 1 && depth <= 5 && this.draggedNodes.length > 0) {
            const firstNodeId = this.draggedNodes[0].node.id;
            const cluster = this.clusters.find(c => c.depth === depth && c.nodeIds.includes(firstNodeId));
            if (cluster) {
                let sx = 0, sy = 0;
                this.draggedNodes.forEach(item => { sx += item.node.x; sy += item.node.y; });
                cluster.centroid.x = sx / this.draggedNodes.length;
                cluster.centroid.y = sy / this.draggedNodes.length;
            }
        }
        this.reheat(0.2);
    }

    public endDrag(): void {
        this.isDragging = false;
        for (const item of this.draggedNodes) { item.node.fx = null; item.node.fy = null; }
        this.draggedNodes = [];
        this.reheat(0.1);
    }
}
