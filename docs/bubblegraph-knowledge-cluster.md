---
id: bubblegraph-knowledge-cluster
title: Bubble Graph Knowledge Cluster & Visual Timeline
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - bubblegraph
  - feature
created: 2026-10-09
---

# Bubble Graph Knowledge Cluster & Visual Timeline

## 1. Overview
Bubble Graph adalah visualisasi graph interaktif berbasis D3.js force-directed physics yang mengelompokkan note dan aset vault ke dalam bubble klaster dinamis dengan integrasi timeline playback, auto-tracking zoom, dan procedural sound effects.

## 2. Key Capabilities
- **Force-Directed Physics Simulation**: Mengelompokkan node berdasarkan relasi folder, tag, dan frontmatter properties.
- **Timelapse & Historical Playback**: Memutar kronologi pembuatan dan modifikasi catatan dari waktu ke waktu.
- **Auto-Tracking Modes**: Mode `Fit & Center` (zoom dan sentralisasi otomatis) dan `Center` (sentralisasi posisi tanpa merubah level zoom).
- **Spawning Callouts**: Menampilkan overlay teks cuplikan catatan yang sedang di-spawn pada node.
- **Tactile Sound Effects**: Sintesis audio prosedural Web Audio API saat tabrakan node dan seleksi klaster.

## 3. Integration Points
- Terintegrasi dengan `bubbleGraphView.ts`, `audioEngine.ts`, dan pengaturan `bubbleTimelapseDurationMode`.
- Mendukung snapshot cover gambar note dan relasi multi-scope.

## 4. Status: 1 (Implemented)
Fitur sudah sepenuhnya diimplementasikan, stabil, dan terpasang di rilis produksi `pakcli-panel`.
