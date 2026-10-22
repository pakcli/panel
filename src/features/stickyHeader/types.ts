export interface StickyHeadingItem {
  heading: string;
  level: number;
  line: number;
  el?: HTMLElement;
}

export interface StickyHeaderSettings {
  enableCascadingStickyHeaders: boolean;
  stickyHeaderMaxDepth: number;
}

export const DEFAULT_STICKY_HEADER_SETTINGS: StickyHeaderSettings = {
  enableCascadingStickyHeaders: true,
  stickyHeaderMaxDepth: 3,
};
