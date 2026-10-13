import { TierListItem } from './comparison-view';
import { VennPartition } from '../utils/venn-utils';

export interface VennBubbleNode {
    id: string;
    text: string;
    partitionId: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    color: string;
    textColor: string;
    labelX: number;
    labelY: number;
    labelWidth: number;
    labelHeight: number;
}

export interface VennHullGeometry {
    id: string;
    label: string;
    cx: number;
    cy: number;
    radius: number;
    color: string;
    strokeColor: string;
    isCenterAll: boolean;
    itemIndices: number[];
}

export interface VennCanvasCallbacks {
    onSelectAttribute?: (attr: string, partition: VennPartition) => void;
    onSelectZone?: (zoneId: string) => void;
}

const ZONE_PALETTE = [
    { fill: 'rgba(139, 92, 246, 0.14)', stroke: 'rgba(139, 92, 246, 0.65)', node: '#8b5cf6', text: '#ffffff' }, // Purple
    { fill: 'rgba(236, 72, 153, 0.14)', stroke: 'rgba(236, 72, 153, 0.65)', node: '#ec4899', text: '#ffffff' }, // Pink
    { fill: 'rgba(56, 189, 248, 0.16)', stroke: 'rgba(56, 189, 248, 0.70)', node: '#38bdf8', text: '#ffffff' }, // Sky Blue (Shared)
    { fill: 'rgba(16, 185, 129, 0.14)', stroke: 'rgba(16, 185, 129, 0.65)', node: '#10b981', text: '#ffffff' }, // Emerald
    { fill: 'rgba(245, 158, 11, 0.14)', stroke: 'rgba(245, 158, 11, 0.65)', node: '#f59e0b', text: '#ffffff' }, // Amber
    { fill: 'rgba(168, 85, 247, 0.14)', stroke: 'rgba(168, 85, 247, 0.65)', node: '#a855f7', text: '#ffffff' }, // Indigo
];

export class VennBubbleCanvas {
    private container: HTMLElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private items: TierListItem[] = [];
    private partitions: VennPartition[] = [];
    private nodes: VennBubbleNode[] = [];
    private hulls: VennHullGeometry[] = [];
    private simulateTextCollision: boolean = false;
    private activeZoneId: string = 'all';
    private callbacks: VennCanvasCallbacks = {};

    private animId: number | null = null;
    private isRunning: boolean = false;
    private isDragging: boolean = false;
    private draggedNode: VennBubbleNode | null = null;
    private hoveredNode: VennBubbleNode | null = null;
    private tooltipEl: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;

    private width: number = 600;
    private height: number = 380;
    private dpr: number = 1;

    constructor(
        container: HTMLElement,
        items: TierListItem[],
        partitions: VennPartition[],
        simulateTextCollision: boolean = false,
        activeZoneId: string = 'all',
        callbacks: VennCanvasCallbacks = {}
    ) {
        this.container = container;
        this.items = items;
        this.partitions = partitions;
        this.simulateTextCollision = simulateTextCollision;
        this.activeZoneId = activeZoneId;
        this.callbacks = callbacks;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'venn-bubble-canvas';
        this.container.appendChild(this.canvas);

        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D canvas context');
        this.ctx = ctx;

        this.initTooltip();
        this.setupEventListeners();
        this.initResize();
        this.rebuildGraph();
    }

    private initTooltip() {
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.className = 'venn-canvas-tooltip';
        this.tooltipEl.style.display = 'none';
        this.tooltipEl.style.position = 'absolute';
        this.tooltipEl.style.pointerEvents = 'none';
        this.tooltipEl.style.zIndex = '1000';
        this.container.style.position = 'relative';
        this.container.appendChild(this.tooltipEl);
    }

    private initResize() {
        this.resizeObserver = new ResizeObserver(() => {
            this.handleResize();
        });
        this.resizeObserver.observe(this.container);
        this.handleResize();
    }

