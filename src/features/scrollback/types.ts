export interface ScrollbackAnchor {
  path: string;
  name: string;
  isFolder: boolean;
  timestamp: number;
}

export interface ScrollbackSettings {
  enableScrollbackRibbon: boolean;
  scrollbackHighlightDurationMs: number;
}

export const DEFAULT_SCROLLBACK_SETTINGS: ScrollbackSettings = {
  enableScrollbackRibbon: true,
  scrollbackHighlightDurationMs: 1600,
};
