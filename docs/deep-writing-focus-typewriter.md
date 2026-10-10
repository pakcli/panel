---
id: deep-writing-focus-typewriter
title: Deep Writing Suite & Typewriter Scrolling
plugin: panel
status: 0
tags:
  - pakcli
  - write
  - typewriter
  - focus
  - feature
created: 2026-10-09
---

# Deep Writing Suite & Typewriter Scrolling

## 1. Overview
Suite alat bantu konsentrasi menulis tingkat lanjut yang mencakup typewriter vertical centering, mode layar bersih (Zen/Distraction-Free), dan indikator kecepatan menulis real-time.

## 2. Key Capabilities (Planned)
- **Typewriter Vertical Centering**: Mengunci baris kursor pengetikan aktif selalu berada di tengah layar editor untuk ergonomi leher dan pandangan mata saat menulis naskah panjang.
- **Zen Mode Overlay**: Menyamarkan sidebar, ribbon, dan bilah status secara cerdas saat pengguna mengetik paragraf secara intensif.
- **Live Speedometer & Goal Tracker**: Widget kecil di sudut editor yang menampilkan jumlah kata, target harian progress bar, dan estimasi waktu baca (*Estimated Reading Time*).
- **Sticky Section Outline**: Ringkasan heading dokumen yang mengambang untuk navigasi bab instan.

## 3. Integration Points
- Terintegrasi dengan ekstensi CodeMirror 6 pada active markdown editor leaf.

## 4. Status: 0 (Planned / In Progress)
Konsep desain dan event listener prototype telah dirancang; sedang diintegrasikan ke lifecycle editor `pakcli-write`.
