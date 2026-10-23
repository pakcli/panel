# 📌 Master Brief: Codeblock Copy Prompt Action Button (pakcli-panel)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `panel` (`src/features/codeblock/scaler.ts`, `src/features/codeblock/codeblockPromptTemplates.ts`, `src/styles/main.scss`)  
> **Platform**: Cross-platform (Desktop & Mobile)  
> **Date**: 2026-10-23  

---

## 1. Objective & Problem Statement

### Masalah
Saat ini, tombol salin bawaan codeblock (`.copy-code-button` atau `.pakcli-cb-copy-btn`) hanya menyalin **teks mentah (raw text)** dari dalam codeblock. 

Ketika pengguna ingin membawa kode, diagram pohon (`panel-tree`), kueri SQL, atau skrip ke AI Assistant (Antigravity, Claude, ChatGPT, Cursor), pengguna terpaksa melakukan pekerjaan repetitif yang membosankan:
1. Klik tombol Copy di Obsidian.
2. Pindah ke jendela AI Chat.
3. Mengetik *framing prompt* secara manual: *"Tolong implementasikan arsitektur ini...", "Buatkan boilerplate...", "Jelaskan dan refactor kode berikut..."*.
4. Menempelkan (*paste*) kode.

### Solusi
Menghadirkan tombol aksi pendamping **`[✨ Copy Prompt]`** persis di sebelah tombol copy codeblock yang sudah ada:
- **1-Klik Instan**: Membungkus konten codeblock ke dalam **AI-Ready Prompt Template** yang cerdas dan langsung menyalinnya ke clipboard.
- **Smart Context Awareness**: Otomatis mendeteksi jenis codeblock (misal: jika diagram pohon `panel-tree`, prompt bertema *Architecture Scaffolding*; jika bahasa pemrograman seperti TS/Python/SQL, prompt bertema *Implementation & Review*).
- **Zero Friction**: Pengguna cukup klik `[✨ Prompt]`, `Alt+Tab` ke AI Chat, `Ctrl+V`, dan tekan Enter!

---

## 2. Desain UI & Penempatan

### A. Codeblock Action Group Header
Tombol diletakkan di pojok kanan atas codeblock, berjejer rapi di samping tombol copy standar:

```text
+-------------------------------------------------------------+
| ```panel-tree                         [ 📄 Copy ] [ ✨ Prompt ] |
| v src                                                       |
|   auth.service.ts # f?dependencies: [[db.ts]]                |
| ```                                                         |
+-------------------------------------------------------------+
```

### B. Interaksi & Feedback Visual
1. **Default State**:
   - Tombol tampil halus dan menyatu dengan tema codeblock:
     - Ikon Sparkle `✨` atau Robot `🤖` dengan tooltip: `"Copy as AI Ready Prompt"`.
2. **Active / Click State**:
   - Ikon berubah sementara menjadi centang hijau `✓` (`.pakcli-cb-prompt-btn--done`) selama 1.2 detik.
   - Menampilkan Obsidian Toast Notice: `📋 Copied AI Prompt to clipboard!`.

---

## 3. Spesifikasi Template Prompt Kontekstual

### A. Template Khusus `panel-tree` (Tree Scaffolding & Dependencies)
Saat tombol diklik pada codeblock `panel-tree`, `panel-tree-cascading`, atau `tree-structure`:

```text
Act as a Principal Software Engineer. Based on the following declarative project architecture with frontmatter directives:

```panel-tree
<ISI_CODEBLOCK_TREE>
```

Please perform the following tasks:
1. Scaffold each file with clean, production-ready boilerplate code.
2. Accurately resolve and wire up internal imports based on the declared `f?dependencies:` lists.
3. Preserve all declared frontmatter properties (tags, status, priority, tier) in the generated notes/files.
4. Provide a concise summary of the module relationships.
```

### B. Template Bahasa Pemrograman (TypeScript, Python, Rust, SQL, dll.)
Saat tombol diklik pada codeblock kode biasa:

```text
Act as an expert software engineer. Analyze the following code snippet:

```<LANG>
<KODE>
```

Please review and provide:
1. Production implementation / clean refactoring.
2. Edge cases, security considerations, and potential optimizations.
3. Type-safe definitions and explanatory docstrings.
```

---

## 4. Rencana Implementasi & Modul File

| File | Status | Deskripsi |
| :--- | :---: | :--- |
| `docs/brief-codeblock-copy-prompt.md` | ✅ | Master Brief Status 0 & Spesifikasi Teknis |
| `src/features/codeblock/codeblockPromptTemplates.ts` | ⏳ | Engine template prompt kontekstual berdasarkan tipe/bahasa codeblock |
| `src/features/codeblock/scaler.ts` | ⏳ | Injeksi DOM tombol `.pakcli-cb-prompt-btn` di samping `.pakcli-cb-copy-btn` |
| `src/styles/main.scss` | ⏳ | Styling tombol, grouping layout, hover states, dan animasi status `--done` |

---

## 5. Acceptance Criteria Checklist

- [x] Status 0 Master Brief dibuat dan di-commit ke Git.
- [ ] Tombol pendamping `.pakcli-cb-prompt-btn` terpasang rapi di samping `.pakcli-cb-copy-btn`.
- [ ] Deteksi tipe codeblock bekerja akurat (khusus `panel-tree` vs kode pemrograman umum).
- [ ] Konten disalin ke clipboard lengkap dengan template prompt yang rapi dan terformat.
- [ ] Feedback visual centang hijau `✓` dan toast notice berfungsi mulus.
- [ ] Build sukses (`npm run build`) dengan 0 error kompilasi dan ukuran bundle $< 5.0\text{ MB}$.
- [ ] Status 1 Update dan final commit.
