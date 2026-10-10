---
id: markdown-sanitizer-masker
title: Markdown String Sanitizer & Virtual Masking Engine
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - sanitizer
  - privacy
  - feature
created: 2026-10-09
---

# Markdown String Sanitizer & Virtual Masking Engine

## 1. Overview
Sistem penyensoran string dan pembersihan teks markdown otomatis yang melindungi data privat, kredensial, token API, dan path lokal sensitif baik saat tampilan live (reading/editing view) maupun saat ekspor publik.

## 2. Key Capabilities
- **Regex & Pattern Replacement**: Mendukung aturan pencocokan pola kata sandi, token, email, dan path sensitif.
- **Pre-Flight Diff Modal**: Menampilkan preview perbedaan (diff visual) sebelum perubahan massal diterapkan ke file catatan fisik.
- **Virtual String Masking Extension**: Masking visual real-time di CodeMirror 6 tanpa merusak teks asli di dalam dokumen.
- **Toggleable Rules**: Status aktivasi aturan dengan tombol stabil tanpa layout jitter.

## 3. Integration Points
- Terintegrasi dengan modul `src/features/sanitizer/`, `PreFlightDiffModal`, dan CodeMirror view plugin.

## 4. Status: 1 (Implemented)
Fitur sudah diimplementasikan penuh dan aktif di `pakcli-panel`.
