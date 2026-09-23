import { App, Notice, setIcon, Platform } from 'obsidian';
import type PakCLITablePlugin from '../../main';

export class SidebarManager {
  private app: App;
  private plugin: PakCLITablePlugin;
  private leftPinBtnEl: HTMLElement | null = null;
  private leftSwapBtnEl: HTMLElement | null = null;
  private rightPinBtnEl: HTMLElement | null = null;
  private rightSwapBtnEl: HTMLElement | null = null;
  private onRootClickBound: ((e: MouseEvent) => void) | null = null;
  private onTouchStartBound: ((e: TouchEvent | PointerEvent) => void) | null = null;
  private onKeyDownBound: ((e: KeyboardEvent) => void) | null = null;
  private onResizePointerDownBound: ((e: PointerEvent) => void) | null = null;

  constructor(plugin: PakCLITablePlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  /**
   * Helper using Obsidian's official Platform API to detect tablet or mobile environment.
   */
  public isTablet(): boolean {
    return Platform.isTablet || (Platform.isMobile && window.innerWidth >= 768);
  }

  public isMobile(): boolean {
    return Platform.isMobile;
  }

  public init(): void {
    this.app.workspace.onLayoutReady(() => {
      this.applyLayout();
      this.injectLeftHeaderButtons();
      this.injectRightHeaderButtons();
      this.setupDismissListeners();
      this.setupResizeInterception();
    });

    // Re-apply and re-inject on layout changes (Official Obsidian API)
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.applyLayout();
        this.injectLeftHeaderButtons();
        this.injectRightHeaderButtons();
      })
    );

    // Re-apply and adjust on window/tablet resize or orientation changes (Official Obsidian API)
    this.plugin.registerEvent(
      this.app.workspace.on('resize', () => {
        this.applyLayout();
        this.injectLeftHeaderButtons();
        this.injectRightHeaderButtons();
      })
    );
  }

  public destroy(): void {
    this.removeResizeInterception();
    this.removeDismissListeners();
    this.removeHeaderButtons();
    this.removeClasses();
  }

  /**
   * Applies the classes for Pin/Overlay modes and Left/Right swap.
   * Compatible with Desktop sidedocks and Mobile/Tablet drawers.
   */
  public applyLayout(): void {
    const leftSplit = this.app.workspace.leftSplit;
    const rightSplit = this.app.workspace.rightSplit;
    const workspaceEl = (this.app.workspace as any).containerEl as HTMLElement | null || document.querySelector('.workspace') as HTMLElement | null;

    if (!workspaceEl) return;

    const leftMode = this.plugin.settings.leftSidebarMode || 'pinned';
    const rightMode = this.plugin.settings.rightSidebarMode || 'pinned';
    const isSwapped = Boolean(this.plugin.settings.sidebarsSwapped);

    // Tablet / Mobile class markers
    if (this.isTablet()) {
      workspaceEl.classList.add('pakcli-tablet');
    }

    // 1. Swapped state on workspace container and document body
    workspaceEl.classList.toggle('pakcli-sidebars-swapped', isSwapped);
    document.body.classList.toggle('pakcli-sidebars-swapped', isSwapped);

    // 2. Left Split (File Explorer) overlay vs pinned
    if (leftSplit && leftSplit.containerEl) {
      const isLeftOverlay = leftMode === 'overlay';
      leftSplit.containerEl.classList.toggle('pakcli-sidebar-overlay', isLeftOverlay);
      leftSplit.containerEl.classList.toggle('pakcli-sidebar-left-overlay', isLeftOverlay);
      leftSplit.containerEl.classList.toggle('pakcli-sidebar-left-pinned', !isLeftOverlay);
      workspaceEl.classList.toggle('pakcli-left-overlay-active', isLeftOverlay);
    }

    // 3. Right Split overlay vs pinned
    if (rightSplit && rightSplit.containerEl) {
      const isRightOverlay = rightMode === 'overlay';
      rightSplit.containerEl.classList.toggle('pakcli-sidebar-overlay', isRightOverlay);
      rightSplit.containerEl.classList.toggle('pakcli-sidebar-right-overlay', isRightOverlay);
      rightSplit.containerEl.classList.toggle('pakcli-sidebar-right-pinned', !isRightOverlay);
      workspaceEl.classList.toggle('pakcli-right-overlay-active', isRightOverlay);
    }

    // 4. Update Header Buttons visual states
    this.updateButtonStates();
  }

  /**
   * Toggles Left Sidebar (Explorer) between 'pinned' (docked) and 'overlay' (floating drawer).
   * Uses Obsidian official workspace.leftSplit API.
   */
  public async toggleLeftSidebarMode(): Promise<void> {
    const current = this.plugin.settings.leftSidebarMode || 'pinned';
    const next = current === 'pinned' ? 'overlay' : 'pinned';
    this.plugin.settings.leftSidebarMode = next;
    await this.plugin.saveSettings();

    this.applyLayout();

    const leftSplit = this.app.workspace.leftSplit;
    if (next === 'overlay' && leftSplit && leftSplit.collapsed) {
      leftSplit.expand();
    }

    new Notice(
      next === 'overlay'
        ? 'Left Sidebar (Explorer): Floating Overlay (without affecting content width)'
        : 'Left Sidebar (Explorer): Pinned Docked (with affecting content width)'
    );
  }

  /**
   * Toggles Right Sidebar between 'pinned' and 'overlay'.
   * Uses Obsidian official workspace.rightSplit API.
   */
  public async toggleRightSidebarMode(): Promise<void> {
    const current = this.plugin.settings.rightSidebarMode || 'pinned';
    const next = current === 'pinned' ? 'overlay' : 'pinned';
    this.plugin.settings.rightSidebarMode = next;
    await this.plugin.saveSettings();

    this.applyLayout();

    const rightSplit = this.app.workspace.rightSplit;
    if (next === 'overlay' && rightSplit && rightSplit.collapsed) {
      rightSplit.expand();
    }

    new Notice(
      next === 'overlay'
        ? 'Right Sidebar: Floating Overlay (without affecting content width)'
        : 'Right Sidebar: Pinned Docked (with affecting content width)'
    );
  }

  /**
   * Swaps Left and Right sidebars.
   */
  public async swapSidebars(): Promise<void> {
    const next = !this.plugin.settings.sidebarsSwapped;
    this.plugin.settings.sidebarsSwapped = next;
    await this.plugin.saveSettings();

    this.applyLayout();

    new Notice(
      next
        ? 'Sidebars Swapped: File Explorer on RIGHT, Sidebar on LEFT'
        : 'Sidebars Restored: File Explorer on LEFT, Sidebar on RIGHT'
    );
  }

  /**
   * Opens temporary overlay for either sidebar without affecting content width.
   * Uses Obsidian official workspace split expand() API.
   */
  public openTemporaryOverlay(side: 'left' | 'right'): void {
    const split = side === 'left' ? this.app.workspace.leftSplit : this.app.workspace.rightSplit;
    if (!split) return;

    if (side === 'left') {
      this.plugin.settings.leftSidebarMode = 'overlay';
    } else {
      this.plugin.settings.rightSidebarMode = 'overlay';
    }
    this.plugin.saveSettings().catch(() => {});
    this.applyLayout();

    if (split.collapsed) {
      split.expand();
    }
  }

  /**
   * Intercepts the sidebar resize handles (collider bar detector) when sidebars are swapped or in overlay mode.
   * Swapping changes the physical screen side:
   * - When Left Sidebar is on the RIGHT: dragging mouse left expands width, dragging right shrinks width.
   * - When Right Sidebar is on the LEFT: dragging mouse right expands width, dragging left shrinks width.
   */
  private setupResizeInterception(): void {
    this.removeResizeInterception();

    this.onResizePointerDownBound = (e: PointerEvent) => {
      // Primary button only
      if (e.button !== 0) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const handle = target.closest('.workspace-leaf-resize-handle') as HTMLElement | null;
      if (!handle) return;

      const leftSplit = this.app.workspace.leftSplit;
      const rightSplit = this.app.workspace.rightSplit;

      const inLeft = leftSplit?.containerEl?.contains(handle);
      const inRight = rightSplit?.containerEl?.contains(handle);

      if (!inLeft && !inRight) return;

      const isSwapped = Boolean(this.plugin.settings.sidebarsSwapped);
      const leftMode = this.plugin.settings.leftSidebarMode || 'pinned';
      const rightMode = this.plugin.settings.rightSidebarMode || 'pinned';

      const isLeftSplit = Boolean(inLeft);
      const split = isLeftSplit ? leftSplit : rightSplit;
      if (!split || !split.containerEl) return;

      const isOverlay = isLeftSplit ? (leftMode === 'overlay') : (rightMode === 'overlay');

      // Intercept whenever swapped or in overlay mode to guarantee correct detector math
      if (!isSwapped && !isOverlay) return;

      // Active screen side:
      // When swapped: Left Split is on RIGHT, Right Split is on LEFT
      // When normal: Left Split is on LEFT, Right Split is on RIGHT
      const currentSide: 'left' | 'right' = isSwapped
        ? (isLeftSplit ? 'right' : 'left')
        : (isLeftSplit ? 'left' : 'right');

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const startX = e.clientX;
      const startWidth = split.containerEl.getBoundingClientRect().width;

      const doc = document;
      const body = doc.body;
      body.classList.add('pakcli-sidebar-resizing');
      body.style.cursor = 'col-resize';
      body.style.userSelect = 'none';

      const onPointerMove = (moveEvt: PointerEvent) => {
        const deltaX = moveEvt.clientX - startX;
        let newWidth: number;

        if (currentSide === 'left') {
          // Sidebar is on the LEFT side of screen: dragging right expands width
          newWidth = startWidth + deltaX;
        } else {
          // Sidebar is on the RIGHT side of screen: dragging left expands width
          newWidth = startWidth - deltaX;
        }

        // Clamp width
        const minWidth = 180;
        const maxWidth = Math.max(minWidth, window.innerWidth - 240);
        newWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(newWidth)));

        split.containerEl.style.width = `${newWidth}px`;
        (split as any).width = newWidth;
      };

      const onPointerUp = () => {
        doc.removeEventListener('pointermove', onPointerMove, true);
        doc.removeEventListener('pointerup', onPointerUp, true);
        doc.removeEventListener('pointercancel', onPointerUp, true);

        body.classList.remove('pakcli-sidebar-resizing');
        body.style.cursor = '';
        body.style.userSelect = '';

        this.app.workspace.trigger('resize');
        if (typeof (this.app.workspace as any).requestSaveLayout === 'function') {
          (this.app.workspace as any).requestSaveLayout();
        }
      };

      doc.addEventListener('pointermove', onPointerMove, true);
      doc.addEventListener('pointerup', onPointerUp, true);
      doc.addEventListener('pointercancel', onPointerUp, true);
    };

    document.addEventListener('pointerdown', this.onResizePointerDownBound, true);
  }

  private removeResizeInterception(): void {
    if (this.onResizePointerDownBound) {
      document.removeEventListener('pointerdown', this.onResizePointerDownBound, true);
      this.onResizePointerDownBound = null;
    }
  }

  /**
   * Sets up click-outside and Escape dismiss listeners when a sidebar is in overlay mode.
   * Handles desktop mouse events, touch events on tablet/mobile, and Escape key.
   */
  private setupDismissListeners(): void {
    this.removeDismissListeners();

    const handleDismiss = (e: Event) => {
      if (this.plugin.settings.sidebarOverlayAutoClose === false) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Ignore clicks/touches inside ribbons, modals, context menus, resize handles, or the sidebars themselves
      if (
        target.closest('.workspace-split.mod-left-split') ||
        target.closest('.workspace-split.mod-right-split') ||
        target.closest('.workspace-drawer.mod-left') ||
        target.closest('.workspace-drawer.mod-right') ||
        target.closest('.workspace-ribbon') ||
        target.closest('.menu') ||
        target.closest('.modal-container') ||
        target.closest('.pakcli-sidebar-pin-btn') ||
        target.closest('.pakcli-sidebar-swap-btn') ||
        target.closest('.workspace-leaf-resize-handle')
      ) {
        return;
      }

      // Check if clicking in central root area (.mod-root) or tablet drawer backdrop
      const inRoot = target.closest('.workspace-split.mod-root, .workspace-drawer-backdrop, .workspace-leafs');
      if (inRoot) {
        const leftSplit = this.app.workspace.leftSplit;
        const rightSplit = this.app.workspace.rightSplit;

        if (this.plugin.settings.leftSidebarMode === 'overlay' && leftSplit && !leftSplit.collapsed) {
          leftSplit.collapse();
        }
        if (this.plugin.settings.rightSidebarMode === 'overlay' && rightSplit && !rightSplit.collapsed) {
          rightSplit.collapse();
        }
      }
    };

    this.onRootClickBound = (e: MouseEvent) => handleDismiss(e);
    this.onTouchStartBound = (e: TouchEvent | PointerEvent) => handleDismiss(e);

    this.onKeyDownBound = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const leftSplit = this.app.workspace.leftSplit;
        const rightSplit = this.app.workspace.rightSplit;
        let closedAny = false;

        if (this.plugin.settings.leftSidebarMode === 'overlay' && leftSplit && !leftSplit.collapsed) {
          leftSplit.collapse();
          closedAny = true;
        }
        if (this.plugin.settings.rightSidebarMode === 'overlay' && rightSplit && !rightSplit.collapsed) {
          rightSplit.collapse();
          closedAny = true;
        }
        if (closedAny) {
          e.stopPropagation();
        }
      }
    };

    document.addEventListener('click', this.onRootClickBound, true);
    document.addEventListener('pointerdown', this.onTouchStartBound, true);
    document.addEventListener('keydown', this.onKeyDownBound, true);
  }

  private removeDismissListeners(): void {
    if (this.onRootClickBound) {
      document.removeEventListener('click', this.onRootClickBound, true);
      this.onRootClickBound = null;
    }
    if (this.onTouchStartBound) {
      document.removeEventListener('pointerdown', this.onTouchStartBound, true);
      this.onTouchStartBound = null;
    }
    if (this.onKeyDownBound) {
      document.removeEventListener('keydown', this.onKeyDownBound, true);
      this.onKeyDownBound = null;
    }
  }

  /**
   * Injects Pin and Swap buttons into the Left Sidebar (File Explorer) header.
   * Fits into the nav buttons row like Obsidian's standard actions.
   */
  public injectLeftHeaderButtons(): void {
    const leftSplit = this.app.workspace.leftSplit;
    if (!leftSplit || !leftSplit.containerEl) return;

    // Search for nav buttons container (desktop, tablet, or mobile drawer)
    const navButtons = leftSplit.containerEl.querySelector(
      '.nav-header .nav-buttons-container, .nav-buttons-container, .workspace-tab-header-container, .workspace-drawer-header, .view-header-nav-buttons'
    ) as HTMLElement | null;
    if (!navButtons) return;

    if (this.leftPinBtnEl && navButtons.contains(this.leftPinBtnEl)) {
      this.updateButtonStates();
      return;
    }

    if (this.leftPinBtnEl) this.leftPinBtnEl.remove();
    if (this.leftSwapBtnEl) this.leftSwapBtnEl.remove();

    // 1. Left Pin / Float Overlay Button
    this.leftPinBtnEl = document.createElement('div');
    this.leftPinBtnEl.className = 'workspace-tab-header clickable-icon nav-action-button pakcli-sidebar-pin-btn';
    this.leftPinBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleLeftSidebarMode();
    });

    // 2. Left Swap Button
    this.leftSwapBtnEl = document.createElement('div');
    this.leftSwapBtnEl.className = 'workspace-tab-header clickable-icon nav-action-button pakcli-sidebar-swap-btn';
    setIcon(this.leftSwapBtnEl, 'arrow-left-right');
    this.leftSwapBtnEl.setAttribute('aria-label', 'Swap Left & Right Sidebars');
    this.leftSwapBtnEl.title = 'Swap Left & Right Sidebars';
    this.leftSwapBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.swapSidebars();
    });

    navButtons.appendChild(this.leftPinBtnEl);
    navButtons.appendChild(this.leftSwapBtnEl);

    this.updateButtonStates();
  }

  /**
   * Injects Pin and Swap buttons into the Right Sidebar header.
   * Fits into the nav buttons row like Obsidian's standard actions.
   */
  public injectRightHeaderButtons(): void {
    const rightSplit = this.app.workspace.rightSplit;
    if (!rightSplit || !rightSplit.containerEl) return;

    const navButtons = rightSplit.containerEl.querySelector(
      '.nav-header .nav-buttons-container, .nav-buttons-container, .workspace-tab-header-container, .workspace-drawer-header, .view-header-nav-buttons'
    ) as HTMLElement | null;
    if (!navButtons) return;

    if (this.rightPinBtnEl && navButtons.contains(this.rightPinBtnEl)) {
      this.updateButtonStates();
      return;
    }

    if (this.rightPinBtnEl) this.rightPinBtnEl.remove();
    if (this.rightSwapBtnEl) this.rightSwapBtnEl.remove();

    // 1. Right Pin / Float Overlay Button
    this.rightPinBtnEl = document.createElement('div');
    this.rightPinBtnEl.className = 'workspace-tab-header clickable-icon nav-action-button pakcli-sidebar-pin-btn';
    this.rightPinBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleRightSidebarMode();
    });

    // 2. Right Swap Button
    this.rightSwapBtnEl = document.createElement('div');
    this.rightSwapBtnEl.className = 'workspace-tab-header clickable-icon nav-action-button pakcli-sidebar-swap-btn';
    setIcon(this.rightSwapBtnEl, 'arrow-left-right');
    this.rightSwapBtnEl.setAttribute('aria-label', 'Swap Left & Right Sidebars');
    this.rightSwapBtnEl.title = 'Swap Left & Right Sidebars';
    this.rightSwapBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.swapSidebars();
    });

    navButtons.appendChild(this.rightPinBtnEl);
    navButtons.appendChild(this.rightSwapBtnEl);

    this.updateButtonStates();
  }

  public updateButtonStates(): void {
    const leftMode = this.plugin.settings.leftSidebarMode || 'pinned';
    const rightMode = this.plugin.settings.rightSidebarMode || 'pinned';
    const isSwapped = Boolean(this.plugin.settings.sidebarsSwapped);

    // Left Button
    if (this.leftPinBtnEl) {
      const isOverlay = leftMode === 'overlay';
      // Icon like Image 3: panel-left or panel-right when docked, pin-off when overlay
      const iconName = isOverlay ? 'pin-off' : (isSwapped ? 'panel-right' : 'panel-left');
      setIcon(this.leftPinBtnEl, iconName);
      this.leftPinBtnEl.classList.toggle('is-active', isOverlay);
      this.leftPinBtnEl.classList.toggle('is-overlay', isOverlay);
      this.leftPinBtnEl.classList.toggle('is-pinned', !isOverlay);
      const label = isOverlay
        ? 'Left Sidebar: Floating Overlay (does not affect content width) — Click to Pin'
        : 'Left Sidebar: Pinned (Docked) — Click to switch to Floating Overlay';
      this.leftPinBtnEl.setAttribute('aria-label', label);
      this.leftPinBtnEl.title = label;
    }

    // Right Button
    if (this.rightPinBtnEl) {
      const isOverlay = rightMode === 'overlay';
      const iconName = isOverlay ? 'pin-off' : (isSwapped ? 'panel-left' : 'panel-right');
      setIcon(this.rightPinBtnEl, iconName);
      this.rightPinBtnEl.classList.toggle('is-active', isOverlay);
      this.rightPinBtnEl.classList.toggle('is-overlay', isOverlay);
      this.rightPinBtnEl.classList.toggle('is-pinned', !isOverlay);
      const label = isOverlay
        ? 'Right Sidebar: Floating Overlay (does not affect content width) — Click to Pin'
        : 'Right Sidebar: Pinned (Docked) — Click to switch to Floating Overlay';
      this.rightPinBtnEl.setAttribute('aria-label', label);
      this.rightPinBtnEl.title = label;
    }

    // Swap Buttons
    if (this.leftSwapBtnEl) {
      this.leftSwapBtnEl.classList.toggle('is-active', isSwapped);
      this.leftSwapBtnEl.classList.toggle('is-swapped', isSwapped);
      const label = isSwapped
        ? 'Sidebars Swapped: Click to restore Default sidebars'
        : 'Swap Left & Right Sidebars';
      this.leftSwapBtnEl.setAttribute('aria-label', label);
      this.leftSwapBtnEl.title = label;
    }
    if (this.rightSwapBtnEl) {
      this.rightSwapBtnEl.classList.toggle('is-active', isSwapped);
      this.rightSwapBtnEl.classList.toggle('is-swapped', isSwapped);
      const label = isSwapped
        ? 'Sidebars Swapped: Click to restore Default sidebars'
        : 'Swap Left & Right Sidebars';
      this.rightSwapBtnEl.setAttribute('aria-label', label);
      this.rightSwapBtnEl.title = label;
    }
  }

  private removeHeaderButtons(): void {
    if (this.leftPinBtnEl) {
      this.leftPinBtnEl.remove();
      this.leftPinBtnEl = null;
    }
    if (this.leftSwapBtnEl) {
      this.leftSwapBtnEl.remove();
      this.leftSwapBtnEl = null;
    }
    if (this.rightPinBtnEl) {
      this.rightPinBtnEl.remove();
      this.rightPinBtnEl = null;
    }
    if (this.rightSwapBtnEl) {
      this.rightSwapBtnEl.remove();
      this.rightSwapBtnEl = null;
    }
  }

  private removeClasses(): void {
    const leftSplit = this.app.workspace.leftSplit;
    const rightSplit = this.app.workspace.rightSplit;
    const workspaceEl = (this.app.workspace as any).containerEl as HTMLElement | null || document.querySelector('.workspace') as HTMLElement | null;

    if (workspaceEl) {
      workspaceEl.classList.remove('pakcli-sidebars-swapped', 'pakcli-left-overlay-active', 'pakcli-right-overlay-active', 'pakcli-tablet');
    }
    document.body.classList.remove('pakcli-sidebars-swapped', 'pakcli-sidebar-resizing');

    if (leftSplit && leftSplit.containerEl) {
      leftSplit.containerEl.classList.remove('pakcli-sidebar-overlay', 'pakcli-sidebar-left-overlay', 'pakcli-sidebar-left-pinned');
    }
    if (rightSplit && rightSplit.containerEl) {
      rightSplit.containerEl.classList.remove('pakcli-sidebar-overlay', 'pakcli-sidebar-right-overlay', 'pakcli-sidebar-right-pinned');
    }
  }
}
