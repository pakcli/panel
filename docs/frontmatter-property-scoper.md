---
id: frontmatter-property-scoper
title: Frontmatter Property Scoper & Suggestion Filter
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - frontmatter
  - scoper
  - feature
created: 2026-10-09
---

# Frontmatter Property Scoper & Suggestion Filter

## 1. Overview
Pengontrol auto-suggest cerdas untuk properti frontmatter YAML yang membatasi saran nilai input hanya pada cakupan direktori atau aturan konteks yang relevan.

## 2. Key Capabilities
- **Scoped Suggestion Engine**: Mencegah saran autocomplete frontmatter tercampur baur dengan data tidak relevan dari folder lain di vault.
- **Card-Based Rule Configuration**: Antarmuka konfigurasi kartu di pengaturan panel untuk mengaktifkan/menonaktifkan aturan folder dengan tombol toggle stabil.
- **Quick Scoper Modal**: Modal pintas untuk mengganti cakupan aturan properti tanpa harus masuk ke halaman Settings umum.

## 3. Integration Points
- Terintegrasi di `src/features/frontmatterSuggester/` dan kartu renderer pengaturan.

## 4. Status: 1 (Implemented)
Fitur sudah diimplementasikan penuh dan aktif di `pakcli-panel`.
