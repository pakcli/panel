---
id: folderize-virtual-explorer-split
title: Folderize Virtual Explorer Split
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - explorer
  - folderize
  - feature
created: 2026-10-09
---

# Folderize Virtual Explorer Split

## 1. Overview
Modul manajemen navigasi file explorer ganda (*split view*) dan alat konversi otomatis file tunggal menjadi folder utuh dengan file index di dalamnya tanpa merusak struktur relasi note.

## 2. Key Capabilities
- **Split Explorer View**: Menampilkan dua panel penjelajah folder sekaligus untuk memudahkan perbandingan dan pemindahan file antar direktori.
- **Turn File Into Folder (Folderize)**: Mengubah `Catatan.md` menjadi folder `Catatan/` dan memindahkan file tersebut ke dalamnya sebagai `Catatan/Catatan.md` atau `Catatan/index.md`.
- **Automatic Internal Link Healing**: Memperbarui semua wikilink vault yang mengarah ke file yang dikonversi agar tidak menjadi tautan rusak.

## 3. Integration Points
- Terintegrasi dengan `src/features/explorer/splitViewManager.ts` dan `src/features/folderize/`.

## 4. Status: 1 (Implemented)
Fitur sudah diimplementasikan penuh dan aktif di `pakcli-panel`.
