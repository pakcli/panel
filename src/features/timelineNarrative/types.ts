export type TimelineViewMode = 'raw' | 'outline' | 'timeline-view' | 'timeline-edit';

export type OutcomeType = 'good' | 'bad' | 'neutral' | 'none';

export interface WikilinkTarget {
  raw: string;
  path: string;
  alias?: string;
}

export interface TimelineNode {
  id: string;
  lineIndex: number;
  depth: number;
  rawText: string;
  timestamp?: string;       // e.g. "2027-03-01 09:40"
  rawTimestamp?: string;    // e.g. "_2027-03-01_09-40_"
  label: string;            // Clean label text
  wikilink?: WikilinkTarget;
  jumpTarget?: string;      // Target node label or wikilink
  jumpTargets?: string[];   // All jump targets if multiple or merged
  note?: string;            // Plain text note or wikilink note
  noteWikilink?: WikilinkTarget;
  children: TimelineNode[];
  parent?: TimelineNode;
  isJumpTarget?: boolean;
  
  // Frontmatter extracted metadata (from linked note)
  outcome?: OutcomeType;
  imageUrl?: string;
}

export interface TimelineTree {
  roots: TimelineNode[];
  allNodes: Map<string, TimelineNode>; // id -> node
  nodesByLabel: Map<string, TimelineNode[]>; // label -> nodes
  rawLines: string[];
}

export interface NodeLayout {
  node: TimelineNode;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  row: number;
}

export interface ConnectorPath {
  fromNodeId: string;
  toNodeId: string;
  d: string; // SVG path string with Detroit 45° chamfers or orthogonal curves
  isJump: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface DiagramLayout {
  nodes: NodeLayout[];
  connectors: ConnectorPath[];
  totalWidth: number;
  totalHeight: number;
}

export type WikilinkDisplaySetting = 'both' | 'image' | 'text';
