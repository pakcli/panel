export type ZoomWidthMode = 'keep-margins' | 'fill-width';

export interface ZoomSettings {
  enablePaneZoom: boolean;
  zoomStep: number;                // Zoom increment per scroll tick (e.g. 0.1 = 10%)
  minZoom: number;                 // Minimum zoom limit (e.g. 0.5 = 50%)
  maxZoom: number;                 // Maximum zoom limit (e.g. 2.5 = 250%)
  defaultWidthMode: ZoomWidthMode; // 'keep-margins' (preserve side gutters) vs 'fill-width' (edge-to-edge)
  showZoomInStatusBar: boolean;
}

export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = {
  enablePaneZoom: true,
  zoomStep: 0.1,
  minZoom: 0.5,
  maxZoom: 2.5,
  defaultWidthMode: 'keep-margins',
  showZoomInStatusBar: true,
};
