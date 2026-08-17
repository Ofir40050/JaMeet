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

export interface WorkspaceSaveContext {
  activeProjectId?: string;
  targetProjectId?: string;
  localEditGen?: number;
  targetEditGen?: number;
  saveAttemptGen?: number;
  targetSaveGen?: number;
}

export async function executeWorkspaceSave<T>(
  saveCall: () => Promise<{ ok: boolean; workspace?: T; message?: string }>,
  currentLocalState: T,
  callbacks: {
    setStatus: (status: WorkspaceSaveStatus) => void;
    updateAuthoritativeState: (serverWorkspace: T) => void;
  },
  context?: WorkspaceSaveContext
): Promise<{ ok: boolean; state: T }> {
  const isStaleDispatch = context?.targetSaveGen !== undefined && context?.saveAttemptGen !== undefined && context.targetSaveGen < context.saveAttemptGen;
  if (!isStaleDispatch) {
    callbacks.setStatus('saving');
  }
  try {
    const res = await saveCall();

    // Check project binding and generation matching
    const projectMatches = context?.targetProjectId === undefined || context?.activeProjectId === undefined || context.targetProjectId === context.activeProjectId;
    const editGenMatches = context?.targetEditGen === undefined || context?.localEditGen === undefined || context.targetEditGen === context.localEditGen;
    const saveGenMatches = context?.targetSaveGen === undefined || context?.saveAttemptGen === undefined || context.targetSaveGen === context.saveAttemptGen;
    const isLatest = projectMatches && editGenMatches && saveGenMatches;

    if (!isLatest) {
      // Stale response from older save attempt or previous project: do not overwrite local state or change status
      return { ok: res?.ok ?? false, state: currentLocalState };
    }

    if (res?.ok && res.workspace) {
      callbacks.updateAuthoritativeState(res.workspace);
      callbacks.setStatus('saved');
      return { ok: true, state: res.workspace };
    } else {
      callbacks.setStatus('unsaved');
      return { ok: false, state: currentLocalState };
    }
  } catch (err) {
    const projectMatches = context?.targetProjectId === undefined || context?.activeProjectId === undefined || context.targetProjectId === context.activeProjectId;
    const editGenMatches = context?.targetEditGen === undefined || context?.localEditGen === undefined || context.targetEditGen === context.localEditGen;
    const saveGenMatches = context?.targetSaveGen === undefined || context?.saveAttemptGen === undefined || context.targetSaveGen === context.saveAttemptGen;
    const isLatest = projectMatches && editGenMatches && saveGenMatches;

    if (isLatest) {
      callbacks.setStatus('unsaved');
    }
    return { ok: false, state: currentLocalState };
  }
}

/**
 * Mirror of applyAuthoritativeWorkspaceUpdate logic in main.ts
 * Applies authoritative server state ONLY to the specific saved area.
 */
export function applyAuthoritativeWorkspaceUpdate(
  savedArea: 'lyrics' | 'notes' | 'structure' | 'tasks',
  currentWorkspace: any,
  serverWorkspace: any
): any {
  const result = {
    lyrics: { ...currentWorkspace?.lyrics },
    notes: { ...currentWorkspace?.notes },
    structure: { ...currentWorkspace?.structure },
    tasks: { ...currentWorkspace?.tasks }
  };

  if (savedArea === 'lyrics' && serverWorkspace.lyrics) {
    result.lyrics = serverWorkspace.lyrics;
  } else if (savedArea === 'notes' && serverWorkspace.notes) {
    result.notes = serverWorkspace.notes;
  } else if (savedArea === 'structure' && serverWorkspace.structure) {
    result.structure = serverWorkspace.structure;
  } else if (savedArea === 'tasks' && serverWorkspace.tasks) {
    result.tasks = serverWorkspace.tasks;
  }

  return result;
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
});

