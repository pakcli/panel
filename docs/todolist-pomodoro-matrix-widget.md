---
id: todolist-pomodoro-matrix-widget
title: Todo List & Pomodoro Matrix Widget
plugin: panel
status: 1
tags:
  - pakcli
  - panel
  - todolist
  - pomodoro
  - feature
created: 2026-10-09
---

# Todo List & Pomodoro Matrix Widget

## 1. Overview
Sidebar task aggregator dan timer fokus Pomodoro terintegrasi yang memindai checklist tugas dari seluruh file markdown vault berdasarkan time-range syntax dan deadline terdekat.

## 2. Key Capabilities
- **Universal Vault Task Scanner**: Parsing baris tugas markdown dengan rentang waktu presisi (`hh-mm, dd-mm-yyyy -> hh-mm, dd-mm-yyyy`).
- **Dynamic Scope & Sorting**: Opsi filter folder spesifik atau seluruh vault dengan pengurutan deadline terdekat (`dateend closest`).
- **Split-View Pomodoro Widget**: Timer interval fokus, istirahat pendek, dan istirahat panjang dengan ring SVG animasi dan tombol anti-shift (`min-width: 95px`).
- **Single-Click Focus Assignment**: Mengklik icon Play pada tugas langsung menyematkan tugas tersebut ke dalam Pomodoro widget aktif.

## 3. Integration Points
- Terintegrasi di `src/features/todolist/`, `PomodoroWidget.ts`, dan view `v05_todolist_view`.

## 4. Status: 1 (Implemented)
Fitur sudah diimplementasikan penuh dan aktif di `pakcli-panel`.
