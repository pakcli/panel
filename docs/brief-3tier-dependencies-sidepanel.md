# 📋 Brief: 4-Tier Dependency Triage & Interactive Right Sidepanel Inspector

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **UI Target**: Right Sidepanel View (`ItemView` / Mobile Slide-over Drawer)  
> **Platform**: Obsidian Desktop & Mobile  
> **Date**: 2026-10-23  

---

## 1. Executive Summary & Core Objective

Sering kali pengguna merasa terbebani untuk membedakan dependensi teknis mana yang harus dimasukkan ke frontmatter YAML (`dependencies: [...]`) dan mana yang cukup disebut di dalam teks biasa. Jika semua wikilink disedot mentah-mentah, daftar perbandingan (*Compare Hub* & *Venn Diagram*) menjadi penuh sampah (*bloated*). Terlebih lagi, link yang belum dibuat filenya (*unresolved phantom links*) sering membingungkan pengguna.

Fitur ini menghadirkan **4-Tier Dependency Triage Engine** dan **Interactive Right Sidepanel Inspector** dengan spesifikasi produksi **10/10 Bulletproof**:
1. **4 Groups di Mode `Grouped` (Dengan Zona Oranye Khusus Unresolved)**:
   - 🔴 **Hard Dependencies**: Prasyarat mutlak di YAML frontmatter.
   - 🟡 **Contextual Dependencies**: Alat/aturan fungsional ber-specs.
   - ⚪ **Soft Mentions**: Sebutan narasi biasa yang sudah ada filenya.
   - 🟠 **Unresolved / Phantom Links**: Link yang belum memiliki file fisik di vault atau belum terhubung ke URL.
2. **Universal 4-Color Scope Radio Buttons**:
   - `🔘 All`
   - `🔴 Hard (Red)`
   - `🟡 Contextual (Yellow)`
   - `⚪ Soft (White)`
   - `🟠 Unresolved (Orange)`: **Quick Scope Filter** untuk langsung memburu dan menyelesaikan link-link gantung!
3. **Hover & Click Quick-Resolve Action**:
   - Pada kartu 🟠 **Unresolved**, terdapat tombol aksi cepat:
     - `[📄 Create Note]`: Otomatis membuat file `.md` baru di folder yang sesuai (`tools/`, `rules/`, atau root) dan langsung menghubungkannya.
     - `[🔗 Set as URL]`: Mengubah wikilink menjadi direct URL eksternal jika ternyata rujukan tersebut adalah link web/video.
4. **Drag & Drop Triage (SortableJS)**:
   - Pengguna bisa menyeret kartu link antar 4 zona.
   - Menyeret kartu ke zona 🔴 **Hard otomatis menuliskan link ke frontmatter YAML**.
   - Menyeret keluar dari 🔴 **Hard otomatis menghapusnya dari YAML**.
5. **🔁 Collapse Repetitive Multiplier**:
   - Mention ganda digabung menjadi satu kartu dengan badge redup `badge:[x3]`.
6. **Smart Dropdown Sorter**:
   - ⏳ *Pertama Mention* (First $\rightarrow$ Last), ⌛ *Terakhir Mention*, 🔥 *Popular / Frequency*, 🔤 *A-Z / Z-A*.
7. **🛡️ Rock-Solid Safety Net & Undo/Redo Engine**:
   - Menggunakan pattern `HistoryEntry[]` yang mencatat snapshot mutasi YAML dan aksi drag & drop dengan tombol `[↩️ Undo]`.

---

## 2. Definisi 4 Tingkat Dependensi & Penyimpanan Fisiknya

Semua data tersimpan secara alami di dalam satu file Markdown lokal tanpa database eksternal:

| Kategori & Warna | Lokasi Penyimpanan Fisik di `.md` | Logika Identifikasi Otomatis | Peran di Compare Hub |
| :--- | :--- | :--- | :--- |
| 🔴 **Dependencies** *(Red / Rose)* | **Frontmatter YAML** (`dependencies: [...]`) | Tertulis di blok metadata atas, ATAU diseret (dragged) / di-pin ke zona Red. | **Mutlak / Prasyarat Utama**: Masuk ke baris perbandingan & simpul utama Venn. |
| 🟡 **Contextual** *(Yellow / Amber)* | **Body Teks Markdown** (`[[wikilink]]` biasa) | Link menunjuk ke file eksis di `/tools/`, `/rules/`, `/workflows/`, atau punya `specs`. | **Alat & SOP Fungsional**: Melengkapi perbandingan alat di Compare Hub. |
| ⚪ **Soft Mention** *(White / Gray)* | **Body Teks Markdown** (`[[wikilink]]` biasa) | Link menunjuk ke file eksis umum tanpa spesifikasi teknis (hanya sebutan narasi). | **Diabaikan dari Compare**: Hanya tampil sebagai referensi sampingan. |
| 🟠 **Unresolved** *(Orange / Amber)* | **Body Teks Markdown** (`[[wikilink]]` gantung) | `app.metadataCache.getFirstLinkpathDest(link) === null` (File belum ada di vault). | **Peringatan / Action Item**: Menunggu resolusi via `[Create Note]` atau `[Set URL]`. |

