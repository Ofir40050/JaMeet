import type { Project, ProjectSongItem } from '@jameet/shared';

export interface CreateSongResult {
  newSong: ProjectSongItem;
  newId: string;
}

export function mutateCreateSong(
  project: Project,
  title: string,
  newId: string,
  now: number = Date.now()
): CreateSongResult {
  const ws = project.workspace || { songs: [] };
  if (!ws.songs || !Array.isArray(ws.songs)) {
    ws.songs = [];
  }
  const songs = ws.songs;

  if (songs.length === 0) {
    const initSong: ProjectSongItem = {
      id: 'song-1',
      title: project.name ? project.name : 'Song 1',
      order: 0,
      lyrics: ws.lyrics || { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now },
      notes: ws.notes || { revision: 1, content: '• ', bpm: '120 BPM', key: 'C Major', updatedAt: now },
      structure: ws.structure || { revision: 1, sections: [], updatedAt: now },
      createdAt: now,
      updatedAt: now
    };
    songs.push(initSong);
  }

  const cleanTitle = title.trim() || `Song ${songs.length + 1}`;

  const newSong: ProjectSongItem = {
    id: newId,
    title: cleanTitle,
    order: songs.length,
    lyrics: {
      revision: 1,
      activeDocumentId: 'doc-main',
      documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }],
      content: '',
      updatedAt: now
    },
    notes: { revision: 1, content: '• ', bpm: '120 BPM', key: 'C Major', updatedAt: now },
    structure: { revision: 1, sections: [], updatedAt: now },
    createdAt: now,
    updatedAt: now
  };

  songs.push(newSong);
  ws.songs = songs;
  ws.activeSongId = newId;
  ws.lyrics = newSong.lyrics;
  ws.notes = newSong.notes;
  ws.structure = newSong.structure;
  project.workspace = ws;

  return { newSong, newId };
}
