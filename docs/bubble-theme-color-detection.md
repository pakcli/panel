# 📌 Master Brief: Bubble Graph Theme-Aware Dynamic Color Override (`pakcli-panel`)

> **Feature Status**: `1` (Implemented & Verified)  
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
    textFaint: string;
    textAccent: string;
    bgPrimary: string;
    bgSecondary: string;
    border: string;
    // Theme Text Glow Detection
    hasTextGlow: boolean;
    textGlowColor: string;
    textGlowBlur: number;
    // Theme Container / Surface Styling for Bubbles
    containerBg: string;
    containerBorder: string;
}
```

### C. Strict Color Priority Hierarchy & Element Mapping
1. **HIGHEST PRIORITY: Captain Folder Colors**
   - Jika `useCaptainColors` aktif dan folder memiliki aturan Captain Folder Rules (atau Relationship Tier), warna Captain **TIDAK BOLEH** di-override oleh tema. Pilihan warna folder captain selalu mendikte secara absolut.
2. **THEME COLOR & GLOW OVERRIDE (Secondary Priority)**:
   - Jika `bubbleThemeColorOverride` = `true`:
     - **THEME TEXT -> NODE**:
       - Base node color menyerap warna theme text (`palette.textNormal` / `palette.accent`) jika tidak memiliki captain rule.
       - **Text Glow -> Node Glow**: Jika tema menggunakan text glow / text-shadow / neon luminous styling (`text-shadow`, `--text-glow`, `--glow-color`), node otomatis menyerap efek pendaran cahaya (glow aura) menggunakan `ctx.shadowColor` dan `ctx.shadowBlur` yang identik di kanvas.
     - **CONTAINER -> BUBBLE**:
       - Bubble hull background dan contour border menyerap container surface styling (`palette.containerBg` dan `palette.containerBorder`) untuk cluster yang tidak diatur oleh captain rule.
     - **TEXT LABELS & CONTROLS**:
       - Teks label node menggunakan `palette.textNormal`, teks sekunder menggunakan `palette.textMuted`.
       - Folder tab badges menggunakan `palette.bgSecondary` dan border `palette.containerBorder`.
       - Quick toggle buttons dan UI controls disinkronkan dengan palet tema.
3. **FALLBACK / DEFAULT (Lowest Priority)**:
   - Jika `bubbleThemeColorOverride` = `false` dan tidak ada captain rule, node dan cluster menggunakan `getDefaultNodeColor(app)`.

---

## 3. Implementation Plan & Files

| File | Status | Keterangan |
| :--- | :---: | :--- |
| `panel/docs/bubble-theme-color-detection.md` | ✅ Done | Brief dokumentasi fitur (Status 0 -> 1) |
| `panel/src/settings.ts` | ✅ Done | Menambahkan `bubbleThemeColorOverride: boolean` ke `BubbleGraphSettings` |
| `panel/src/features/bubblegraph/themeColorDetector.ts` | ✅ Done | Helper ekstraksi palet CSS tema aktif dari DOM & Obsidian config |
| `panel/src/features/bubblegraph/graphBuilder.ts` | ✅ Done | Integrasi `themePalette` override saat `bubbleThemeColorOverride` aktif |
| `panel/src/features/bubblegraph/canvasRenderer.ts` | ✅ Done | Render label teks, badge folder tab, dan hull dengan warna tema |
| `panel/src/features/bubblegraph/bubbleGraphView.ts` | ✅ Done | UI toggle button pada control bar & event listener pergantian tema |

---

## 4. Acceptance Criteria Checklist

- [x] Status 0 brief dibuat dan di-commit ke Git repo (`d257a54`).
- [x] Implementasi ekstraksi palet tema (`themeColorDetector.ts`).
- [x] Toggle `bubbleThemeColorOverride` tersedia di pengaturan dan toolbar view.
- [x] Teks dan node berubah warna sesuai tema saat opsi aktif.
- [x] Mekanik pewarnaan saat opsi mati tetap 100% normal seperti semula.
- [x] Build `npm run build` sukses, 0 error, bundle 4.55 MB (< 5.0 MB limit).
- [x] Status brief di-update ke 1 dan di-commit.
