# 📋 Brief: 3-Tier Dependency Triage & Interactive Right Sidepanel Inspector

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **UI Target**: Right Sidepanel View (`ItemView` / Mobile Slide-over Drawer)  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-23  

---

## 1. Executive Summary & Core Objective

Sering kali pengguna merasa terbebani untuk membedakan dependensi teknis mana yang harus dimasukkan ke frontmatter YAML (`dependencies: [...]`) dan mana yang cukup disebut di dalam teks biasa. Jika semua wikilink disedot mentah-mentah, daftar perbandingan (*Compare Hub* & *Venn Diagram*) menjadi penuh sampah (*bloated*).

Fitur ini menghadirkan **3-Tier Dependency Triage Engine** dan **Interactive Right Sidepanel Inspector** dengan **Universal 3-Color Scope Radio Buttons**, **Drag & Drop Triage**, **Right-Click Context Menu**, **Dual View Modes (`Grouped` vs `Ungrouped`)**, dan **Collapse Repetitive Multiplier**:

1. **Universal 3-Color Column Radio Buttons**:
   - Selalu tampil dan aktif baik di mode **`Grouped`** maupun **`Ungrouped`**.
   - ⚪ **Soft Mention (White / Slate)**: Link sebutan narasi biasa.
   - 🟡 **Contextual (Yellow / Amber)**: Alat/aturan fungsional ber-specs.
   - 🔴 **Dependencies (Red / Rose)**: Hard prasyarat mutlak di YAML frontmatter.
   - `🔘 All`: Pilihan default untuk melihat keseluruhan.
2. **Drag & Drop Triage (Khusus Mode `Grouped`)**:
   - Menggunakan library bawaan `SortableJS` (yang sudah terpasang di modul Tierlist).
   - Pengguna bisa **menyeret kartu link (Drag & Drop)** dari zona ⚪ Soft $\rightarrow$ 🟡 Contextual $\rightarrow$ 🔴 Hard (Dependencies).
   - Menyeret kartu ke zona 🔴 **Hard otomatis menuliskan link ke frontmatter YAML** di file markdown secara instan!
   - Menyeret keluar dari 🔴 **Hard otomatis menghapusnya dari YAML**.
3. **Right-Click Context Menu**:
   - Klik kanan pada kartu/item mana saja memunculkan menu instan:
     - 🔴 *Move to Hard Dependencies (Pin to YAML)*
     - 🟡 *Move to Contextual Tools/Rules*
     - ⚪ *Demote to Soft Mention*
     - 📄 *Open Note in New Tab / Split*
4. **🔁 Collapse Repetitive Toggle**:
   - Mode `Collapsed (ON)`: Menyatukan link yang disebut berulang kali menjadi 1 baris dengan badge multiplier redup (`badge:[x3]`).
   - Mode `Uncollapsed (OFF)`: Menampilkan setiap baris kemunculan sesuai urutan teks.
5. **Smart Dropdown Sorter**:
   - ⏳ *Pertama Mention* (First $\rightarrow$ Last), ⌛ *Terakhir Mention*, 🔥 *Popular / Frequency*, 🔤 *A-Z / Z-A*.

---

## 2. Definisi 3 Tingkat Dependensi & Penyimpanan Fisiknya

Semua data tersimpan secara alami di dalam satu file Markdown lokal tanpa database eksternal:

| Kategori & Warna | Lokasi Penyimpanan Fisik di `.md` | Logika Identifikasi Otomatis | Peran di Compare Hub |
| :--- | :--- | :--- | :--- |
| 🔴 **Dependencies** *(Red / Rose)* | **Frontmatter YAML** (`dependencies: [...]`) | Tertulis di blok metadata atas, ATAU diseret (dragged) / di-pin ke zona Red. | **Mutlak / Prasyarat Utama**: Masuk ke baris perbandingan & simpul utama Venn. |
| 🟡 **Contextual** *(Yellow / Amber)* | **Body Teks Markdown** (`[[wikilink]]` biasa) | Link menunjuk ke `/tools/`, `/rules/`, `/workflows/`, atau note target punya `specs`. | **Alat & SOP Fungsional**: Melengkapi perbandingan alat di Compare Hub. |
| ⚪ **Soft Mention** *(White / Gray)* | **Body Teks Markdown** (`[[wikilink]]` biasa) | Link catatan umum tanpa spesifikasi teknis (hanya sebutan narasi). | **Diabaikan dari Compare**: Hanya tampil sebagai referensi sampingan. |

