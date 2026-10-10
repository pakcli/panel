---
id: dev-note-mainjs-max-size-5-mb
title: Developer Architecture Note - Bundle Size Constraint & Obsidian Sync 5MB Limit
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - architecture
  - performance
  - bundle
  - obsidian-sync
  - guidelines
created: 2026-10-10
---

# Developer Architecture Note: main.js 5MB Limit & Bundle Diet Strategy

## 1. Problem Statement & Obsidian Review Policy
Pada automated check sistem rilis Obsidian Community (`community.obsidian.md`), rilis v1.0.42 memicu peringatan resmi:
> âš ï¸ **Warning**: *`main.js` from release 1.0.42 is larger than 5 MB. Users with the Obsidian Sync Standard plan will not be able to sync this file.*

Obsidian Sync Standard memberlakukan batas maksimal file sebesar **5 MB per file tunggal**. Jika `main.js` melebihi 5 MB:
1. Pengguna berbayar Obsidian Sync Standard tidak dapat menyinkronkan plugin ini ke perangkat lain (mobile/laptop).
2. Bot audit otomatis menandai peringatan pada rilis GitHub.

## 2. Root Cause Analysis (Penyebab Bengkak)
Hasil audit bundle input menunjukkan kontributor utama ukuran file:
- **`wa-sqlite-wasm` (~1.45 MB base64)**: Binary SQLite WebAssembly di-embed langsung ke bundle.
- **`@ag-grid-community` (~0.55 MB)**: Komponen grid enterprise dan parsing CST.
- **`leaflet` & shaders (~0.4 MB)**: Library pemetaan dan template canvas filmstrip.
- **Build Configurations**: Ketiadaan tree-shaking agresif dan minimisasi komentar legal di proses build release.

## 3. Mandatory Engineering Rules & Implemented Solutions

### A. Pengaturan Production `esbuild.config.mjs`
Setiap build production (baik di lokal maupun di GitHub Actions Runner) menerapkan konfigurasi:
```javascript
minify: true,
minifyWhitespace: true,
minifyIdentifiers: true,
minifySyntax: true,
treeShaking: true,
legalComments: 'none',   // Membuang ribuan baris komentar lisensi pihak ketiga dari bundle
sourcemap: false,        // DILARANG inline sourcemap pada production artifact!
drop: ['debugger'],      // Hilangkan debugging hooks
```

### B. Solusi Optimasi Tanpa Menghilangkan Fitur (Zero-Feature-Loss)
1. **WASM Deflate Compression (`wa-sqlite-wasm-url`)**:
   - `wa-sqlite-async.wasm` dikompresi saat build menggunakan `node:zlib.deflateSync` (level 9), memangkas raw base64 dari 1.45 MB menjadi ~0.53 MB.
   - Di runtime, `pako.inflate` mengekstraksi binary wasm secara sinkronik menjadi `Uint8Array` yang identik byte-for-byte.
   - Penghematan: **~920 KB**.
2. **Vector SVG Avatars pada Shader Carousel**:
   - Template dummy fallback pada `character-filmstrip.html` yang sebelumnya menanamkan 4 gambar JPEG base64 masif (~250 KB) digantikan dengan avatar SVG ringkas dan tajam.
   - Penghematan: **~250 KB**.
3. **Automated Bundle Size Cap Assertion**:
   - Script `esbuild.config.mjs` memvalidasi ukuran `main.js` pasca-build (`size <= 5 * 1024 * 1024`).
   - Jika ukuran melebihi batas 5.0 MB, build akan otomatis melempar error dan membatalkan pipeline sebelum dipublikasikan.

### C. Hasil Metrik Bundle Terkini
- **Ukuran Awal**: 5.94 MB (5,937,641 bytes) — *Gagal / Warning di Obsidian Sync*
- **Ukuran Terkini**: **4.54 MB (4,762,372 bytes)** — *Lolos 100% (< 5.0 MB)*
- **Headroom Tersedia**: ~480 KB di bawah batas ketat Obsidian Sync Standard.

## 4. Manifest Integrity Guard
Plugin ID resmi yang terdaftar di direktori komunitas Obsidian adalah **`pakcli-table`**.
- Field `id` pada `manifest.json` **TIDAK BOLEH DIUBAH** menjadi nama lain agar rilis GitHub tidak berstatus *FAILED* saat diaudit bot Obsidian.
- Nama publik disesuaikan melalui field `name: "PakCLI Panel"`.

## 5. Status: 1 (Active Directive)
Pedoman ini aktif sebagai acuan arsitektur wajib untuk seluruh rilis dan automated CI/CD pipeline selanjutnya.
