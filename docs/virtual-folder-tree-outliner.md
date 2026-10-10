---
id: virtual-folder-tree-outliner
title: Virtual Folder Tree & Spec Outliner Engine
plugin: write
status: 0
tags:
  - pakcli
  - write
  - virtualtree
  - outliner
  - feature
created: 2026-10-09
---

# Virtual Folder Tree & Spec Outliner Engine

## 1. Overview
Mesin representasi hirarki dokumen virtual independen yang melepaskan struktur pengelompokan note dari batasan folder fisik OS, dilengkapi inline property editing matrix dan scroll-lock protection.

## 2. Key Capabilities (Planned)
- **Multi-Dimensional Virtual Grouping**: Mengelompokkan catatan secara instan berdasarkan nilai property frontmatter (misal: group by `status`, `tier`), nested tag (`#proj/game`), formula kustom, atau susunan folder fisik.
- **Dynamic Multi-Parenting**: Menampilkan satu catatan di berbagai virtual folder sekaligus tanpa menduplikasi file di hard drive.
- **Inline Spec Property Matrix**: Mengedit atribut YAML frontmatter langsung di bawah baris judul tree tanpa perlu membuka tab file baru.
- **LockView Mode**: Tombol toggle `🔒 LockView: ON / OFF` dengan lebar terkunci (`min-width: 120px`) untuk mencegah loncatan posisi scroll viewport saat mengetik.
- **Materialize to Physical Folders**: Opsi sekali klik untuk menyamakan struktur folder virtual menjadi folder fisik di disk secara aman.

## 3. Integration Points
- Komponen inti dari plugin `pakcli-write`, mengambil alih modul `SpecTreeBasesView.ts` dan `tree.css` dari modul panel lama.

## 4. Status: 0 (Planned / In Progress)
Master brief arsitektur dan spesifikasi teknis telah rampung; sedang disiapkan untuk pemindahan ke repositori `pakcli-write`.
