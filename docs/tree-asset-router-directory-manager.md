---
id: tree-asset-router-directory-manager
title: Tree Asset Router & Directory Manager
plugin: panel
status: -2
tags:
  - pakcli
  - panel
  - tree
  - deprecated
  - migration
  - feature
created: 2026-10-09
updated: 2026-10-09
---

# Tree Asset Router & Directory Manager

## 1. Overview
Sistem router dan direktori navigasi aset lama di `pakcli-panel` yang sebelumnya menangani pemetaan file lampiran, gambar, dan navigasi tree di panel.

## 2. Status: -2 (About to be Removed / Migrated)
> **PEMBERITAHUAN MIGRASI ARCHITECTURE**:
> Modul ini **sedang dipindahkan keluar dari `pakcli-panel`** menuju `pakcli-local` sebagai fitur **Native Drag & Drop Attachment & File Explorer Tree** (dengan status `0` di `local`). 
> Kode lama di modul panel akan dibersihkan (*sunset & cleanup*) agar `pakcli-panel` tetap ramping dan fokus murni pada visualisasi media/dashboard.

## 3. Rencana Tindak Lanjut
- Hapus ketergantungan `AssetRouter` dari `panel/src/main.ts`.
- Pindahkan logic drag-and-drop native dan tree explorer aset ke repo `pakcli-local`.
