---
id: quick-add-invoice-modal
title: Quick-Add Invoice Modal
plugin: panel
status: -1
tags:
  - pakcli
  - panel
  - finance
  - invoice
  - feature
created: 2026-10-09
---

# Quick-Add Invoice Modal

## 1. Overview
Modal entri data cepat untuk menambahkan tagihan, invoice klien, dan struk transaksi harian langsung dari antarmuka panel tanpa perlu membuat catatan markdown secara manual satu per satu.

## 2. Key Capabilities (Backlog)
- **Fast Tabular Form**: Input item belanja/jasa, kuantitas, harga satuan via Rupiah Smart Parser, dan kalkulasi PPN/total otomatis.
- **Auto-Generating Markdown Note**: Menghasilkan file note invoice terstruktur di folder target dengan template frontmatter standar.
- **Sync to Accounting Table**: Otomatis memperbarui baris tabel ringkasan keuangan di dashboard panel.

## 3. Integration Points
- Akan terhubung dengan `rupiah-smart-parser-input` dan modul tabel `sqlseal`.

## 4. Status: -1 (Backlog)
Fitur berada dalam backlog antrean pengembangan tahap lanjut setelah modul keuangan dasar stabil.
