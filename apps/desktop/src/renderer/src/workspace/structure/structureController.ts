import type { Project, ProjectSongItem } from '@jameet/shared';
import type { StructureSection } from './structureUi';
import { normalizeStructureSections } from './structureState';
import { mutateReorderStructureSectionToPosition } from './structureReorder';

export const SECTION_TYPE_DEFAULT_BARS: Record<string, number> = {
  'intro': 8,
  'verse': 16,
  'pre-chorus': 8,
  'chorus': 16,
  'post-chorus': 8,
  'hook': 8,
  'bridge': 8,
  'breakdown': 8,
  'solo': 8,
  'outro': 8,
  'custom': 8
};

export const SECTION_TYPE_DEFAULT_NAMES: Record<string, string> = {
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

export interface StructureControllerOptions {
  getProject: () => Project | null | undefined;
  getActiveSong: () => ProjectSongItem;
  canEdit: () => boolean;
  onRenderStructureWorkspace: () => void;
  onFocusStructureSection: (id: string) => void;
  onDebounceSaveStructure: () => void;
}

let controllerOptions: StructureControllerOptions | null = null;

export function initStructureController(options: StructureControllerOptions): void {
  controllerOptions = options;
}

export function getStructureSections(): StructureSection[] {
  if (!controllerOptions) return [];
  const project = controllerOptions.getProject();
  const activeSong = controllerOptions.getActiveSong();
  return normalizeStructureSections(project, activeSong);
}

export function reorderStructureSectionToPosition(
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): void {
  if (!controllerOptions) return;
  const sections = getStructureSections();
  const changed = mutateReorderStructureSectionToPosition(sections, sourceId, targetId, position);
  if (!changed) return;

  controllerOptions.onRenderStructureWorkspace();
  controllerOptions.onDebounceSaveStructure();
}

export function addStructureSection(type: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const sections = getStructureSections();
  const sameTypeCount = sections.filter((s) => s.type === type).length;
  const baseLabel = SECTION_TYPE_DEFAULT_NAMES[type] || 'Section';
  const name = sameTypeCount === 0 && (type === 'intro' || type === 'bridge' || type === 'outro' || type === 'hook')
    ? baseLabel
    : `${baseLabel} ${sameTypeCount + 1}`;
  const bars = SECTION_TYPE_DEFAULT_BARS[type] || 8;
  const newId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  sections.push({
    id: newId,
    type: type as any,
    name,
    bars,
    note: '',
    updatedAt: Date.now()
  });

  controllerOptions.onRenderStructureWorkspace();
  controllerOptions.onDebounceSaveStructure();

  setTimeout(() => {
    controllerOptions?.onFocusStructureSection(newId);
  }, 50);
}

export function moveStructureSection(id: string, direction: 'up' | 'down'): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const sections = getStructureSections();
  const idx = sections.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= sections.length) return;

  const moved = sections[idx];
  if (!moved) return;
  sections.splice(idx, 1);
  sections.splice(targetIdx, 0, moved);
  controllerOptions.onRenderStructureWorkspace();
  controllerOptions.onDebounceSaveStructure();
}

export function duplicateStructureSection(id: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const sections = getStructureSections();
  const idx = sections.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const source = sections[idx];
  if (!source) return;
  const newId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  sections.splice(idx + 1, 0, {
    id: newId,
    type: source.type,
    name: `${source.name} (Copy)`,
    bars: source.bars,
    note: source.note || '',
    updatedAt: Date.now()
  });

  controllerOptions.onRenderStructureWorkspace();
  controllerOptions.onDebounceSaveStructure();
}

export function deleteStructureSection(id: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const sections = getStructureSections();
  const idx = sections.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sections.splice(idx, 1);
  controllerOptions.onRenderStructureWorkspace();
  controllerOptions.onDebounceSaveStructure();
}

export function handleStructureSectionChange(
  sectionId: string,
  changes: Partial<StructureSection>
): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const sections = getStructureSections();
  const target = sections.find((s) => s.id === sectionId);
  if (target) {
    if (changes.name !== undefined) target.name = changes.name;
    if (changes.bars !== undefined) target.bars = changes.bars;
    if (changes.note !== undefined) target.note = changes.note;
    target.updatedAt = Date.now();
  }
  controllerOptions.onDebounceSaveStructure();
}
