/**
 * types.ts
 * Type definitions for panel-tree codeblock renderer
 */

export interface TreeGridColumn {
    id: number;
    title: string;
    width: number;
    minWidth: number;
}

export interface TreeGridNode {
    id: string;
    name: string;
    rawName: string;
    rawLine?: string;
    depth: number;
    isDirectory: boolean;
    extension?: string;
    columns: string[]; // up to 10 columns
    children: TreeGridNode[];
    parent?: TreeGridNode;
    isExpanded: boolean;
}

export interface ParsedTreeGrid {
    rootNodes: TreeGridNode[];
    totalColumns: number;
    columnTitles: string[];
}