---

## 3. Desain UI/UX: Interactive Right Sidepanel

Panel ini terdaftar sebagai Obsidian Native `ItemView` (`viewType: 'pakcli-dependency-inspector'`) dan selalu sinkron dengan catatan aktif (`active-leaf-change`).

### A. Desktop Right Sidepanel Wireframe

#### 1. Header Toolbar & Universal 3-Color Radio Buttons
```text
┌──────────────────────────────────────────────────────────────┐
│ 🧭 DEPENDENCY INSPECTOR                                      │
│ File: esp32-firmware-flash.md                                │
├──────────────────────────────────────────────────────────────┤
│ [ 🗂️ Grouped | 📜 Ungrouped ]   [ 🔁 Collapse Repetitive: ON ]│
│ Dropdown Sorter: [ ⏳ Pertama Mention ▼                     ]│
│                                                              │
│ Scope Filter Radio Buttons (Aktif di Grouped & Ungrouped):   │
│ (•) All   ( ) ⚪ Soft (2)   ( ) 🟡 Contextual (3)   ( ) 🔴 Hard (2) │
│                                                              │
│ 🔍 [ Cari link...                                          ] │
├──────────────────────────────────────────────────────────────┤
```

#### 2. Tampilan Mode `Grouped` (Drag & Drop + Right Click)
```text
│ 🔴 HARD DEPENDENCIES (2) [Frontmatter Zone - Drop Target]    │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 🔴 [::] [[esptool.py]]          badge:[x1]  [Right-click]│ │
│ │    Runtime • Python Package                              │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ 🔴 [::] [[kabel-data-3.3v]]     badge:[x1]  [Right-click]│ │
│ │    Hardware • USB-C Data Cable                           │ │
│ └──────────────────────────────────────────────────────────┘ │
│                               ▲                              │
│                    (Drag & Drop antar Zona)                  │
│                               ▼                              │
│ 🟡 CONTEXTUAL TOOLS & RULES (2) [Has Specs - Drop Target]    │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 🟡 [::] [[tools/hardware/esp32-s3]]  badge:[x3]          │ │
│ │    Specs: Xtensa Dual-Core, 3.3V Logic                   │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ 🟡 [::] [[rules/anti-static-esd]]    badge:[x1]          │ │
│ │    Rule: Warning (Gunakan Gelang ESD)                    │ │
│ └──────────────────────────────────────────────────────────┘ │
│                               ▲                              │
│                    (Drag & Drop antar Zona)                  │
│                               ▼                              │
│ ⚪ SOFT MENTIONS (2) [Narrative Only - Drop Target]          │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ⚪ [::] [[sejarah-mikrokontroler]]   badge:[x1]          │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ ⚪ [::] [[forum-esp32-reddit]]       badge:[x2]          │ │
│ └──────────────────────────────────────────────────────────┘ │
```

#### 3. Tampilan Mode `Ungrouped` (Cascading Stream with Post-It Style)

**Ketika Toggle Collapse: ON (Default)**
```text
│ 📜 UNGROUPED STREAM [Filter: All | Collapse: ON | Sort: Pertama]
│ ├── 🔴 [[esptool.py]]               badge:[x1] Line 3  # PythonCLI
│ ├── 🔴 [[kabel-data-3.3v]]          badge:[x1] Line 5  # Hardware 
│ ├── 🟡 [[tools/hardware/esp32-s3]]  badge:[x3] Line 12 # DevBoard 
│ ├── 🟡 [[rules/anti-static-esd]]    badge:[x1] Line 28 # SafetySOP
│ ├── ⚪ [[sejarah-mikro]]            badge:[x1] Line 35 # History  
│ └── ⚪ [[forum-esp32-reddit]]       badge:[x2] Line 42 # Forum    
```

---

## 4. Mekanisme Drag & Drop dan Right-Click Synchronization

