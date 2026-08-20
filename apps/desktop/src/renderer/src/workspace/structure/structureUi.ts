/**
 * Song Structure & Arrangement UI Engine
 * Handles timeline ribbon rendering, section cards, drag-and-drop reordering,
 * section edits, presets, custom bar lengths, and drawer synchronization.
 */

import { $, setText } from '../../core/dom';
import { escapeHtml, findSectionCard, findTimelineBlocks } from '../../core/htmlSecurity';

export interface StructureSectionItem {
  id: string;
  type: string;
  name: string;
  bars: number;
  note?: string;
  updatedAt?: number;
}

export interface StructureSectionChange {
  name?: string;
  bars?: number;
  note?: string;
}

export const SECTION_TYPE_LABELS: Record<string, string> = {
  'intro': 'Intro',
  'verse': 'Verse',
  'pre-chorus': 'Pre-Chorus',
  'chorus': 'Chorus',
  'post-chorus': 'Post-Chorus',
  'hook': 'Hook',
  'bridge': 'Bridge',
  'breakdown': 'Breakdown',
  'solo': 'Solo',
  'outro': 'Outro',
  'custom': 'Custom'
};

export interface StructureUiOptions {
  getSections: () => StructureSectionItem[];
  canEdit: () => boolean;
  onAddSection: (type: string) => void;
  onReorderSection: (sourceId: string, targetId: string, position: 'before' | 'after') => void;
  onDuplicateSection: (sectionId: string) => void;
  onDeleteSection: (sectionId: string) => void;
  onSectionChange: (sectionId: string, changes: StructureSectionChange) => void;
}

let structureOptions: StructureUiOptions | null = null;
let listenersBound = false;
let currentStructureStatus: 'saving' | 'saved' | 'unsaved' = 'saved';
let draggedStructureSectionId: string | null = null;

export function getStructureStatus(): 'saving' | 'saved' | 'unsaved' {
  return currentStructureStatus;
}

export function setStructureStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentStructureStatus = status;
  const badge = $('project-structure-status');
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  if (badge) {
    badge.className = `workspace-status-badge ${status}`;
    badge.innerHTML = `<span class="status-dot"></span> ${label}`;
  }
}

export function applyStructurePermissions(canEdit: boolean): void {
  const structureAddBtn = $<HTMLButtonElement>('btn-structure-add-section');
  if (structureAddBtn) structureAddBtn.style.display = canEdit ? '' : 'none';
  const structureActionsBar = document.querySelector<HTMLElement>('.structure-actions-bar');
  if (structureActionsBar) structureActionsBar.style.display = canEdit ? '' : 'none';
  const structureQuickAdd = document.querySelector<HTMLElement>('.structure-quick-add');
  if (structureQuickAdd) structureQuickAdd.style.display = canEdit ? '' : 'none';
  const structureTimeline = $('structure-timeline-ribbon');
  if (structureTimeline) structureTimeline.classList.toggle('readonly-viewer', !canEdit);

  document.querySelectorAll<HTMLElement>('.structure-section-card, .drawer-section-card').forEach((card) => {
    if (!canEdit) {
      card.removeAttribute('draggable');
      card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((el) => {
        el.disabled = true;
        if (el instanceof HTMLInputElement) el.readOnly = true;
      });
      card.querySelectorAll<HTMLElement>('.btn-dup, .btn-del, .drag-handle').forEach((el) => {
        el.style.display = 'none';
      });
    }
  });
}

export function focusStructureSection(sectionId: string): void {
  const card = findSectionCard(sectionId);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.querySelector<HTMLInputElement>('.section-name-input')?.focus();
  }
}

