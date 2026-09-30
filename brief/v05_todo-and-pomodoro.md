# Brief Konsep & Desain: `v05_todolist` (Todo & Pomodoro Hub)

Dokumen arsitektur, filosofi desain, dan spesifikasi teknis untuk implementasi fitur **Todo List + Pomodoro Split View** terintegrasi di PakCLI Obsidian Plugin dengan kemampuan **Vault / Directory Markdown Task Parser** dan **Time-Range Syntax**.

---

## 1. Latar Belakang & Filosofi Inti (Core Philosophy)

### Masalah pada Solusi Eksisting (Misal: Obsidian Tasks)
1. **Tidak Ada Dedicated Sidebar Panel**: Pengguna harus membuat note khusus dan mengetik blok kode query (` ```tasks ...``` `) hanya untuk melihat daftar tugas harian.
2. **Tidak Ada Eksekusi/Fokus (Zero Timer)**: Obsidian Tasks hanya mencatat daftar statis, tidak ada alat bantu fokus langsung saat mengeksekusi tugas.
3. **Format Baris Tanggal Kaku & Tercecer**: Format emoji bertumpuk (`📅 ⏳ 🛫`) kurang nyaman jika ingin mencatat rentang waktu kerja yang presisi (*timeblocking* dari jam A ke jam B).
4. **Scope Direktori Terbatas**: Tidak ada cara visual cepat di sidebar untuk memilih: *"Tampilkan task dari seluruh vault"* atau *"Hanya folder proyek `Projects/App/` ini saja"*.

### Solusi PakCLI: `v05_todolist`
1. **Always-On Sidebar Panel (Ribbon 🎯)**: Sekali klik icon target di ribbon, panel langsung terbuka di lokasi yang disukai pengguna (**Left Sidebar** [Default], **Right Sidebar**, atau **Center Tab**).
2. **Native Markdown Line Parser (Time-Range + Wikilinks)**: Memindai baris task langsung dari file markdown di vault dengan format rentang waktu terstruktur:
   `hh-mm, dd-mm-yyyy -> hh-mm, dd-mm-yyyy Catatan task [[Wikilink]]`
3. **Scope Selector & Dynamic Sorting (Default: `dateend closest`)**:
   - Pilih scope: **Seluruh Vault** atau **Direktori Tertentu**.
   - Sort dinamis: **Deadline Terdekat (`dateend closest`)**, **A-Z**, **Z-A**, **Oldest Task**, atau **Newest Task**.
4. **Integrated Pomodoro Split View**: Timer fokus berada di satu halaman yang sama dengan task list (dapat diletakkan di **Atas** atau di **Bawah**). Task yang dipilih langsung di-fokuskan, dan sesi 🍅 otomatis tercatat.
5. **Flexible Persistence Engine**: Selain parsing live baris Markdown di vault, juga mendukung ekspor/impor mode **JSON** dan **CSV**.

---

## 2. Ribbon & Panel Routing (Settings)

### Titik Akses (Ribbon)
* **Icon**: `target` (🎯) pada ribbon kiri Obsidian.
* **Aksi Klik**: Membuka atau memfokuskan leaf `v05_todolist_view`.

### Lokasi Panel (Dapat Dipilih di Settings)
Pengguna dapat memilih posisi default pembukaan panel melalui dropdown setting:

| Pilihan Setting | Nilai Teknis | Perilaku di Obsidian |
|---|---|---|
| **Left Sidebar (Default)** | `'sidebar-left'` | Membuka tab baru di dock kiri (`workspace.getLeftLeaf(false)`). |
| **Right Sidebar** | `'sidebar-right'` | Membuka tab baru di dock kanan (`workspace.getRightLeaf(false)`). |
| **Active Note Center** | `'center'` | Membuka tab baru di area kerja utama/editor (`workspace.getLeaf('tab')`). |

---

## 3. Spesifikasi Parsing Markdown Task & Format Waktu

Parser akan memindai baris checklist markdown di dalam scope note yang dipilih.

