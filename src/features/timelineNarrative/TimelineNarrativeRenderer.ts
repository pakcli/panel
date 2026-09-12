import { App, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, TFile } from 'obsidian';
import { DiagramLayout, OutcomeType, TimelineNode, TimelineTree, TimelineViewMode } from './types';
import { parseTimelineSource, serializeTimelineNode, serializeTimelineTree } from './parser';
import { computeTimelineLayout } from './layout';
import { updateCodeblockSource } from './sourceUpdater';
import { RawTextareaAutocomplete, extractTimelineCandidates } from './timelineAutocomplete';

export class TimelineNarrativeRenderer extends MarkdownRenderChild {
  private app: App;
  private source: string;
  private ctx: MarkdownPostProcessorContext;
  private currentMode: TimelineViewMode = 'timeline-view';

  private tree: TimelineTree;
  private layout: DiagramLayout;
  private rawAutocomplete: RawTextareaAutocomplete | null = null;
  private mergeJumps: boolean = false;

  // Zoom & Pan state
  private zoom: number = 1.0;
  private pan: { x: number; y: number } = { x: 0, y: 0 };
  private isDragging: boolean = false;
  private dragStart: { x: number; y: number } = { x: 0, y: 0 };

  constructor(
    app: App,
    source: string,
    containerEl: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) {
    super(containerEl);
    this.app = app;
    this.source = source;
    this.ctx = ctx;

    try {
      this.tree = parseTimelineSource(source);
      this.resolveFrontmatterMetadata();
      this.layout = computeTimelineLayout(this.tree, { mergeJumps: this.mergeJumps });
    } catch (err) {
      console.error('[Timeline Narrative] Parse/Layout error:', err);
      this.tree = { roots: [], allNodes: new Map(), nodesByLabel: new Map(), rawLines: [] };
      this.layout = { nodes: [], connectors: [], totalWidth: 600, totalHeight: 350 };
    }

    // Render immediately so live preview and reading view display without delay
    this.render();
  }

  onload() {
    this.render();
  }

  onunload() {
    if (this.rawAutocomplete) {
      this.rawAutocomplete.destroy();
      this.rawAutocomplete = null;
    }
  }

