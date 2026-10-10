import { TFile } from 'obsidian';

export type ClipboardSanitizerTriggerMode = 'none' | 'codeblock-btn-only' | 'all';

export interface StringSanitizerRule {
    id: string;
    label: string;                 // e.g. "Mask Username fsl -> fulan"
    searchPattern: string;         // e.g. "C:\\Users\\fsl"
    replacementText: string;       // e.g. "C:\\Users\\fulan"
    isRegex: boolean;              // true = regex, false = plain text
    caseSensitive: boolean;        // true / false
    enabled: boolean;              // toggle aktif/nonaktif per rule
    affectClipboard?: boolean;     // legacy boolean compatibility
    clipboardTrigger?: ClipboardSanitizerTriggerMode; // 'none' | 'codeblock-btn-only' | 'all'
    affectVirtualEditor: boolean;  // menyamarkan tampilan di editor
}

export interface StringSanitizerSettings {
    masterEnabled: boolean;
    enableClipboardSanitizer?: boolean; // legacy boolean compatibility
    clipboardSanitizerMode?: ClipboardSanitizerTriggerMode; // 'none' | 'codeblock-btn-only' | 'all'
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
    clipboardSanitizerMode: 'codeblock-btn-only',
    enableVirtualPreviewMasking: true,
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
            clipboardTrigger: 'codeblock-btn-only',
            affectVirtualEditor: true
        }
    ]
};