### A. Status Checkbox
| Kode Markdown | Status Internal | Visual Icon di Sidebar | Deskripsi |
|---|---|---|---|
| `- [ ]` | `todo` | `○` (Bulat kosong) | Tugas belum dimulai |
| `- [/]` | `in_progress` | `◑` (Setengah terisi) | Sedang dikerjakan (Active) |
| `- [x]` | `done` | `✔` (Centang hijau/aksen) | Selesai (teks dicoret halus) |
| `- [-]` | `cancelled` | `✖` (Silang merah/muted) | Dibatalkan / Di-drop |

---

### B. Format Waktu & Tanggal (Time-Range Syntax)

Format string waktu yang diparsing menggunakan pola:
```text
hh-mm, dd-mm-yyyy -> hh-mm, dd-mm-yyyy [Deskripsi / Catatan] [[Wikilink]]
```
*(Catatan: Parser juga fleksibel menerima pemisah waktu `:` seperti `hh:mm, dd-mm-yyyy -> hh:mm, dd-mm-yyyy`)*.

#### Komponen Baris:
1. **`timeStart, dateStart`**: Jam & tanggal mulai tugas (contoh: `09-00, 30-09-2026`).
2. **Separator**: Tanda panah `->`.
3. **`timeEnd, dateEnd`**: Jam & tanggal tenggat / selesai tugas (contoh: `11-30, 30-09-2026`).
4. **Catatan / Deskripsi**: Teks bebas penjelasan task.
5. **`[[Wikilink]]` Support**: Dapat menyematkan link ke note lain di vault. Di sidebar, link ini interaktif (hover preview & click to navigate).

#### Contoh Baris Nyata di Markdown:
```markdown
- [ ] 09-00, 30-09-2026 -> 11-30, 30-09-2026 Review PR arsitektur plugin [[v05_todolist]]
- [/] 13-00, 30-09-2026 -> 15-00, 30-09-2026 Debugging parser time-range [[TimelineNarrative]]
- [x] 08-30, 29-09-2026 -> 09-30, 29-09-2026 Sync pagi dengan tim desain
- [-] 16-00, 28-09-2026 -> 17-00, 28-09-2026 Weekly vendor meeting (rescheduled)
```

---

## 4. Scope Direktori & Mesin Sorting di Sidebar

Di bagian atas panel sidebar terdapat bilah kontrol cepat untuk **Scope Folder** dan **Aturan Pengurutan (Sorting)**:

```
┌────────────────────────────────────────────────────────┐
│ 🎯 TODO & POMODORO HUB                [⚙️] [🔄] [➕]    │
├────────────────────────────────────────────────────────┤
│ 📁 Scope: [ 📂 Projects/ClientA        ▼ ]             │
│ ↕️ Sort : [ ⏳ Date End Closest (Default) ▼ ]           │
│ 🔍 [Cari task, catatan, atau [[wikilink]]...]          │
└────────────────────────────────────────────────────────┘
```

### A. Opsi Scope Direktori:
1. **Whole Vault (`*`)**: Memindai seluruh file markdown yang ada di vault.
2. **Specified Directory / Folder**: Membatasi pencarian hanya pada folder tertentu (misal: `Projects/`, `Daily Notes/`, `00_Inbox/`).
3. **Folder Selector Dropdown**: User bisa langsung mengganti folder scope dari header panel sidebar tanpa harus masuk ke menu settings.

### B. Opsi Sorting (Pengurutan):
1. **`dateend_closest` (DEFAULT)**:
   - Mengurutkan berdasarkan `dateEnd` & `timeEnd` yang paling dekat dengan waktu saat ini (Overdue & Mendekati Deadline muncul paling atas).
2. **`oldest_task`**:
   - Berdasarkan `dateStart` & `timeStart` paling lampau / tugas yang paling awal dibuat.
3. **`newest_task`**:
   - Berdasarkan `dateStart` & `timeStart` paling baru.
4. **`a-z`**:
   - Alfabet judul catatan/deskripsi dari A ke Z.
