import type { Project, ProjectSongItem } from '@jameet/shared';
import {
  initStructureController,
  getStructureSections,
  addStructureSection,
  reorderStructureSectionToPosition,
  duplicateStructureSection,
  deleteStructureSection,
  handleStructureSectionChange
} from './structureController';
import { initStructureUi } from './structureUi';

export interface StructureDomainControllerOptions {
  getProject: () => Project | null | undefined;
  getActiveSong: () => ProjectSongItem;
  canEdit: () => boolean;
  onRenderStructureWorkspace: () => void;
  onFocusStructureSection: (id: string) => void;
  onDebounceSaveStructure: () => void;
}

export function initStructureDomainController(options: StructureDomainControllerOptions): void {
  initStructureController({
    getProject: () => options.getProject(),
    getActiveSong: () => options.getActiveSong(),
    canEdit: () => options.canEdit(),
    onRenderStructureWorkspace: () => {
      options.onRenderStructureWorkspace();
    },
    onFocusStructureSection: (id) => {
      options.onFocusStructureSection(id);
    },
    onDebounceSaveStructure: () => {
      options.onDebounceSaveStructure();
    }
  });

  initStructureUi({
    getSections: () => getStructureSections(),
    canEdit: () => options.canEdit(),
    onAddSection: (type) => {
      addStructureSection(type);
    },
    onReorderSection: (sourceId, targetId, position) => {
      reorderStructureSectionToPosition(sourceId, targetId, position);
    },
    onDuplicateSection: (sectionId) => {
      duplicateStructureSection(sectionId);
    },
    onDeleteSection: (sectionId) => {
      deleteStructureSection(sectionId);
    },
    onSectionChange: (sectionId, changes) => {
      handleStructureSectionChange(sectionId, changes);
    }
  });
}
