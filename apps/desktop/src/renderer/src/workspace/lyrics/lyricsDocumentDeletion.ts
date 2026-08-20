import type { Project } from '@jameet/shared';

export function canDeleteLyricsDoc(project: Project | null | undefined): boolean {
  const docs = project?.workspace?.lyrics?.documents;
  return Boolean(docs && Array.isArray(docs) && docs.length > 1);
}

export function findLyricsDocToDelete(project: Project | null | undefined, docId: string) {
  const docs = project?.workspace?.lyrics?.documents;
  return docs?.find((d) => d && d.id === docId) || null;
}

export function mutateDeleteLyricsDoc(
  project: Project,
  docId: string
): { nextDocId: string } | null {
  if (!project.workspace?.lyrics?.documents) return null;
  const docs = project.workspace.lyrics.documents;
  if (docs.length <= 1) return null;

  const idx = docs.findIndex((d) => d.id === docId);
  if (idx !== -1) docs.splice(idx, 1);
  const nextDoc = docs[0];
  project.workspace.lyrics.activeDocumentId = nextDoc.id;
  return { nextDocId: nextDoc.id };
}