5. **`z-a`**:
   - Alfabet judul catatan/deskripsi dari Z ke A.

---

## 5. Pomodoro Split-View Layout

Todo list dan Pomodoro berada pada **satu halaman/view yang sama** dalam susunan split vertikal yang posisinya bisa ditukar (Top atau Bottom):

```
MODE A: Pomodoro on Top (Default)           MODE B: Pomodoro on Bottom
┌─────────────────────────────────────┐     ┌─────────────────────────────────────┐
│ 🎯 TODO & POMODORO HUB    [⚙️][🔄]   │     │ 🎯 TODO & POMODORO HUB    [⚙️][🔄]   │
├─────────────────────────────────────┤     ├─────────────────────────────────────┤
│ ⏱️ POMODORO TIMER (Compact View)    │     │ 📁 Scope: [ 📂 Projects/ClientA   ] │
│  Focus: Review PR arsitektur        │     │ ↕️ Sort : [ ⏳ Date End Closest   ] │
│               24:18                 │     │                                     │
│       [ ▶ Focus ]  [ ⏹ Reset ]       │     │ ▼ 📄 SprintPlan.md                  │
│      Sesi Hari Ini: 🍅🍅🍅⚪ (3/4)   │     │   ├─ [x] 08-30 -> 09-30 Standup     │
├─────────────────────────────────────┤     │   └─ [▶] 09-00 -> 11-30 Review PR   │
│ 📁 Scope: [ 📂 Projects/ClientA   ] │     │          [[v05_todolist]]           │
│ ↕️ Sort : [ ⏳ Date End Closest   ] │     ├─────────────────────────────────────┤
│                                     │     │ ⏱️ POMODORO TIMER                   │
│ ▼ 📄 SprintPlan.md                  │     │  Focus: Review PR arsitektur        │
│   ├─ [x] 08-30 -> 09-30 Standup     │     │               24:18                 │
│   └─ [▶] 09-00 -> 11-30 Review PR   │     │       [ ▶ Focus ]  [ ⏹ Reset ]       │
│          [[v05_todolist]]           │     │      Sesi Hari Ini: 🍅🍅🍅⚪ (3/4)   │
└─────────────────────────────────────┘     └─────────────────────────────────────┘
```

### Integrasi Alur Pomodoro:
1. User mengklik tombol **`▶ Focus`** pada salah satu baris task di sidebar.
2. Widget Pomodoro mengunci task tersebut: *"Currently focusing: [Judul Task]"*.
3. Timer 25 menit berjalan.
4. Ketika sesi selesai:
   - Notifikasi suara (*audio chime*) dan Obsidian Notice muncul.
   - Sesi Pomodoro hari ini bertambah (`🍅 +1`).
   - Bisa otomatis menambahkan counter 🍅 ke baris task tersebut di file aslinya.

---

## 6. Bi-directional Sync (Two-Way Editing)

1. **Klik Checkbox di Sidebar**:
   - Saat pengguna mengklik checkbox `○` ➔ `✔` di panel sidebar, plugin langsung mencari file dan baris sumber di vault, lalu mengubah `- [ ]` menjadi `- [x]` secara aman menggunakan `app.vault.process()`.
2. **Navigasi ke Sumber**:
   - Setiap kartu task memiliki tombol kecil `🔗 Buka Sumber` yang langsung membuka file catatan dan mengarahkan kursor tepat pada baris task yang bersangkutan.
3. **Reaktif (Live Vault Watcher)**:
   - Jika pengguna mengedit file markdown secara langsung di editor Obsidian, panel sidebar mendengarkan event `vault.on('modify')` dan me-refresh daftar task secara otomatis tanpa perlu reload plugin.

---

## 7. Storage Engine: 3 Pilihan Fleksibel

Selain fitur utama memindai baris Markdown di vault, arsitektur `v05_todolist` tetap mempertahankan dukungan multi-storage:

