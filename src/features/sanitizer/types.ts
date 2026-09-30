import { TFile } from 'obsidian';

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
    masterEnabled: boolean;
    enableClipboardSanitizer: boolean;
    enableVirtualPreviewMasking: boolean;
    rules: StringSanitizerRule[];
}

export interface ReplacementMatchItem {
    id: string;
    file: TFile;
    filePath: string;
    fileName: string;
    lineIndex: number;
    lineNumber: number;
    originalLine: string;
    replacedLine: string;
    ruleLabel: string;
    selected: boolean;
}

export const DEFAULT_STRING_SANITIZER_SETTINGS: StringSanitizerSettings = {
    masterEnabled: true,
    enableClipboardSanitizer: true,
    enableVirtualPreviewMasking: false,
    rules: [
        {
            id: 'rule_default_user_fsl',
            label: 'Sanitize Local User fsl -> fulan',
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
