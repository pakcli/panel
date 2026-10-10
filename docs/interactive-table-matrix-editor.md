---
id: interactive-table-matrix-editor
title: Interactive Table & Matrix Editor (SQLSeal & Data Grid)
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - table
  - sqlseal
  - feature
created: 2026-10-09
---

# Interactive Table & Matrix Editor (SQLSeal & Data Grid)

## 1. Overview
Editor data tabular berkinerja tinggi yang menggabungkan integrasi engine database relasional lokal (SQLite via WASM) dan grid interaktif untuk manipulasi data catatan dalam skala besar.

## 2. Key Capabilities
- **In-Memory SQL Execution**: Menjalankan kueri SQL nyata terhadap data frontmatter dan metadata markdown vault.
- **Dynamic AG Grid Presentation**: Sorting multi-kolom, filter tingkat lanjut, pagination, dan reordering kolom.
- **CSV & JSON Two-Way Binding**: Kemampuan mengimpor, mengedit, dan mengekspor kumpulan data tabular langsung ke format CSV atau JSON.
- **Custom Expression Builder**: Membangun formula filter kustom untuk subset baris data.

## 3. Integration Points
- Terintegrasi dengan modul `sqlseal` dan `agGrid.scss`.

## 4. Status: 1 (Implemented)
Fitur sudah diimplementasikan penuh dan aktif di produksi `pakcli-panel`.
