# Brief Desain: Audio Engine, Tactile SFX & Vault MP3 Player di PakCLI Panel

Dokumen arsitektur teknis lengkap, sistem antrean playlist (*queue logic*), integrasi menu klik-kanan vault, diagram wireframe UI/UX, dan tata letak kontrol pemutar musik MP3 yang mengikuti tema aktif Obsidian.

---

## 1. Inti Konsep & Filosofi (Core Philosophy)

1. **100% Offline & Lokal**:
   * **SFX Interaksi (Klik, Toggle, Kertas)**: Dihasilkan via **Web Audio API Sintetis** (0 KB ukuran file, latensi 0ms).
   * **Ambient MP3 Player**: Memutar file audio (`.mp3`, `.m4a`, `.wav`, `.ogg`, `.flac`) langsung dari Vault lokal pengguna tanpa internet.
2. **Fleksibilitas Direktori / Playlist**:
   * Jika setting folder = **None / Kosong**: Menampilkan dan memutar seluruh file audio yang ada di **seluruh Vault**.
   * Jika diset ke **Folder Tertentu** (misal `Music/Lofi`): Fokus hanya pada folder tersebut sebagai playlist aktif.
3. **Queue Logic yang Cerdas (Priority Insert & Fallback)**:
   * Mendukung antrean alami: `a1 ➔ a2 ➔ a3 ➔ a4`.
   * Jika user memilih *"Play Next"* pada lagu `z1` di tengah jalan, antrean otomatis menjadi: `a1 ➔ a2 (sedang jalan) ➔ z1 (prioritas) ➔ a3 ➔ a4`. Setelah `z1` selesai, pemutar otomatis melanjutkan ke `a3` tanpa merusak susunan playlist asal!
4. **Native Obsidian Aesthetic**:
   * 100% mengikuti variabel CSS tema Obsidian aktif (`--background-primary`, `--background-secondary`, `--interactive-accent`, `--text-normal`, `--radius-m`, dsb.). Cocok di Theme Dark maupun Light.

---

## 2. Diagram Wireframe UI / UX

### A. Layout Mode: 50% Screen Popup (Default) & Dock as Tab

#### 1. Default View: 50% Screen Popup (Tanpa Animasi)
* **Zero-Animation (Instan)**: Muncul seketika tanpa efek transisi/slide lambat (`transition: none; transform: none;`).
* **50% Screen Width**: Menutupi tepat **50% lebar layar** (sisi kiri atau kanan), sehingga 50% sisi lainnya tetap menampilkan catatan aktif pengguna untuk menulis atau membaca.
* **Header Actions**:
  * `[🗗 Dock]`: Mengubah popup menjadi tab leaf permanen di dalam workspace Obsidian (misal sidebar kanan/kiri atau split tab).
  * `[🗕 Minimize]`: Menyembunyikan popup dan beralih ke widget status bar di footer bawah.
  * `[✕ Close]`: Menutup panel audio.

