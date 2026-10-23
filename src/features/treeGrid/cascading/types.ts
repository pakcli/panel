import { TreeGridNode } from '../types';

export interface TreeCascadingSettings {
    enableTreeCascading: boolean;
    treeCascadingStyle: 'auto' | 'breadcrumb' | 'cascading';
    treeCascadingMaxDepth: number;
    treeCascadingShowBadges: boolean;
    treeCascadingShowNoteBadge?: boolean;
    treeCascadingPostItTheme?: 'sticky-yellow' | 'subtle-badge' | 'monospace-tag';
    treeNoteSpacing?: string;
}

export const DEFAULT_TREE_CASCADING_SETTINGS: TreeCascadingSettings = {
    enableTreeCascading: true,
    treeCascadingStyle: 'auto',
    treeCascadingMaxDepth: 12,
    treeCascadingShowBadges: true,
    treeCascadingShowNoteBadge: true,
    treeCascadingPostItTheme: 'sticky-yellow',
    treeNoteSpacing: '1',
};

export interface TreeCrumbItem {
    name: string;
    node: TreeGridNode;
    lineNo: number;
    depth: number;
    isFolder: boolean;
}
