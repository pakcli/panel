# 🔬 Technical Architecture: Text Simulation, Scoped Compare, & Multi-Venn Physics

> **Module**: `pakcli-panel` (`panel`)  
> **Topic**: Mathematical & Physics Engine Specifications for Dual Text Simulation, Auto-Fit Venn Hulls, and Scoped Frontmatter Presets  
> **Date**: 2026-10-13  

---

## 1. Separation of Concerns: Text File Node vs. Text Callout Node

Dalam arsitektur rendering `pakcli-panel`, terdapat dua jenis teks dengan tujuan, siklus hidup, dan metode render yang sangat berbeda:

```
+─────────────────────────────────────────────────────────────────────────────+
|                        TEXT RENDERING CLASSIFICATION                        |
+─────────────────────────────────────────────────────────────────────────────+
|                                                                             |
|  [1] TEXT FILE NODE (Canvas Label)          [2] TEXT CALLOUT NODE (DOM)     |
|  • Surface: HTML5 Canvas 2D                 • Surface: HTML DOM Overlay     |
|  • Lifetime: Permanent / Continuous         • Lifetime: Ephemeral (Ms)      |
|  • Identity: Markdown File Name / Prop      • Identity: Note Spawning Event |
|  • Render: CanvasRenderer.drawNodeLabel()   • Render: DOM .pakcli-callout   |
|  • Physics: 2D PBD Box-to-Circle Repulsion  • Physics: Anchor Top-Clamp     |
|                                                                             |
+─────────────────────────────────────────────────────────────────────────────+
```

### A. Text File Node (Canvas Label)
- **Sumber Data**: `node.name` (nama note) atau label atribut frontmatter di diagram Venn.
- **Posisi Dasar**: `(node.x + node.radius + padding, node.y)`.
- **Ketika Simulasi Collision ON**:
  1. Label didaftarkan sebagai **AABB Body (Axis-Aligned Bounding Box)**:
     - $\text{Width} = \text{measureText}(label) + 6\text{px}$.
     - $\text{Height} = \text{fontSize} \times 1.25$.
  2. Bounding box terhubung ke node asalnya melalui **Spring Constraint** ($k = 0.4$).
  3. Mengalami **Repulsion** terhadap:
     - Circle body node lain di sekitarnya.
     - Bounding box label teks file tetangga.

### B. Text Callout Node (DOM HTML Overlay)
- **Sumber Data**: Notifikasi saat timeline slider bergeser, atau timelapse otomatis berjalan.
- **Wadah**: `this.spawningContainerEl` (`div.pakcli-spawning-text-overlay`).
- **Collision Rules**:
  - Dibatasi secara vertikal di atas perimeter node:
    $$\text{ScreenX} = \text{Camera}(node.x), \quad \text{ScreenY} = \text{Camera}(node.y - node.radius)$$
  - Dilengkapi culling viewport dan pool maksimum 25 elemen aktif untuk menjaga framerate stabil di 60 FPS.

---

## 2. Mathematical Modeling for Adaptive Venn Hulls

Untuk memastikan semua bubble dan label teks muat di dalam partisi Venn tanpa terdesak (*fit enough*):

### Formula Radius Cluster Zona Venn ($R_{\text{zone}}$):

$$R_{\text{zone}} = \max\left( R_{\text{min}}, \quad \sqrt{\frac{\sum_{i=1}^{N} \left( \pi \cdot (r_i + p)^2 + W_i \cdot H_i \right)}{\pi \cdot \phi}} \right)$$

Di mana:
- $r_i$: Radius circle glyph node atribut ke-$i$.
- $W_i, H_i$: Dimensi lebar dan tinggi bounding box teks label jika ditampilkan.
- $p$: Margin keselamatan antar-node (standar: $4.0\text{px}$).
- $\phi$: *Packing Efficiency Factor* ($\approx 0.68$ untuk lingkaran padat).
- $R_{\text{min}}$: Radius minimum partisi Venn ($35\text{px}$).

Dengan rumus ini, jika partisi Venn hanya berisi 2 atribut, lingkarannya berukuran ringkas. Jika partisi Venn diisi 20 atribut, lingkaran otomatis mengembang dengan proporsi yang pas.

---

## 3. Position-Based Dynamics (PBD) Text Relaxation Algorithm

