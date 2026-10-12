# 📌 Master Brief: Bubble Graph Theme-Aware Dynamic Color Override (`pakcli-panel`)

> **Feature Status**: `0` (Draft / Pending Implementation)  
> **Target Module**: `pakcli-panel` (`panel`)  
> **Platform**: Obsidian Desktop & Mobile (`obsidian` API / CSSOM)  
> **Date**: 2026-10-12  

---

## 1. Objective & Problem Statement

### The Problem
Pengguna menginginkan sistem deteksi warna tema aktif Obsidian pada **Bubble Graph View**:
- Saat ini warna bubble dan node menggunakan default accent color atau captain folder rules.
- Ketika pengguna mengganti tema Obsidian (misalnya tema kustom, snippet CSS, atau tema terang/gelap), elemen teks, bubble, node, folder tab badge, dan button kontrol di Bubble Graph tidak otomatis menyerap palet warna yang di-override oleh tema tersebut.
- Pengguna meminta:
  1. Opsi/toggle deteksi warna tema aktif.
  2. Jika opsi aktif: mendeteksi theme yang dipakai dan melakukan override ke seluruh warna TEXT, button/tab, bubble, dan node menggunakan warna dari tema tersebut.
  3. Jika opsi tidak aktif (atau default): tetap mempertahankan mekanik pewarnaan yang ada saat ini (default node color, captain folder colors, dsb).

---

## 2. Technical Architecture & Color Detection Pipeline

### A. Theme Detection & Extraction (`ThemePalette`)
Obsidian mengekspos variabel CSS di `:root` dan `body`:
1. **Accent / Primary Color**:
   - `--interactive-accent`, `--color-accent`, `--text-accent`
2. **Text Normal & Muted**:
   - `--text-normal`, `--text-muted`, `--text-faint`
3. **Backgrounds & Surfaces**:
   - `--background-primary`, `--background-secondary`, `--background-modifier-border`
4. **Theme Info**:
   - `(app as any).customCss?.theme` atau `(app as any).vault?.getConfig?.('cssTheme')`
   - Dark/Light mode: `document.body.classList.contains('theme-dark')`

### B. Dynamic Palette Structure
```typescript
export interface BubbleThemePalette {
    isDark: boolean;
    themeName: string;
    accent: string;
    textNormal: string;
    textMuted: string;
    bgPrimary: string;
    bgSecondary: string;
    border: string;
}
```

### C. Color Override Rules
Ketika `bubbleThemeColorOverride` = `true`:
- **Nodes**: node yang tidak memiliki warna tier kustom / captain rules akan menggunakan `palette.accent` (atau turunan luminous theme).
- **Bubble Hull & Outer Contour**: menggunakan warna aksen tema dengan opacity dinamis.
- **Node Labels & Text**: teks label node menggunakan `palette.textNormal`, teks sekunder menggunakan `palette.textMuted`.
- **Folder Tab Badges**: background pill menggunakan `palette.bgSecondary`, border menggunakan `palette.accent` / `palette.border`, teks menggunakan `palette.textNormal`.
- **Button & Control Bar**: elemen quick toggle dan tombol bar dapat disinkronkan dengan warna teks dan aksen tema.
- **Fallback**: Jika `bubbleThemeColorOverride` = `false`, seluruh mekanik pewarnaan tetap sama persis seperti saat ini tanpa perubahan.

---

## 3. Implementation Plan & Files

| File | Status | Keterangan |
| :--- | :---: | :--- |
| `panel/docs/bubble-theme-color-detection.md` | ⏳ Pending | Brief dokumentasi fitur (Status 0 -> 1) |
| `panel/src/settings.ts` | ⏳ Pending | Menambahkan `bubbleThemeColorOverride: boolean` ke `BubbleGraphSettings` |
| `panel/src/features/bubblegraph/themeColorDetector.ts` | ⏳ Pending | Helper ekstraksi palet CSS tema aktif dari DOM & Obsidian config |
| `panel/src/features/bubblegraph/graphBuilder.ts` | ⏳ Pending | Integrasi `themePalette` override saat `bubbleThemeColorOverride` aktif |
| `panel/src/features/bubblegraph/canvasRenderer.ts` | ⏳ Pending | Render label teks, badge folder tab, dan hull dengan warna tema |
| `panel/src/features/bubblegraph/bubbleGraphView.ts` | ⏳ Pending | UI toggle button pada control bar & event listener pergantian tema |

---

## 4. Acceptance Criteria Checklist

- [ ] Status 0 brief dibuat dan di-commit ke Git repo.
- [ ] Implementasi ekstraksi palet tema (`themeColorDetector.ts`).
- [ ] Toggle `bubbleThemeColorOverride` tersedia di pengaturan dan toolbar view.
- [ ] Teks dan node berubah warna sesuai tema saat opsi aktif.
- [ ] Mekanik pewarnaan saat opsi mati tetap 100% normal seperti semula.
- [ ] Build `npm run build` sukses, 0 error, bundle < 5.0 MB.
- [ ] Status brief di-update ke 1 dan di-commit.
