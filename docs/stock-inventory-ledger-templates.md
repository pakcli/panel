---
id: stock-inventory-ledger-templates
title: Stock & Inventory Ledger Templates
plugin: panel
status: -1
tags:
  - pakcli
  - write
  - inventory
  - ledger
  - feature
created: 2026-10-09
---

# Stock & Inventory Ledger Templates

## 1. Overview
Template dan generator dokumen buku besar stok inventaris barang untuk toko dan manajemen aset fisik dengan pelacakan SKU, mutasi masuk/keluar, dan status restock.

## 2. Key Capabilities (Backlog)
- **SKU Metadata Schema**: Struktur frontmatter khusus untuk kode barang, stok awal, stok minimum, dan vendor.
- **Ledger Row Parser**: Menghitung sisa stok terkini berdasarkan mutasi tabel di dalam dokumen.
- **Low-Stock Alert Flag**: Menandai catatan barang yang mencapai batas stok minimum secara visual di dalam Virtual Tree.

## 3. Integration Points
- Terintegrasi dengan Virtual Folder Tree (Group by SKU status).

## 4. Status: -1 (Backlog)
Fitur berada dalam backlog antrean modul manajemen barang.
