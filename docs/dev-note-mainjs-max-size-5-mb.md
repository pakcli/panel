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

## 3. Mandatory Engineering Rules (Aturan Wajib Build)

### A. Pengaturan Production `esbuild.config.mjs`
Setiap build production (baik di lokal maupun di GitHub Actions Runner) **WAJIB** menerapkan flag berikut:
```javascript
minify: true,
minifyWhitespace: true,
minifyIdentifiers: true,
minifySyntax: true,
treeShaking: true,
legalComments: 'none',   // Membuang ribuan baris komentar lisensi pihak ketiga dari bundle
sourcemap: false,        // DILARANG inline sourcemap pada production artifact!
drop: ['debugger'],      // Opsional: hilangkan debugging hooks
```

### B. Strategi Pemisahan & Lazy-Loading (Jika Mendekati Batas 4 MB)
1. **Dynamic Import**: Hindari mengimpor library berat di tingkat teratas `main.ts`. Gunakan `await import(...)` hanya saat view terkait dibuka (misal saat Leaflet View atau SQLite Editor aktif).
2. **Decoupled Architecture**: Pisahkan modul authoring dan scaffolding murni ke plugin pendamping (`pakcli-write` / `pakcli-local`) agar tidak menumpuk semua modul ke dalam satu bundle.

## 4. Manifest Integrity Guard
Plugin ID resmi yang terdaftar di direktori komunitas Obsidian adalah **`pakcli-table`**.
- Field `id` pada `manifest.json` **TIDAK BOLEH DIUBAH** menjadi nama lain agar rilis GitHub tidak berstatus *FAILED* saat diaudit bot Obsidian.
- Nama publik dapat disesuaikan melalui field `name: "PakCLI Panel"`.

## 5. Status: 1 (Active Directive)
Pedoman ini aktif sebagai acuan arsitektur wajib untuk seluruh rilis dan automated CI/CD pipeline selanjutnya.
