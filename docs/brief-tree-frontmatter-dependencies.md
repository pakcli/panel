# 📌 Master Brief: Tree Frontmatter & Dependencies Integration (pakcli-panel)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `panel` (`src/features/treeGrid/`, `src/features/tierlist/utils/`)  
> **Platform**: Cross-platform (Desktop & Mobile)  
> **Date**: 2026-10-23  

---

## 1. Objective & Problem Statement

### Masalah
Saat ini, diagram pohon file (`panel-tree`, `panel-tree-cascading`, dsb.) hanya berfungsi sebagai visualisasi hierarki folder/file dan catatan teks sederhana (`# note`). 
Jika pengguna ingin menyusun arsitektur sistem baru atau mendefinisikan relasi antar-file, mereka harus:
1. Mengetik nama file di tree diagram.
2. Membuka file satu per satu secara manual.
3. Menulis frontmatter YAML (`dependencies: [...]`, `status: ...`, dsb.) satu per satu.
Hal ini sangat memakan waktu, memecah fokus, dan tidak terintegrasi langsung dengan modul **3-Tier Dependency Inspector** serta **Compare Hub**.

### Solusi
Mengintegrasikan parser metadata frontmatter native langsung ke dalam baris pohon dengan sintaks deklaratif:
```text
f?<nama_properti>: <isi_nilai>
```
Pengguna dapat langsung mendefinisikan hierarki file **sekaligus metadata dan dependensi frontmatter-nya** dalam satu baris ringkas:
```text
v src
  auth-service.ts  # f?dependencies: [[db.ts]], [[jwt.ts]] f?status: active f?priority: 1
```

---

## 2. Spesifikasi Sintaks & Parsing Engine

### A. Format Deklarasi `f?<nama>:`
- Setiap deklarasi frontmatter diawali dengan token `f?<key>:`.
- Teks yang tidak diawali `f?` tetap diperlakukan sebagai catatan display biasa (*human note*).
- **Multi-Property Per Line**:
  Bisa menggabungkan banyak properti sekaligus tanpa perlu karakter separator khusus:
  ```text
  user-controller.ts # controller user f?dependencies: [[auth.ts]], [[db.ts]] f?tier: A f?author: fsl
  ```
  - Catatan biasa: `"controller user"`
  - Properti `dependencies`: `["[[auth.ts]]", "[[db.ts]]"]` (Array)
  - Properti `tier`: `"A"` (String)
  - Properti `author`: `"fsl"` (String)

### B. List vs Primitive Auto-Detection
1. **List / Array (`dependencies`, `tags`, dll.)**:
   - Jika nilai mengandung koma (`,`): otomatis di-*split*, di-*trim*, dan diserialisasikan sebagai YAML Array:
     ```yaml
     dependencies:
       - "[[auth.ts]]"
       - "[[db.ts]]"
     ```
2. **Primitives (String / Number / Boolean)**:
   - Jika nilai tunggal (tanpa koma), disimpan sebagai primitive yang sesuai:
     - `f?status: active` $\rightarrow$ `status: "active"`
     - `f?priority: 1` $\rightarrow$ `priority: 1`
     - `f?published: true` $\rightarrow$ `published: true`

---

## 3. Arsitektur Teknis & Alur Data

### A. Atomic Frontmatter Sync (`processFrontMatter`)
- **Keamanan Data Mutlak**: Dilarang menggunakan manipulasi regex mentah pada file `.md` untuk mencegah rusaknya indentasi atau komentar YAML pengguna.
- **Obsidian Native API**:
  Saat tree dikomit atau file di-update dari tree:
  ```typescript
  await this.app.fileManager.processFrontMatter(targetFile, (fm) => {
      for (const [key, value] of Object.entries(parsedMeta)) {
          fm[key] = value;
      }
  });
  ```

### B. Scaffolding File Baru via `+File` Badge
- Jika pengguna mengklik badge `+File` pada folder tree yang di dalamnya sudah dideklarasikan baris dengan `f?dependencies:`:
  - File baru langsung dibuat dengan YAML frontmatter yang sudah terisi otomatis sesuai deklarasi di tree!

### C. Sinergi dengan 3-Tier Dependency Triage Engine
- Properti `f?dependencies:` secara otomatis tersinkronisasi ke:
  1. **🔴 Hard Dependencies Zone** di Dependency Sidepanel Inspector.
  2. **Compare Hub / Venn Diagram** perbandingan file.
  3. **Visual Badge Indicator** di samping nama file pada diagram pohon.

---

## 4. Rencana Implementasi File

| File | Status | Deskripsi |
| :--- | :---: | :--- |
| `docs/brief-tree-frontmatter-dependencies.md` | ✅ | Master Brief Status 0 & Dokumentasi Arsitektur |
| `src/features/treeGrid/treeParser.ts` | ⏳ | Regex tokenizer untuk mengekstrak token `f?<name>: <val>` dan memisahkan display note |
| `src/features/treeGrid/TreeLivePreviewPlugin.ts` | ⏳ | Live preview rendering (tag preview / badge indicator untuk metadata) |
| `src/features/treeGrid/cascading/TreeCascadingManager.ts` | ⏳ | Dukungan sticky cascading header untuk baris ber-frontmatter |
| `src/features/treeGrid/treeFrontmatterSync.ts` | ⏳ | Service sinkronisasi atomik frontmatter via `app.fileManager.processFrontMatter` |
| `src/styles/treeGrid.scss` | ⏳ | Styling styling pill/badge untuk metadata tag `f?` |

---

## 5. Acceptance Criteria Checklist

- [x] Status 0 Master Brief dibuat dan di-commit ke Git.
- [ ] Tokenizer `f?<key>: <value>` mampu memproses multiple properties dalam 1 baris.
- [ ] Nilai berkoma otomatis dikonversi menjadi array string list.
- [ ] Catatan teks biasa di luar `f?` tetap tampil utuh sebagai display note.
- [ ] Sinkronisasi atomik ke file markdown menggunakan `processFrontMatter` tanpa merusak format YAML yang sudah ada.
- [ ] Integrasi otomatis dengan 3-Tier Dependency Triage Inspector (`fromZone: 'hard'`).
- [ ] Pembuatan file baru via `+File` badge otomatis menginjeksi frontmatter yang dideklarasikan.
- [ ] Build lulus verifikasi (`npm run build`) dengan 0 error kompilasi dan bundle size $< 5.0\text{ MB}$.
- [ ] Status 1 Update dan final commit.