---

## 3. The 10/10 Bulletproof Safety Net Architecture

### A. Atomic Frontmatter Mutation
- **Wajib menggunakan Obsidian Native API**:
  ```typescript
  await this.app.fileManager.processFrontMatter(tfile, (fm) => {
      if (!fm.dependencies) fm.dependencies = [];
      const list: string[] = Array.isArray(fm.dependencies) ? fm.dependencies : [fm.dependencies];
      if (action === 'pin' && !list.includes(targetLink)) list.push(targetLink);
      if (action === 'unpin') fm.dependencies = list.filter((x) => x !== targetLink);
  });
  ```

### B. History Stack & Undo/Redo Engine (`HistoryEntry`)
- Setiap aksi mutasi menyimpan snapshot JSON ke stack undo/redo hingga 30 aksi terakhir.
- Toast safety notification:
  > *"Pushed `[[kabel-data-3.3v]]` to Hard Dependencies. `[↩️ Undo]`"*

### C. Quick-Resolve Engine (Hover & Click Resolution)
- Memeriksa eksistensi file:
  ```typescript
  const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(cleanLink, activeFile.path);
  const isResolved = resolvedFile instanceof TFile;
  ```
- Jika `!isResolved`:
  - Kartu diberi border putus-putus (*dashed line*) oranye.
  - Saat di-hover, muncul tombol aksi:
    1. **`[📄 Create Note]`**: Menjalankan `app.vault.create(`${folder}/${cleanLink}.md`, "---\ncategory: ...\n---\n")`.
    2. **`[🔗 Set URL]`**: Membuka prompt modal untuk mengubah teks `[[nama]]` menjadi `[nama](https://url...)`.

---

## 4. Desain UI/UX: Interactive Right Sidepanel

Panel ini terdaftar sebagai Obsidian Native `ItemView` (`viewType: 'pakcli-dependency-inspector'`) dan selalu sinkron dengan catatan aktif (`active-leaf-change`).

### Desktop Right Sidepanel Wireframe

#### 1. Header Toolbar & Universal 4-Color Radio Buttons
```text
┌──────────────────────────────────────────────────────────────┐
│ 🧭 DEPENDENCY INSPECTOR                 [ ↩️ Undo ] [ ↪️ Redo ]│
│ File: esp32-firmware-flash.md                                │
├──────────────────────────────────────────────────────────────┤
│ [ 🗂️ Grouped | 📜 Ungrouped ]   [ 🔁 Collapse Repetitive: ON ]│
│ Dropdown Sorter: [ ⏳ Pertama Mention ▼                     ]│
│                                                              │
│ Scope Filter Radio Buttons (Aktif di Grouped & Ungrouped):   │
│ (•) All (8)  ( ) 🔴 Hard (2)  ( ) 🟡 Contextual (2)          │
│              ( ) ⚪ Soft (2)  ( ) 🟠 Unresolved (2)          │
│                                                              │
│ 🔍 [ Cari link...                                          ] │
├──────────────────────────────────────────────────────────────┤
```

#### 2. Tampilan Mode `Grouped` (4 ZONA DENGAN DRAG & DROP)
```text
│ 🔴 HARD DEPENDENCIES (2) [Frontmatter Zone - Drop Target]    │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 🔴 [::] [[esptool.py]]          badge:[x1]  [Right-click]│ │
│ │    Runtime • Python Package • 🟢 Resolved                │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ 🔴 [::] [[kabel-data-3.3v]]     badge:[x1]  [Right-click]│ │
│ │    Hardware • USB-C Data Cable • 🟢 Resolved             │ │
│ └──────────────────────────────────────────────────────────┘ │
│                               ▲                              │
│                    (Drag & Drop antar Zona)                  │
│                               ▼                              │
│ 🟡 CONTEXTUAL TOOLS & RULES (2) [Has Specs - Drop Target]    │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 🟡 [::] [[tools/hardware/esp32-s3]]  badge:[x3]          │ │
│ │    Specs: Xtensa Dual-Core, 3.3V Logic • 🟢 Resolved     │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ 🟡 [::] [[rules/anti-static-esd]]    badge:[x1]          │ │
│ │    Rule: Warning (Gunakan Gelang ESD) • 🟢 Resolved      │ │
│ └──────────────────────────────────────────────────────────┘ │
│                               ▲                              │
│                    (Drag & Drop antar Zona)                  │
│                               ▼                              │
│ ⚪ SOFT MENTIONS (2) [Narrative Only - Drop Target]          │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ⚪ [::] [[sejarah-mikrokontroler]]   badge:[x1] 🟢       │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ ⚪ [::] [[forum-esp32-reddit]]       badge:[x2] 🟢       │ │
│ └──────────────────────────────────────────────────────────┘ │
│                               ▲                              │
│                    (Drag & Drop antar Zona)                  │
│                               ▼                              │
│ 🟠 UNRESOLVED PHANTOM LINKS (2) [Action Zone - Drop Target]  │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 🟠 [::] [[driver-ch341-custom]]      badge:[x1] 🟠       │ │
│ │    (File belum ada) • [📄 Create Note] [🔗 Set URL]      │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ 🟠 [::] [[sensor-suhu-dht22]]        badge:[x1] 🟠       │ │
│ │    (File belum ada) • [📄 Create Note] [🔗 Set URL]      │ │
│ └──────────────────────────────────────────────────────────┘ │
```

