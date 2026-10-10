---
id: invoice-frontmatter-compiler-validator
title: Invoice Frontmatter Compiler & Validator
plugin: write
status: -1
tags:
  - pakcli
  - write
  - invoice
  - validation
  - feature
created: 2026-10-09
---

# Invoice Frontmatter Compiler & Validator

## 1. Overview
Kompilator dan validator skema metadata frontmatter untuk dokumen keuangan, invoice dagang, dan surat penawaran harga yang menjamin kebenaran tipe data angka, format tanggal, dan relasi item sebelum diekspor.

## 2. Key Capabilities (Backlog)
- **Schema Validation**: Memverifikasi keberadaan field wajib (`invoice_id`, `client`, `amount`, `due_date`, `items`).
- **Mathematical Integrity Check**: Menghitung ulang subtotal, diskon, dan pajak untuk mendeteksi kesalahan hitung manual pada dokumen.
- **Auto-Formatting**: Merapikan indentasi dan urutan key YAML secara otomatis saat dokumen disimpan.

## 3. Integration Points
- Terhubung dengan `rupiah-smart-parser-input` dan modul generator invoice.

## 4. Status: -1 (Backlog)
Fitur berada dalam backlog modul authoring keuangan.