```
┌────────────────────────────────────────────────────────┐ ┌─────────────────────────┐
│ 🎵 PakCLI Audio & Ambient   [🗗 Dock] [🗕 Min] [✕ Close]│ │                         │
├────────────────────────────────────────────────────────┤ │   ACTIVE NOTE (50%)     │
│  NOW PLAYING                                           │ │                         │
│  ┌──────────────────────────────────────────────────┐  │ │   # Daily Notes         │
│  │ 💿 Lofi Study Beats - Track 04.mp3               │  │ │                         │
│  │    Folder: Music/Lofi • Playlist: [ Entire ▾ ]   │  │ │   - Menulis bab 3...    │
│  └──────────────────────────────────────────────────┘  │ │   - Merapikan relasi... │
│                                                        │ │                         │
│  01:42 ━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━ 04:15      │ │                         │
│                                                        │ │   (Catatan tetap        │
│          [⏮ Prev]   [⏹ Stop]   [⏸ Pause]   [⏭ Next]    │ │    terbuka dan          │
│                                                        │ │    terlihat jelas)      │
│  MODE: [ 🔁 Loop All ] [ 🔂 Loop 1 ] [ 🔀 ] [ ➡️ ]     │ │                         │
├────────────────────────────────────────────────────────┤ │                         │
│  VOLUME CONTROLS                                       │ │                         │
│  🔊 Master : ───●────── 70%  [ 🔈 Mute ]               │ │                         │
│  🎵 Music  : ────────●─ 85%                            │ │                         │
│  ✨ SFX    : ──────●─── 60%  [ Test Clicks ]           │ │                         │
├────────────────────────────────────────────────────────┤ │                         │
│  UP NEXT QUEUE (3 items)       [ + Add ] [ 🗑 Clear ]  │ │                         │
│  ▶ 1. [Priority] z1_relaxing_piano.mp3         03:12   │ │                         │
│    2. a3_afternoon_rain.mp3                    02:45   │ │                         │
│    3. a4_evening_coffee.mp3                    04:20   │ │                         │
└────────────────────────────────────────────────────────┘ └─────────────────────────┘
  ◄─────────────────── 50% LEBAR LAYAR ──────────────────►   ◄────── 50% LEBAR ──────►
```

#### 2. Status Saat Di-Dock sebagai Tab (`[🗗 Dock]`):
Jendela bertransisi menjadi native `ItemView` / workspace tab di Obsidian, bisa di-drag ke sidebar samping atau dijadikan split tab.

#### 3. Status Saat Di-Minimize ke Obsidian Footer (`[🗕 Minimize]`):
Jendela disembunyikan dan berganti menjadi compact widget di status bar bawah Obsidian:

```
[...status bar lain...] | 🎵 Track 04 [01:42] [⏸] [⏭] | 1,420 words | UTF-8
```
*(Klik pada status bar pill ini untuk me-restore popup 50% kembali).*

---

### B. Ribbon Icon & File Explorer Context Menu (Klik Kanan)

```
[Ribbon Icon] ──► 🎧 Klik: Buka / Sembunyikan Floating Audio Player

[Klik Kanan pada FILE Audio: .mp3 / .wav / .m4a]
┌──────────────────────────────────────┐
│  Open                                │
│  Open in new tab                     │
│  ──────────────────────────────────  │
│  ▶  PakCLI: Play Now                 │ ──► Langsung putar lagu ini sekarang
│  ⏭  PakCLI: Play Next (Queue)        │ ──► Masuk antrean tepat setelah lagu aktif
│  ➕  PakCLI: Add to End of Queue     │ ──► Masuk antrean di urutan paling belakang
│  ──────────────────────────────────  │
│  Rename / Delete                     │
└──────────────────────────────────────┘

[Klik Kanan pada FOLDER berisi Audio]
┌──────────────────────────────────────┐
│  New note                            │
│  ──────────────────────────────────  │
│  🎵  PakCLI: Play All as Playlist    │ ──► Gantikan antrean saat ini & putar folder ini
│  ➕  PakCLI: Add Folder to Queue     │ ──► Tambahkan seluruh audio folder ke antrean
│  ──────────────────────────────────  │
│  Folder settings                     │
└──────────────────────────────────────┘
```

---

### C. Master-Detail Settings Tab (Hub Audio & Playlist Settings)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚙️ AUDIO & AMBIENT SETTINGS                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ Target Music Folder                                                         │
│ [ None (Entire Vault) ▾ ]  (Pilihan: None, atau spesifik folder di vault)   │
│                                                                             │
│ Default Playback Mode                                                       │
│ ( ) Loop Single Track  (•) Loop Playlist Sequentially  ( ) Shuffle / Random │
│                                                                             │
│ Tactile Micro-SFX Toggles                                                   │
│ [x] Button Click Mechanical Snap (12ms impulse)                             │
│ [x] Toggle Switch Ascending/Descending Chime                                │
│ [x] File Creation: Crisp Paper Slide                                        │
│ [x] File Deletion: Crumpled Paper Scrunch                                   │
│ [x] Suppress SFX while typing or inline renaming                            │
│                                                                             │
│ Master Output Pipeline                                                      │
│ Master Gain: [════════════●═] 80%   [ 🔊 Test Audio ]                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Logika Antrean & Pemutaran (Smart Queue Matrix)

