---
id: ascii-unicode-flowchart-canvas
title: ASCII & Unicode Flowchart Canvas Engine
plugin: panel
status: 0
tags:
  - pakcli
  - write
  - asciidraw
  - diagram
  - feature
created: 2026-10-09
---

# ASCII & Unicode Flowchart Canvas Engine

## 1. Overview
Kanvas gambar berbasis teks dan grid karakter ASCII/Unicode monospaced untuk merancang diagram alur, wireframe retro, kotak logika, dan panah koneksi langsung yang dapat disisipkan rapi ke dalam blok kode markdown.

## 2. Key Capabilities (Planned)
- **Monospace Grid Canvas**: Alat gambar kotak, garis, panah, teks label, dan freehand menggunakan karakter ASCII (`+--+`, `|`, `-->`) atau Unicode Box-Drawing (`â”Œâ”€â”€â”`, `â”‚`, `â–º`).
- **Layers & History**: Dukungan multi-layer kanvas dan riwayat undo/redo berbasis patch karakter.
- **Embedded Codeblock Renderer**: Render langsung blok kode ````asciidraw ... ```` dengan tombol salin dan mode fullscreen imersif.

## 3. Integration Points
- Diadaptasi dari modul `asciidraw` yang sebelumnya diujicobakan pada panel, kini menjadi bagian inti tool penulisan visual di `pakcli-write`.

## 4. Status: 0 (Planned / In Progress)
Komponen core engine `AnimationEngine.ts`, `LayerManager.ts`, dan modal telah selesai prototipenya; integrasi ke plugin `write` sedang dijadwalkan.
