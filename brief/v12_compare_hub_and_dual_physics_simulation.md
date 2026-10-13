# 📋 Brief: Advanced Compare Hub & Dual Physics Text Simulation

> **Feature Status**: `0` (Brief Created / Ready for Implementation)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile (`obsidian` API / HTML5 Canvas / PBD Physics)  
> **Date**: 2026-10-13  

---

## 1. Executive Summary & Core Objective

Fitur ini merevolusi **Compare Modal** (`CompareModal` / `renderCompareView`) dan mengintegrasikan **Dual-Physics Text Anti-Overlap Engine** pada dua permukaan visual:

1. **Scoped Frontmatter Focus & Presets**: Membandingkan note berdasarkan domain tertentu (misal: Gadget Tech, Book Library, Research Papers) dengan preset urutan properti dan seleksi interaktif.
2. **Multi-Way Venn Diagram ($2$ s.d. $N$ Notes)**: Diagram Venn dinamis yang menampung 2, 3, atau lebih note sekaligus dengan irisan modular.
3. **Embedded Bubble Sub-Graph in Venn**: Setiap irisan Venn mengeksekusi sub-grafik bubble interaktif di mana tiap atribut frontmatter berwujud node bubble dengan radius adaptif (*auto-fit content*).
4. **Dual Physics Collision Toggles**:
   - **Toggle A (Main Graph View Toolbar)**: `💬 Text Collision` (Default: `OFF`).
   - **Toggle B (Compare Venn Modal Header)**: `💬 Simulate Text Collision` (Default: `OFF`).
5. **Critical Distinction**:
   - **Text File Node (Canvas Label)**: Teks nama file permanen yang digambar di kanvas di samping node glyph.
   - **Text Callout Node (DOM HTML Overlay)**: Balon bubble teks dinamis yang muncul saat timelapse spawning atau hover/interaksi inspeksi.
   - Keduanya memiliki entitas dan perlakuan collision yang terpisah secara fundamental!

---

## 2. Distinction: Text File Node vs. Text Callout Node

| Properti | 📄 Text File Node (Canvas Label) | 💬 Text Callout Node (DOM Overlay) |
| :--- | :--- | :--- |
| **Media Render** | HTML5 Canvas 2D (`ctx.fillText`, `ctx.strokeText`) | DOM HTML Element (`div.pakcli-spawn-callout`) |
| **Sifat Keberadaan** | Permanen selama node terlihat pada level zoom/filter | Transient / Temporer (memiliki *lifetime* milidetik dan memudar) |
| **Tujuan** | Identitas permanen file markdown / atribut frontmatter | Notifikasi visual event (e.g. note spawning pada timelapse slider) |
| **Kebutuhan Fisika** | Repulsion santai agar teks file tetangga tidak saling timpa | Repulsion terhadap node circle agar ekor balon tidak menutupi isi note |
| **Physics Body** | `LabelPhysicsBody` (Orientasi horizontal di kanvas) | CSS Transform + Viewport Culling Bounding Box |

---

## 3. Scoped Frontmatter Grouping & Presets

### A. Konsep Preset
Pengguna sering membandingkan note sejenis dengan skema YAML tertentu:
- **📱 Gadget / Tech**: `price` $\rightarrow$ `chipset` $\rightarrow$ `battery` $\rightarrow$ `display` $\rightarrow$ `ram` $\rightarrow$ `storage`
- **📚 Book / Reading**: `author` $\rightarrow$ `rating` $\rightarrow$ `genre` $\rightarrow$ `pages` $\rightarrow$ `published_year`
- **💼 Task / Project**: `status` $\rightarrow$ `priority` $\rightarrow$ `assignee` $\rightarrow$ `due_date` $\rightarrow$ `estimated_hours`

### B. Interaksi UI/UX
- **Scope Selector Dropdown**: Terletak di toolbar atas Compare Modal.
- **Dynamic Field Scoper**: Modal checklist untuk mencentang/menonaktifkan atribut frontmatter spesifik secara instan.
- **Matrix Row Synchronization**: Semua kolom note mengunci baris properti yang sama pada koordinat vertikal yang identik.

---

## 4. Multi-Way Venn with Embedded Bubble Graph

### A. Skalabilitas Irisan ($N$-Way)
- **2 Notes**: 2 Circle Hulls $\rightarrow$ $A$, $B$, $A \cap B$.
- **3 Notes**: 3 Circle Tri-Venn $\rightarrow$ $A$, $B$, $C$, $A \cap B$, $B \cap C$, $A \cap C$, $A \cap B \cap C$.
- **4+ Notes**: Radial Flower Hulls dengan partisi cluster terpusat.

### B. Atribut sebagai Bubble Nodes
- Setiap atribut frontmatter di-parse dan dimasukkan ke area Venn yang sesuai:
  - Nilai unik note $A$ masuk ke zona eksklusif $A$.
  - Nilai yang sama pada seluruh note masuk ke zona tengah ($A \cap B \dots \cap N$).
- **Adaptive Bubble Sizing**: Lingkaran zona Venn otomatis mengembang (*breathing factor*) proporsional terhadap total footprint luas node + teks di dalamnya:
  $$R_{\text{zone}} = \sqrt{\frac{\sum (\pi r_{\text{node}}^2 + \text{Area}_{\text{text}})}{\pi}} \times 1.25$$

---

## 5. Dual Toggle Physics Simulation (Text vs. Node Collision)

### A. Mengapa Default Harus OFF?
1. Menghitung bounding box collision untuk ribuan teks label pada vault besar memakan CPU.
2. Default `OFF` menjamin 60 FPS instan pada perangkat berspesifikasi rendah/mobile.
3. User dapat menyalakan toggle saat membutuhkan presentasi visual yang rapi dan bebas tumpang tindih.

### B. Status Toggle & Lokasi
1. **Main Bubble Graph**: Toolbar atas $\rightarrow$ icon `💬 Text Anti-Overlap` (`OFF` by default).
2. **Compare Modal**: Header Venn $\rightarrow$ pill `💬 Simulate Text Collision` (`OFF` by default).

---

## 6. Implementation Checklist & Verification Gates

- [ ] Brief Status 0 dibuat di `panel/brief/` dan dokumentasi teknis di `panel/docs/`.
- [ ] Implementasi Frontmatter Scoper & Presets pada `comparison-view.ts`.
- [ ] Implementasi Multi-Venn Canvas Renderer dengan PBD Sub-simulation.
- [ ] Pemisahan fisika antara **Text File Node** (kanvas) dan **Text Callout Node** (DOM).
- [ ] Toggle UI di Toolbar Graph View & Compare Modal Header.
- [ ] Build verification: `npm run build` bebas error dan bundle tetap $< 5.0\text{ MB}$.
- [ ] Update Brief Status ke 1 setelah seluruh pengujian selesai.
