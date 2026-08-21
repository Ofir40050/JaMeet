import type { Project } from '@jameet/shared';
import type { UserStore } from '../auth/auth.js';

export function enrichUserAvatars(project: Project, userStore?: UserStore): Project {
  if (!userStore) return project;
  try {
    // 1. Owner
    const ownerProfile = userStore.getStoredUser(project.ownerId);
    if (ownerProfile) {
      if (ownerProfile.avatarUrl) project.ownerAvatarUrl = ownerProfile.avatarUrl;
      if (ownerProfile.avatarColor) project.ownerAvatarColor = ownerProfile.avatarColor;
    }
    // 2. Collaborators
    if (Array.isArray(project.collaborators)) {
      for (const c of project.collaborators) {
        const collabProfile = userStore.getStoredUser(c.userId);
        if (collabProfile) {
          if (collabProfile.avatarUrl) c.avatarUrl = collabProfile.avatarUrl;
          if (collabProfile.avatarColor) c.avatarColor = collabProfile.avatarColor;
        }
      }
    }
    // 3. Activities
    if (Array.isArray(project.activities)) {
      for (const a of project.activities) {
        if (!a.userAvatarUrl) {
          const actProfile = userStore.getStoredUser(a.userId);
          if (actProfile?.avatarUrl) {
            a.userAvatarUrl = actProfile.avatarUrl;
          }
        }
      }
    }
  } catch { /* ignore */ }
  return project;
}

export function normalizeLoadedProject(p: Project): void {
  if (!Array.isArray(p.activities)) {
    p.activities = [];
  }
  if (Array.isArray(p.collaborators)) {
    for (const c of p.collaborators) {
      delete (c as any).email;
      if (!c.role || (c.role as string) === 'owner') {
        c.role = 'collaborator';
      }
    }
  }
  const now = p.updatedAt || p.createdAt || Date.now();
  if (!p.workspace) {
    const defaultSong = {
      id: 'song-1',
      title: 'Song 1',
      order: 0,
      lyrics: { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now },
      notes: { revision: 1, content: '', updatedAt: now },
      structure: { revision: 1, sections: [], updatedAt: now },
      createdAt: now,
      updatedAt: now
    };
    p.workspace = {
      activeSongId: 'song-1',
      songs: [defaultSong],
      lyrics: defaultSong.lyrics,
      notes: defaultSong.notes,
      structure: defaultSong.structure,
      tasks: { revision: 1, tasks: [], updatedAt: now }
    };
  } else {
    if (!p.workspace.lyrics) {
      p.workspace.lyrics = { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now };
    } else if (p.workspace.lyrics.revision === undefined) {
      p.workspace.lyrics.revision = 1;
    }
    if (!p.workspace.notes) {
      p.workspace.notes = { revision: 1, content: '', updatedAt: now };
    } else if (p.workspace.notes.revision === undefined) {
      p.workspace.notes.revision = 1;
    }
    if (!p.workspace.structure) {
      p.workspace.structure = { revision: 1, sections: [], updatedAt: now };
    } else if (p.workspace.structure.revision === undefined) {
      p.workspace.structure.revision = 1;
    }
    if (!p.workspace.tasks) {
      p.workspace.tasks = { revision: 1, tasks: [], updatedAt: now };
    } else {
      if (p.workspace.tasks.revision === undefined) {
        p.workspace.tasks.revision = 1;
      }
      if (Array.isArray(p.workspace.tasks.tasks)) {
        p.workspace.tasks.tasks.forEach((t: { title?: string }, idx: number) => {
          if (!t.title || typeof t.title !== 'string' || !t.title.trim()) {
            t.title = `Task ${idx + 1}`;
          }
        });
      }
    }

    if (!p.workspace.songs || !Array.isArray(p.workspace.songs) || p.workspace.songs.length === 0) {
      p.workspace.songs = [{
        id: 'song-1',
        title: 'Song 1',
        order: 0,
        lyrics: p.workspace.lyrics,
        notes: p.workspace.notes,
        structure: p.workspace.structure,
        createdAt: now,
        updatedAt: now
      }];
      p.workspace.activeSongId = 'song-1';
    }
    if (!p.workspace.activeSongId) {
      p.workspace.activeSongId = p.workspace.songs[0]?.id || 'song-1';
    }
    const activeSong = p.workspace.songs.find((s) => s.id === p.workspace.activeSongId) || p.workspace.songs[0];
    if (activeSong) {
      p.workspace.lyrics = activeSong.lyrics;
      p.workspace.notes = activeSong.notes;
      p.workspace.structure = activeSong.structure;
    }
  }
}