#### 3. Tampilan Mode `Ungrouped` (Cascading Stream with Post-It Style)

```text
│ 📜 UNGROUPED STREAM [Filter: All | Collapse: ON | Sort: Pertama]
│ ├── 🔴 [[esptool.py]]               badge:[x1] Line 3  # PythonCLI
│ ├── 🔴 [[kabel-data-3.3v]]          badge:[x1] Line 5  # Hardware 
│ ├── 🟡 [[tools/hardware/esp32-s3]]  badge:[x3] Line 12 # DevBoard 
│ ├── 🟡 [[rules/anti-static-esd]]    badge:[x1] Line 28 # SafetySOP
│ ├── ⚪ [[sejarah-mikro]]            badge:[x1] Line 35 # History  
│ ├── 🟠 [[driver-ch341-custom]]      badge:[x1] Line 42 [Create|URL]
│ └── 🟠 [[sensor-suhu-dht22]]        badge:[x1] Line 50 [Create|URL]
```

---

## 5. Fitur Interaksi Kunci

1. **Universal 4-Color Scope Radio Buttons**:
   - `🔴 Hard` (Red): Menyaring hanya prasyarat mutlak.
   - `🟡 Contextual` (Yellow): Menyaring hanya alat dan aturan.
   - `⚪ Soft` (White): Menyaring hanya link narasi.
   - `🟠 Unresolved` (Orange): Menyaring hanya link gantung yang belum ada filenya.
   - `🔘 All`: Menampilkan keempat zona sekaligus.
2. **Hover & Click Quick-Resolve**:
   - Klik `[📄 Create Note]` langsung membuat file di vault tanpa keluar dari catatan aktif.
   - Klik `[🔗 Set URL]` langsung mengubah wikilink menjadi tautan web/video.
3. **Drag & Drop Triage 4 Zona (SortableJS)**:
   - Pindahkan status dependensi secara visual dengan menyeret kartu antar 4 kotak zona.
4. **Right-Click Context Menu**:
   - Alternatif cepat: pindah ke Hard, Contextual, Soft, atau Create Note.
5. **↩️ Undo / ↪️ Redo Navigation**:
   - Snapshot history tersimpan hingga 30 aksi terakhir per sesi dengan tombol Undo di header dan toast notification.
6. **🔁 Collapse Repetitive Multiplier Badge**:
   - Mention ganda digabung menjadi satu kartu dengan badge redup `badge:[x3]`.
7. **Direct Integration with Compare Hub**:
   - Tombol `[⚖️ Send Clean Data to Compare Hub]` di bagian bawah sidepanel mengirimkan data dependensi bersih ke modal perbandingan.

---

## 6. Implementation & Verification Gates

- [x] Brief Status 0 disempurnakan ke level **4-Tier Grouped View**:
  - Zona 🟠 **Unresolved** khusus untuk link gantung.
  - Universal 4-Color Radio Buttons (`All`, `Red`, `Yellow`, `White`, `Orange`).
  - Hover & Click Action: `[📄 Create Note]` dan `[🔗 Set URL]`.
  - Atomic Frontmatter Mutation (`processFrontMatter`).
  - History Manager Undo/Redo Stack (`TriageHistoryEntry`).
- [ ] Implementasi Triage Engine di `panel/src/features/tierlist/utils/dependency-triage.ts`:
  - `triageDependencies(app, activeFile)`
  - Pengecekan eksistensi via `metadataCache.getFirstLinkpathDest`.
  - Pemisahan 4 tier: `hard`, `contextual`, `soft`, `unresolved`.
- [ ] Implementasi Quick-Resolve Handler di `panel/src/features/tierlist/utils/resolve-handler.ts`:
  - `createNoteFromLink(app, linkName)`
  - `convertLinkToUrl(app, activeFile, linkName, url)`
- [ ] Implementasi History Manager di `panel/src/features/tierlist/utils/triage-history.ts`.
- [ ] Implementasi View Component `DependencyInspectorView.ts`:
  - Registrasi leaf sidepanel kanan (`viewType: 'pakcli-dependency-inspector'`).
  - Integrasi SortableJS pada 4 zona triage.
  - Context menu trigger pada item link.
  - Universal 4-Color radio selector.
  - Tombol Undo/Redo di header.
- [ ] Integrasi SCSS di `panel/src/styles/dependency-inspector.scss`.
- [ ] Verifikasi Build: Jalankan `npm run build` di `panel/` dengan 0 error kompilasi dan ukuran bundle $< 5.0\text{ MB}$.
- [ ] Update Brief Status ke `1` (Implemented).
