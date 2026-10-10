---
id: universal-scoped-undo-redo-engine
title: Universal Scoped Undo/Redo Engine
plugin: panel
status: -1
tags:
  - pakcli
  - write
  - undo
  - history
  - feature
created: 2026-10-09
---

# Universal Scoped Undo/Redo Engine

## 1. Overview
Mesin pencatat riwayat transaksi atomik tunggal (*Single Master JSON Log*) yang mengisolasi pembatalan aksi hanya pada kumpulan catatan yang sedang terlihat di viewport aktif saat ini serta kebal terhadap penggantian nama file (rename-resilient).

## 2. Key Capabilities (Backlog)
- **Scope-Aware Isolation**: Mencegah tombol Undo di Virtual Tree membatalkan operasi pada dokumen di tab atau vault lain yang tidak terlihat.
- **UUID File Tracking**: Memetakan mutasi file menggunakan internal UUID sehingga riwayat undo tetap utuh saat nama file diubah.
- **Single Master JSON Storage**: Menyimpan seluruh riwayat operasi transaksi ke dalam 1 file artefak terpusat tanpa menghasilkan ribuan file sampah.

## 3. Integration Points
- Terintegrasi langsung dengan Virtual Folder Tree dan Inline Spec Outliner.

## 4. Status: -1 (Backlog)
Arsitektur master brief telah dirumuskan secara mendalam; implementasi dijadwalkan setelah core virtual tree aktif.
