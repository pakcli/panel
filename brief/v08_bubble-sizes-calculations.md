# 🫧 v08: BubbleGraph Size Calculation (Direct from `panel/src/`)

> **Source Code Analysis**:  
> - `panel/src/features/bubblegraph/graphBuilder.ts` (Lines 716–750)  
> - `panel/src/features/bubblegraph/simulation.ts` (Lines 89–199)  
> **Topic**: Exact Mathematical Formula for Node Bubbles, Connections, and Hierarchical Sub-bubbles  

---

## 📌 1. Node Bubble Radius (`graphBuilder.ts:717-749`)

In the source code, node radius is calculated strictly based on **connectivity (Total Degree = inDegree + outDegree)**, **Index/Hub role**, and **image cover status**:

```typescript
// panel/src/features/bubblegraph/graphBuilder.ts (lines 717-748)
const outDeg = outDegrees.get(path) || 0;
const inDeg = inDegrees.get(path) || 0;
const totalDeg = inDeg + outDeg;

const isIndexNote = isNamedAfterFolder || isMaxDegreeInFolder || 
                    name.toLowerCase() === 'readme' || name.toLowerCase() === 'index';

let radius: number;

if (isIndexNote && totalDeg >= 2) {
    // 👑 Connected Folder Captain / Index Hub
    radius = Math.round(6 + Math.sqrt(inDeg + outDeg));
} else if (totalDeg === 0) {
    // ⚪ Isolated / Unconnected Node (Zero links)
    radius = imageUrl ? 5.5 : 3.5;
} else {
    // 🟢 Connected Regular Node (Degree > 0)
    radius = Math.round(3.5 + Math.sqrt(totalDeg));
    if (imageUrl && radius < 5.5) {
        radius = 5.5;
    }
}
```

### 📐 Node Size Comparison Table:

| Node Type | Connections (Degree $k$) | Formula | Radius ($R$) | Visual Meaning |
|---|:---:|:---:|:---:|---|
| **Unconnected Node** | $k = 0$ | $3.5$ (or $5.5$ if image) | **$3.5\text{px}$** | Isolated leaf note, minimal footprint |
| **Connected Standard** | $k = 1$ | $\text{round}(3.5 + \sqrt{1})$ | **$5\text{px}$** | Single linked note |
| **Connected Standard** | $k = 4$ | $\text{round}(3.5 + \sqrt{4})$ | **$6\text{px}$** | Active referenced note |
| **Connected Standard** | $k = 9$ | $\text{round}(3.5 + \sqrt{9})$ | **$7\text{px}$** | Well-connected note |
| **Folder Captain / Index Hub** | $k = 4$ | $\text{round}(6 + \sqrt{4})$ | **$8\text{px}$** | Dominant index note in folder |
| **Folder Captain / Index Hub** | $k = 16$ | $\text{round}(6 + \sqrt{16})$ | **$10\text{px}$** | Major hub anchor in cluster |

---

## 🗂️ 2. Sub-bubble & Cluster Radius (`simulation.ts:89-199`)

### A. Leaf Sub-bubble Cluster (Without Child Folders)
For a folder containing only direct child notes:

```typescript
// panel/src/features/bubblegraph/simulation.ts (lines 89-99)
export function computeLeafClusterRadius(nodeCount: number, depth: number = 2, denseScale: number = 1.0): number {
    if (nodeCount <= 0) return 0;
    if (nodeCount === 1) return depth === 1 ? 18 : 16;
    if (nodeCount === 2) return depth === 1 ? 22 : 18;
    if (nodeCount === 3) return depth === 1 ? 26 : 22;
    
    // For 4 or more nodes:
    const base = Math.sqrt(nodeCount) * 7.5 + (depth === 1 ? 9 : 7);
    let r = Math.max(16, Math.round(base));
    if (nodeCount >= 4) {
        r = Math.max(5, Math.round(r * denseScale));
    }
    return r;
}
```

### B. Parent Cluster Enclosing Sub-bubbles (`simulation.ts:167-195`)
When a parent folder (Depth 1, e.g. `01 - Project Alpha`) contains **Sub-bubbles (Depth 2, e.g. `Docs`)** and direct notes:

1. **Sum of Sub-bubble Areas**:
   $$\text{Area}_{\text{subs}} = \sum_{s \in \text{childSubs}} \pi \cdot (R_s + \text{pad})^2$$
2. **Sum of Direct Node Areas**:
   $$\text{Area}_{\text{direct}} = \sum_{n \in \text{directNodes}} \pi \cdot (R_n + \text{pad})^2$$
3. **Total Pack Area**:
   $$\text{Total Area} = \text{Area}_{\text{subs}} + \text{Area}_{\text{direct}}$$
4. **Packing Circle Radius**:
   $$R_{\text{packing}} = \sqrt{\frac{\text{Total Area}}{\pi \times \text{packDensity}}} + \text{margin}$$
   *(where $\text{packDensity} \approx 0.54 - 0.60$)*
5. **Final Clamping**:
   $$R_{\text{parent}} = \max(R_{\text{min}}, \; R_{\text{base}}, \; R_{\text{packing}}, \; \max(R_{\text{sub}}) + \text{directExtra} + \text{margin})$$

This guarantees that the parent bubble expands dynamically so that all sub-bubbles fit inside with physics collision clearance!

---

## 🎬 3. Video Animation Architecture in Manim

The Manim script in `D:\0pro\pakcli-plugin\manim\bubble_size_scene.py` demonstrates:
1. **Unconnected Node**: $k=0 \implies R=3.5\text{px}$ (Grey dot).
2. **Connected Node with Edges**: $k=4 \implies R = 3.5 + \sqrt{4} = 5.5\text{px}$ with visible lines.
3. **Index / Hub Node**: $k=4 \implies R = 6 + \sqrt{4} = 8\text{px}$ with golden glow.
4. **Sub-bubble Formation**: Leaf cluster enclosure $R = \sqrt{N} \cdot 7.5 + 7$.
5. **Parent Cluster Hull**: Packing both sub-bubbles and direct nodes via $\sqrt{\text{Total Area} / (\pi \cdot 0.54)}$.
