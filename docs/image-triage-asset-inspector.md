---
id: image-triage-asset-inspector
title: Image Triage & Asset Inspector (Character Carousel)
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - carousel
  - triage
  - feature
created: 2026-10-09
---

# Image Triage & Asset Inspector (Character Carousel)

## 1. Overview
Antarmuka triage visual dan inspeksi aset berbasis kanvas interaktif dan shader 3D yang memudahkan kurasi gambar karakter, diagram, dan galeri visual dalam vault.

## 2. Key Capabilities
- **Character Carousel View**: Galeri geser filmstrip visual dengan efek shader retro-modern.
- **Image Triage Modal**: Meninjau metadata gambar, dimensi, ukuran file, dan lokasi penggunaan wikitext secara cepat.
- **Batch Asset Curation**: Melakukan filter gambar yang tidak terpakai (orphaned images) dan pengelompokan batch.

## 3. Integration Points
- Terintegrasi dengan `src/features/carousel/` dan shader `character-filmstrip.html`.

## 4. Status: 1 (Implemented)
Fitur sudah diimplementasikan penuh di rilis `pakcli-panel`.
