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
});
