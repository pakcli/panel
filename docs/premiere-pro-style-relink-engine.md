---
id: premiere-pro-style-relink-engine
title: Premiere Pro Style Relink Engine (.links.json)
plugin: write
status: -1
tags:
  - pakcli
  - write
  - relink
  - links
  - feature
created: 2026-10-09
---

# Premiere Pro Style Relink Engine (.links.json)

## 1. Overview
Mesin penyambung ulang tautan (*relink engine*) yang terinspirasi dari alur kerja Adobe Premiere Pro, menggunakan file peta indeks `.links.json` untuk mencari dan memulihkan ribuan link gambar/lampiran yang rusak setelah folder dipindahkan atau diganti namanya.

## 2. Key Capabilities (Backlog)
- **Fuzzy Filename & Hash Matching**: Mencari file pengganti yang hilang berdasarkan kesamaan nama dan hash biner di seluruh drive.
- **Batch Relink Execution**: Memperbaiki ratusan link rusak dalam satu klik tanpa mengedit file note satu per satu secara manual.
- **Manifest Persistence**: Menyimpan daftar mapping relink ke dalam artefak `.links.json` yang dapat diverifikasi ulang kapan saja.

## 3. Integration Points
- Terintegrasi dengan modul file resolver di `pakcli-write`.

## 4. Status: -1 (Backlog)
Fitur berada dalam backlog antrean pemulihan data dan perbaikan link tingkat lanjut.
