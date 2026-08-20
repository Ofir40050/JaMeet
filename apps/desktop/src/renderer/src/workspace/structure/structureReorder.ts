export function mutateReorderStructureSectionToPosition(
  sections: any[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): boolean {
  const sourceIdx = sections.findIndex((s) => s.id === sourceId);
  const targetIdx = sections.findIndex((s) => s.id === targetId);
  if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return false;

  const [moved] = sections.splice(sourceIdx, 1);
  const newTargetIdx = sections.findIndex((s) => s.id === targetId);
  const insertIndex = position === 'before' ? newTargetIdx : newTargetIdx + 1;
  sections.splice(insertIndex, 0, moved);
  return true;
}
