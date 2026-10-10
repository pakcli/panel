---
id: rupiah-smart-parser-input
title: Rupiah Smart Parser Input
plugin: panel
status: 0
tags:
  - pakcli
  - panel
  - finance
  - parser
  - feature
created: 2026-10-09
---

# Rupiah Smart Parser Input

## 1. Overview
Parser input nominal mata uang Rupiah cerdas yang mengenali penulisan angka kasual (seperti `50rb`, `1.5jt`, `2,4m`, `500k`) dan mengonversinya menjadi angka integer terformat rapi (`Rp 50.000`, `Rp 1.500.000`) untuk keperluan pencatatan keuangan dan tabel invoice.

## 2. Key Capabilities (Planned)
- **Natural Language Suffix Recognition**: Mendukung sufiks umum Indonesia (`rb`, `jt`, `m`, `k`, `jt5`).
- **Live Currency Masking**: Format otomatis dengan pemisah titik ribuan saat pengguna mengetik angka di form input.
- **Two-Way Data Serialization**: Menyimpan nilai numerik mentah (`raw numeric integer`) ke frontmatter/database sambil menampilkan format tampilan terformat kepada user.

## 3. Integration Points
- Akan diintegrasikan ke dalam sel tabel SQLSeal, modal invoice, dan input field metadata panel.

## 4. Status: 0 (Planned / In Progress)
Spesifikasi parser regex dan tokenizer telah disiapkan; modul helper sedang dalam tahap pengujian integrasi.
