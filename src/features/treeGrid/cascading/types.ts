import { TreeGridNode } from '../types';

export interface TreeCascadingSettings {
    enableTreeCascading: boolean;
    treeCascadingStyle: 'auto' | 'breadcrumb' | 'cascading';
    treeCascadingMaxDepth: number;
    treeCascadingShowBadges: boolean;
}

export const DEFAULT_TREE_CASCADING_SETTINGS: TreeCascadingSettings = {
    enableTreeCascading: true,
    treeCascadingStyle: 'auto',
    treeCascadingMaxDepth: 3,
    treeCascadingShowBadges: true,
};

export interface TreeCrumbItem {
    name: string;
    node: TreeGridNode;
    lineNo: number;
    depth: number;
    isFolder: boolean;
}
