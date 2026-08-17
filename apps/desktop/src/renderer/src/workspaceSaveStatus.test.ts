import { describe, it, expect, vi } from 'vitest';

export type WorkspaceSaveStatus = 'saving' | 'saved' | 'unsaved';

export function getStatusBadgeData(status: WorkspaceSaveStatus): { className: string; label: string; dotClass: string } {
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  return {
    className: `workspace-status-badge ${status}`,
    label: `● ${label}`,
    dotClass: `status-dot ${status}`
  };
}

export async function executeWorkspaceSave<T>(
  saveCall: () => Promise<{ ok: boolean; workspace?: T; message?: string }>,
  currentLocalState: T,
  callbacks: {
    setStatus: (status: WorkspaceSaveStatus) => void;
    updateAuthoritativeState: (serverWorkspace: T) => void;
  }
): Promise<{ ok: boolean; state: T }> {
  callbacks.setStatus('saving');
  try {
    const res = await saveCall();
    if (res?.ok && res.workspace) {
      callbacks.updateAuthoritativeState(res.workspace);
      callbacks.setStatus('saved');
      return { ok: true, state: res.workspace };
    } else {
      callbacks.setStatus('unsaved');
      return { ok: false, state: currentLocalState };
    }
  } catch (err) {
    callbacks.setStatus('unsaved');
    return { ok: false, state: currentLocalState };
  }
}

/**
 * Mirror of realtime sync protection logic in main.ts
 */
export function handleRealtimeWorkspaceSync(
  local: {
    workspace: any;
    lyricsStatus: WorkspaceSaveStatus;
    hasPendingLyrics: boolean;
    notesStatus: WorkspaceSaveStatus;
    hasPendingNotes: boolean;
    lastSyncedNotes: string;
    structureStatus: WorkspaceSaveStatus;
    hasPendingStructure: boolean;
    tasksStatus: WorkspaceSaveStatus;
    hasPendingTasks: boolean;
  },
  incomingWorkspace: any
): {
  workspace: any;
  lyricsStatus: WorkspaceSaveStatus;
  notesStatus: WorkspaceSaveStatus;
  structureStatus: WorkspaceSaveStatus;
  tasksStatus: WorkspaceSaveStatus;
} {
  const resultWorkspace = { ...local.workspace };
  let newLyricsStatus = local.lyricsStatus;
  let newNotesStatus = local.notesStatus;
  let newStructureStatus = local.structureStatus;
  let newTasksStatus = local.tasksStatus;

  // 1. Lyrics
  if (!local.hasPendingLyrics && local.lyricsStatus === 'saved' && incomingWorkspace.lyrics) {
    resultWorkspace.lyrics = incomingWorkspace.lyrics;
    newLyricsStatus = 'saved';
  }

  // 2. Notes
  if (!local.hasPendingNotes && local.notesStatus === 'saved' && incomingWorkspace.notes) {
    resultWorkspace.notes = incomingWorkspace.notes;
    newNotesStatus = 'saved';
  } else if (local.hasPendingNotes || local.notesStatus !== 'saved') {
    // Preserves local notes and does not overwrite with saved
  }

  // 3. Structure
  if (!local.hasPendingStructure && local.structureStatus === 'saved' && incomingWorkspace.structure) {
    resultWorkspace.structure = incomingWorkspace.structure;
    newStructureStatus = 'saved';
  }

  // 4. Tasks
  if (!local.hasPendingTasks && local.tasksStatus === 'saved' && incomingWorkspace.tasks) {
    resultWorkspace.tasks = incomingWorkspace.tasks;
    newTasksStatus = 'saved';
  }

  return {
    workspace: resultWorkspace,
    lyricsStatus: newLyricsStatus,
    notesStatus: newNotesStatus,
    structureStatus: newStructureStatus,
    tasksStatus: newTasksStatus
  };
}

