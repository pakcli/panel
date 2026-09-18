# Brief Konsep & Desain: PakCLI Editorial Diagram Engine

Dokumen arsitektur, filosofi desain, dan spesifikasi teknis untuk implementasi engine diagram editorial native di Obsidian (**"diagram-design" for Obsidian**).

---

## 1. Latar Belakang & Inti Konsep (Core Philosophy)

### Masalah Utama Mermaid di Obsidian
* **Estetika Kaku ("Mermaid Slop")**: Rounded box generik, konektor panah menyilang kusut, dan palet warna yang bentrok dengan tema Obsidian.
* **Terisolasi dari Vault**: Sulit atau canggung menghubungkan node ke note Obsidian (`[[wikilink]]`).
* **Kustomisasi Sulit**: Mengubah warna atau layout membutuhkan CSS hack panjang dan sering rusak saat tema berganti.
* **Tipe Visual Terbatas**: Kurang memadai untuk arsitektur modern (cloud stack, DB schema bertingkat, timeline editorial, dll.).

### Solusi PakCLI: Editorial Diagram Engine
Terinspirasi dari metodologi desain [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design):
1. **Pure SVG + HTML (Zero Runtime Bloat)**: Tidak butuh library eksternal besar (tanpa webgl/canvas berlebih). Rendering instan, tajam di semua level zoom, dan sangat ramah performa mobile/desktop.
2. **100% Native Obsidian Theme Binding**: Otomatis menyerap variabel tema Obsidian pengguna:
   * `paper` ➔ `var(--background-primary)` & `var(--background-secondary)`
   * `ink` ➔ `var(--text-normal)`
   * `muted` ➔ `var(--text-muted)`
   * `accent` ➔ `var(--interactive-accent)`
   * `hairline` ➔ `var(--background-modifier-border)`
   * *Otomatis beradaptasi saat pengguna berganti Dark Mode / Light Mode tanpa setting ulang.*
3. **Obsidian "Wikilink-First" Navigation**: Setiap node di SVG dapat menjadi pintu masuk ke note vault (`link: "[[Nama Note]]"`). Mendukung **Click to Open Note** dan **Hover Preview Popover** native Obsidian.
4. **Editorial Design Rules (Strict 4px Grid & 1 Accent Rule)**:
   * Semua koordinat, padding, margin, dan jarak antar-elemen habis dibagi 4 (4px, 8px, 12px, 16px, 24px, 32px).
   * Hanya 1 atau 2 focal node utama yang menggunakan warna aksen (`accent: true`); sisanya menggunakan hairline elegan dan warna netral.

---

## 2. Arsitektur Dual View

Fitur ini menyediakan 2 titik akses yang saling terintegrasi:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. INLINE CODEBLOCK (Di dalam note Markdown biasa)                          │
│    ```editorial-diagram                                                     │
│    type: architecture                                                       │
│    ...                                                                      │
│    ```                                                                      │
│    - Render langsung di reading view & live preview                         │
│    - Floating hover actions: [🔍 Expand to Tab] [📋 Copy SVG] [🖼️ Save PNG] │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. DEDICATED BASE VIEW TAB (ItemView: Full Canvas Studio)                   │
│    - Interactive SVG Pan & Zoom (Mouse drag, mousewheel zoom, pinch)        │
│    - Live Split Code Editor (Edit YAML di kiri, render live SVG di kanan)   │
│    - Preset Template Picker (1-click insert architecture/sequence/db/dsb.)  │
│    - One-Click High-Res Export (SVG murni atau PNG 2x/3x untuk publikasi)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 5 Tipe Diagram Fondasi (Phase 1)

| Tipe Diagram | Karakteristik Visual | Contoh Penggunaan Vault |
|---|---|---|
| **`architecture`** | Box berjenjang (*tiers*), ikon komponen (*cloud, server, db, web*), arah panah ortogonal rapi. | Memetakan sistem stack, alur data plugin, arsitektur server/homelab. |
| **`flowchart`** | Alur keputusan, diamond branching (*Yes/No*), status box (*success, warning, fail*). | Standard Operating Procedure (SOP), decision tree troubleshooting. |
| **`sequence`** | Lifeline aktor horizontal, panah pesan kronologis ke bawah, activation boxes. | Alur autentikasi, lifecycle event plugin, request-response API. |
| **`db-schema`** | Card tabel bergaya editorial dengan kolom, tipe data monospace, penanda PK/FK, relasi 1:N. | Skema SQLSeal / SQLite, data model vault, arsitektur database. |
| **`timeline`** | Sumbu horizontal rapi dengan milestone, tanggal, badge kategori, dan kartu penjelas. | Project roadmap, sejarah riset, fase rilis plugin. |

---

## 4. Spesifikasi Sintaks (Human & LLM Friendly)

Menggunakan format **YAML** yang bersih, mudah dibaca manusia, dan sangat mudah digenerate oleh AI:

