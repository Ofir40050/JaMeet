import type { ProjectSongItem } from '@jameet/shared';

export interface SongDeletionResult {
  songs: ProjectSongItem[];
  nextActiveSongId: string;
  wasActive: boolean;
  shouldSwitchActiveSong: boolean;
}

export function computeSongDeletion(
  currentSongs: ProjectSongItem[],
  activeSongId: string | undefined,
  songIdToDelete: string,
  fallbackSongTitle: string = 'Song 1'
): SongDeletionResult {
  const idx = currentSongs.findIndex((s) => s.id === songIdToDelete);
  if (idx === -1) {
    return {
      songs: currentSongs,
      nextActiveSongId: activeSongId || 'song-1',
      wasActive: false,
      shouldSwitchActiveSong: false
    };
  }

  const wasActive = activeSongId === songIdToDelete;
  const remaining = currentSongs.filter((s) => s.id !== songIdToDelete);

  if (remaining.length === 0) {
    const now = Date.now();
    const initSong: ProjectSongItem = {
      id: 'song-1',
      title: fallbackSongTitle,
      order: 0,
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
    return {
      songs: [initSong],
      nextActiveSongId: 'song-1',
      wasActive,
      shouldSwitchActiveSong: wasActive
    };
  }

  if (wasActive) {
    const nextSong = remaining[Math.max(0, idx - 1)] || remaining[0];
    return {
      songs: remaining,
      nextActiveSongId: nextSong.id,
      wasActive: true,
      shouldSwitchActiveSong: true
    };
  }

  return {
    songs: remaining,
    nextActiveSongId: activeSongId || remaining[0].id,
    wasActive: false,
    shouldSwitchActiveSong: false
  };
}
