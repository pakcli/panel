# Brief Konsep & Desain: `v06_string_sanitizer` (Virtual Find & Replace & Vault Sanitizer)

Dokumen arsitektur, filosofi desain, dan spesifikasi teknis untuk implementasi fitur **Virtual String Masking, Codeblock Clipboard Sanitizer, serta Safe Batch Raw-File Replacer dengan Pre-flight Diff Table** di PakCLI Obsidian Plugin.

---

## 1. Latar Belakang & Filosofi Inti (Core Philosophy)

### Masalah Utama
1. **Kebocoran Identitas & Path Sensitif**:
   Saat berbagi dokumentasi, presentasi, atau meng-copy kode script dari codeblock (misal PowerShell/Bash), path lokal nyata seperti `C:\Users\fsl\...`, API key, internal IP, atau username pribadi ikut terbawa ke clipboard.
2. **Bahaya Fitur Find & Replace Massal Standar**:
   Fitur Find & Replace bawaan sering kali langsung menimpa file fisik tanpa memberikan ringkasan (*pre-flight brief*) atau tabel preview yang jelas mengenai baris mana saja yang akan berubah. Sekali salah regex/string, banyak catatan bisa rusak.

### Solusi PakCLI: `v06_string_sanitizer`
1. **Virtual Overlay (Live Preview)**:
   Menyamarkan string secara virtual di tampilan editor tanpa mengubah file fisik di disk.
2. **Codeblock Clipboard Auto-Sanitizer**:
   Terintegrasi langsung ke tombol copy codeblock (`scaler.ts`): saat kode disalin, string sensitif otomatis diganti sebelum mendarat di clipboard pengguna.
3. **Safe Raw File Replacer (Active Note & All Notes)**:
   Kemampuan menulis perubahan ke file fisik Markdown dengan **Pre-flight Audit Brief & Interactive Impact Table** sebelum dieksekusi.

---

## 2. Aksi Eksekusi & Mekanisme Verifikasi (Pre-Flight Table Modal)

Terdapat 2 aksi eksekusi penulisan fisik ke file raw:
1. **Action 1: Apply to Active Note** (Hanya file yang sedang aktif dibuka).
2. **Action 2: Apply to All Notes** (Pindai dan ubah seluruh file Markdown di vault).

### 🛡️ Pre-Flight Verification Brief & Table Modal
Sebelum file fisik di disk disentuh, sebuah modal dialog interaktif akan muncul menampilkan:
1. **Summary Cards**:
   - Total files impacted (misal: `3 files`)
   - Total string replacements found (misal: `14 occurrences`)
   - Active rules matched (misal: `Rule: Mask C:\Users\fsl -> C:\Users\fulan`)
2. **Interactive Change Table**:
   | Select | File Name / Path | Line | Original String (Before) | Replaced String (After) | Matched Rule |
   |:---:|:---|:---:|:---|:---|:---|
   | `[x]` | `Scripts/Deploy.md` | `12` | `Remove-Item "C:\Users\fsl\..."` | `Remove-Item "C:\Users\fulan\..."` | `fsl -> fulan` |
   | `[x]` | `Scripts/Deploy.md` | `28` | `cd C:\Users\fsl\Projects` | `cd C:\Users\fulan\Projects` | `fsl -> fulan` |
   | `[x]` | `Daily/2026-09-30.md` | `5` | `Backup path: C:\Users\fsl\bak` | `Backup path: C:\Users\fulan\bak` | `fsl -> fulan` |
3. **Safety Controls**:
   - Checkbox per baris & Tombol `Select All / Deselect All`.
   - Tombol **`[ 🚀 Confirm & Apply Changes ]`** (dengan konfirmasi aman).
   - Tombol **`[ ✖ Cancel ]`** untuk membatalkan tanpa mengubah apa pun di vault.

---

## 3. Model Data & Skema Pengaturan (`settings.ts`)