Sistem antrean memisahkan antara **Base Playlist** (daftar lagu dasar dari folder/vault) dan **User Priority Queue** (lagu yang diselipkan manual via *Play Next*):

```
Base Playlist:  [ a1 ] ──► [ a2 ] ──────────────► [ a3 ] ──► [ a4 ]
                             ▲
                       (Sedang Memutar)
                             │
            User Klik Kanan: "Play Next on z1.mp3"
                             ▼
Effective Queue: [ a1 ] ──► [ a2 ] ──► [ z1★ ] ──► [ a3 ] ──► [ a4 ]
```

### Aturan Transisi:
1. **Lagu `z1` Selesai**:
   * `z1` dihapus dari Priority Queue.
   * Pointer otomatis maju ke index berikutnya di Base Playlist yaitu **`a3`**.
   * Pemutaran berlanjut secara mulus (*seamless playback continuation*).
2. **Tombol Previous `<<`**:
   * Jika lagu telah berjalan > 3 detik: Mengulang lagu saat ini dari detik 00:00.
   * Jika lagu berjalan < 3 detik: Mundur ke lagu sebelumnya dalam antrean historis.
3. **Tombol Next `>>`**:
   * Memotong lagu saat ini dan langsung memajukan antrean ke item berikutnya.
4. **Tombol Stop `⏹`**:
   * Menghentikan audio sepenuhnya, mengosongkan buffer audio aktif, dan mengembalikan penunjuk waktu ke `00:00` (berbeda dengan *Pause* yang membekukan posisi detik).

---

## 4. Mode Perulangan (Playback Modes)

Ada 4 mode yang dapat di-toggle secara siklis (*cyclic button toggle*):

| Mode Icon | Nama Mode | Perilaku Pemutaran |
|:---:|---|---|
| `🔁` | **Loop Sequence** | Memutar playlist berurutan (1 ➔ 2 ➔ 3 ➔ n). Saat lagu terakhir selesai, otomatis kembali ke lagu pertama. |
| `🔂` | **Loop 1 Track** | Mengulang satu lagu yang sedang aktif terus-menerus tanpa berpindah. |
| `🔀` | **Shuffle Random** | Mengacak urutan lagu berikutnya tanpa pengulangan lagu yang sama sampai semua lagu dalam antrean diputar. |
| `➡️` | **Linear Once** | Memutar berurutan dari lagu aktif hingga akhir antrean, lalu otomatis berhenti (*Stop*). |

---

## 5. Arsitektur Routing Web Audio & Theme Integration

```
[ HTML5 Audio Element (<audio>) ] ──► [ MediaElementAudioSourceNode ]
                                                │
                                                ▼
                                      [ Ambient GainNode ] (Slider Musik)
                                                │
[ Procedural SFX (Clicks/Paper) ] ──► [ SFX GainNode ]     (Slider SFX)
                                                │
                                                ▼
                                     [ Master GainNode ]   (Slider Master & Mute)
                                                │
                                                ▼
                                    [ Dynamics Compressor ] (Anti-Clipping)
                                                │
                                                ▼
                                    [ AudioDestinationNode ] (Speaker/Headphone)
```

### CSS Theme Integration (Strict Obsidian Standard)
* Background: `var(--background-primary)` dan `var(--background-secondary)`.
* Borders: `var(--background-modifier-border)`.
* Tombol Aktif & Accent: `var(--interactive-accent)` dan `var(--text-on-accent)`.
* Scrubber Track & Sliders: `var(--background-modifier-form-field)` & `var(--interactive-accent)`.
* Text & Metadata: `var(--text-normal)`, `var(--text-muted)`, dan `var(--font-monospace)` untuk penunjuk menit/detik.
