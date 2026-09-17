# Brief Desain: Git Local Snapshot & Timeline Animation di BubbleGraph

Dokumen ringkasan arsitektur visual, mekanisme Git lokal (*view-only*), dan koreografi animasi untuk fitur **BubbleGraph Git Snapshot Timelapse**.

---

## 1. Inti Konsep (Core Philosophy)

* **100% Offline & Lokal**: Menggunakan snapshot Git lokal (tanpa remote GitHub / tanpa upload cloud).
* **View-Only (Non-Destructive)**: Fitur ini murni untuk **inspeksi visual & visualisasi sejarah vault**. Menggeser timeline tidak akan mengubah, me-restore, atau merusak file Markdown pengguna yang sebenarnya di disk.
* **Ground Truth Evolusi**: Berbeda dengan timestamp file OS (`mtime`/`ctime`) yang bisa berubah karena sinkronisasi atau backup, commit Git adalah *checkpoint pasti* dari struktur vault pada saat itu.

---

## 2. Arsitektur Komponen Visual

Sesuai dengan arsitektur UI/UX native plugin PakCLI Panel:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. HEADER TOOLBAR (2 Rows: Scope Breadcrumb, Depth Pills, Quick Toggles)    │
├──────────────────────────────────────────────────────────────┬──────────────┤
│ 2. BUBBLE CANVAS                                             │ 3. INSPECTOR │
│    - Cluster Hulls (Depth 1 Parent & Depth 2 Nested Subfolder)│    SIDEBAR   │
│    - 1 Pinned Highlighted Hero Note (Cyan Pulse Aura)         │  (Terkunci   │
│    - 6 Ambient Independent Mutating Notes                     │   permanen   │
│    - Venn Bridges with Marching Flow Particles               │   ke Hero    │
│    - Floating Commit Info Card                               │    Note)     │
├──────────────────────────────────────────────────────────────┴──────────────┤
│ 4. TIMELAPSE MINIMAP BAR (10 Step Pills: C0 s/d C9, Play/Pause, Progress)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Matriks 10 Commit: 1 Hero + 6 Mutating Files

Fitur ini memperagakan **1 Hero Note** yang terus di-highlight dan diinspeksi, bersama **6 file ambient** yang mengalami siklus hidup mandiri (lahir acak, edit massa, migrasi folder, rename, hingga penghapusan):

| Commit | Hash | Peran Hero (Highlighted 🌟) | Perubahan 6 File Ambient (Background 🌐) | Efek Animasi Kanvas |
|:---:|:---:|---|---|---|
| **C0** | `#10a7b4f` | **Lahir di Inbox**: `Untitled.md` (Draft kecil, 110w). | 2 file aktif awal: `scratchpad.md` (Inbox) & `index.md` (Alpha). | Subfolder `Docs` belum ada (`radius: 0`). Hero berdenyut cyan di Inbox. |
| **C1** | `#2c9e88a` | Mengamati pertumbuhan vault di Inbox. | **Lahir**: `quick_idea.md` & `todos.md` di Inbox.<br>**Edit**: `scratchpad.md` bertambah isi (+200w). | Efek pop-in lahir asinkron pada 2 file baru. |
| **C2** | `#3f77b10` | Bersiap untuk restrukturisasi proyek. | **Edit**: `index.md` (+overview table saat subfolder baru disiapkan). | **Subfolder Bloom**: Gelembung Depth 2 `Docs` mekar elastis di Alpha dari radius 0 ke 78px. |
| **C3** | `#4a1b919` | **Pindah Direktori (Move)**: `Untitled.md` ditarik ke `Project Alpha / Docs`. | **Edit**: `todos.md` di Inbox bertambah checklist (+150w). | Hero meluncur menyeberang melintasi **Venn Bridge (Cyan Glow)** dengan partikel berjalan. |
| **C4** | `#5e4d29b` | **Rename**: `Untitled.md` ➔ `architecture.md` (Glyph berubah ke Hub `+`). | **Edit**: `quick_idea.md` di Inbox bertambah link riset. | Label teks hero bertransisi mulus; pendaran warna ungu aksen. |
| **C5** | `#6a0f12c` | Terhubung otomatis ke note ambient baru. | **Lahir**: `api_routes.md` lahir acak di Alpha root.<br>**Edit**: `todos.md` di Inbox bertambah (+300w). | Garis koneksi intra-cluster terhubung ke Hero; pop-in birth pada `api_routes.md`. |
| **C6** | `#7b8893d` | Menyambut partner kerja baru di dalam `Docs`. | **Move**: `quick_idea.md` migrasi dari Inbox ke `Docs`.<br>**DELETE**: `scratchpad.md` dihapus dari vault. | `scratchpad.md` memudar dan mengecil (*fade out*). `quick_idea.md` meluncur ke subfolder. |
| **C7** | `#8f102ca` | Mempertahankan posisi sentral di `Docs`. | **Rename**: `quick_idea.md` ➔ `spec.md` di `Docs`.<br>**Edit**: `api_routes.md` (+500w). | Partner note bermutasi nama; struktur cluster subfolder semakin matang. |
| **C8** | `#9c37a11` | **Heavy Edit (+3,400w)**: Radius hero membesar elastis (`15px ➔ 26px`). | **DELETE**: `todos.md` di Inbox selesai dan dihapus dari vault. | Hero memancarkan **gelombang ripple sonik** yang mendorong bubble tetangga. `todos.md` fade-out. |
| **C9** | `#0d44e51` | Terhubung ke tabel database pelengkap. | **Lahir**: `schema.base` lahir di Alpha (Glyph Ring `○`).<br>**Edit**: `index.md` diperbarui. | Topologi klaster lengkap; ekosistem pengetahuan terhubung sempurna. |