describe('Workspace Save Status & Failure Recovery', () => {
  it('correctly maps status badge classes and labels', () => {
    expect(getStatusBadgeData('saved')).toEqual({
      className: 'workspace-status-badge saved',
      label: '● Saved',
      dotClass: 'status-dot saved'
    });

    expect(getStatusBadgeData('saving')).toEqual({
      className: 'workspace-status-badge saving',
      label: '● Saving…',
      dotClass: 'status-dot saving'
    });

    expect(getStatusBadgeData('unsaved')).toEqual({
      className: 'workspace-status-badge unsaved',
      label: '● Save failed',
      dotClass: 'status-dot unsaved'
    });
  });

  it('handles Lyrics save success and replaces local state with server authoritative workspace', async () => {
    let status: WorkspaceSaveStatus = 'saved';
    let localWorkspace = { lyrics: { content: 'Local verse 1 edit' } };

    const serverWorkspace = { lyrics: { content: 'Server authoritative verse 1 edit' } };
    const mockSaveCall = vi.fn().mockResolvedValue({ ok: true, workspace: serverWorkspace });

    const result = await executeWorkspaceSave(
      mockSaveCall,
      localWorkspace,
      {
        setStatus: (s) => { status = s; },
        updateAuthoritativeState: (ws) => { localWorkspace = ws; }
      }
    );

    expect(result.ok).toBe(true);
    expect(status).toBe('saved');
    expect(localWorkspace.lyrics.content).toBe('Server authoritative verse 1 edit');
  });

  it('handles Notes save failure with ok:false without discarding local edits', async () => {
    let status: WorkspaceSaveStatus = 'saved';
    let localWorkspace = { notes: { content: 'Draft chord progression: Cmaj7 -> Dm7' } };

    const mockSaveCall = vi.fn().mockResolvedValue({ ok: false, message: 'Rate limit or validation error' });

    const result = await executeWorkspaceSave(
      mockSaveCall,
      localWorkspace,
      {
        setStatus: (s) => { status = s; },
        updateAuthoritativeState: (ws) => { localWorkspace = ws; }
      }
    );

    expect(result.ok).toBe(false);
    expect(status).toBe('unsaved');
    // Local edit preserved
    expect(localWorkspace.notes.content).toBe('Draft chord progression: Cmaj7 -> Dm7');
  });

  it('handles Structure save failure on network exception without discarding local edits', async () => {
    let status: WorkspaceSaveStatus = 'saved';
    let localWorkspace = {
      structure: { sections: [{ id: 's1', type: 'bridge', name: 'New Bridge', bars: 8 }] }
    };

    const mockSaveCall = vi.fn().mockRejectedValue(new Error('Network connection timeout'));

    const result = await executeWorkspaceSave(
      mockSaveCall,
      localWorkspace,
      {
        setStatus: (s) => { status = s; },
        updateAuthoritativeState: (ws) => { localWorkspace = ws; }
      }
    );

    expect(result.ok).toBe(false);
    expect(status).toBe('unsaved');
    expect(localWorkspace.structure.sections.length).toBe(1);
    expect(localWorkspace.structure.sections[0]?.name).toBe('New Bridge');
  });

  it('recovers to Saved status on subsequent successful retry after failure', async () => {
    let status: WorkspaceSaveStatus = 'saved';
    let localWorkspace = {
      tasks: { tasks: [{ id: 't1', title: 'Record Vocals', status: 'todo' }] }
    };

    // 1. First attempt fails
    const failCall = vi.fn().mockResolvedValue({ ok: false, message: 'Server temporarily unavailable' });
    await executeWorkspaceSave(
      failCall,
      localWorkspace,
      {
        setStatus: (s) => { status = s; },
        updateAuthoritativeState: (ws) => { localWorkspace = ws; }
      }
    );
    expect(status).toBe('unsaved');

    // 2. Retry succeeds
    const serverWorkspace = {
      tasks: { tasks: [{ id: 't1', title: 'Record Vocals', status: 'todo' }] }
    };
    const successCall = vi.fn().mockResolvedValue({ ok: true, workspace: serverWorkspace });
    await executeWorkspaceSave(
      successCall,
      localWorkspace,
      {
        setStatus: (s) => { status = s; },
        updateAuthoritativeState: (ws) => { localWorkspace = ws; }
      }
    );
    expect(status).toBe('saved');
    expect(localWorkspace.tasks.tasks[0]?.title).toBe('Record Vocals');
  });

  describe('Realtime Sync & Reconnect Protection', () => {
    it('preserves unsaved Lyrics when incoming realtime sync arrives', () => {
      const state = {
        workspace: {
          lyrics: { content: 'Unsaved draft chorus lyrics' },
          notes: { content: 'Clean notes' },
          structure: { sections: [] },
          tasks: { tasks: [] }
        },
        lyricsStatus: 'unsaved' as WorkspaceSaveStatus,
        hasPendingLyrics: true,
        notesStatus: 'saved' as WorkspaceSaveStatus,
        hasPendingNotes: false,
        lastSyncedNotes: 'Clean notes',
        structureStatus: 'saved' as WorkspaceSaveStatus,
        hasPendingStructure: false,
        tasksStatus: 'saved' as WorkspaceSaveStatus,
        hasPendingTasks: false
      };

      const incoming = {
        lyrics: { content: 'Remote old lyrics' },
        notes: { content: 'Updated remote notes' },
        structure: { sections: [{ id: 's1', type: 'intro', bars: 4 }] },
        tasks: { tasks: [{ id: 't1', title: 'Remote Task', status: 'todo' }] }
      };

      const result = handleRealtimeWorkspaceSync(state, incoming);

      // Local unsaved lyrics preserved and status stays unsaved
      expect(result.workspace.lyrics.content).toBe('Unsaved draft chorus lyrics');
      expect(result.lyricsStatus).toBe('unsaved');

      // Clean areas (notes, structure, tasks) updated to remote server state
      expect(result.workspace.notes.content).toBe('Updated remote notes');
      expect(result.notesStatus).toBe('saved');
      expect(result.workspace.structure.sections.length).toBe(1);
      expect(result.structureStatus).toBe('saved');
      expect(result.workspace.tasks.tasks.length).toBe(1);
      expect(result.tasksStatus).toBe('saved');
    });

    it('preserves unsaved Structure and Tasks across socket sync without marking saved', () => {
      const state = {
        workspace: {
          lyrics: { content: 'Clean lyrics' },
          notes: { content: 'Clean notes' },
          structure: { sections: [{ id: 's_local', type: 'outro', bars: 16 }] },
          tasks: { tasks: [{ id: 't_local', title: 'Local Task In Progress', status: 'in_progress' }] }
        },
        lyricsStatus: 'saved' as WorkspaceSaveStatus,
        hasPendingLyrics: false,
        notesStatus: 'saved' as WorkspaceSaveStatus,
        hasPendingNotes: false,
        lastSyncedNotes: 'Clean notes',
        structureStatus: 'unsaved' as WorkspaceSaveStatus,
        hasPendingStructure: true,
        tasksStatus: 'unsaved' as WorkspaceSaveStatus,
        hasPendingTasks: true
      };

      const incoming = {
        lyrics: { content: 'Clean lyrics updated' },
        notes: { content: 'Clean notes updated' },
        structure: { sections: [] },
        tasks: { tasks: [] }
      };

      const result = handleRealtimeWorkspaceSync(state, incoming);

      expect(result.workspace.structure.sections[0]?.id).toBe('s_local');
      expect(result.structureStatus).toBe('unsaved');
      expect(result.workspace.tasks.tasks[0]?.id).toBe('t_local');
      expect(result.tasksStatus).toBe('unsaved');

      expect(result.workspace.lyrics.content).toBe('Clean lyrics updated');
      expect(result.lyricsStatus).toBe('saved');
      expect(result.workspace.notes.content).toBe('Clean notes updated');
      expect(result.notesStatus).toBe('saved');
    });
  });
});
