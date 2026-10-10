---
id: paired-asset-link-coordinator
title: Paired Asset Link Coordinator
plugin: panel
status: -1
tags:
  - pakcli
  - write
  - assets
  - linking
  - feature
created: 2026-10-09
---

# Paired Asset Link Coordinator

## 1. Overview
Koordinator penautan aset berpasangan yang menjaga konsistensi referensi antara file dokumen markdown dan aset media pasangannya (contoh: video dengan naskah subtitle, atau rekaman audio dengan transkripsi teks).

## 2. Key Capabilities (Backlog)
- **Automatic Association**: Menemukan dan menautkan file media dengan catatan pendamping bernama serupa (`Wawancara_01.mp3` <-> `Wawancara_01.md`).
- **Bidirectional Navigation**: Tombol pintas cepat di header dokumen untuk melompat langsung ke pemutar media atau file raw.
- **Relocation Guardian**: Memastikan saat catatan dipindahkan ke virtual folder lain, aset pasangannya tetap terkoordinasi.

## 3. Integration Points
- Terhubung dengan `pakcli-local` dan modul audio/media.

## 4. Status: -1 (Backlog)
Fitur berada dalam backlog antrean koordinasi aset multimedia.