---

## 4. Spesifikasi UI/UX & Animasi Fisika

### A. The Pinned Hero
1. **Cyan Active Pulse Aura**: Lingkaran gelombang tipis cyan (`rgba(0, 242, 255, alpha)`) yang berdenyut terus-menerus mengindikasikan bahwa node ini adalah subjek utama yang sedang diamati.
2. **Inspector Sidebar Locking**: Panel inspector di sebelah kanan tidak berpindah-pindah, melainkan fokus menyajikan metadata evolusi Hero:
   - Path/Folder hierarki saat ini.
   - Status mutasi terakhir (*Note Created*, *Directory Migration*, *Renamed*, *Heavy Edit*).
   - Ukuran kata (*Draft 110w ➔ Pillar Note 4,650w*).
   - Daftar koneksi aktif (*Backlinks & Outgoing*).

### B. The 6 Ambient Files
1. **Visual Contrast**: Menggunakan warna cluster netral (tanpa aura berdenyut) agar pengguna tetap mudah membedakan antara *file fokus* dan *lingkungan sekitar*.
2. **Lifecycles Asinkron**: Mendemonstrasikan dinamika vault sesungguhnya di mana note lain bisa lahir, berpindah, membesar, atau terhapus sewaktu-waktu.
3. **Deletion Handling**: Node yang dihapus tidak langsung hilang mendadak, melainkan menggunakan transisi lembut (`scale: 1 ➔ 0`, `opacity: 1 ➔ 0`) selama beberapa ratus milidetik.

### C. Folder Hulls & Subfolder Bloom
1. **Depth 1 (Parent)**: Lingkaran klaster besar dengan fill tipis (`alpha: 0.09`) dan tab pill folder `📁 01 - Project Alpha`.
2. **Depth 2 (Child Subfolder)**: Ketika direktori baru pertama kali terbentuk pada commit tertentu, lingkaran gelembung anak mekar elastis (*spring lerp*) dari radius `0` ke radius target di dalam lingkaran induknya, lengkap dengan mini-tab pill `📁 Docs`.

### D. Inter-Folder Venn Bridge
1. Garis koneksi bertegangan tinggi antara dua klaster folder berbeda (`rgba(0, 242, 255, 0.45)`).
2. Dilengkapi **Marching Flow Particle** (titik cahaya putih berkilau) yang bergerak menyeberangi jembatan untuk memperjelas aliran keterhubungan antar folder.

---

## 5. File Prototipe Terpasang

Prototipe interaktif lengkap dapat dijalankan langsung di browser melalui file:
* **Demo HTML**: [**`demo.html`**](file:///d:/0pro/pakcli-plugin/panel/demo.html)
* **Pintasan Kontrol**:
  - `Spasi`: Play / Pause otomatis timelapse.
  - `←` / `→`: Navigasi maju/mundur antar commit secara presisi.
  - Klik pada pill commit manapun (`C0` s/d `C9`) di timeline bawah untuk melompat langsung.