Ketika toggle `💬 Simulate Text Collision` aktif, loop simulasi menjalankan 4 tahap iterasi PBD per frame:

```
[Frame Start]
      │
      ├─► 1. Step Node Velocity & Integrator (Standard Verlet)
      │
      ├─► 2. Spring Anchor: Tarik label menuju nodenya (Target: r + margin)
      │
      ├─► 3. Circle-to-Box Collision: Dorong label keluar dari radius node asing
      │
      ├─► 4. Box-to-Box Collision: Saling dorong jika 2 label bertumpukan
      │
      ├─► 5. Boundary Containment: Jepit label agar tetap di dalam lingkaran cluster
      │
[Render Canvas]
```

### Kode Relaksasi Bounding Box (PBD Pseudo-Implementation):

```typescript
export interface LabelBody {
    nodeId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    vx: number;
    vy: number;
}

export function resolveLabelCollisions(labels: LabelBody[], nodes: BubbleNode[], clusterRadius: number, centroid: { x: number; y: number }): void {
    // 1. Box vs Circle Collision
    for (const lbl of labels) {
        for (const n of nodes) {
            if (n.id === lbl.nodeId) continue;
            // Check overlap between circle (n.x, n.y, n.radius) and box (lbl.x, lbl.y, lbl.w, lbl.h)
            const nearestX = Math.max(lbl.x - lbl.w / 2, Math.min(n.x, lbl.x + lbl.w / 2));
            const nearestY = Math.max(lbl.y - lbl.h / 2, Math.min(n.y, lbl.y + lbl.h / 2));
            const dx = n.x - nearestX;
            const dy = n.y - nearestY;
            const distSq = dx * dx + dy * dy;
            const minR = n.radius + 3.0;

            if (distSq < minR * minR) {
                const dist = Math.sqrt(distSq) || 0.001;
                const push = minR - dist;
                lbl.x -= (dx / dist) * push * 0.7;
                lbl.y -= (dy / dist) * push * 0.7;
            }
        }
    }

    // 2. Box vs Box Collision
    for (let i = 0; i < labels.length; i++) {
        const a = labels[i];
        for (let j = i + 1; j < labels.length; j++) {
            const b = labels[j];
            const dx = Math.abs(a.x - b.x);
            const dy = Math.abs(a.y - b.y);
            const halfW = (a.w + b.w) / 2 + 3;
            const halfH = (a.h + b.h) / 2 + 2;

            if (dx < halfW && dy < halfH) {
                const overlapX = halfW - dx;
                const overlapY = halfH - dy;
                if (overlapX < overlapY) {
                    const sign = a.x < b.x ? -1 : 1;
                    a.x += sign * overlapX * 0.5;
                    b.x -= sign * overlapX * 0.5;
                } else {
                    const sign = a.y < b.y ? -1 : 1;
                    a.y += sign * overlapY * 0.5;
                    b.y -= sign * overlapY * 0.5;
                }
            }
        }
    }
}
```

---

## 4. UI/UX Preset Configuration Architecture

Struktur konfigurasi untuk Frontmatter Scoping Presets:

```typescript
export interface CompareScopePreset {
    id: string;
    name: string;
    icon: string;
    priorityKeys: string[];      // Field yang diutamakan di urutan teratas
    excludedKeys?: string[];     // Field yang disembunyikan
    unitFormatters?: Record<string, 'currency' | 'bytes' | 'number' | 'text'>;
}

export const DEFAULT_COMPARE_PRESETS: CompareScopePreset[] = [
    {
        id: 'gadget-tech',
        name: 'Gadget / Tech Specs',
        icon: 'smartphone',
        priorityKeys: ['price', 'chipset', 'soc', 'processor', 'ram', 'storage', 'battery', 'display', 'screen', 'weight', 'camera']
    },
    {
        id: 'books-reading',
        name: 'Books & Literature',
        icon: 'book-open',
        priorityKeys: ['author', 'rating', 'genre', 'pages', 'published', 'status', 'isbn']
    },
    {
        id: 'task-projects',
        name: 'Tasks & Projects',
        icon: 'check-square',
        priorityKeys: ['status', 'priority', 'assignee', 'due', 'deadline', 'tags', 'estimate']
    }
];
```

Dengan desain ini, Compare Hub menjadi sistem perbandingan multi-domain yang presisi, responsif, dan bebas tumpang tindih.
