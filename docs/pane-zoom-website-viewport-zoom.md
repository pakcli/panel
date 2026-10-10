---
id: pane-zoom-website-viewport-zoom
title: Pane Zoom Engine & Website Viewport Zoom
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - zoom
  - webview
  - feature
created: 2026-10-09
---

# Pane Zoom Engine & Website Viewport Zoom

## 1. Overview
Mesin penskalaan zoom per-panel (*pane-level zoom*) yang mendukung kanvas Markdown, editor teks, dan embedding halaman website eksternal (`<webview>` dan `<iframe>`) dengan perutean bridge wheel pointer dan penyimpanan state zoom persisten per panel.

## 2. Key Capabilities
- **Per-Pane Independent Zoom**: Penskalaan zoom kustom (25% - 500%) yang hanya mempengaruhi panel yang sedang aktif tanpa merubah zoom global Obsidian.
- **Embedded Webview & IFrame Guest Bridge**: Meneruskan pintasan `Ctrl + Wheel` ke dalam native Electron webview melalui IPC guest event capture script dan CSS pointer-events passthrough saat tombol Ctrl ditekan.
- **Persistent Leaf Zoom States**: Menyimpan faktor zoom setiap panel ke artefak `zoom-states.json` dan memulihkannya secara otomatis saat layout Obsidian dimuat ulang.
- **Status Bar Zoom Pill**: Menampilkan persentase zoom saat ini dan mode lebar layar (`â†” Full` vs `â†” Margins` vs `ðŸŒ Web`) dengan tombol anti-layout jitter.

## 3. Integration Points
- Terintegrasi di `src/features/zoom/ZoomManager.ts` dan status bar item Obsidian.

## 4. Status: 1 (Implemented)
Fitur sudah diimplementasikan penuh dan aktif di `pakcli-panel`.
