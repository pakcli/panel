---
id: tierlist-matrix-radar-compare
title: Tierlist Drag-and-Drop Matrix & Radar Comparison View
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - tierlist
  - radar
  - feature
created: 2026-10-09
---

# Tierlist Drag-and-Drop Matrix & Radar Comparison View

## 1. Overview
Modul visualisasi peringkat (ranking matrix) dan analisis komparasi multi-dimensi yang telah dimerge ke dalam `pakcli-panel` untuk mengelompokkan catatan secara visual berbasis tier S/A/B/C/D dan membandingkan atribut catatan dalam chart radar.

## 2. Key Capabilities
- **Drag-and-Drop Tier Board**: Pengelompokan kartu catatan ke dalam baris tier interaktif dengan integrasi SortableJS.
- **Radar Chart Multi-Dimensi**: Visualisasi grafik jaring laba-laba (radar chart) untuk membandingkan skor spesifikasi antar catatan.
- **Quick Compare Diff Modal**: Membandingkan 2 atau lebih catatan secara side-by-side untuk mengidentifikasi perbedaan spesifikasi dan atribut frontmatter.
- **Two-Way Frontmatter Persistence**: Posisi tier langsung tersimpan ke metadata note atau file konfigurasi JSON.

## 3. Integration Points
- Terintegrasi dalam `src/features/tierlist/` dan di-bundle langsung dalam `pakcli-panel`.

## 4. Status: 1 (Implemented)
Fitur sudah diimplementasikan penuh dan terintegrasi pada branch produksi.