export function renderStructureWorkspace(providedSections?: StructureSectionItem[], providedCanEdit?: boolean): void {
  const sections = providedSections ?? (structureOptions ? structureOptions.getSections() : []);
  const canEdit = providedCanEdit ?? (structureOptions ? structureOptions.canEdit() : false);
  const totalSections = sections.length;
  const totalBars = sections.reduce((sum, s) => sum + (Number(s.bars) || 0), 0);

  // 1. Update Header Metrics
  setText('structure-summary-sections', `${totalSections} ${totalSections === 1 ? 'Section' : 'Sections'}`);
  setText('structure-summary-bars', `${totalBars} Total Bars`);
  setText('session-structure-summary', `${totalSections} ${totalSections === 1 ? 'Section' : 'Sections'} · ${totalBars} Bars`);

  // 2. Render Arrangement Timeline Ribbon (Proportional DAW Blocks)
  const timelineEl = $('structure-timeline-ribbon');
  const sessionTimelineEl = $('session-structure-timeline');

  const renderTimeline = (container: HTMLElement | null, _isDrawer: boolean) => {
    if (!container) return;
    container.innerHTML = '';
    if (sections.length === 0) {
      const emptyHint = document.createElement('div');
      emptyHint.style.cssText = 'color:#64748b; font-size:11px; padding:12px 6px; font-style:italic;';
      emptyHint.textContent = 'No sections added yet · Click + Verse or + Chorus to start mapping';
      container.appendChild(emptyHint);
      return;
    }

    const calculatedTotalBars = sections.reduce((sum, s) => sum + (Number(s.bars) || 8), 0) || 1;

    sections.forEach((sec) => {
      const block = document.createElement('div');
      block.className = `timeline-block type-${sec.type || 'verse'}`;
      block.dataset.sectionId = sec.id;

      const bars = Number(sec.bars) || 8;
      const barPercent = ((bars / calculatedTotalBars) * 100).toFixed(2);
      block.style.flex = `${bars} ${bars} 0%`;
      block.style.width = `${barPercent}%`;
      block.style.minWidth = '48px';
      block.style.boxSizing = 'border-box';

      block.innerHTML = `
        <span class="timeline-block-name">${escapeHtml(sec.name || SECTION_TYPE_LABELS[sec.type] || 'Section')}</span>
        <span class="timeline-block-bars">${sec.bars ? `${sec.bars} Bars` : '—'}</span>
      `;
      block.addEventListener('click', () => {
        const card = findSectionCard(sec.id);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('focused');
          container.querySelectorAll('.timeline-block').forEach((b) => b.classList.remove('active-section'));
          block.classList.add('active-section');
          setTimeout(() => card.classList.remove('focused'), 1600);
        }
      });
      container.appendChild(block);
    });
  };

  renderTimeline(timelineEl, false);
  renderTimeline(sessionTimelineEl, true);

  // 3. Render Arrangement Section Cards List
  const listEl = $('structure-sections-list');
  const emptyEl = $('structure-sections-empty');
  const sessionListEl = $('session-structure-sections-list');

  if (emptyEl) {
    emptyEl.classList.toggle('hidden', sections.length > 0);
  }

  const renderCards = (container: HTMLElement | null, isDrawer: boolean) => {
    if (!container) return;
    container.innerHTML = '';

    sections.forEach((sec) => {
      const card = document.createElement('div');
      card.className = `${isDrawer ? 'drawer-section-card' : 'structure-section-card'} type-${sec.type || 'verse'}`;
      card.dataset.sectionId = sec.id;
      card.setAttribute('draggable', 'true');

      const COMMON_BAR_PRESETS = [1, 2, 4, 8, 12, 16, 24, 32];
      const curBars = Number(sec.bars) || 8;
      const isCustomBar = !COMMON_BAR_PRESETS.includes(curBars);

      if (isDrawer) {
        card.innerHTML = `
          <span class="drag-handle" title="Drag to reorder section">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
          </span>
          <span class="section-type-pill type-${sec.type || 'verse'}">${escapeHtml(SECTION_TYPE_LABELS[sec.type] || sec.type || 'VERSE')}</span>
          <input type="text" class="section-name-input" value="${escapeHtml(sec.name || '')}" placeholder="Title…" maxlength="80" />
          <select class="section-bars-select" aria-label="Section Bar Count" title="Section Length">
            <option value="1" ${curBars === 1 ? 'selected' : ''}>1 Bar</option>
            <option value="2" ${curBars === 2 ? 'selected' : ''}>2 Bars</option>
            <option value="4" ${curBars === 4 ? 'selected' : ''}>4 Bars</option>
            <option value="8" ${curBars === 8 && !isCustomBar ? 'selected' : ''}>8 Bars</option>
            <option value="12" ${curBars === 12 ? 'selected' : ''}>12 Bars</option>
            <option value="16" ${curBars === 16 ? 'selected' : ''}>16 Bars</option>
            <option value="24" ${curBars === 24 ? 'selected' : ''}>24 Bars</option>
            <option value="32" ${curBars === 32 ? 'selected' : ''}>32 Bars</option>
          </select>
          <button type="button" class="btn-card-action btn-del" title="Delete Section">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        `;
      } else {
        card.innerHTML = `
          <span class="drag-handle" title="Drag to reorder section">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
          </span>
          <span class="section-type-pill type-${sec.type || 'verse'}">${escapeHtml(SECTION_TYPE_LABELS[sec.type] || sec.type || 'VERSE')}</span>
          <input type="text" class="section-name-input" value="${escapeHtml(sec.name || '')}" placeholder="Section title…" maxlength="80" />
          
          <div class="section-note-compact-wrap">
            <input type="text" class="section-note-input" value="${escapeHtml(sec.note || '')}" placeholder="Arrangement note…" maxlength="300" />
          </div>

          <div class="section-bars-control-wrap" title="Section length in bars">
            <select class="section-bars-select" aria-label="Section Bar Count">
              <option value="1" ${curBars === 1 ? 'selected' : ''}>1 Bar</option>
              <option value="2" ${curBars === 2 ? 'selected' : ''}>2 Bars</option>
              <option value="4" ${curBars === 4 ? 'selected' : ''}>4 Bars</option>
              <option value="8" ${curBars === 8 && !isCustomBar ? 'selected' : ''}>8 Bars</option>
              <option value="12" ${curBars === 12 ? 'selected' : ''}>12 Bars</option>
              <option value="16" ${curBars === 16 ? 'selected' : ''}>16 Bars</option>
              <option value="24" ${curBars === 24 ? 'selected' : ''}>24 Bars</option>
              <option value="32" ${curBars === 32 ? 'selected' : ''}>32 Bars</option>
              <option value="custom" ${isCustomBar ? 'selected' : ''}>Custom…</option>
            </select>
            <input type="number" class="section-bars-custom-input ${isCustomBar ? '' : 'hidden'}" value="${curBars}" min="1" max="256" placeholder="Bars" />
          </div>

          <div class="section-card-actions">
            <button type="button" class="btn-card-action btn-dup" title="Duplicate"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
            <button type="button" class="btn-card-action btn-del" title="Delete Section"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
          </div>
        `;
      }

      if (!canEdit) {
        card.removeAttribute('draggable');
        card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((el) => {
          el.disabled = true;
          if (el instanceof HTMLInputElement) el.readOnly = true;
        });
        card.querySelectorAll<HTMLElement>('.btn-dup, .btn-del, .drag-handle').forEach((el) => {
          el.style.display = 'none';
        });
      }

      // Drag and Drop Event Listeners
      card.addEventListener('dragstart', (e) => {
        const allowedToEdit = structureOptions ? structureOptions.canEdit() : canEdit;
        if (!allowedToEdit) {
          e.preventDefault();
          return;
        }
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'SELECT' || target.closest('button, input, select')) {
          e.preventDefault();
          return;
        }
        draggedStructureSectionId = sec.id;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', sec.id);
          e.dataTransfer.effectAllowed = 'move';
        }
        setTimeout(() => {
          card.classList.add('dragging');
        }, 0);
      });

      card.addEventListener('dragend', () => {
        draggedStructureSectionId = null;
        card.classList.remove('dragging');
        container.querySelectorAll('.drop-target-above, .drop-target-below, .dragging').forEach((el) => {
          el.classList.remove('drop-target-above', 'drop-target-below', 'dragging');
        });
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedStructureSectionId || draggedStructureSectionId === sec.id) return;
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isAbove = e.clientY < midY;

        if (isAbove) {
          card.classList.add('drop-target-above');
          card.classList.remove('drop-target-below');
        } else {
          card.classList.add('drop-target-below');
          card.classList.remove('drop-target-above');
        }
      });

      card.addEventListener('dragleave', (e) => {
        if (!card.contains(e.relatedTarget as Node)) {
          card.classList.remove('drop-target-above', 'drop-target-below');
        }
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer?.getData('text/plain') || draggedStructureSectionId;
        card.classList.remove('drop-target-above', 'drop-target-below');

        if (sourceId && sourceId !== sec.id) {
          const rect = card.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const isAbove = e.clientY < midY;
          structureOptions?.onReorderSection(sourceId, sec.id, isAbove ? 'before' : 'after');
        }
      });

      // Highlight corresponding timeline block on card focus
      card.addEventListener('focusin', () => {
        document.querySelectorAll('.timeline-block').forEach((b) => b.classList.remove('active-section'));
        const matchingBlocks = findTimelineBlocks(sec.id);
        matchingBlocks.forEach((b) => b.classList.add('active-section'));
      });

      card.addEventListener('focusout', (e) => {
        if (!card.contains(e.relatedTarget as Node)) {
          const matchingBlocks = findTimelineBlocks(sec.id);
          matchingBlocks.forEach((b) => b.classList.remove('active-section'));
        }
      });

      // Inline Edit Name
      const nameInput = card.querySelector<HTMLInputElement>('.section-name-input');
      nameInput?.addEventListener('input', (e) => {
        const newName = (e.target as HTMLInputElement).value;
        // Update timeline title live
        findTimelineBlocks(sec.id).forEach((block) => {
          const blockName = block.querySelector('.timeline-block-name');
          if (blockName) blockName.textContent = newName || SECTION_TYPE_LABELS[sec.type] || 'Section';
        });
        structureOptions?.onSectionChange(sec.id, { name: newName });
      });

      // Interactive Bar Selector (Common Presets + Custom)
      const barsSelect = card.querySelector<HTMLSelectElement>('.section-bars-select');
      const customBarsInput = card.querySelector<HTMLInputElement>('.section-bars-custom-input');

      const applyBarsChange = (val: number | undefined) => {
        const newBars = val && val > 0 ? val : 8;

        const currentSections = structureOptions ? structureOptions.getSections() : sections;
        const currentTotalBars = currentSections.reduce((sum, s) => {
          const b = s.id === sec.id ? newBars : (Number(s.bars) || 8);
          return sum + b;
        }, 0) || 1;
        setText('structure-summary-bars', `${currentTotalBars} Total Bars`);
        setText('session-structure-summary', `${currentSections.length} ${currentSections.length === 1 ? 'Section' : 'Sections'} · ${currentTotalBars} Bars`);

        // Update all timeline blocks proportionally
        currentSections.forEach((s) => {
          const sBars = s.id === sec.id ? newBars : (Number(s.bars) || 8);
          const sPercent = ((sBars / currentTotalBars) * 100).toFixed(2);
          findTimelineBlocks(s.id).forEach((block) => {
            const blockBars = block.querySelector('.timeline-block-bars');
            if (blockBars) blockBars.textContent = `${sBars} Bars`;
            block.style.flex = `${sBars} ${sBars} 0%`;
            block.style.width = `${sPercent}%`;
            block.style.minWidth = '48px';
          });
        });

        structureOptions?.onSectionChange(sec.id, { bars: newBars });
      };

      barsSelect?.addEventListener('change', () => {
        const selectedVal = barsSelect.value;
        if (selectedVal === 'custom') {
          customBarsInput?.classList.remove('hidden');
          customBarsInput?.focus();
          customBarsInput?.select();
        } else {
          customBarsInput?.classList.add('hidden');
          applyBarsChange(parseInt(selectedVal, 10));
        }
      });

      customBarsInput?.addEventListener('input', () => {
        const val = parseInt(customBarsInput.value, 10);
        if (!isNaN(val) && val > 0) {
          applyBarsChange(val);
        }
      });

      // Inline Edit Note
      const noteInput = card.querySelector<HTMLInputElement>('.section-note-input');
      noteInput?.addEventListener('input', (e) => {
        const newNote = (e.target as HTMLInputElement).value;
        structureOptions?.onSectionChange(sec.id, { note: newNote });
      });

      // Duplicate
      card.querySelector('.btn-dup')?.addEventListener('click', (e) => {
        e.stopPropagation();
        structureOptions?.onDuplicateSection(sec.id);
      });

      // Delete
      card.querySelector('.btn-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        structureOptions?.onDeleteSection(sec.id);
      });

      container.appendChild(card);
    });
  };

  renderCards(listEl, false);
  renderCards(sessionListEl, true);
}

export function initStructureUi(options: StructureUiOptions): void {
  structureOptions = options;
  if (listenersBound) return;
  listenersBound = true;

  // Attach 1-Click Section Insert Listeners (Primary & More Sections Menu)
  document.querySelectorAll<HTMLButtonElement>('.btn-add-section-preset:not(.btn-more-sections), .more-sec-item, .btn-drawer-add-sec').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.sectionType || 'verse';
      structureOptions?.onAddSection(type);
      $('more-sections-menu')?.classList.add('hidden');
    });
  });

  // Toggle More Sections Dropdown Menu
  $('btn-more-sections-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('more-sections-menu')?.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!$('more-sections-menu')?.contains(e.target as Node) && e.target !== $('btn-more-sections-toggle')) {
      $('more-sections-menu')?.classList.add('hidden');
    }
  });
}