describe('Dual-Generation & Project Context Stale Save Protection', () => {
  describe('Project Context Binding', () => {
    it('completely ignores a save response arriving from a previous project after switching projects', async () => {
      let status: WorkspaceSaveStatus = 'saving';
      let currentWorkspace = { lyrics: { content: 'Project B Lyrics' } };

      const projectAServerResponse = {
        lyrics: { content: 'Project A Old Lyrics from in-flight save' }
      };
      const mockSaveCall = vi.fn().mockResolvedValue({ ok: true, workspace: projectAServerResponse });

      await executeWorkspaceSave(
        mockSaveCall,
        currentWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { currentWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_A',
          activeProjectId: 'proj_B', // User switched to Project B
          targetEditGen: 1,
          localEditGen: 1,
          targetSaveGen: 1,
          saveAttemptGen: 1
        }
      );

      // Project B's state and status are completely untouched!
      expect(currentWorkspace.lyrics.content).toBe('Project B Lyrics');
      expect(status).toBe('saving');
    });

    it('ignores an older project save failure without overwriting the new project save status', async () => {
      let status: WorkspaceSaveStatus = 'saving';
      let currentWorkspace = { notes: { content: 'Project B Fresh Notes' } };

      const mockSaveCall = vi.fn().mockRejectedValue(new Error('Network error on Project A'));

      await executeWorkspaceSave(
        mockSaveCall,
        currentWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { currentWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_A',
          activeProjectId: 'proj_B',
          targetEditGen: 1,
          localEditGen: 1,
          targetSaveGen: 1,
          saveAttemptGen: 1
        }
      );

      // Status remains 'saving' for Project B, not changed to 'unsaved'
      expect(status).toBe('saving');
      expect(currentWorkspace.notes.content).toBe('Project B Fresh Notes');
    });
  });

  describe('Newer Local Edits During In-Flight Save', () => {
    it('protects newer Lyrics edits from older in-flight save response', async () => {
      let status: WorkspaceSaveStatus = 'saving';
      let localWorkspace = { lyrics: { content: 'Verse 1 + Chorus (New local edit)' } };

      // Earlier save response only has Verse 1
      const staleServerResponse = { lyrics: { content: 'Verse 1 only (Stale)' } };
      const mockSaveCall = vi.fn().mockResolvedValue({ ok: true, workspace: staleServerResponse });

      await executeWorkspaceSave(
        mockSaveCall,
        localWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { localWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_1',
          activeProjectId: 'proj_1',
          targetEditGen: 1, // save was dispatched for edit gen 1
          localEditGen: 2,  // user typed more -> edit gen is now 2
          targetSaveGen: 1,
          saveAttemptGen: 1
        }
      );

      // Stale response must not overwrite newer local edit or mark as saved
      expect(localWorkspace.lyrics.content).toBe('Verse 1 + Chorus (New local edit)');
      expect(status).toBe('saving');
    });

    it('protects newer Notes edits from older in-flight save response', async () => {
      let status: WorkspaceSaveStatus = 'saving';
      let localWorkspace = { notes: { content: 'Key: Am -> Bridge transition note (Newer)' } };

      const staleServerResponse = { notes: { content: 'Key: Am (Stale)' } };
      const mockSaveCall = vi.fn().mockResolvedValue({ ok: true, workspace: staleServerResponse });

      await executeWorkspaceSave(
        mockSaveCall,
        localWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { localWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_1',
          activeProjectId: 'proj_1',
          targetEditGen: 1,
          localEditGen: 2,
          targetSaveGen: 1,
          saveAttemptGen: 1
        }
      );

      expect(localWorkspace.notes.content).toBe('Key: Am -> Bridge transition note (Newer)');
      expect(status).toBe('saving');
    });

    it('protects Song Structure sections added while earlier save is in flight so debounced save can persist them', async () => {
      let status: WorkspaceSaveStatus = 'saving';
      // User added Intro, and while saving, added Verse and Chorus
      let localWorkspace = {
        structure: {
          sections: [
            { id: 's1', type: 'intro', name: 'Intro', bars: 8 },
            { id: 's2', type: 'verse', name: 'Verse 1', bars: 16 },
            { id: 's3', type: 'chorus', name: 'Chorus 1', bars: 16 }
          ]
        }
      };

      // Stale response only contains Intro
      const staleServerResponse = {
        structure: {
          sections: [{ id: 's1', type: 'intro', name: 'Intro', bars: 8 }]
        }
      };
      const mockSaveCall = vi.fn().mockResolvedValue({ ok: true, workspace: staleServerResponse });

      await executeWorkspaceSave(
        mockSaveCall,
        localWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { localWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_1',
          activeProjectId: 'proj_1',
          targetEditGen: 1,
          localEditGen: 3, // 2 more sections added
          targetSaveGen: 1,
          saveAttemptGen: 1
        }
      );

      // In-memory sections are preserved for the subsequent debounced save
      expect(localWorkspace.structure.sections.length).toBe(3);
      expect(localWorkspace.structure.sections.map((s) => s.name)).toEqual(['Intro', 'Verse 1', 'Chorus 1']);
      expect(status).toBe('saving');
    });

    it('protects Tasks modified while earlier save is in flight so debounced save can persist them', async () => {
      let status: WorkspaceSaveStatus = 'saving';
      let localWorkspace = {
        tasks: {
          tasks: [
            { id: 't1', title: 'Record Vocals', status: 'done' as const },
            { id: 't2', title: 'Mix Track', status: 'todo' as const }
          ]
        }
      };

      const staleServerResponse = {
        tasks: {
          tasks: [
            { id: 't1', title: 'Record Vocals', status: 'todo' as const }
          ]
        }
      };
      const mockSaveCall = vi.fn().mockResolvedValue({ ok: true, workspace: staleServerResponse });

      await executeWorkspaceSave(
        mockSaveCall,
        localWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { localWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_1',
          activeProjectId: 'proj_1',
          targetEditGen: 1,
          localEditGen: 2,
          targetSaveGen: 1,
          saveAttemptGen: 1
        }
      );

      expect(localWorkspace.tasks.tasks.length).toBe(2);
      expect(localWorkspace.tasks.tasks[0]?.status).toBe('done');
      expect(localWorkspace.tasks.tasks[1]?.title).toBe('Mix Track');
      expect(status).toBe('saving');
    });
  });

  describe('Multiple Save Attempts for the Same Edit Generation', () => {
    it('prevents an older save attempt from overriding a newer save attempt for the same edit generation', async () => {
      let status: WorkspaceSaveStatus = 'saving';
      let localWorkspace = { lyrics: { content: 'Verse 1' } };

      const attempt1Response = { lyrics: { content: 'Verse 1 (Attempt 1 Response)' } };
      const attempt2Response = { lyrics: { content: 'Verse 1 (Attempt 2 Response)' } };

      // Attempt 2 completes first and succeeds
      await executeWorkspaceSave(
        vi.fn().mockResolvedValue({ ok: true, workspace: attempt2Response }),
        localWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { localWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_1',
          activeProjectId: 'proj_1',
          targetEditGen: 1,
          localEditGen: 1,
          targetSaveGen: 2, // Attempt 2
          saveAttemptGen: 2  // latest save attempt is 2
        }
      );
      expect(status).toBe('saved');
      expect(localWorkspace.lyrics.content).toBe('Verse 1 (Attempt 2 Response)');

      // Attempt 1 finishes later
      await executeWorkspaceSave(
        vi.fn().mockResolvedValue({ ok: true, workspace: attempt1Response }),
        localWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { localWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_1',
          activeProjectId: 'proj_1',
          targetEditGen: 1,
          localEditGen: 1,
          targetSaveGen: 1, // Attempt 1 (older saveGen)
          saveAttemptGen: 2  // latest save attempt is 2
        }
      );

      // Attempt 1 must NOT override Attempt 2's authoritative state or status
      expect(localWorkspace.lyrics.content).toBe('Verse 1 (Attempt 2 Response)');
      expect(status).toBe('saved');
    });

    it('prevents a late failure of Attempt 1 from turning Attempt 2 saved status into unsaved', async () => {
      let status: WorkspaceSaveStatus = 'saving';
      let localWorkspace = { notes: { content: 'Guitar tuning: DADGAD' } };

      const attempt2Response = { notes: { content: 'Guitar tuning: DADGAD' } };

      // Attempt 2 succeeds
      await executeWorkspaceSave(
        vi.fn().mockResolvedValue({ ok: true, workspace: attempt2Response }),
        localWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { localWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_1',
          activeProjectId: 'proj_1',
          targetEditGen: 1,
          localEditGen: 1,
          targetSaveGen: 2,
          saveAttemptGen: 2
        }
      );
      expect(status).toBe('saved');

      // Attempt 1 fails later
      await executeWorkspaceSave(
        vi.fn().mockRejectedValue(new Error('Connection reset on attempt 1')),
        localWorkspace,
        {
          setStatus: (s) => { status = s; },
          updateAuthoritativeState: (ws) => { localWorkspace = ws; }
        },
        {
          targetProjectId: 'proj_1',
          activeProjectId: 'proj_1',
          targetEditGen: 1,
          localEditGen: 1,
          targetSaveGen: 1,
          saveAttemptGen: 2
        }
      );

      // Status must remain 'saved'
      expect(status).toBe('saved');
      expect(localWorkspace.notes.content).toBe('Guitar tuning: DADGAD');
    });
  });

  describe('Isolated Per-Area Save Responses & Cross-Area Out-Of-Order Handling', () => {
    it('applies authoritative server state ONLY to Lyrics when Lyrics save succeeds', () => {
      const currentWorkspace = {
        lyrics: { content: 'Old Lyrics' },
        notes: { content: 'Newer Unsaved Notes' },
        structure: { sections: [{ id: 's1', name: 'Newer Section' }] },
        tasks: { tasks: [{ id: 't1', title: 'Newer Task' }] }
      };

      // Server returns complete workspace snapshot, where notes/structure/tasks may be stale
      const serverResponseWorkspace = {
        lyrics: { content: 'Authoritative Persisted Lyrics' },
        notes: { content: 'Stale Notes Snapshot' },
        structure: { sections: [] },
        tasks: { tasks: [] }
      };

      const updated = applyAuthoritativeWorkspaceUpdate('lyrics', currentWorkspace, serverResponseWorkspace);

      // Only Lyrics is updated
      expect(updated.lyrics.content).toBe('Authoritative Persisted Lyrics');
      // Other areas are completely untouched
      expect(updated.notes.content).toBe('Newer Unsaved Notes');
      expect(updated.structure.sections[0]?.name).toBe('Newer Section');
      expect(updated.tasks.tasks[0]?.title).toBe('Newer Task');
    });

    it('applies authoritative server state ONLY to Notes when Notes save succeeds', () => {
      const currentWorkspace = {
        lyrics: { content: 'Newer Unsaved Lyrics' },
        notes: { content: 'Old Notes' },
        structure: { sections: [{ id: 's1', name: 'Newer Section' }] },
        tasks: { tasks: [{ id: 't1', title: 'Newer Task' }] }
      };

      const serverResponseWorkspace = {
        lyrics: { content: 'Stale Lyrics Snapshot' },
        notes: { content: 'Authoritative Persisted Notes' },
        structure: { sections: [] },
        tasks: { tasks: [] }
      };

      const updated = applyAuthoritativeWorkspaceUpdate('notes', currentWorkspace, serverResponseWorkspace);

      expect(updated.notes.content).toBe('Authoritative Persisted Notes');
      expect(updated.lyrics.content).toBe('Newer Unsaved Lyrics');
      expect(updated.structure.sections[0]?.name).toBe('Newer Section');
      expect(updated.tasks.tasks[0]?.title).toBe('Newer Task');
    });

    it('applies authoritative server state ONLY to Structure when Structure save succeeds', () => {
      const currentWorkspace = {
        lyrics: { content: 'Newer Lyrics' },
        notes: { content: 'Newer Notes' },
        structure: { sections: [{ id: 's1', name: 'Old Section' }] },
        tasks: { tasks: [{ id: 't1', title: 'Newer Task' }] }
      };

      const serverResponseWorkspace = {
        lyrics: { content: 'Stale Lyrics' },
        notes: { content: 'Stale Notes' },
        structure: { sections: [{ id: 's1', name: 'Authoritative Persisted Section' }] },
        tasks: { tasks: [] }
      };

      const updated = applyAuthoritativeWorkspaceUpdate('structure', currentWorkspace, serverResponseWorkspace);

      expect(updated.structure.sections[0]?.name).toBe('Authoritative Persisted Section');
      expect(updated.lyrics.content).toBe('Newer Lyrics');
      expect(updated.notes.content).toBe('Newer Notes');
      expect(updated.tasks.tasks[0]?.title).toBe('Newer Task');
    });

    it('applies authoritative server state ONLY to Tasks when Tasks save succeeds', () => {
      const currentWorkspace = {
        lyrics: { content: 'Newer Lyrics' },
        notes: { content: 'Newer Notes' },
        structure: { sections: [{ id: 's1', name: 'Newer Section' }] },
        tasks: { tasks: [{ id: 't1', title: 'Old Task' }] }
      };

      const serverResponseWorkspace = {
        lyrics: { content: 'Stale Lyrics' },
        notes: { content: 'Stale Notes' },
        structure: { sections: [] },
        tasks: { tasks: [{ id: 't1', title: 'Authoritative Persisted Task' }] }
      };

      const updated = applyAuthoritativeWorkspaceUpdate('tasks', currentWorkspace, serverResponseWorkspace);

      expect(updated.tasks.tasks[0]?.title).toBe('Authoritative Persisted Task');
      expect(updated.lyrics.content).toBe('Newer Lyrics');
      expect(updated.notes.content).toBe('Newer Notes');
      expect(updated.structure.sections[0]?.name).toBe('Newer Section');
    });

    it('handles out-of-order save responses across different workspace areas without regression', () => {
      let workspace = {
        lyrics: { content: 'Lyrics Edit 1' },
        notes: { content: 'Notes Edit 1' },
        structure: { sections: [{ id: 's1', name: 'Structure Edit 1' }] },
        tasks: { tasks: [{ id: 't1', title: 'Tasks Edit 1' }] }
      };

      // 1. Notes save completes with its response
      const notesServerResponse = {
        lyrics: { content: 'Stale Lyrics snapshot from Notes server payload' },
        notes: { content: 'Authoritative Notes 1' },
        structure: { sections: [] },
        tasks: { tasks: [] }
      };
      workspace = applyAuthoritativeWorkspaceUpdate('notes', workspace, notesServerResponse);

      // Notes updated, Lyrics preserved
      expect(workspace.notes.content).toBe('Authoritative Notes 1');
      expect(workspace.lyrics.content).toBe('Lyrics Edit 1');

      // 2. Lyrics save completes later with its response
      const lyricsServerResponse = {
        lyrics: { content: 'Authoritative Lyrics 1' },
        notes: { content: 'Old Stale Notes snapshot from Lyrics server payload' },
        structure: { sections: [] },
        tasks: { tasks: [] }
      };
      workspace = applyAuthoritativeWorkspaceUpdate('lyrics', workspace, lyricsServerResponse);

      // Both Notes and Lyrics retain their respective latest authoritative state!
      expect(workspace.lyrics.content).toBe('Authoritative Lyrics 1');
      expect(workspace.notes.content).toBe('Authoritative Notes 1');
      expect(workspace.structure.sections[0]?.name).toBe('Structure Edit 1');
      expect(workspace.tasks.tasks[0]?.title).toBe('Tasks Edit 1');
    });
  });

  describe('Realtime Sync & Reconnect Preservation', () => {
    it('preserves unsaved Lyrics and status across realtime socket sync', () => {
      const state = {
        workspace: {
          lyrics: { content: 'Unsaved local draft lyrics' },
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
        lyrics: { content: 'Remote server lyrics' },
        notes: { content: 'Updated remote notes' },
        structure: { sections: [{ id: 's1', type: 'intro', bars: 4 }] },
        tasks: { tasks: [{ id: 't1', title: 'Remote Task', status: 'todo' }] }
      };

      const result = handleRealtimeWorkspaceSync(state, incoming);

      expect(result.workspace.lyrics.content).toBe('Unsaved local draft lyrics');
      expect(result.lyricsStatus).toBe('unsaved');
      expect(result.workspace.notes.content).toBe('Updated remote notes');
      expect(result.notesStatus).toBe('saved');
      expect(result.workspace.structure.sections.length).toBe(1);
      expect(result.structureStatus).toBe('saved');
      expect(result.workspace.tasks.tasks.length).toBe(1);
      expect(result.tasksStatus).toBe('saved');
    });

    it('preserves unsaved Structure and Tasks across realtime socket sync', () => {
      const state = {
        workspace: {
          lyrics: { content: 'Clean lyrics' },
          notes: { content: 'Clean notes' },
          structure: { sections: [{ id: 's_local', type: 'outro', bars: 16 }] },
          tasks: { tasks: [{ id: 't_local', title: 'Local Task', status: 'in_progress' }] }
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
