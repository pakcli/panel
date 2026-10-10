---
id: persistent-audio-sfx-engine
title: Persistent Global Audio Player Dock & Tactile SFX Engine
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - audio
  - sfx
  - feature
created: 2026-10-09
---

# Persistent Global Audio Player Dock & Tactile SFX Engine

## 1. Overview
Mesin audio ganda (`audioEngine.ts` & `playlistManager.ts`) yang menyediakan pemutaran musik latar vault berkelanjutan dan synthesizer SFX prosedural Web Audio API tanpa dependensi file eksternal untuk feedback UI taktil di seluruh Obsidian.

## 2. Key Capabilities
- **Background Music Player**: Memindai file audio vault (`.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`), mendukung mode shuffle, loop 1, loop all, dan linear queue.
- **Persistent State Artifact**: Status pemutaran (trek aktif, volume, posisi detik, queue) disimpan ke file artefak JSON dan dipulihkan secara mulus saat reload vault.
- **Dockable & Floating UI**: Dapat dibuka sebagai popup mengambang 50%, di-dock ke tab editor/sidebar, atau diminimalkan ke status bar.
- **Zero-Jitter Mute & Volume Controls**: Tombol Mute/Unmute dengan ukuran terkunci (`min-width: 82px`), slider independen untuk Master, Music, dan SFX.
- **Tactile Procedural SFX**: Click snaps, mechanical chimes, dan toggle feedback yang disintesis secara matematis dengan latensi 0ms.

## 3. Integration Points
- Akses cepat via ribbon icon `headphones` dan status bar pill.
- Terhubung dengan aksi klik tombol dan node spawn di Bubble Graph.

## 4. Status: 1 (Implemented)
Fitur sudah diimplementasikan penuh dan aktif di produksi `pakcli-panel`.
