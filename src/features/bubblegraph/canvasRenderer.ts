import { normalizePath } from 'obsidian';
import { BubbleNode, BubbleEdge, BubbleCluster } from './types';
import { createSmoothHullPath } from './hullGenerator';
import { getNodeEffectiveTime } from './graphBuilder';

export interface ViewportTransform {
    panX: number;
    panY: number;
    zoom: number;
}

export interface RenderState {
    nodes: BubbleNode[];
    edges: BubbleEdge[];
    clusters: BubbleCluster[];
    nodeMap: Map<string, BubbleNode>;
    layoutMode: 'bubble' | 'default';
    hoveredNode: BubbleNode | null;
    hoveredCluster: BubbleCluster | null;
    selectedNode: BubbleNode | null;
    isInspectorOpen?: boolean;
    searchQuery: string;
    scopeFilter: string;
    scopedFolder?: string | null;
    showVennBridges: boolean;
    interLinkGlow: boolean;
    showLines: boolean;
    showLabels: boolean;
    labelMode?: 'all' | 'folder' | 'text' | 'custom' | 'off' | 'hide';
    customLabelFormats?: Set<string>;
    labelRangeLevel?: number; // legacy single level fallback
    labelMinLevel?: number; // 1 to 5 (hierarchy depth: 1 = root/top, 2 = subfolder, 3 = L3, 4 = L4, 5 = L5+)
    labelMaxLevel?: number; // 1 to 5
    labelFontSize: number; // 8 to 24px
    hullOpacity: number;
    intraLinkOpacity: number;
    timelapseCtimeCutoff?: number | null;
    timelapseVisibleNodeIds?: Set<string> | null;
    enableNodeImageCover?: boolean;
    nodeImageBorder?: 'noborder' | 'thin' | 'thick';
}