### Contoh 1: Architecture Stack
````markdown
```editorial-diagram
type: architecture
title: PakCLI Cloud & Sync Architecture
badge: v2.0
nodes:
  - id: client
    label: Obsidian Client
    sublabel: Desktop & Mobile UI
    icon: laptop
    link: "[[Architecture Overview]]"
  - id: gateway
    label: API Gateway
    sublabel: Nginx / HTTPS :443
    icon: globe
    accent: true
  - id: auth
    label: Auth Service
    sublabel: JWT / OAuth2
    icon: shield
    link: "[[Security Notes]]"
  - id: db
    label: Postgres DB
    sublabel: Primary Cluster
    icon: database
    link: "[[Database Schema]]"
edges:
  - from: client
    to: gateway
    label: REST / Sync
  - from: gateway
    to: auth
    label: Verify Token
  - from: gateway
    to: db
    label: Queries
```
````

### Contoh 2: Database Schema (ER)
````markdown
```editorial-diagram
type: db-schema
title: Vault Database Models
nodes:
  - id: users
    label: users
    fields:
      - name: id
        type: uuid
        isPk: true
      - name: email
        type: varchar(255)
      - name: role
        type: enum
  - id: notes
    label: notes
    accent: true
    link: "[[Note Model]]"
    fields:
      - name: id
        type: uuid
        isPk: true
      - name: user_id
        type: uuid
        isFk: true
      - name: title
        type: text
      - name: content
        type: markdown
edges:
  - from: users
    to: notes
    label: 1 : N
```
````

---

## 5. Fitur Interaktif & Ekspor

1. **Navigasi Wikilink**:
   * Klik node ber-`link`: Membuka note terkait di Obsidian Workspace (`this.app.workspace.openLinkText`).
   * Hover node ber-`link`: Memunculkan popover preview note Obsidian (`hover-link` event).
2. **Ekspor Mandiri (Self-Contained)**:
   * **Copy Standalone SVG**: SVG yang disalin sudah menyertakan styling CSS inline fallback, sehingga jika di-paste ke Figma, Illustrator, browser, atau website lain, tampilannya tetap utuh.
   * **Download PNG (2x / 3x Retina)**: Mengonversi SVG via in-memory canvas menjadi PNG beresolusi tinggi tanpa dependensi headless browser di background.
3. **Mermaid Compatibility**:
   * Opsi perintah *Convert Mermaid to Editorial*: Otomatis membaca blok `mermaid` yang ada di note dan mengubahnya menjadi format `editorial-diagram`.

---

## 6. Rencana Struktur Kode Plugin

```
src/features/editorialDiagram/
├── index.ts                      # Registrasi processor codeblock, views, commands, ribbon
├── types.ts                      # Interface diagram spec, node, edge, theme tokens
├── styles/
│   └── editorialDiagram.scss     # Layout styles, responsive SVG rules, pan-zoom viewer
├── core/
│   ├── parser.ts                 # YAML / JSON parser dengan validasi & fallback default
│   └── layoutEngine.ts           # Grid 4px layout calculator & orthogonal line routing
├── renderers/
│   ├── svgBuilder.ts             # Generator elemen SVG murni, markers, icons, text measuring
│   ├── renderArchitecture.ts     # Generator layout tipe Architecture
│   ├── renderFlowchart.ts        # Generator layout tipe Flowchart
│   ├── renderSequence.ts         # Generator layout tipe Sequence
│   ├── renderDbSchema.ts         # Generator layout tipe DB Schema / ER
│   └── renderTimeline.ts         # Generator layout tipe Timeline
└── ui/
    ├── DiagramCodeblockRenderer.ts # MarkdownRenderChild untuk inline reading view
    ├── EditorialDiagramView.ts   # ItemView tab mandiri dengan pan/zoom & split editor
    └── DiagramGalleryModal.ts    # Dialog modal galeri template diagram siap pakai
```

---

## 7. Tahapan Implementasi (Roadmap)

1. **Step 1: Core Data Models, Types, & SVG Builder Base**
   * Buat `types.ts`, konfigurasi palet warna native Obsidian, utilitas grid 4px, dan generator SVG wrapper.
2. **Step 2: Architecture & DB-Schema Renderers**
   * Implementasi algoritma perataan box, penempatan ikon SVG monochrome, baris field DB, dan routing panah.
3. **Step 3: Inline Markdown Codeblock Renderer & Wikilink Navigation**
   * Daftarkan processor `editorial-diagram` di `main.ts` dengan dukungan click/hover note link.
4. **Step 4: Flowchart, Sequence, & Timeline Renderers**
   * Lengkapi kelima tipe diagram fondasi.
5. **Step 5: Dedicated Base View (ItemView) & Export Tools**
   * Tambahkan tab canvas dengan Pan-Zoom, live split-editor, dan tombol ekspor PNG/SVG.
