---
id: folder-auto-assign-rules-engine
title: Folder Auto-Assign Rules Engine
plugin: panel
status: -1
tags:
  - pakcli
  - write
  - rules
  - autoassign
  - feature
created: 2026-10-09
---

# Folder Auto-Assign Rules Engine

## 1. Overview
Mesin aturan penempatan otomatis (*rule engine*) yang secara otomatis mengarahkan catatan baru ke folder virtual atau fisik tertentu berdasarkan isi tag, kata kunci di judul, atau properti frontmatter saat catatan dibuat.

## 2. Key Capabilities (Backlog)
- **Declarative Rule Builder**: Konfigurasi kondisi IF-THEN sederhana (misal: *Jika tag `#invoice` -> tetapkan ke folder `Keuangan/Invoices/`*).
- **Silent Background Routing**: Memindahkan atau mengelompokkan catatan secara instan tanpa mengganggu pengetikan user.
- **Batch Evaluation**: Kemampuan mengevaluasi seluruh catatan di Inbox untuk disortir otomatis berdasarkan aturan yang sudah ada.

## 3. Integration Points
- Terintegrasi dengan event `vault.on('create')` dan Virtual Folder Tree.

## 4. Status: -1 (Backlog)
Fitur berada dalam backlog antrean otomatisasi organisasi dokumen.