export class CanvasRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private animationTime: number = 0;
    private imageCache = new Map<string, HTMLImageElement>();
    private failedImageUrls = new Set<string>();

    private getImage(url: string): HTMLImageElement | null {
        if (this.failedImageUrls.has(url)) return null;
        const cached = this.imageCache.get(url);
        if (cached) return cached;

        const img = new Image();
        img.src = url;
        img.onerror = () => {
            this.failedImageUrls.add(url);
        };
        this.imageCache.set(url, img);
        return img;
    }

    private isNodeVisible(node: BubbleNode, state: RenderState): boolean {
        if (state.timelapseVisibleNodeIds) {
            return state.timelapseVisibleNodeIds.has(node.id);
        }
        if (state.timelapseCtimeCutoff) {
            return getNodeEffectiveTime(node) <= state.timelapseCtimeCutoff;
        }
        return true;
    }

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Failed to obtain 2D rendering context');
        }
        this.ctx = context;
    }

    public render(transform: ViewportTransform, state: RenderState, time: number): void {
        this.animationTime = time;
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Save base state
        ctx.save();

        // 1. Draw subtle grid in screen coordinates
        this.drawBackgroundGrid(transform, width, height);

        // 2. Apply viewport transform (pan & zoom)
        ctx.translate(width / 2 + transform.panX, height / 2 + transform.panY);
        ctx.scale(transform.zoom, transform.zoom);

        // Hover neighbor set for fast lookup
        const hoveredNeighbors = new Set<string>();
        if (state.hoveredNode) {
            hoveredNeighbors.add(state.hoveredNode.id);
            for (const edge of state.edges) {
                if (edge.source === state.hoveredNode.id) hoveredNeighbors.add(edge.target);
                if (edge.target === state.hoveredNode.id) hoveredNeighbors.add(edge.source);
            }
        }

        // 3. Draw Bubble Contour Hulls (if bubble layout mode enabled)
        if (state.layoutMode === 'bubble') {
            this.drawClusterHulls(state, transform.zoom);
        }

        // 4. Draw Links (3-Tier Hierarchy)
        this.drawEdges(state, hoveredNeighbors);

        // 5. Draw Node Glyphs
        this.drawNodes(state, hoveredNeighbors, transform.zoom);

        // Restore base state
        ctx.restore();

        // 6. Draw Screen-Space Tooltip
        if (state.hoveredNode) {
            this.drawTooltip(state.hoveredNode, transform, width, height);
        }
    }

    private drawBackgroundGrid(transform: ViewportTransform, width: number, height: number): void {
        const ctx = this.ctx;
        const gridSize = 40 * transform.zoom;
        if (gridSize < 12) return; // Too dense to render

        const offsetX = (width / 2 + transform.panX) % gridSize;
        const offsetY = (height / 2 + transform.panY) % gridSize;

        ctx.fillStyle = 'rgba(150, 160, 180, 0.04)';
        for (let x = offsetX; x < width; x += gridSize) {
            for (let y = offsetY; y < height; y += gridSize) {
                ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
            }
        }
    }

    private drawClusterHulls(state: RenderState, zoom: number): void {
        const ctx = this.ctx;

        // Resolve scope level and effective text levels (items inside scoped folder start at 1 + scope depth)
        const scopeLevel = (state.scopedFolder && state.scopedFolder !== '/' && state.scopedFolder !== '.')
            ? Math.min(5, 1 + state.scopedFolder.split('/').filter(Boolean).length)
            : 1;
        const userMin = state.labelMinLevel ?? 1;
        const userMax = state.labelMaxLevel ?? (state.labelRangeLevel ?? 2);
        const effectiveMinLevel = Math.max(userMin, scopeLevel);
        const effectiveMaxLevel = Math.max(userMax, effectiveMinLevel);

        // Draw top-level clusters first, then nested subfolders
        const sortedClusters = [...state.clusters].sort((a, b) => a.depth - b.depth);

        for (const cluster of sortedClusters) {
            if (cluster.radius <= 0) continue;

            if (state.timelapseVisibleNodeIds || state.timelapseCtimeCutoff) {
                const hasVisible = cluster.nodeIds.some(id => {
                    const n = state.nodeMap.get(id);
                    return n ? this.isNodeVisible(n, state) : false;
                });
                if (!hasVisible) continue;
            }

            const isExactScopedRoot = Boolean(
                state.scopedFolder && (
                    cluster.id === state.scopedFolder ||
                    (cluster as any).folderPath === state.scopedFolder ||
                    cluster.id === normalizePath(state.scopedFolder) ||
                    (cluster.depth === 1 && state.scopedFolder)
                )
            );

            const isHovered = state.hoveredCluster?.id === cluster.id;
            const isDimmed = state.hoveredNode && !cluster.nodeIds.includes(state.hoveredNode.id);

            ctx.save();
            if (isDimmed) {
                ctx.globalAlpha = 0.2;
            }

            const baseColor = cluster.color || '#4a5568';
            const directChildren = state.clusters.filter(c => c.parentClusterId === cluster.id && c.radius > 0);

            if (cluster.depth === 1) {
                // Top-level Parent Bubble
                const fillAlpha = isHovered ? state.hullOpacity * 2.2 : state.hullOpacity;
                ctx.fillStyle = this.hexToRgba(baseColor, fillAlpha);

                // Carve out direct child bubbles so parent color does NOT bleed into inner bubbles
                ctx.beginPath();
                ctx.arc(cluster.centroid.x, cluster.centroid.y, cluster.radius, 0, Math.PI * 2, false);
                for (const child of directChildren) {
                    const dx = child.centroid.x - cluster.centroid.x;
                    const dy = child.centroid.y - cluster.centroid.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist + child.radius <= cluster.radius * 1.05) {
                        ctx.moveTo(child.centroid.x + child.radius, child.centroid.y);
                        ctx.arc(child.centroid.x, child.centroid.y, child.radius, 0, Math.PI * 2, true);
                    }
                }
                ctx.fill('evenodd');

                // Glow contour stroke of outer boundary only
                if (!isExactScopedRoot) {
                    ctx.beginPath();
                    ctx.arc(cluster.centroid.x, cluster.centroid.y, cluster.radius, 0, Math.PI * 2);
                    if (isHovered) {
                        ctx.shadowColor = baseColor;
                        ctx.shadowBlur = 16;
                        ctx.strokeStyle = this.hexToRgba(baseColor, 0.9);
                        ctx.lineWidth = 2.5;
                    } else {
                        ctx.strokeStyle = this.hexToRgba(baseColor, 0.35);
                        ctx.lineWidth = 1.4;
                    }
                    ctx.stroke();
                }
            } else {
                // Nested Child Bubble (Depth 2 to 5)
                const fillAlpha = isHovered ? 0.32 : Math.max(0.08, (state.hullOpacity || 0.12) * 1.1);
                ctx.fillStyle = this.hexToRgba(baseColor, fillAlpha);

                // Carve out direct children so this bubble's color (even if red) won't affect bubbles inside it
                ctx.beginPath();
                ctx.arc(cluster.centroid.x, cluster.centroid.y, cluster.radius, 0, Math.PI * 2, false);
                for (const child of directChildren) {
                    const dx = child.centroid.x - cluster.centroid.x;
                    const dy = child.centroid.y - cluster.centroid.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist + child.radius <= cluster.radius * 1.05) {
                        ctx.moveTo(child.centroid.x + child.radius, child.centroid.y);
                        ctx.arc(child.centroid.x, child.centroid.y, child.radius, 0, Math.PI * 2, true);
                    }
                }
                ctx.fill('evenodd');

                // Contour stroke of this cluster's outer boundary only
                if (!isExactScopedRoot) {
                    ctx.beginPath();
                    ctx.arc(cluster.centroid.x, cluster.centroid.y, cluster.radius, 0, Math.PI * 2);
                    ctx.strokeStyle = this.hexToRgba(baseColor, isHovered ? 0.95 : 0.65);
                    ctx.lineWidth = isHovered ? 2.0 : 1.4;
                    ctx.stroke();
                }
            }

            // Folder Label Tab Badge (Hierarchy Depth based)
            const isFolderModeAllowed = state.labelMode !== 'hide' && (!state.labelMode || state.labelMode === 'all' || state.labelMode === 'folder' ||
                (state.labelMode === 'custom' && (
                    state.customLabelFormats?.has('folder') ||
                    state.customLabelFormats?.has('folders') ||
                    state.customLabelFormats?.has('*')
                )));

            if (state.showLabels && isFolderModeAllowed) {
                let clusterLevel = cluster.depth || 1;
                if (!cluster.isRelTier) {
                    const clusterParts = cluster.id ? cluster.id.split('/').filter(Boolean) : [];
                    clusterLevel = Math.min(5, Math.max(1, cluster.depth || clusterParts.length));
                    if (state.scopedFolder && cluster.id && (cluster.id === state.scopedFolder || cluster.id.startsWith(state.scopedFolder + '/'))) {
                        const subParts = cluster.id === state.scopedFolder ? [] : cluster.id.slice(state.scopedFolder.length + 1).split('/').filter(Boolean);
                        clusterLevel = Math.min(5, Math.max(1, 1 + subParts.length));
                    }
                }
                const isFolderLevelAllowed = (clusterLevel >= userMin && clusterLevel <= userMax) || 
                                             (clusterLevel >= effectiveMinLevel && clusterLevel <= effectiveMaxLevel);

                if (isHovered || isFolderLevelAllowed) {
                    if (cluster.depth === 1) {
                        this.drawClusterFolderTab(cluster, baseColor, isHovered, state);
                    } else if (isHovered || cluster.radius >= 8) {
                        this.drawSubClusterFolderTab(cluster, baseColor, isHovered, state);
                    }
                }
            }

            ctx.restore();
        }
    }

    private drawClusterFolderTab(
        cluster: BubbleCluster,
        color: string,
        isHovered: boolean,
        state: RenderState
    ): void {
        const visibleCount = (state.timelapseVisibleNodeIds || state.timelapseCtimeCutoff)
            ? cluster.nodeIds.filter(id => {
                const n = state.nodeMap.get(id);
                return n ? this.isNodeVisible(n, state) : false;
            }).length
            : cluster.nodeIds.length;

        if (visibleCount === 0) return;

        const ctx = this.ctx;
        const box = cluster.boundingBox;

        const labelText = `📁 ${cluster.name} (${visibleCount})`;
        const baseSize = state.labelFontSize || 11;
        const fontSize = baseSize;
        ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
        const textWidth = ctx.measureText(labelText).width;
        const tabWidth = textWidth + Math.round(fontSize * 1.3 + 4);
        const tabHeight = Math.round(fontSize * 1.5 + 6);

        const tabX = cluster.centroid.x - tabWidth / 2;
        const topY = (box && isFinite(box.minY) && box.minY !== 0) ? box.minY : (cluster.centroid.y - cluster.radius);
        const tabY = topY - tabHeight / 2 - 2;

        ctx.save();
        // Pill background
        ctx.beginPath();
        ctx.roundRect(tabX, tabY, tabWidth, tabHeight, Math.max(4, Math.round(fontSize * 0.45)));
        ctx.fillStyle = isHovered ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.82)';
        ctx.fill();

        ctx.strokeStyle = isHovered ? color : this.hexToRgba(color, 0.55);
        ctx.lineWidth = isHovered ? 1.5 : 1;
        ctx.stroke();

        // Label Text
        ctx.fillStyle = isHovered ? '#ffffff' : '#cbd5e1';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, tabX + Math.round(fontSize * 0.65 + 2), tabY + tabHeight / 2);

        ctx.restore();
    }

    private drawSubClusterFolderTab(
        cluster: BubbleCluster,
        color: string,
        isHovered: boolean,
        state: RenderState
    ): void {
        const visibleCount = (state.timelapseVisibleNodeIds || state.timelapseCtimeCutoff)
            ? cluster.nodeIds.filter(id => {
                const n = state.nodeMap.get(id);
                return n ? this.isNodeVisible(n, state) : false;
            }).length
            : cluster.nodeIds.length;

        if (visibleCount === 0) return;

        const ctx = this.ctx;
        const labelText = `${cluster.name} (${visibleCount})`;
        const baseSize = state.labelFontSize || 11;
        const fontSize = Math.max(7, Math.round((baseSize * 0.88) * 10) / 10);
        ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
        const textWidth = ctx.measureText(labelText).width;
        const dotRadius = Math.max(2, Math.round(fontSize * 0.28));
        const dotSpacing = dotRadius * 2 + 5;
        const tabWidth = textWidth + Math.round(fontSize * 1.1 + 4) + dotSpacing;
        const tabHeight = Math.round(fontSize * 1.4 + 4);

        const tabX = cluster.centroid.x - tabWidth / 2;
        const tabY = cluster.centroid.y - cluster.radius - tabHeight / 2 - 2;

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(tabX, tabY, tabWidth, tabHeight, Math.max(3, Math.round(fontSize * 0.35)));
        ctx.fillStyle = isHovered ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.85)';
        ctx.fill();

        ctx.strokeStyle = isHovered ? color : this.hexToRgba(color, 0.85);
        ctx.lineWidth = isHovered ? 1.5 : 1.1;
        ctx.stroke();

        // Draw color indicator dot
        ctx.beginPath();
        ctx.arc(tabX + Math.round(fontSize * 0.55 + dotRadius), tabY + tabHeight / 2, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        ctx.fillStyle = isHovered ? '#ffffff' : '#f1f5f9';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, tabX + Math.round(fontSize * 0.55 + dotRadius * 2 + 4), tabY + tabHeight / 2);
        ctx.restore();
    }

    private drawEdges(state: RenderState, hoveredNeighbors: Set<string>): void {
        const ctx = this.ctx;

        for (const edge of state.edges) {
            const src = edge.sourceNode;
            const tgt = edge.targetNode;
            if (!src || !tgt) continue;

            if (!this.isNodeVisible(src, state) || !this.isNodeVisible(tgt, state)) continue;

            const isEdgeConnectedToHover = state.hoveredNode &&
                (edge.source === state.hoveredNode.id || edge.target === state.hoveredNode.id);

            if (!state.showLines && !isEdgeConnectedToHover) continue;

            const isDimmed = state.hoveredNode && !isEdgeConnectedToHover;

            ctx.save();

            if (isDimmed) {
                ctx.globalAlpha = 0.08;
            }

            if (edge.tier === 'tier2_inter') {
                // Tier 2: Inter-Folder Venn Bridge (High-Contrast Glow)
                if (state.showVennBridges) {
                    const isGlowing = state.interLinkGlow || isEdgeConnectedToHover;
                    if (isGlowing && isEdgeConnectedToHover) {
                        ctx.shadowColor = '#00f2ff';
                        ctx.shadowBlur = 12;
                    }
                    ctx.strokeStyle = isEdgeConnectedToHover ? '#00f2ff' : 'rgba(0, 242, 255, 0.4)';
                    ctx.lineWidth = isEdgeConnectedToHover ? 2.4 : 1.3;
                    ctx.beginPath();
                    ctx.moveTo(src.x, src.y);
                    ctx.lineTo(tgt.x, tgt.y);
                    ctx.stroke();
                }
            } else {
                // Tier 1: Intra-Folder Sibling (Thin, low visual weight)
                ctx.strokeStyle = isEdgeConnectedToHover
                    ? src.color
                    : `rgba(148, 163, 184, ${state.intraLinkOpacity})`;
                ctx.lineWidth = isEdgeConnectedToHover ? 1.8 : 1.0;
                ctx.beginPath();
                ctx.moveTo(src.x, src.y);
                ctx.lineTo(tgt.x, tgt.y);
                ctx.stroke();
            }

            // Tier 3: Directional Flow / Hover Marching Particles
            const isSrcActive = Boolean(state.isInspectorOpen && src.isActive);
            if (isEdgeConnectedToHover || (state.showLines && isSrcActive && edge.tier === 'tier2_inter')) {
                this.drawFlowParticle(src, tgt, edge.tier === 'tier2_inter' ? '#00f2ff' : src.color);
            }

            ctx.restore();
        }
    }

    private drawFlowParticle(
        src: BubbleNode,
        tgt: BubbleNode,
        color: string
    ): void {
        const ctx = this.ctx;
        const progress = (this.animationTime % 1200) / 1200;
        const px = src.x + (tgt.x - src.x) * progress;
        const py = src.y + (tgt.y - src.y) * progress;

        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.restore();
    }

    private drawNodes(state: RenderState, hoveredNeighbors: Set<string>, zoom: number): void {
        const ctx = this.ctx;

        // Resolve scope level and effective text levels (items inside scoped folder start at 1 + scope depth)
        const scopeLevel = (state.scopedFolder && state.scopedFolder !== '/' && state.scopedFolder !== '.')
            ? Math.min(5, 1 + state.scopedFolder.split('/').filter(Boolean).length)
            : 1;
        const userMin = state.labelMinLevel ?? 1;
        const userMax = state.labelMaxLevel ?? (state.labelRangeLevel ?? 2);
        const effectiveMinLevel = Math.max(userMin, scopeLevel);
        const effectiveMaxLevel = Math.max(userMax, effectiveMinLevel);

        for (const node of state.nodes) {
            if (!this.isNodeVisible(node, state)) continue;

            const isHovered = state.hoveredNode?.id === node.id;
            const isNeighbor = hoveredNeighbors.has(node.id);
            const isSelected = Boolean(state.isInspectorOpen && state.selectedNode?.id === node.id);
            const isNodeActive = Boolean(state.isInspectorOpen && node.isActive);
            const isDimmed = state.hoveredNode && !isHovered && !isNeighbor;

            ctx.save();
            if (isDimmed) {
                ctx.globalAlpha = 0.12;
            }

            // Draw Node Glyphs (or Image Covers if enabled and available)
            this.drawNodeGlyph(
                node, 
                isHovered, 
                isSelected, 
                isNodeActive, 
                state.enableNodeImageCover !== false,
                state.nodeImageBorder || 'thick'
            );

            // Draw Labels (Dual Handle Range Level 1-5: File/Folder Hierarchy Depth based)
            // Level 1 = Vault root files (nodeParts.length === 0)
            // Level 2 = Files inside top-level folders / Bad / Unsure / Friends
            // Level 3 = Files inside subfolders / Close Friends
            // Level 4 = Files inside Level 3+ subfolders / Family
            // Level 5 = Household & Deepest subfolders
            const nodeParts = node.folderPath ? node.folderPath.split('/').filter(Boolean) : [];
            let nodeLevel = Math.min(5, 1 + nodeParts.length);
            if (node.isRelTier && node.subClusterId) {
                const parentCluster = state.clusters.find(c => c.id === node.subClusterId);
                if (parentCluster && parentCluster.depth) {
                    nodeLevel = parentCluster.depth;
                }
            } else if (state.scopedFolder && node.folderPath && (node.folderPath === state.scopedFolder || node.folderPath.startsWith(state.scopedFolder + '/'))) {
                const subParts = node.folderPath === state.scopedFolder ? [] : node.folderPath.slice(state.scopedFolder.length + 1).split('/').filter(Boolean);
                nodeLevel = Math.min(5, Math.max(1, 1 + subParts.length));
            }
            const isLevelAllowed = (nodeLevel >= userMin && nodeLevel <= userMax) || 
                                   (nodeLevel >= effectiveMinLevel && nodeLevel <= effectiveMaxLevel);

            const ext = (node.extension || 'md').toLowerCase();
            const isNodeFormatAllowed = state.labelMode !== 'hide' && (!state.labelMode || state.labelMode === 'all' || state.labelMode === 'text' ||
                (state.labelMode === 'custom' && (
                    state.customLabelFormats?.has(ext) ||
                    state.customLabelFormats?.has('*') ||
                    state.customLabelFormats?.has('.' + ext)
                )));

            const shouldShowLabel = state.showLabels && state.labelMode !== 'hide' && (
                isHovered ||
                isSelected ||
                (isLevelAllowed && isNodeFormatAllowed)
            );

            if (shouldShowLabel) {
                this.drawNodeLabel(node, isHovered || isSelected, state.labelFontSize || 11);
            }

            ctx.restore();
        }
    }

    private drawNodeGlyph(
        node: BubbleNode, 
        isHovered: boolean, 
        isSelected: boolean, 
        isNodeActive: boolean = false,
        enableNodeImageCover: boolean = true,
        nodeImageBorder: 'noborder' | 'thin' | 'thick' = 'thick'
    ): void {
        const ctx = this.ctx;

        // 1. Active Node Pulse Aura (Only if Inspector is active)
        if (isNodeActive) {
            const pulse = (this.animationTime % 1500) / 1500;
            const currentWaveR = node.radius + pulse * 14;
            const waveAlpha = (1 - pulse) * 0.7;

            ctx.beginPath();
            ctx.arc(node.x, node.y, currentWaveR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 242, 255, ${waveAlpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // 2. Base Node Circle Body
        const effRadius = isNodeActive ? Math.max(node.radius, 6.5) : node.radius;
        ctx.beginPath();
        ctx.arc(node.x, node.y, effRadius, 0, Math.PI * 2);
        const nodeColor = isNodeActive ? '#00f2ff' : (node.color || '#4a5568');
        ctx.fillStyle = nodeColor;
        if (isNodeActive) {
            ctx.shadowColor = '#00f2ff';
            ctx.shadowBlur = 16;
        } else if (isHovered || isSelected) {
            ctx.shadowColor = nodeColor;
            ctx.shadowBlur = 12;
        }
        ctx.fill();

        // 3. Optional Cover Image (Waterfall override: img | image | img-preview | icon | image-preview)
        let hasDrawnImage = false;
        if (enableNodeImageCover && node.imageUrl) {
            const img = this.getImage(node.imageUrl);
            if (img && img.complete && img.naturalWidth > 0) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(node.x, node.y, effRadius, 0, Math.PI * 2);
                ctx.clip();

                // Object-fit: cover inside circle
                const nw = img.naturalWidth;
                const nh = img.naturalHeight;
                const aspect = nw / nh;
                let drawW = effRadius * 2;
                let drawH = effRadius * 2;
                let drawX = node.x - effRadius;
                let drawY = node.y - effRadius;

                if (aspect > 1) {
                    drawW = effRadius * 2 * aspect;
                    drawX = node.x - drawW / 2;
                } else {
                    drawH = (effRadius * 2) / aspect;
                    drawY = node.y - drawH / 2;
                }

                ctx.drawImage(img, drawX, drawY, drawW, drawH);
                ctx.restore();
                hasDrawnImage = true;
            }
        }

        // 4. Outer Rim Stroke
        const isEmphasized = isHovered || isSelected || isNodeActive;
        const borderStyle = nodeImageBorder || 'thick';
        const hasBorder = hasDrawnImage ? (borderStyle !== 'noborder') : (node.totalDegree >= 2);

        if (isEmphasized || hasBorder) {
            ctx.strokeStyle = isNodeActive
                ? '#00f2ff'
                : (isHovered || isSelected
                    ? '#ffffff'
                    : (hasDrawnImage ? (node.color || '#ffffff') : '#ffffff'));

            let strokeW = 1.2;
            if (isEmphasized) {
                strokeW = 2.0;
            } else if (hasDrawnImage) {
                if (borderStyle === 'thin') {
                    strokeW = 1.0;
                } else {
                    strokeW = 2.4; // thick (kayak sekarang)
                }
            }

            ctx.lineWidth = strokeW;
            ctx.stroke();
        }

        // If image was successfully drawn, it overrides the symbol!
        if (hasDrawnImage) {
            return;
        }

        // 5. Fallback Center Glyph Symbol Interior
        const glyph = node.glyph;

        if (glyph === 'no-dot') {
            // Clean circle with no interior dot
            return;
        }

        if (glyph === 'plus' || glyph === 'hub') {
            // '+' Cross
            const crossSize = Math.max(2.5, Math.min(5.5, node.radius * 0.45));
            ctx.beginPath();
            ctx.moveTo(node.x - crossSize, node.y);
            ctx.lineTo(node.x + crossSize, node.y);
            ctx.moveTo(node.x, node.y - crossSize);
            ctx.lineTo(node.x, node.y + crossSize);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.8;
            ctx.stroke();
            return;
        }

        if (glyph === 'minus') {
            // '-' Horizontal Bar
            const barSize = Math.max(2.5, Math.min(5.5, node.radius * 0.45));
            ctx.beginPath();
            ctx.moveTo(node.x - barSize, node.y);
            ctx.lineTo(node.x + barSize, node.y);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.8;
            ctx.stroke();
            return;
        }

        if (glyph === 'i') {
            // 'i' Info Symbol (top dot + stem)
            const h = Math.max(2.5, Math.min(5.5, node.radius * 0.45));
            // Dot
            ctx.beginPath();
            ctx.arc(node.x, node.y - h * 0.65, Math.max(0.9, h * 0.22), 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            // Stem
            ctx.beginPath();
            ctx.moveTo(node.x, node.y - h * 0.15);
            ctx.lineTo(node.x, node.y + h * 0.75);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.6;
            ctx.stroke();
            return;
        }

        if (glyph === 'ring') {
            // '○' Hollow Ring
            ctx.beginPath();
            ctx.arc(node.x, node.y, Math.max(1.5, node.radius * 0.38), 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.3;
            ctx.stroke();
            return;
        }

        if (glyph === 'star') {
            // '*' Asterisk
            const r = Math.max(2.5, Math.min(5.0, node.radius * 0.42));
            ctx.beginPath();
            for (let i = 0; i < 3; i++) {
                const angle = (i * Math.PI) / 3;
                ctx.moveTo(node.x - Math.cos(angle) * r, node.y - Math.sin(angle) * r);
                ctx.lineTo(node.x + Math.cos(angle) * r, node.y + Math.sin(angle) * r);
            }
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.stroke();
            return;
        }

        if (glyph === 'square' || glyph === 'leaf') {
            // '▫' Center Square
            const sqSize = Math.max(2.5, Math.min(4.5, node.radius * 0.42));
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(node.x - sqSize / 2, node.y - sqSize / 2, sqSize, sqSize);
            return;
        }

        // Default / 'dot' / 'document': Center Solid Dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(1.2, node.radius * 0.32), 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }

    private drawNodeLabel(node: BubbleNode, isProminent: boolean, baseFontSize: number = 11): void {
        const ctx = this.ctx;
        const label = node.name;
        const fontSize = isProminent ? baseFontSize + 1 : baseFontSize;
        ctx.font = `${isProminent ? '600' : '400'} ${fontSize}px Inter, system-ui, sans-serif`;

        const textX = node.x + node.radius + 5;
        const textY = node.y + fontSize * 0.35;

        // Dark background halo for high contrast
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.lineWidth = 3;
        ctx.strokeText(label, textX, textY);

        ctx.fillStyle = isProminent ? '#ffffff' : '#e2e8f0';
        ctx.fillText(label, textX, textY);
    }

    private drawTooltip(
        node: BubbleNode,
        transform: ViewportTransform,
        width: number,
        height: number
    ): void {
        const ctx = this.ctx;

        // Convert world coords to screen
        const screenX = width / 2 + transform.panX + node.x * transform.zoom;
        const screenY = height / 2 + transform.panY + node.y * transform.zoom;

        const glyphSymbol = node.glyph === 'plus' ? '( + )' : 
            (node.glyph === 'minus' ? '( - )' : 
            (node.glyph === 'i' ? '( i )' : 
            (node.glyph === 'no-dot' ? '(   )' : 
            (node.glyph === 'ring' ? '( ○ )' : 
            (node.glyph === 'star' ? '( * )' : 
            (node.glyph === 'square' || node.glyph === 'leaf' ? '( ▫ )' : 
            (node.glyph === 'hub' ? '( + )' : '( • )')))))));
        const titleText = `${glyphSymbol} ${node.name}`;
        const folderText = `📁 ${node.folderPath || '/'}`;
        const statsText = `Links: ↗ ${node.outDegree}  |  ↖ ${node.inDegree}  |  Σ ${node.totalDegree}`;

        ctx.font = '600 12px Inter, system-ui, sans-serif';
        const titleWidth = ctx.measureText(titleText).width;
        ctx.font = '400 10px Inter, system-ui, sans-serif';
        const folderWidth = ctx.measureText(folderText).width;
        const statsWidth = ctx.measureText(statsText).width;

        const boxWidth = Math.max(titleWidth, folderWidth, statsWidth) + 24;
        const boxHeight = 62;
        const boxX = Math.min(width - boxWidth - 16, Math.max(16, screenX - boxWidth / 2));
        const boxY = Math.max(16, screenY - node.radius * transform.zoom - boxHeight - 12);

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.fill();
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = node.color;
        ctx.shadowBlur = 10;
        ctx.stroke();

        // Title
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(titleText, boxX + 12, boxY + 18);

        // Folder
        ctx.font = '400 10px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(folderText, boxX + 12, boxY + 36);

        // Stats
        ctx.font = '500 10px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(statsText, boxX + 12, boxY + 52);

        ctx.restore();
    }

    private hexToRgba(hex: string, alpha: number): string {
        let clean = hex.replace('#', '');
        if (clean.length === 3) {
            clean = clean.split('').map(c => c + c).join('');
        }
        const num = parseInt(clean, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}