  /**
   * Resolves frontmatter metadata (outcome: good/bad, image: ...) from linked vault notes
   */
  private resolveFrontmatterMetadata() {
    this.tree.allNodes.forEach((node) => {
      if (!node.wikilink) return;

      const targetPath = node.wikilink.path;
      const file = this.app.metadataCache.getFirstLinkpathDest(targetPath, this.ctx.sourcePath);
      if (!file || !(file instanceof TFile)) return;

      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) return;

      // 1. Resolve Outcome for Detroit diagonal-cut banner
      const rawOutcome = String(fm.outcome || fm.ending || '').toLowerCase();
      if (rawOutcome.includes('good') || rawOutcome.includes('win') || rawOutcome.includes('success')) {
        node.outcome = 'good';
      } else if (rawOutcome.includes('bad') || rawOutcome.includes('lose') || rawOutcome.includes('fail') || rawOutcome.includes('death')) {
        node.outcome = 'bad';
      } else if (rawOutcome) {
        node.outcome = 'neutral';
      }

      // 2. Resolve Image thumbnail
      if (fm.image) {
        const imgStr = String(fm.image).trim();
        if (imgStr.startsWith('http://') || imgStr.startsWith('https://')) {
          node.imageUrl = imgStr;
        } else {
          const imgClean = imgStr.replace(/^\[\[|\]\]$/g, '');
          const imgFile = this.app.metadataCache.getFirstLinkpathDest(imgClean, this.ctx.sourcePath);
          if (imgFile instanceof TFile) {
            node.imageUrl = this.app.vault.getResourcePath(imgFile);
          }
        }
      }
    });
  }

  private async handleSourceUpdate(newContent: string) {
    this.source = newContent;
    const ok = await updateCodeblockSource(this.app, this.ctx, this.containerEl, newContent);
    if (ok) {
      this.tree = parseTimelineSource(newContent);
      this.resolveFrontmatterMetadata();
      this.layout = computeTimelineLayout(this.tree);
      this.render();
    }
  }

  private render() {
    try {
      if (this.rawAutocomplete) {
        this.rawAutocomplete.destroy();
        this.rawAutocomplete = null;
      }

      this.containerEl.empty();

      this.tree = parseTimelineSource(this.source);
      this.resolveFrontmatterMetadata();
      this.layout = computeTimelineLayout(this.tree, { mergeJumps: this.mergeJumps });

      const wrapper = this.containerEl.createDiv({ cls: 'timeline-narrative-container' });

      // 1. Header Toolbar
      this.renderToolbar(wrapper);

      // Empty state notice if no nodes found
      if (this.tree.roots.length === 0) {
        const emptyBox = wrapper.createDiv({
          cls: 'timeline-empty-notice',
          attr: { style: 'padding: 30px 20px; text-align: center; color: var(--text-muted);' }
        });
        emptyBox.createEl('h4', { text: 'Timeline Narrative: No Nodes Found', attr: { style: 'margin-bottom: 8px; color: var(--text-normal);' } });
        emptyBox.createEl('p', { text: 'Type your timeline choices indented with tabs, or click below to load the demo:', attr: { style: 'margin-bottom: 16px; font-size: 0.85rem;' } });
        const insertBtn = emptyBox.createEl('button', {
          cls: 'apply-btn',
          text: 'Load Demo Flowchart',
          attr: { style: 'padding: 6px 16px; background: var(--interactive-accent); color: var(--text-on-accent, #ffffff); border: none; border-radius: 6px; cursor: pointer;' }
        });
        insertBtn.onclick = () => {
          const demo = `_2027-03-01_09-40_ Mission Start\n\tTalk to Captain\n\t\tSearch for Clues\n\t\t\tConfront Deviant Outside\n\t\t\t\tNegotiate\n\t\t\t\t\tBe Honest > Deviant Jumps (honesty risks trust)\n\t\t\t\t\tBuild Trust > Deviant Jumps\n\t\t\t\t\t[[Use Gun Ending]]\n\t\t\t\t\t[[Sacrifice Self Ending]] (no return from here)\n\nDeviant Jumps\n\t[[Connor Leapt and Fell]]\n\t[[Snipers Shot Deviant]]`;
          this.handleSourceUpdate(demo);
        };
        return;
      }

      // 2. Active Mode View Body
      switch (this.currentMode) {
        case 'raw':
          this.renderRawView(wrapper);
          break;
        case 'outline':
          this.renderOutlineView(wrapper);
          break;
        case 'timeline-view':
        case 'timeline-edit':
        default:
          this.renderFlowchartView(wrapper, this.currentMode === 'timeline-edit');
          break;
      }
    } catch (err) {
      console.error('[Timeline Narrative] Render exception:', err);
      this.containerEl.empty();
      const errBox = this.containerEl.createDiv({
        attr: { style: 'padding: 16px; color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 6px;' }
      });
      errBox.createEl('strong', { text: 'Timeline Narrative Error: ' });
      errBox.createSpan({ text: String((err as Error).message || err) });
    }
  }

  private renderToolbar(parent: HTMLElement) {
    const toolbar = parent.createDiv({ cls: 'timeline-toolbar' });

    // Left info
    const left = toolbar.createDiv({ cls: 'toolbar-left' });
    const title = left.createDiv({ cls: 'timeline-title' });
    title.createSpan({ cls: 'title-icon', text: '⑂' });
    title.createSpan({ text: 'Timeline Narrative' });

    const totalNodes = this.tree.allNodes.size;
    left.createSpan({ cls: 'node-counter', text: `${totalNodes} node${totalNodes === 1 ? '' : 's'}` });

    // Mode Switcher (4 modes)
    const modeGroup = toolbar.createDiv({ cls: 'toolbar-modes' });

    const modes: { key: TimelineViewMode; label: string; icon: string }[] = [
      { key: 'raw', label: 'Raw', icon: '📝' },
      { key: 'outline', label: 'Outline', icon: '📑' },
      { key: 'timeline-view', label: 'Timeline', icon: '🎬' },
      { key: 'timeline-edit', label: 'Edit Flowchart', icon: '✏️' },
    ];

    modes.forEach((m) => {
      const btn = modeGroup.createEl('button', {
        cls: `mode-btn ${this.currentMode === m.key ? 'active' : ''}`,
        text: `${m.icon} ${m.label}`,
      });
      btn.onclick = () => {
        if (this.currentMode !== m.key) {
          this.currentMode = m.key;
          this.render();
        }
      };
    });

    // Right controls (for flowchart and outline modes)
    if (this.currentMode === 'timeline-view' || this.currentMode === 'timeline-edit' || this.currentMode === 'outline') {
      const right = toolbar.createDiv({ cls: 'toolbar-right' });

      // Merge Jumps Toggle Button (default OFF)
      const mergeBtn = right.createEl('button', {
        cls: `action-btn merge-toggle-btn ${this.mergeJumps ? 'active' : ''}`,
        text: this.mergeJumps ? '🔀 Merge Jumps: ON' : '🔀 Merge Jumps: OFF',
        title: 'Merge jump target trees into 1 continuous flow line (default: OFF)',
      });
      mergeBtn.onclick = () => {
        this.mergeJumps = !this.mergeJumps;
        this.render();
      };

      if (this.currentMode === 'timeline-view' || this.currentMode === 'timeline-edit') {
        const zoomOut = right.createEl('button', { cls: 'action-btn', text: '−', title: 'Zoom Out' });
        zoomOut.onclick = () => {
          this.zoom = Math.max(0.4, this.zoom - 0.15);
          this.updateTransform();
        };

        const resetZoom = right.createEl('button', { cls: 'action-btn', text: '⟲', title: 'Reset View' });
        resetZoom.onclick = () => {
          this.zoom = 1.0;
          this.pan = { x: 0, y: 0 };
          this.updateTransform();
        };

        const zoomIn = right.createEl('button', { cls: 'action-btn', text: '+', title: 'Zoom In' });
        zoomIn.onclick = () => {
          this.zoom = Math.min(2.5, this.zoom + 0.15);
          this.updateTransform();
        };
      }
    }
  }

  /* ------------------------------------------------------------------------- */
  /* Mode 1: Raw Text Mode                                                     */
  /* ------------------------------------------------------------------------- */
  private renderRawView(parent: HTMLElement) {
    const container = parent.createDiv({ cls: 'timeline-raw-view' });

    const textarea = container.createEl('textarea', { cls: 'raw-textarea' });
    textarea.value = this.source;

    // Attach autocomplete controller
    if (this.rawAutocomplete) {
      this.rawAutocomplete.destroy();
    }
    this.rawAutocomplete = new RawTextareaAutocomplete(textarea);

    const actions = container.createDiv({ cls: 'raw-actions' });
    const applyBtn = actions.createEl('button', { cls: 'apply-btn', text: 'Apply Changes' });
    applyBtn.onclick = () => {
      this.handleSourceUpdate(textarea.value);
    };
  }

  /* ------------------------------------------------------------------------- */
  /* Mode 2: Interactive Outline View ("Raw Layout with Buttons")              */
  /* ------------------------------------------------------------------------- */
  private renderOutlineView(parent: HTMLElement) {
    const container = parent.createDiv({ cls: 'timeline-outline-view' });

    const renderNodeRow = (node: TimelineNode) => {
      const row = container.createDiv({ cls: 'outline-row' });
      row.style.marginLeft = `${node.depth * 24}px`;

      const main = row.createDiv({ cls: 'row-main' });

      // Indent indicator
      main.createSpan({ cls: 'depth-indicator', text: '└' + '─'.repeat(Math.max(1, node.depth)) });

      // Timestamp chip
      if (node.timestamp) {
        main.createSpan({ cls: 'timestamp-chip', text: node.timestamp });
      }

      // Label
      const label = main.createSpan({
        cls: `label-text ${node.wikilink ? 'wikilink' : ''}`,
        text: node.label,
      });

      if (node.wikilink) {
        label.onclick = (e) => {
          e.stopPropagation();
          this.app.workspace.openLinkText(node.wikilink!.path, this.ctx.sourcePath, false);
        };
      }

      // Jump indicator
      if (node.jumpTarget) {
        main.createSpan({ cls: 'jump-badge', text: `> ${node.jumpTarget}` });
      }

      // Note
      if (node.note) {
        main.createSpan({ cls: 'note-text', text: `(${node.note})` });
      }

      // Quick action buttons
      const actions = row.createDiv({ cls: 'row-actions' });

      const addChildBtn = actions.createEl('button', {
        cls: 'mini-btn',
        text: '+ Child',
        title: 'Add child choice under this node',
      });
      addChildBtn.onclick = () => this.promptAddChild(node);

      const addSiblingBtn = actions.createEl('button', {
        cls: 'mini-btn',
        text: '+ Sibling',
        title: 'Add alternative sibling choice',
      });
      addSiblingBtn.onclick = () => this.promptAddSibling(node);

      const editBtn = actions.createEl('button', {
        cls: 'mini-btn',
        text: '✏️',
        title: 'Edit Node',
      });
      editBtn.onclick = () => this.openEditModal(node);

      const delBtn = actions.createEl('button', {
        cls: 'mini-btn delete',
        text: '🗑️',
        title: 'Delete Node',
      });
      delBtn.onclick = () => this.deleteNode(node);

      // Render children recursively
      node.children.forEach(renderNodeRow);
    };

    this.tree.roots.forEach(renderNodeRow);

    // Root add button at bottom
    const addRootBtn = container.createEl('button', {
      cls: 'apply-btn',
      text: '+ Add Root Timeline Track',
      attr: { style: 'align-self: flex-start; margin-top: 12px;' },
    });
    addRootBtn.onclick = () => {
      const newContent = this.source.trim() + '\nNew Timeline Branch';
      this.handleSourceUpdate(newContent);
    };
  }

  /* ------------------------------------------------------------------------- */
  /* Modes 3 & 4: Detroit: Become Human Flowchart (View & Edit)                */
  /* ------------------------------------------------------------------------- */
  private stageContentEl?: HTMLElement;

  private renderFlowchartView(parent: HTMLElement, isEditable: boolean) {
    const wrapper = parent.createDiv({ cls: 'timeline-stage-wrapper' });

    // Drag-to-pan & wheel-to-zoom handlers
    wrapper.onmousedown = (e) => {
      if ((e.target as HTMLElement).closest('.detroit-node')) return;
      this.isDragging = true;
      this.dragStart = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
    };

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.pan = { x: e.clientX - this.dragStart.x, y: e.clientY - this.dragStart.y };
      this.updateTransform();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    wrapper.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      this.zoom = Math.min(2.5, Math.max(0.4, this.zoom + delta));
      this.updateTransform();
    };

    const content = wrapper.createDiv({ cls: 'timeline-stage-content' });
    this.stageContentEl = content;
    this.updateTransform();

    // 1. SVG Layer for Detroit Chamfered Connectors
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'timeline-svg-layer');
    svg.setAttribute('width', String(Math.max(this.layout.totalWidth, 1200)));
    svg.setAttribute('height', String(Math.max(this.layout.totalHeight, 800)));
    svg.setAttribute('viewBox', `0 0 ${Math.max(this.layout.totalWidth, 1200)} ${Math.max(this.layout.totalHeight, 800)}`);
    svg.setAttribute('style', 'position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; z-index: 1;');

    this.layout.connectors.forEach((conn) => {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', conn.d);
      path.setAttribute('class', `connector-path ${conn.isJump ? 'jump-path' : ''}`);
      path.setAttribute('data-from', conn.fromNodeId);
      path.setAttribute('data-to', conn.toNodeId);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--interactive-accent, #7c3aed)');
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-opacity', conn.isJump ? '0.85' : '0.75');
      if (conn.isJump) {
        path.setAttribute('stroke-dasharray', '6 4');
      }
      svg.appendChild(path);

      // Start connection dot
      const startDot = document.createElementNS(svgNS, 'circle');
      startDot.setAttribute('cx', String(conn.startX));
      startDot.setAttribute('cy', String(conn.startY));
      startDot.setAttribute('r', '4');
      startDot.setAttribute('fill', 'var(--interactive-accent, #7c3aed)');
      startDot.setAttribute('stroke', 'var(--background-primary, #ffffff)');
      startDot.setAttribute('stroke-width', '2');
      startDot.setAttribute('class', 'joint-dot');
      startDot.setAttribute('data-node', conn.fromNodeId);
      svg.appendChild(startDot);

      // End connection dot
      const endDot = document.createElementNS(svgNS, 'circle');
      endDot.setAttribute('cx', String(conn.endX));
      endDot.setAttribute('cy', String(conn.endY));
      endDot.setAttribute('r', '4');
      endDot.setAttribute('fill', 'var(--interactive-accent, #7c3aed)');
      endDot.setAttribute('stroke', 'var(--background-primary, #ffffff)');
      endDot.setAttribute('stroke-width', '2');
      endDot.setAttribute('class', 'joint-dot');
      endDot.setAttribute('data-node', conn.toNodeId);
      svg.appendChild(endDot);
    });

    content.appendChild(svg);

    // 2. HTML Nodes Layer
    const nodesLayer = content.createDiv({ cls: 'timeline-nodes-layer' });

    this.layout.nodes.forEach((layout) => {
      const node = layout.node;

      const card = nodesLayer.createDiv({
        cls: `detroit-node ${node.outcome ? `outcome-${node.outcome}` : ''} ${isEditable ? 'is-editable' : ''}`,
      });
      card.setAttribute('data-node-id', node.id);
      card.style.left = `${layout.x}px`;
      card.style.top = `${layout.y}px`;
      card.style.width = `${layout.width}px`;

      // Hover to illuminate connected paths and dots
      card.addEventListener('mouseenter', () => {
        svg.querySelectorAll(`.connector-path[data-from="${node.id}"], .connector-path[data-to="${node.id}"]`).forEach((p) => {
          p.classList.add('highlighted');
        });
        svg.querySelectorAll(`.joint-dot[data-node="${node.id}"]`).forEach((d) => {
          d.classList.add('highlighted');
        });
      });

      card.addEventListener('mouseleave', () => {
        svg.querySelectorAll('.connector-path.highlighted').forEach((p) => {
          p.classList.remove('highlighted');
        });
        svg.querySelectorAll('.joint-dot.highlighted').forEach((d) => {
          d.classList.remove('highlighted');
        });
      });

      // Header row (Timestamp & Jump indicator)
      if (node.timestamp || node.jumpTarget) {
        const header = card.createDiv({ cls: 'node-header' });
        if (node.timestamp) {
          header.createSpan({ cls: 'timestamp-badge', text: node.timestamp });
        }
        if (node.jumpTarget) {
          header.createSpan({ cls: 'jump-indicator', text: `> ${node.jumpTarget}` });
        }
      }

      // Title row (Thumbnail & Label)
      const labelRow = card.createDiv({ cls: 'node-label-row' });

      if (node.imageUrl) {
        const img = labelRow.createEl('img', { cls: 'node-thumb' });
        img.src = node.imageUrl;
      }

      const title = labelRow.createSpan({
        cls: `node-title ${node.wikilink ? 'is-wikilink' : ''}`,
        text: node.label,
      });

      // Hover preview and click navigation for wikilinks
      if (node.wikilink) {
        title.onclick = (e) => {
          e.stopPropagation();
          this.app.workspace.openLinkText(node.wikilink!.path, this.ctx.sourcePath, false);
        };

        title.addEventListener('mouseover', (event) => {
          this.app.workspace.trigger('hover-link', {
            event,
            source: 'timeline-narrative',
            hoverParent: card,
            targetEl: title,
            linktext: node.wikilink!.path,
            sourcePath: this.ctx.sourcePath,
          });
        });
      }

      // Node Note
      if (node.note) {
        card.createDiv({ cls: 'node-note', text: `(${node.note})` });
      }

      // Editable Mode: Click node to open editor + hover '+' button to add child branch
      if (isEditable) {
        card.onclick = (e) => {
          if ((e.target as HTMLElement).closest('.node-add-btn')) return;
          this.openEditModal(node);
        };

        const editControls = card.createDiv({ cls: 'node-edit-controls' });
        const addBtn = editControls.createEl('button', {
          cls: 'node-add-btn',
          text: '+',
          title: 'Add child choice branching from here',
        });
        addBtn.onclick = (e) => {
          e.stopPropagation();
          this.promptAddChild(node);
        };
      }
    });
  }

  private updateTransform() {
    if (this.stageContentEl) {
      this.stageContentEl.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    }
  }

  /* ------------------------------------------------------------------------- */
  /* Node Actions & Interactive Edit Modal                                     */
  /* ------------------------------------------------------------------------- */
  private promptAddChild(parentNode: TimelineNode) {
    const lines = this.source.split(/\r?\n/);
    const childIndent = '\t'.repeat(parentNode.depth + 1);
    const newLine = `${childIndent}New Choice`;

    lines.splice(parentNode.lineIndex + 1, 0, newLine);
    this.handleSourceUpdate(lines.join('\n'));
    new Notice(`Added branch under "${parentNode.label}"`);
  }

  private promptAddSibling(node: TimelineNode) {
    const lines = this.source.split(/\r?\n/);
    const indent = '\t'.repeat(node.depth);
    const newLine = `${indent}Alternative Choice`;

    lines.splice(node.lineIndex + 1, 0, newLine);
    this.handleSourceUpdate(lines.join('\n'));
    new Notice(`Added alternative branch`);
  }

  private deleteNode(node: TimelineNode) {
    const lines = this.source.split(/\r?\n/);
    lines.splice(node.lineIndex, 1);
    this.handleSourceUpdate(lines.join('\n'));
    new Notice(`Deleted "${node.label}"`);
  }

  private openEditModal(node: TimelineNode) {
    const backdrop = document.body.createDiv({ cls: 'timeline-node-modal-backdrop' });

    const modal = backdrop.createDiv({ cls: 'timeline-node-modal' });
    const header = modal.createEl('h4');
    header.createSpan({ text: 'Edit Decision Node' });

    // Label Field
    const labelField = modal.createDiv({ cls: 'modal-field' });
    labelField.createEl('label', { text: 'Label (Plain Text or [[Wikilink]])' });
    const labelInput = labelField.createEl('input', {
      value: node.wikilink ? node.wikilink.raw : node.label,
    });

    // Extract candidates from source for datalists
    const allCandidates = extractTimelineCandidates(this.source);

    // Timestamp Field
    const timeField = modal.createDiv({ cls: 'modal-field' });
    timeField.createEl('label', { text: 'Timestamp (e.g. _2027-03-01_09-40_)' });
    const timeInput = timeField.createEl('input', {
      value: node.rawTimestamp || '',
      placeholder: '_YYYY-MM-DD_HH-MM_',
    });

    // Jump Field with datalist suggestions
    const jumpField = modal.createDiv({ cls: 'modal-field' });
    jumpField.createEl('label', { text: 'Jump Target (Optional, e.g. Deviant Jumps)' });
    const jumpListId = `jump-dl-${node.id}`;
    const jumpInput = jumpField.createEl('input', {
      value: node.jumpTarget || '',
      placeholder: 'Target Node Label',
      attr: { list: jumpListId }
    });
    const jumpDatalist = modal.createEl('datalist', { attr: { id: jumpListId } });
    const seenJumps = new Set<string>();
    allCandidates.filter(c => c.type === 'node' || c.type === 'jump').forEach(c => {
      const clean = c.text.replace(/^\[\[|\]\]$/g, '');
      if (!seenJumps.has(clean.toLowerCase())) {
        seenJumps.add(clean.toLowerCase());
        jumpDatalist.createEl('option', { attr: { value: clean } });
      }
    });

    // Note Field with datalist suggestions
    const noteField = modal.createDiv({ cls: 'modal-field' });
    noteField.createEl('label', { text: 'Note (Optional, e.g. high risk)' });
    const noteListId = `note-dl-${node.id}`;
    const noteInput = noteField.createEl('input', {
      value: node.note || '',
      placeholder: 'Short note or [[wikilink]]',
      attr: { list: noteListId }
    });
    const noteDatalist = modal.createEl('datalist', { attr: { id: noteListId } });
    const seenNotes = new Set<string>();
    allCandidates.filter(c => c.type === 'note').forEach(c => {
      if (!seenNotes.has(c.text.toLowerCase())) {
        seenNotes.add(c.text.toLowerCase());
        noteDatalist.createEl('option', { attr: { value: c.text } });
      }
    });

    // Buttons
    const buttons = modal.createDiv({ cls: 'modal-buttons' });

    const delBtn = buttons.createEl('button', { cls: 'delete-btn', text: 'Delete Node' });
    delBtn.onclick = () => {
      backdrop.remove();
      this.deleteNode(node);
    };

    const rightBtns = buttons.createDiv({ cls: 'right-buttons' });

    const cancelBtn = rightBtns.createEl('button', { cls: 'cancel-btn', text: 'Cancel' });
    cancelBtn.onclick = () => backdrop.remove();

    const saveBtn = rightBtns.createEl('button', { cls: 'save-btn', text: 'Save' });
    saveBtn.onclick = () => {
      const updatedLine = serializeTimelineNode({
        depth: node.depth,
        rawTimestamp: timeInput.value.trim() || undefined,
        label: labelInput.value.trim(),
        jumpTarget: jumpInput.value.trim() || undefined,
        note: noteInput.value.trim() || undefined,
      });

      const lines = this.source.split(/\r?\n/);
      lines[node.lineIndex] = updatedLine;
      backdrop.remove();
      this.handleSourceUpdate(lines.join('\n'));
      new Notice(`Updated "${node.label}"`);
    };

    backdrop.onclick = (e) => {
      if (e.target === backdrop) backdrop.remove();
    };
  }
}
