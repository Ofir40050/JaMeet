import type { ProjectSongItem } from '@jameet/shared';

export interface LyricsDocItem {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}

export function getActiveLyricsDocState(
  activeSong: ProjectSongItem,
  now: number = Date.now()
): LyricsDocItem {
  const ws = activeSong.lyrics;
  if (!ws.documents || !Array.isArray(ws.documents) || ws.documents.length === 0) {
    ws.documents = [{ id: 'doc-main', title: 'Main Lyrics', content: ws.content || '', updatedAt: ws.updatedAt || now }];
    ws.activeDocumentId = 'doc-main';
  }

  const fallbackDoc = ws.documents[0];
  const activeId = ws.activeDocumentId || fallbackDoc?.id || 'doc-main';
  const doc = ws.documents.find((d) => d && d.id === activeId) || fallbackDoc;
  if (!doc) {
    const mainDoc = { id: 'doc-main', title: 'Main Lyrics', content: ws.content || '', updatedAt: ws.updatedAt || now };
    ws.documents = [mainDoc];
    ws.activeDocumentId = 'doc-main';
    return mainDoc;
  }
  ws.activeDocumentId = doc.id;
  return doc;
}