```typescript
export interface StringSanitizerRule {
    id: string;
    label: string;                 // e.g. "Mask Username fsl -> fulan"
    searchPattern: string;         // e.g. "C:\\Users\\fsl"
    replacementText: string;       // e.g. "C:\\Users\\fulan"
    isRegex: boolean;              // true = regex, false = plain text
    caseSensitive: boolean;        // true / false
    enabled: boolean;              // toggle aktif/nonaktif per rule
    affectClipboard: boolean;      // otomatis aktif saat copy codeblock
    affectVirtualEditor: boolean;  // menyamarkan tampilan di editor
}

export interface StringSanitizerSettings {
    masterEnabled: boolean;               // Master switch on/off
    enableVirtualPreviewMasking: boolean; // Masking tampilan di Live Preview
    enableClipboardSanitizer: boolean;    // Masking hasil copy codeblock
    rules: StringSanitizerRule[];
}

export const DEFAULT_STRING_SANITIZER_SETTINGS: StringSanitizerSettings = {
    masterEnabled: true,
    enableVirtualPreviewMasking: false,
    enableClipboardSanitizer: true,
    rules: [
        {
            id: 'rule_default_user',
            label: 'Sanitize User Path',
            searchPattern: 'C:\\Users\\fsl',
            replacementText: 'C:\\Users\\fulan',
            isRegex: false,
            caseSensitive: false,
            enabled: true,
            affectClipboard: true,
            affectVirtualEditor: false
        }
    ]
};
```

---

## 4. Alur Integrasi Codeblock Clipboard (`scaler.ts`)

```
[User Clicks Copy Button on Codeblock]
                  │
                  ▼
[scaler.ts: handleCodeblockCopyClick]
                  │
                  ▼
[Check: Is String Sanitizer Master Enabled?]
      ├── NO  ──► Salin kode asli tanpa perubahan
      └── YES ──► Filter baris kode melalui rules dengan `affectClipboard === true`
                  │
                  ▼
[Tulis ke OS Clipboard: String yang sudah disanitasi ("C:\Users\fulan")]
                  │
                  ▼
[Obsidian Notice: "📋 Copied & Sanitized (1 rule applied)"]
```

---

## 5. UI Settings Tab (Didedikasikan di Bawah Ribbon Settings)

Section terdaftar di `MasterDetailSettingsTab`:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 🛡️ String Sanitizer & Virtual Replace                                  │
├────────────────────────────────────────────────────────────────────────┤
│ [Toggle] Master Sanitizer Engine (Active)                              │
│ [Toggle] Auto-Sanitize Codeblock Clipboard Copies                     │
│ [Toggle] Enable Virtual Masking in Live Preview Editor                 │
├────────────────────────────────────────────────────────────────────────┤
│ 📋 REPLACEMENT RULES                                      [➕ Add Rule] │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ [✓] Label: Sanitize User Path                                      │ │
│ │     Search : "C:\Users\fsl"                                        │ │
│ │     Replace: "C:\Users\fulan"                                      │ │
│ │     [Plain Text] [Case-Insensitive] [Clip: ON] [Virtual: OFF]      │ │
│ │     [🧪 Test]  [✏️ Edit]  [🗑️ Delete]                              │ │
│ └────────────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────┤
│ ⚡ BATCH ACTIONS (WITH PRE-FLIGHT AUDIT TABLE)                         │
│ [ 📄 Review & Apply to Active Note ]                                  │
│ [ 🌐 Review & Apply to Entire Vault ]                                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Rencana Tahapan Implementasi (Implementation Roadmap)

| Tahap | Modul | Deskripsi Pekerjaan |
|---|---|---|
| **Fase 1** | `types.ts` & `settings.ts` | Definisikan interface `StringSanitizerRule`, `StringSanitizerSettings`, dan default rules. |
| **Fase 2** | `SanitizerEngine.ts` | Core engine pemrosesan string (literal & regex replacement, transformer helper). |
| **Fase 3** | `ClipboardHook` di `scaler.ts` | Hubungkan tombol copy codeblock agar otomatis melewati `SanitizerEngine`. |
| **Fase 4** | `PreFlightDiffModal.ts` | Modal tabel interaktif yang memindai active file / seluruh vault, menampilkan tabel before-after dengan checkbox, dan tombol konfirmasi. |
| **Fase 5** | Settings Tab Section | Daftarkan UI manager di `MasterDetailSettingsTab` persis di bawah Ribbon Organizer. |