### A. Drag & Drop via SortableJS
1. **Container Linking**: Ketiga kotak zona di mode `Grouped` (`.zone-hard`, `.zone-contextual`, `.zone-soft`) dikonfigurasi dalam satu Sortable Group:
   ```typescript
   group: 'dependency-triage',
   animation: 150,
   handle: '.drag-handle' // Icon [::]
   ```
2. **Event `onAdd` Handling**:
   - Jika item di-drop ke **Zona 🔴 Hard**:
     Sistem memanggil `app.fileManager.processFrontMatter()` untuk menyisipkan nama file ke array `dependencies: [...]`.
   - Jika item di-drag keluar dari **Zona 🔴 Hard** (ke Zona 🟡 atau ⚪):
     Sistem secara otomatis menghapus item dari array frontmatter YAML.
   - Perubahan tersimpan secara lokal dan otomatis tercermin di file markdown tanpa reload!

### B. Right-Click Context Menu (Obsidian Menu API)
Setiap kartu link dilengkapi event listener `contextmenu`:
```typescript
const menu = new Menu();
menu.addItem((item) =>
    item.setTitle('🔴 Move to Hard Dependencies (Write to YAML)')
        .setIcon('pin')
        .onClick(() => promoteToHard(linkName))
);
menu.addItem((item) =>
    item.setTitle('🟡 Move to Contextual Tools/Rules')
        .setIcon('wrench')
        .onClick(() => moveToContextual(linkName))
);
menu.addItem((item) =>
    item.setTitle('⚪ Move to Soft Mentions')
        .setIcon('file-text')
        .onClick(() => demoteToSoft(linkName))
);
menu.showAtMouseEvent(evt);
```

---

## 5. Fitur Interaksi Kunci

1. **Universal 3-Color Scope Radio Buttons**:
   - `⚪ Soft` (White): Menyaring hanya link narasi.
   - `🟡 Contextual` (Yellow): Menyaring hanya alat dan aturan.
   - `🔴 Dependencies` (Red): Menyaring hanya prasyarat mutlak.
   - `🔘 All`: Menampilkan ketiga grup/warna sekaligus.
2. **Drag & Drop Triage**:
   - Pindahkan status dependensi secara visual dengan menyeret kartu antar kotak.
3. **Right-Click Context Menu**:
   - Alternatif cepat tanpa drag & drop untuk mengubah tier link.
4. **🔁 Collapse Repetitive Multiplier Badge**:
   - Mention ganda digabung menjadi satu kartu dengan badge redup `badge:[x3]`.
   - Tooltip menampilkan seluruh nomor baris kemunculan di file aktif.
5. **Direct Integration with Compare Hub**:
   - Tombol `[⚖️ Send Clean Data to Compare Hub]` di bagian bawah sidepanel mengirimkan data dependensi yang sudah rapi dan ter-triage ke modal perbandingan.

---

## 6. Implementation & Verification Gates

- [x] Brief Status 0 diperbarui dengan Universal 3-Color Radio Buttons, Drag & Drop Triage (SortableJS), dan Right-Click Context Menu.
- [ ] Implementasi Triage Engine di `panel/src/features/tierlist/utils/dependency-triage.ts`:
  - `triageDependencies(app, activeFile)`
  - Deduplikasi `count`, array baris `lines[]`.
  - Sinkronisasi frontmatter: `pinToFrontmatter()` dan `unpinFromFrontmatter()`.
- [ ] Implementasi View Component `DependencyInspectorView.ts`:
  - Registrasi leaf sidepanel kanan (`viewType: 'pakcli-dependency-inspector'`).
  - Integrasi SortableJS pada 3 zona triage.
  - Context menu trigger pada item link.
  - Universal 3-Color radio selector.
- [ ] Integrasi SCSS: Styling warna ⚪ White, 🟡 Yellow, 🔴 Red, dan badge multiplier redup di `panel/src/styles/dependency-inspector.scss`.
- [ ] Verifikasi Build: Jalankan `npm run build` di `panel/` dengan 0 error kompilasi dan ukuran bundle $< 5.0\text{ MB}$.
- [ ] Update Brief Status ke `1` (Implemented).
