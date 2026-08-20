import type { Project, ProjectSongItem } from '@jameet/shared';

export function getActiveSongState(project: Project | null | undefined, now: number = Date.now()): ProjectSongItem {
  if (!project) {
    return {
      id: 'song-1',
      title: 'Song 1',
      order: 0,
      lyrics: { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 }], content: '', updatedAt: 0 },
      notes: { revision: 1, content: '', updatedAt: 0 },
      structure: { revision: 1, sections: [], updatedAt: 0 },
      createdAt: 0,
      updatedAt: 0
    };
  }

  if (!project.workspace) {
    project.workspace = {
      activeSongId: 'song-1',
      songs: [],
      lyrics: { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now },
      notes: { revision: 1, content: '', updatedAt: now },
      structure: { revision: 1, sections: [], updatedAt: now },
      tasks: { revision: 1, tasks: [], updatedAt: now }
    };
  }

  const ws = project.workspace;
  if (!ws.songs || !Array.isArray(ws.songs) || ws.songs.length === 0) {
    const initialSong: ProjectSongItem = {
      id: 'song-1',
      title: project.name ? project.name : 'Song 1',
      order: 0,
      lyrics: ws.lyrics || { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now },
      notes: ws.notes || { revision: 1, content: '', updatedAt: now },
      structure: ws.structure || { revision: 1, sections: [], updatedAt: now },
      createdAt: now,
      updatedAt: now
    };
    ws.songs = [initialSong];
    ws.activeSongId = 'song-1';
  }

  const activeId = ws.activeSongId || ws.songs[0].id;
  const song = ws.songs.find((s) => s && s.id === activeId) || ws.songs[0];
  ws.activeSongId = song.id;

  // Mirror active song's data to top-level workspace for seamless subsystem compatibility
  ws.lyrics = song.lyrics;
  ws.notes = song.notes;
  ws.structure = song.structure;

  return song;
}
