# 📌 Master Brief: Advanced Compare Hub & Dual Physics Text Simulation (`pakcli-panel`)

> **Feature Status**: `1` (Implemented & Verified)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile (`obsidian` API / HTML5 Canvas / PBD Physics)  
> **Date**: 2026-10-13  

---

## 1. Objective & Problem Statement

### The Problem
1. **Unscoped Frontmatter Chaos**: Saat membandingkan 2–5 file markdown, seluruh field frontmatter tampil tanpa urutan prioritas atau grouping spesifik domain (misal: membandingkan gadget tech butuh prioritas `price`, `chipset`, `battery`, sedangkan buku butuh `author`, `genre`, `rating`).
2. **Fixed Static 2-Circle Venn**: Diagram Venn saat ini terbatas pada SVG 2 lingkaran pairwise statis tanpa visualisasi cluster sub-graph interaktif untuk 3 atau lebih file.
3. **Text & Node Overlap (Occlusion)**:
   - Pada graph view dan diagram Venn, teks label nama file sering menabrak node lingkaran lain atau teks tetangga ketika node berdekatan.
   - Perlu simulasi fisika anti-overlap untuk teks, namun **HARUS default OFF** agar performa tetap 60 FPS di vault besar, dan dapat di-toggle secara independen pada:
     - **Main Bubble Graph Toolbar** (`💬 Text Collision`)
     - **Compare Modal Header** (`💬 Simulate Text Collision`)
4. **Distinction Guard**:
   - **Text File Node (Canvas Label)**: Teks permanen yang digambar di kanvas di samping node.
   - **Text Callout Node (DOM Overlay)**: Balon teks sementara (spawning callout) dengan *lifetime* milidetik saat timelapse. Keduanya adalah entitas terpisah.
5. **Adaptive Cluster Size**: Lingkaran cluster/Venn harus otomatis menyesuaikan ukurannya (*auto-fit*) agar seluruh node dan label muat tanpa tercekik.

---

## 2. Technical Architecture & Constraints

- **Platform Guards**: Bekerja di Obsidian Desktop dan Mobile (`obsidian` Canvas API + CSSOM).
- **Physics Integration**: Re-use `BubbleSimulation` PBD (Position-Based Dynamics) collision relaxation untuk AABB (Axis-Aligned Bounding Box) teks label saat toggle aktif.
- **Auto-Fit Radius**: Radius cluster/Venn dihitung dinamis berdasarkan luas total node circle + luas bounding box teks label yang ditampilkan dikalikan packing factor $1.25$.
- **Bundle Constraint**: Bundle `main.js` harus tetap $< 5.0\text{ MB}$ (Obsidian Sync limit).

---

## 3. Implementation Plan & Files

| File | Status | Keterangan |
| :--- | :---: | :--- |
| `panel/docs/brief-compare-hub-text-simulation.md` | ✅ | Brief Master Feature Lifecycle (Status 0 -> 1) |
| `panel/src/settings.ts` | ✅ | Menambahkan settings toggle `bubbleTextCollisionSimulation: boolean` (Default: false) |
| `panel/src/features/bubblegraph/simulation.ts` | ✅ | Implementasi PBD text bounding box collision saat toggle aktif |
| `panel/src/features/bubblegraph/canvasRenderer.ts` | ✅ | Sinkronisasi posisi label terelaksasi di kanvas |
| `panel/src/features/bubblegraph/bubbleGraphView.ts` | ✅ | Quick toggle button di toolbar Bubble Graph (`💬 Text Collision`) |
| `panel/src/features/tierlist/utils/venn-utils.ts` | ✅ | Perhitungan multi-way sets (2 s.d. $N$ items) & adaptive radius |
| `panel/src/features/tierlist/views/comparison-view.ts` | ✅ | Frontmatter Scoper Presets, Embedded Bubble Venn, dan toggle modal |
| `panel/src/features/tierlist/views/venn-bubble-canvas.ts` | ✅ | Embedded HTML5 Canvas simulator dengan auto-fit radius & PBD anti-overlap |
| `panel/src/styles/tierlist.scss` | ✅ | Styling untuk preset scoper, aligned matrix, dan embedded bubble canvas |

---

## 4. Acceptance Criteria Checklist

- [x] Status 0 brief dibuat di `panel/docs/brief-compare-hub-text-simulation.md` dan di-commit.
- [x] Frontmatter Scoped Presets (Gadget, Book, Tasks, Custom) di Compare Modal.
- [x] Multi-Way Venn ($2$ s.d. $N$ notes) terintegrasi.
- [x] Embedded mini Bubble Graph di dalam diagram Venn dengan auto-fit size.
- [x] Pemisahan tegas: Text File Node (Canvas) vs Text Callout Node (DOM).
- [x] 2 Toggle independen: Main Graph Toolbar & Compare Modal Header (keduanya default OFF).
- [x] Build `npm run build` sukses, 0 error, bundle $< 5.0\text{ MB}$.
- [x] Auto-deployed ke kedua vault (`MAIN-DIGITAL-LIBRARY` & `SAMPLE-DEMO-THEME-PLUGIN`).
- [x] Status brief di-update ke 1 dan di-commit.
