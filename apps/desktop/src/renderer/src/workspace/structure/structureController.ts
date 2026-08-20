import type { StructureSection } from './structureUi';

export interface StructureControllerOptions {
  getSections: () => StructureSection[];
  onDebounceSaveStructure: () => void;
}

let controllerOptions: StructureControllerOptions | null = null;

export function initStructureController(options: StructureControllerOptions): void {
  controllerOptions = options;
}

export function handleStructureSectionChange(
  sectionId: string,
  changes: Partial<StructureSection>
): void {
  if (!controllerOptions) return;
  const sections = controllerOptions.getSections();
  const target = sections.find((s) => s.id === sectionId);
  if (target) {
    if (changes.name !== undefined) target.name = changes.name;
    if (changes.bars !== undefined) target.bars = changes.bars;
    if (changes.note !== undefined) target.note = changes.note;
    target.updatedAt = Date.now();
  }
  controllerOptions.onDebounceSaveStructure();
}
