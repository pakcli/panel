# 📋 Brief Fitur: Ribbon Grouping & Dedicated Ribbon Manager

### 🔴 1. Latar Belakang & Masalah (Ribbon Clutter / Fatigue)
- **Tumpukan Tombol Tak Beraturan**: Di Obsidian dengan puluhan plugin, bilah ribbon kiri (`.side-dock-actions`) menumpuk 20+ tombol ikon secara vertikal tanpa pemisah atau hierarki.
- **Kesulitan Menemukan Aksi**: Pengguna kesulitan membedakan mana tombol bawaan Obsidian (*Vanilla/Core*), tombol milik *PakCLI Table*, dan mana tombol milik masing-masing *Community Plugin*.
- **Kelemahan Solusi Lain (Foldering/Submenu)**: Mengelompokkan tombol ke dalam subfolder/dropdown menambah 2x klik dan merusak *muscle memory*.
- **Masalah Deteksi Tercampur**: Sebelumnya, tombol plugin lain dan tombol PakCLI sendiri belum terdeteksi secara presisi sehingga sempat tercampur ke dalam grup Vanilla Obsidian. Jarak spacing bawaan juga dirasa terlalu lebar.

---

### 🟢 2. Arsitektur & Spesifikasi Implementasi

1. **Mesin Deteksi Multi-Layer (Anti-Tercampur)**:
   - **Inisialisasi di Awal (`onload` baris pertama)**: Memastikan hook `Plugin.prototype.addRibbonIcon` aktif sebelum tombol pertama PakCLI maupun plugin lain didaftarkan.
   - **Layer 0 (Signature PakCLI)**: 7 tombol PakCLI (Bubble Graph, Audio & Ambient Player, A–Z Dictionary, Timeline Narrative, HTML Snapshot, ASCII Studio, SQLSeal) langsung diklasifikasikan ke grup **PakCLI Table**.
   - **Layer 1 (Workspace LeftRibbon Inspection)**: Memeriksa registry `app.workspace.leftRibbon.items` untuk menemukan ID plugin pemilik elemen tombol.
   - **Layer 2 (Plugin Instance Property Ownership)**: Memindai instans `app.plugins.plugins` aktif untuk mencocokkan referensi elemen tombol DOM langsung (`p[key] === el`).
   - **Layer 3 (Command Palette Cross-Referencing)**: Mencocokkan `aria-label` tombol dengan nama perintah di `app.commands.commands` berformat `<pluginId>:<commandId>`.
   - **Layer 4 (Manifest & Keyword Tokenizer)**: Menemukan kecocokan nama dan kata kunci manifest plugin komunitas.
   - **Layer 5 (Vanilla Core Whitelist)**: Hanya tombol resmi bawaan Obsidian (Graph, Canvas, Daily Notes, Templates, Quick Switcher, Audio Recorder, Workspaces, Bookmarks, dll.) yang masuk ke **Vanilla Obsidian (Core)**.
   - **Layer 6 (Isolasi Plugin Tak Dikenal)**: Tombol plugin yang belum terdaftar diisolasi ke grup plugin mandiri berdasarkan aksinya, **tidak pernah dicampur ke grup Vanilla**.

2. **Pengelompokan & Penjarakan Datar (Grouping Without Foldering)**:
   - Tombol-tombol dikelompokkan secara visual:
     - 🏛️ **Vanilla Obsidian (Core)**
     - 🌸 **PakCLI Table**
     - 🔌 **Community Plugin A, B, C...**
   - **Pengurangan Spacing 50% (Sesuai Permintaan User)**:
     - *Compact*: 4px (2px atas + 2px bawah)
     - *Medium (Default)*: 8px (4px atas + 4px bawah)
     - *Large*: 14px (7px atas + 7px bawah)
   - Pilihan gaya pemisah: *Empty Space*, *Subtle Hairline*, *Subtle Accent Dot*.

3. **Kontrol Visibilitas Per-Tombol (Show / Hide Toggle)**:
   - Setiap tombol yang terdeteksi memiliki switch toggle ON/OFF di pengaturan.
   - Tombol yang di-OFF-kan disembunyikan seketika dari ribbon (`display: none !important;`).

4. **Pengurutan Fleksibel (Drag & Drop Reordering)**:
   - Urutan grup dapat diatur (Default: Vanilla di atas, lalu PakCLI Table, lalu Plugin lainnya).
   - Urutan tombol di dalam masing-masing grup dapat dipindahkan dengan tombol `↑` / `↓`.

5. **Dedicated Settings Tab di Pengaturan Obsidian**:
   - Tab khusus **PakCLI Ribbon Manager** didaftarkan langsung ke bilah samping Pengaturan Obsidian (`this.addSettingTab(...)`).
   - Tersedia juga di dalam Master-Detail Settings Hub (`table-ribbon-manager`) dan Command Palette (`PakCLI: Open Ribbon Manager Settings`).

---

### 🚀 3. Hasil & Dampak Fitur
- ✅ **Tidak Ada Lagi yang Tercampur**: Tombol Vanilla, tombol PakCLI, dan tombol masing-masing plugin komunitas terpisah sempurna ke grupnya masing-masing.
- ✅ **Spacing Lebih Rapi & Pas (-50%)**: Jarak pemisah lebih ramping, estetis, dan tidak memakan ruang vertikal.
- ✅ **Bilah Ribbon Bersih & Terorganisir**: Visual breathing room optimal dengan akses tetap 1-klik.
- ✅ **Kontrol Penuh**: Toggle ON/OFF dan pengaturan urutan grup/tombol responsif secara real-time.