    private handleResize() {
        const rect = this.container.getBoundingClientRect();
        const w = Math.max(320, Math.floor(rect.width || 600));
        const h = Math.max(300, Math.min(560, Math.floor(w * 0.58)));

        this.width = w;
        this.height = h;
        this.dpr = window.devicePixelRatio || 1;

        this.canvas.width = Math.floor(w * this.dpr);
        this.canvas.height = Math.floor(h * this.dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';

        this.layoutHulls();
        this.wakeSimulation();
    }

    public updateData(
        items: TierListItem[],
        partitions: VennPartition[],
        simulateTextCollision?: boolean,
        activeZoneId?: string
    ) {
        this.items = items;
        this.partitions = partitions;
        if (simulateTextCollision !== undefined) {
            this.simulateTextCollision = simulateTextCollision;
        }
        if (activeZoneId !== undefined) {
            this.activeZoneId = activeZoneId;
        }
        this.rebuildGraph();
    }

    public setSimulateTextCollision(enabled: boolean) {
        this.simulateTextCollision = enabled;
        this.wakeSimulation();
    }

    public setActiveZone(zoneId: string) {
        this.activeZoneId = zoneId;
        this.wakeSimulation();
    }

    private layoutHulls() {
        const W = this.width;
        const H = this.height;
        const itemCount = this.items.length;
        this.hulls = [];

        if (itemCount <= 0 || this.partitions.length === 0) return;

        // Position coordinates for basic items
        const itemCenters: Array<{ cx: number; cy: number }> = [];

        if (itemCount === 2) {
            const gap = W * 0.28;
            itemCenters.push({ cx: W * 0.5 - gap * 0.62, cy: H * 0.5 });
            itemCenters.push({ cx: W * 0.5 + gap * 0.62, cy: H * 0.5 });
        } else if (itemCount === 3) {
            const rOrbit = Math.min(W, H) * 0.26;
            itemCenters.push({ cx: W * 0.5 - rOrbit * 0.86, cy: H * 0.5 - rOrbit * 0.5 });
            itemCenters.push({ cx: W * 0.5 + rOrbit * 0.86, cy: H * 0.5 - rOrbit * 0.5 });
            itemCenters.push({ cx: W * 0.5, cy: H * 0.5 + rOrbit * 0.8 });
        } else {
            // N >= 4: Regular circular orbit
            const rOrbit = Math.min(W, H) * 0.30;
            for (let i = 0; i < itemCount; i++) {
                const angle = (2 * Math.PI * i) / itemCount - Math.PI / 2;
                itemCenters.push({
                    cx: W * 0.5 + Math.cos(angle) * rOrbit,
                    cy: H * 0.5 + Math.sin(angle) * rOrbit
                });
            }
        }

        // Generate geometry for each partition
        this.partitions.forEach((p, idx) => {
            let cx = W * 0.5;
            let cy = H * 0.5;

            if (p.isCenterAll) {
                cx = W * 0.5;
                cy = H * 0.5;
            } else if (p.itemIndices.length === 1) {
                const iIdx = p.itemIndices[0];
                if (itemCenters[iIdx]) {
                    cx = itemCenters[iIdx].cx;
                    cy = itemCenters[iIdx].cy;
                }
            } else if (p.itemIndices.length > 1) {
                let sumX = 0;
                let sumY = 0;
                let validCount = 0;
                p.itemIndices.forEach((iIdx) => {
                    if (itemCenters[iIdx]) {
                        sumX += itemCenters[iIdx].cx;
                        sumY += itemCenters[iIdx].cy;
                        validCount++;
                    }
                });
                if (validCount > 0) {
                    cx = sumX / validCount;
                    cy = sumY / validCount;
                }
            }

            // Adaptive auto-fit radius based on attribute count and text bounding area
            const attrCount = p.attributes.length;
            const textAreaScore = p.attributes.reduce((acc, s) => acc + s.length * 9, 0);
            const baseR = Math.sqrt(attrCount * 1400 + textAreaScore * 18 + 1200);
            const maxAllowedR = Math.min(W, H) * (p.isCenterAll ? 0.36 : 0.32);
            const radius = Math.max(38, Math.min(maxAllowedR, Math.round(baseR)));

            const paletteIndex = p.isCenterAll ? 2 : (idx % ZONE_PALETTE.length);
            const pal = ZONE_PALETTE[paletteIndex] || ZONE_PALETTE[0];

            this.hulls.push({
                id: p.id,
                label: p.label,
                cx,
                cy,
                radius,
                color: pal.fill,
                strokeColor: pal.stroke,
                isCenterAll: p.isCenterAll,
                itemIndices: p.itemIndices
            });
        });
    }

    private rebuildGraph() {
        this.layoutHulls();
        const oldMap = new Map<string, VennBubbleNode>();
        this.nodes.forEach((n) => oldMap.set(n.id, n));

        const newNodes: VennBubbleNode[] = [];

        this.partitions.forEach((partition, pIdx) => {
            const hull = this.hulls.find((h) => h.id === partition.id);
            const hcx = hull ? hull.cx : this.width * 0.5;
            const hcy = hull ? hull.cy : this.height * 0.5;
            const hr = hull ? hull.radius : 60;

            const pal = partition.isCenterAll
                ? ZONE_PALETTE[2]
                : (ZONE_PALETTE[pIdx % ZONE_PALETTE.length] || ZONE_PALETTE[0]);

            partition.attributes.forEach((attr, aIdx) => {
                const nodeId = `${partition.id}::${attr}`;
                const existing = oldMap.get(nodeId);

                // Auto-fit radius based on string content
                const cleanLen = Math.min(attr.length, 24);
                const radius = Math.max(13, Math.min(34, Math.round(cleanLen * 2.2 + 8)));
                const labelWidth = Math.max(24, Math.round(attr.length * 6.2));
                const labelHeight = 14;

                let x = hcx + (Math.random() - 0.5) * (hr * 0.8);
                let y = hcy + (Math.random() - 0.5) * (hr * 0.8);
                let vx = 0;
                let vy = 0;

                if (existing) {
                    x = existing.x;
                    y = existing.y;
                    vx = existing.vx;
                    vy = existing.vy;
                }

                newNodes.push({
                    id: nodeId,
                    text: attr,
                    partitionId: partition.id,
                    x,
                    y,
                    vx,
                    vy,
                    radius,
                    color: pal.node,
                    textColor: pal.text,
                    labelX: x,
                    labelY: y,
                    labelWidth,
                    labelHeight
                });
            });
        });

        this.nodes = newNodes;
        this.wakeSimulation();
    }

    private wakeSimulation() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.tick();
        }
    }

    private tick = () => {
        if (!this.isRunning) return;

        const energy = this.stepPhysics();
        this.render();

        // Continue running if above kinetic threshold or dragging
        if (energy > 0.04 || this.isDragging) {
            this.animId = requestAnimationFrame(this.tick);
        } else {
            this.isRunning = false;
            this.animId = null;
        }
    };

    private stepPhysics(): number {
        let totalEnergy = 0;
        const hullsMap = new Map<string, VennHullGeometry>();
        this.hulls.forEach((h) => hullsMap.set(h.id, h));

        // 1. Center attraction and drag update
        for (const node of this.nodes) {
            if (this.draggedNode && this.draggedNode.id === node.id) {
                node.vx = 0;
                node.vy = 0;
                continue;
            }

            const hull = hullsMap.get(node.partitionId);
            if (hull) {
                const dx = hull.cx - node.x;
                const dy = hull.cy - node.y;
                node.vx += dx * 0.04;
                node.vy += dy * 0.04;
            }

            // Damping
            node.vx *= 0.84;
            node.vy *= 0.84;
            node.x += node.vx;
            node.y += node.vy;

            totalEnergy += node.vx * node.vx + node.vy * node.vy;
        }

        // 2. Node-to-node circle repulsion
        const len = this.nodes.length;
        for (let i = 0; i < len; i++) {
            const a = this.nodes[i];
            for (let j = i + 1; j < len; j++) {
                const b = this.nodes[j];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const distSq = dx * dx + dy * dy;
                const minDist = a.radius + b.radius + 4;
                if (distSq > 0 && distSq < minDist * minDist) {
                    const dist = Math.sqrt(distSq);
                    const overlap = (minDist - dist) * 0.5;
                    const nx = dx / dist;
                    const ny = dy / dist;

                    if (!this.draggedNode || this.draggedNode.id !== a.id) {
                        a.x -= nx * overlap;
                        a.y -= ny * overlap;
                    }
                    if (!this.draggedNode || this.draggedNode.id !== b.id) {
                        b.x += nx * overlap;
                        b.y += ny * overlap;
                    }
                }
            }
        }

        // 3. Containment within partition hull
        for (const node of this.nodes) {
            const hull = hullsMap.get(node.partitionId);
            if (hull) {
                const dx = node.x - hull.cx;
                const dy = node.y - hull.cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxR = Math.max(10, hull.radius - node.radius - 2);
                if (dist > maxR && dist > 0) {
                    const pull = dist - maxR;
                    node.x -= (dx / dist) * pull * 0.6;
                    node.y -= (dy / dist) * pull * 0.6;
                }
            }
        }

        // 4. Text Collision Relaxation (PBD AABB passes) when enabled
        if (this.simulateTextCollision) {
            this.relaxTextLabels();
        } else {
            for (const n of this.nodes) {
                n.labelX = n.x;
                n.labelY = n.y;
            }
        }

        return totalEnergy;
    }

    private relaxTextLabels() {
        const count = this.nodes.length;

        // Initialize label target coords
        for (const n of this.nodes) {
            if (!n.labelX || !n.labelY) {
                n.labelX = n.x;
                n.labelY = n.y;
            } else {
                // Spring label towards node center
                n.labelX += (n.x - n.labelX) * 0.35;
                n.labelY += (n.y - n.labelY) * 0.35;
            }
        }

        // 3 passes of Circle-to-Box and Box-to-Box repulsion
        for (let pass = 0; pass < 3; pass++) {
            // Circle-to-Box repulsion
            for (let i = 0; i < count; i++) {
                const nodeA = this.nodes[i];
                for (let j = 0; j < count; j++) {
                    if (i === j) continue;
                    const nodeB = this.nodes[j];

                    const halfW = nodeB.labelWidth * 0.5;
                    const halfH = nodeB.labelHeight * 0.5;

                    const closestX = Math.max(nodeB.labelX - halfW, Math.min(nodeA.x, nodeB.labelX + halfW));
                    const closestY = Math.max(nodeB.labelY - halfH, Math.min(nodeA.y, nodeB.labelY + halfH));

                    const dx = nodeA.x - closestX;
                    const dy = nodeA.y - closestY;
                    const dSq = dx * dx + dy * dy;
                    const safeDist = nodeA.radius + 3;

                    if (dSq < safeDist * safeDist) {
                        const dist = Math.sqrt(dSq) || 0.1;
                        const push = (safeDist - dist) * 0.5;
                        const nx = dx / dist;
                        const ny = dy / dist;
                        nodeB.labelX -= nx * push;
                        nodeB.labelY -= ny * push;
                    }
                }
            }

            // Box-to-Box repulsion
            for (let i = 0; i < count; i++) {
                const a = this.nodes[i];
                for (let j = i + 1; j < count; j++) {
                    const b = this.nodes[j];
                    const minOverlapX = (a.labelWidth + b.labelWidth) * 0.5 + 4;
                    const minOverlapY = (a.labelHeight + b.labelHeight) * 0.5 + 4;

                    const dx = b.labelX - a.labelX;
                    const dy = b.labelY - a.labelY;

                    const ox = minOverlapX - Math.abs(dx);
                    const oy = minOverlapY - Math.abs(dy);

                    if (ox > 0 && oy > 0) {
                        if (ox < oy) {
                            const sx = dx > 0 ? 1 : -1;
                            const shift = ox * 0.5;
                            a.labelX -= sx * shift;
                            b.labelX += sx * shift;
                        } else {
                            const sy = dy > 0 ? 1 : -1;
                            const shift = oy * 0.5;
                            a.labelY -= sy * shift;
                            b.labelY += sy * shift;
                        }
                    }
                }
            }
        }
    }

    private render() {
        const ctx = this.ctx;
        const W = this.width;
        const H = this.height;

        ctx.save();
        ctx.scale(this.dpr, this.dpr);
        ctx.clearRect(0, 0, W, H);

        // 1. Draw Partition Hulls (Venn Boundary circles/ovals)
        this.hulls.forEach((hull) => {
            const isHighlighted = this.activeZoneId === 'all' || this.activeZoneId === hull.id;
            const alpha = isHighlighted ? 1.0 : 0.28;

            ctx.save();
            ctx.globalAlpha = alpha;

            // Translucent fill
            ctx.beginPath();
            ctx.arc(hull.cx, hull.cy, hull.radius, 0, Math.PI * 2);
            ctx.fillStyle = hull.color;
            ctx.fill();

            // Stroke contour
            ctx.lineWidth = isHighlighted ? 2 : 1.2;
            ctx.strokeStyle = hull.strokeColor;
            ctx.stroke();

            // Partition header label
            const labelY = hull.cy - hull.radius + 16;
            ctx.font = '600 11px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isHighlighted ? 'var(--text-normal)' : 'var(--text-muted)';

            const count = this.nodes.filter((n) => n.partitionId === hull.id).length;
            const labelText = `${hull.label} (${count})`;
            ctx.fillText(labelText, hull.cx, labelY);

            ctx.restore();
        });

        // 2. Draw Attribute Bubble Nodes
        this.nodes.forEach((node) => {
            const isHighlighted = this.activeZoneId === 'all' || this.activeZoneId === node.partitionId;
            const isHovered = this.hoveredNode && this.hoveredNode.id === node.id;
            const isDragged = this.draggedNode && this.draggedNode.id === node.id;

            ctx.save();
            ctx.globalAlpha = isHighlighted ? 1.0 : 0.22;

            // Outer bubble circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            ctx.fillStyle = node.color;
            ctx.fill();

            // Hover / drag glow border
            if (isHovered || isDragged) {
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
            } else {
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                ctx.stroke();
            }

            // 3. Draw Text File Node Label (Canvas text label)
            ctx.font = '500 10.5px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = node.textColor;

            // Draw label at relaxed label coordinates
            const lx = this.simulateTextCollision ? node.labelX : node.x;
            const ly = this.simulateTextCollision ? node.labelY : node.y;

            // Truncate if long
            let displayText = node.text;
            if (displayText.length > 18) {
                displayText = displayText.slice(0, 16) + '…';
            }

            ctx.fillText(displayText, lx, ly);

            ctx.restore();
        });

        ctx.restore();
    }

    private setupEventListeners() {
        const getCanvasPos = (evt: MouseEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: evt.clientX - rect.left,
                y: evt.clientY - rect.top
            };
        };

        const findNodeAt = (x: number, y: number): VennBubbleNode | null => {
            for (let i = this.nodes.length - 1; i >= 0; i--) {
                const n = this.nodes[i];
                const dx = n.x - x;
                const dy = n.y - y;
                if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) {
                    return n;
                }
            }
            return null;
        };

        this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
            const pos = getCanvasPos(e);
            const hit = findNodeAt(pos.x, pos.y);
            if (hit) {
                this.isDragging = true;
                this.draggedNode = hit;
                this.wakeSimulation();
            }
        });

        window.addEventListener('mousemove', (e: MouseEvent) => {
            if (this.isDragging && this.draggedNode) {
                const pos = getCanvasPos(e);
                this.draggedNode.x = pos.x;
                this.draggedNode.y = pos.y;
                this.draggedNode.labelX = pos.x;
                this.draggedNode.labelY = pos.y;
                this.wakeSimulation();
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.draggedNode = null;
                this.wakeSimulation();
            }
        });

        this.canvas.addEventListener('mousemove', (e: MouseEvent) => {
            if (this.isDragging) return;
            const pos = getCanvasPos(e);
            const hit = findNodeAt(pos.x, pos.y);

            if (hit !== this.hoveredNode) {
                this.hoveredNode = hit;
                this.wakeSimulation();

                if (hit && this.tooltipEl) {
                    const partition = this.partitions.find((p) => p.id === hit.partitionId);
                    const partLabel = partition ? partition.label : 'Attribute';
                    this.tooltipEl.innerHTML = `
                        <div class="venn-tooltip-title">${hit.text}</div>
                        <div class="venn-tooltip-zone">${partLabel}</div>
                    `;
                    this.tooltipEl.style.display = 'block';
                    this.tooltipEl.style.left = (pos.x + 12) + 'px';
                    this.tooltipEl.style.top = (pos.y + 12) + 'px';
                } else if (this.tooltipEl) {
                    this.tooltipEl.style.display = 'none';
                }
            } else if (hit && this.tooltipEl) {
                this.tooltipEl.style.left = (pos.x + 12) + 'px';
                this.tooltipEl.style.top = (pos.y + 12) + 'px';
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            if (!this.isDragging) {
                this.hoveredNode = null;
                if (this.tooltipEl) this.tooltipEl.style.display = 'none';
                this.wakeSimulation();
            }
        });

        this.canvas.addEventListener('click', (e: MouseEvent) => {
            const pos = getCanvasPos(e);
            const hit = findNodeAt(pos.x, pos.y);
            if (hit) {
                const partition = this.partitions.find((p) => p.id === hit.partitionId);
                if (partition) {
                    this.callbacks.onSelectAttribute?.(hit.text, partition);
                }
            }
        });
    }

    public destroy() {
        if (this.animId !== null) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.tooltipEl && this.tooltipEl.parentNode) {
            this.tooltipEl.parentNode.removeChild(this.tooltipEl);
            this.tooltipEl = null;
        }
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}