```
┌────────────────────────────────────────────────────────┐
│               v05_todolist Storage Engine              │
└──────────────────────────┬─────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────────┐
│ Mode 1: Vault │  │ Mode 2: JSON  │  │   Mode 3: CSV     │
│ Line Parser   │  │ (Single File) │  │  (Single File)    │
│ (Default)     │  │               │  │                   │
│ Parsing baris │  │ Menyimpan     │  │ Format tabel      │
│ markdown      │  │ struktur data │  │ untuk integrasi   │
│ rentang waktu │  │ JSON utuh     │  │ Excel/SQLSeal     │
│ di vault/dir. │  │ di 1 file.    │  │                   │
└───────────────┘  └───────────────┘  └───────────────────┘
```

---

## 8. Schema Konfigurasi Plugin (`settings.ts`)

```typescript
export type TodoSortOption = 
    | 'dateend_closest' 
    | 'oldest_task' 
    | 'newest_task' 
    | 'a_z' 
    | 'z_a';

export type TodoScopeMode = 'vault' | 'directory';

export interface TodoListSettings {
    // Penempatan View & Ribbon
    defaultPanelPosition: 'sidebar-right' | 'sidebar-left' | 'center';
    ribbonIcon: string; // 'target'

    // Scope & Sorting Default
    defaultScopeMode: TodoScopeMode; // 'vault' | 'directory'
    defaultScopeDirectory: string;   // e.g. "Projects"
    defaultSortOption: TodoSortOption; // default: 'dateend_closest'

    // Pomodoro Timer
    pomodoroPosition: 'top' | 'bottom';
    workDurationMinutes: number; // default: 25
    shortBreakMinutes: number;   // default: 5
    longBreakMinutes: number;    // default: 15
    autoStartNextSession: boolean;
    playChimeSound: boolean;

    // Storage Mode Tambahan (Opsional)
    storageMode: 'markdown_parser' | 'json' | 'csv';
    jsonFilePath: string; // e.g. "todo_projects.json"
    csvFilePath: string;  // e.g. "todo_projects.csv"
}

export const DEFAULT_TODOLIST_SETTINGS: TodoListSettings = {
    defaultPanelPosition: 'sidebar-left',
    ribbonIcon: 'target',
    defaultScopeMode: 'vault',
    defaultScopeDirectory: 'Projects',
    defaultSortOption: 'dateend_closest',
    pomodoroPosition: 'top',
    workDurationMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    autoStartNextSession: false,
    playChimeSound: true,
    storageMode: 'markdown_parser',
    jsonFilePath: 'todo_projects.json',
    csvFilePath: 'todo_projects.csv'
};
```

---

## 9. Rencana Tahapan Implementasi (Implementation Roadmap)

| Tahap | Modul | Deskripsi Pekerjaan |
|---|---|---|
| **Fase 1** | `types.ts` & `settings.ts` | Interface model task (`timeStart`, `dateStart`, `timeEnd`, `dateEnd`, `wikilinks`, `status`), sort options, dan scope settings. |
| **Fase 2** | `parser/TaskLineParser.ts` | Regex & parser extractor untuk pola `- [ ] hh-mm, dd-mm-yyyy -> hh-mm, dd-mm-yyyy ... [[link]]`. |
| **Fase 3** | `scanner/VaultTaskScanner.ts` | Engine pemindai file di vault/direktori dengan cache ringan dan listener `vault.on('modify')`. |
| **Fase 4** | `PomodoroWidget.ts` | Komponen Pomodoro timer terpisah dengan audio cue, compact ring/progress bar, dan binding task aktif. |
| **Fase 5** | `TodoListView.ts` & UI | ItemView panel sidebar dengan Scope Selector, Sort Selector, daftar task interaktif, dan split layout (Top/Bottom). |
| **Fase 6** | Two-Way Sync Mutator | Handler mutasi baris Markdown saat checkbox diklik (`[ ]` ➔ `[x]`) dan tombol lompat ke baris catatan. |
| **Fase 7** | Ribbon & Leaf Manager | Mendaftarkan ribbon icon `target` (🎯) dan handler open leaf (`sidebar-right`, `sidebar-left`, `center`). |
