import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from './projects.js';
import type { UserProfile } from '@musiczoom/shared';

describe('ProjectStore & Workspace', () => {
  let tmpDir: string;
  let projectStore: ProjectStore;

  const mockOwner: UserProfile = {
    id: 'user-1',
    displayName: 'Producer Dan',
    username: 'producerdan',
    email: 'dan@music.com',
    avatarColor: '#8b5cf6',
    isGuest: false,
    createdAt: Date.now()
  };

  const mockCollaborator: UserProfile = {
    id: 'user-2',
    displayName: 'Singer Sarah',
    username: 'singersarah',
    email: 'sarah@music.com',
    avatarColor: '#ec4899',
    isGuest: false,
    createdAt: Date.now()
  };

  const mockStranger: UserProfile = {
    id: 'user-99',
    displayName: 'Stranger',
    username: 'stranger',
    email: 'stranger@music.com',
    avatarColor: '#94a3b8',
    isGuest: false,
    createdAt: Date.now()
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-project-test-'));
    projectStore = new ProjectStore(tmpDir);
  });

  it('creates project with initialized empty workspace', () => {
    const project = projectStore.createProject(mockOwner, { name: 'Summer Hit' }, [mockCollaborator]);
    expect(project).toBeDefined();
    expect(project.name).toBe('Summer Hit');
    expect(project.workspace).toBeDefined();
    expect(project.workspace.lyrics.content).toBe('');
    expect(project.workspace.notes.content).toBe('');
  });

  it('allows owner and collaborators to update lyrics and notes with persistence', () => {
    const project = projectStore.createProject(mockOwner, { name: 'Album Track 1' }, [mockCollaborator]);
    
    // Owner updates lyrics
    const updated1 = projectStore.updateWorkspace(project.id, mockOwner, {
      lyrics: { content: '[Verse 1]\nWalking in the moonlight...' }
    });
    expect(updated1).not.toBeNull();
    expect(updated1?.workspace.lyrics.content).toContain('Walking in the moonlight');
    expect(updated1?.workspace.lyrics.updatedBy).toBe(mockOwner.id);

    // Collaborator updates notes and BPM
    const updated2 = projectStore.updateWorkspace(project.id, mockCollaborator, {
      notes: { content: 'Key sounds better in F# min', bpm: '128', key: 'F# minor' }
    });
    expect(updated2).not.toBeNull();
    expect(updated2?.workspace.notes.content).toBe('Key sounds better in F# min');
    expect(updated2?.workspace.notes.bpm).toBe('128');
    expect(updated2?.workspace.notes.key).toBe('F# minor');
    expect(updated2?.workspace.lyrics.content).toContain('Walking in the moonlight');

    // Reload from disk to verify persistence
    const reloadedStore = new ProjectStore(tmpDir);
    const reloadedProject = reloadedStore.getProject(project.id, mockOwner.id);
    expect(reloadedProject?.workspace.lyrics.content).toContain('Walking in the moonlight');
    expect(reloadedProject?.workspace.notes.bpm).toBe('128');
  });

  it('supports multiple lyrics documents per project with switching, renaming, and persistence', () => {
    const project = projectStore.createProject(mockOwner, { name: 'Multi-Doc Album' }, [mockCollaborator]);
    expect(project.workspace.lyrics.documents.length).toBe(1);
    expect(project.workspace.lyrics.documents[0].title).toBe('Main Lyrics');

    // 1. Create a new document "Draft 2"
    const updated1 = projectStore.updateWorkspace(project.id, mockOwner, {
      lyrics: {
        documentId: 'doc-draft-2',
        title: 'Draft 2 (Acoustic)',
        content: '<h1>Acoustic Version</h1><p>[Verse 1]<br>Soft acoustic guitar intro...</p>',
        activeDocumentId: 'doc-draft-2'
      }
    });

    expect(updated1?.workspace.lyrics.documents.length).toBe(2);
    expect(updated1?.workspace.lyrics.activeDocumentId).toBe('doc-draft-2');
    expect(updated1?.workspace.lyrics.content).toContain('Soft acoustic guitar intro');

    // 2. Collaborator updates "Main Lyrics" without changing active doc
    const updated2 = projectStore.updateWorkspace(project.id, mockCollaborator, {
      lyrics: {
        documentId: 'doc-main',
        content: '<b>Studio Master Lyrics</b>'
      }
    });
    expect(updated2?.workspace.lyrics.documents.find(d => d.id === 'doc-main')?.content).toBe('<b>Studio Master Lyrics</b>');

    // 3. Switch back to "Main Lyrics"
    const updated3 = projectStore.updateWorkspace(project.id, mockOwner, {
      lyrics: {
        activeDocumentId: 'doc-main'
      }
    });
    expect(updated3?.workspace.lyrics.activeDocumentId).toBe('doc-main');
    expect(updated3?.workspace.lyrics.content).toBe('<b>Studio Master Lyrics</b>');

    // 4. Reload from disk to verify all documents persisted
    const reloadedStore = new ProjectStore(tmpDir);
    const reloadedProject = reloadedStore.getProject(project.id, mockOwner.id);
    expect(reloadedProject?.workspace.lyrics.documents.length).toBe(2);
    expect(reloadedProject?.workspace.lyrics.documents[1].title).toBe('Draft 2 (Acoustic)');
  });

  it('supports Song Structure arrangement sections with bar counts, notes, reordering and disk persistence', () => {
    const project = projectStore.createProject(mockOwner, { name: 'Arrangement Project' }, [mockCollaborator]);
    expect(project.workspace.structure).toBeDefined();
    expect(project.workspace.structure.sections.length).toBe(0);

    // 1. Add arrangement sections
    const updated1 = projectStore.updateWorkspace(project.id, mockOwner, {
      structure: {
        sections: [
          { id: 'sec_1', type: 'intro', name: 'Intro', bars: 8, note: 'Rhodes piano & ambient pad', updatedAt: Date.now() },
          { id: 'sec_2', type: 'verse', name: 'Verse 1', bars: 16, note: 'Bass & soft drum groove enters', updatedAt: Date.now() },
          { id: 'sec_3', type: 'chorus', name: 'Chorus 1', bars: 16, note: 'Full hook with vocal stacks', updatedAt: Date.now() },
          { id: 'sec_4', type: 'outro', name: 'Outro', bars: 8, note: 'Fade out on guitar riff', updatedAt: Date.now() }
        ]
      }
    });

    expect(updated1?.workspace.structure.sections.length).toBe(4);
    expect(updated1?.workspace.structure.sections[0].type).toBe('intro');
    expect(updated1?.workspace.structure.sections[1].bars).toBe(16);
    expect(updated1?.workspace.structure.sections[2].note).toContain('vocal stacks');

    // 2. Collaborator reorders / edits sections (e.g. inserts Bridge before Outro)
    const updated2 = projectStore.updateWorkspace(project.id, mockCollaborator, {
      structure: {
        sections: [
          { id: 'sec_1', type: 'intro', name: 'Intro', bars: 8, note: 'Rhodes piano & ambient pad', updatedAt: Date.now() },
          { id: 'sec_2', type: 'verse', name: 'Verse 1', bars: 16, note: 'Bass & soft drum groove enters', updatedAt: Date.now() },
          { id: 'sec_3', type: 'chorus', name: 'Chorus 1', bars: 16, note: 'Full hook with vocal stacks', updatedAt: Date.now() },
          { id: 'sec_bridge', type: 'bridge', name: 'Bridge', bars: 8, note: 'Drum breakdown & modulation', updatedAt: Date.now() },
          { id: 'sec_4', type: 'outro', name: 'Outro', bars: 8, note: 'Fade out on guitar riff', updatedAt: Date.now() }
        ]
      }
    });

    expect(updated2?.workspace.structure.sections.length).toBe(5);
    expect(updated2?.workspace.structure.sections[3].type).toBe('bridge');

    // 3. Verify disk reload
    const reloadedStore = new ProjectStore(tmpDir);
    const reloaded = reloadedStore.getProject(project.id, mockOwner.id);
    expect(reloaded?.workspace.structure.sections.length).toBe(5);
    expect(reloaded?.workspace.structure.sections[3].name).toBe('Bridge');
    expect(reloaded?.workspace.structure.sections[3].bars).toBe(8);
  });

  it('supports Tasks workspace with creation, assignment, status changes, and disk persistence', () => {
    const project = projectStore.createProject(mockOwner, { name: 'Tasks Project' }, [mockCollaborator]);
    expect(project.workspace.tasks).toBeDefined();
    expect(project.workspace.tasks.tasks.length).toBe(0);

    // 1. Owner adds music production tasks
    const updated1 = projectStore.updateWorkspace(project.id, mockOwner, {
      tasks: {
        tasks: [
          {
            id: 'task_1',
            title: 'Record final vocals',
            status: 'in_progress',
            assigneeId: mockOwner.id,
            assigneeName: mockOwner.displayName,
            note: 'Use Neumann U87 through 1073 preamp',
            dueDate: '2026-08-20',
            createdAt: Date.now(),
            updatedAt: Date.now()
          },
          {
            id: 'task_2',
            title: 'Add chorus guitars',
            status: 'todo',
            assigneeId: mockCollaborator.id,
            assigneeName: mockCollaborator.displayName,
            note: 'Layer acoustic rhythm and electric lead lines',
            dueDate: '2026-08-22',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      }
    });

    expect(updated1?.workspace.tasks.tasks.length).toBe(2);
    expect(updated1?.workspace.tasks.tasks[0].title).toBe('Record final vocals');
    expect(updated1?.workspace.tasks.tasks[0].status).toBe('in_progress');
    expect(updated1?.workspace.tasks.tasks[1].assigneeName).toBe(mockCollaborator.displayName);

    const task0 = updated1?.workspace.tasks.tasks[0];
    const task1 = updated1?.workspace.tasks.tasks[1];
    expect(task0).toBeDefined();
    expect(task1).toBeDefined();

    // 2. Collaborator completes task_2 and adds a new task
    const updated2 = projectStore.updateWorkspace(project.id, mockCollaborator, {
      tasks: {
        tasks: [
          task0!,
          {
            ...task1!,
            status: 'done',
            completedAt: Date.now(),
            updatedAt: Date.now()
          },
          {
            id: 'task_3',
            title: 'Send new mix to mastering',
            status: 'todo',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      }
    });

    expect(updated2?.workspace.tasks.tasks.length).toBe(3);
    expect(updated2?.workspace.tasks.tasks[1]?.status).toBe('done');
    expect(updated2?.workspace.tasks.tasks[2]?.title).toBe('Send new mix to mastering');

    // 3. Verify disk reload
    const reloadedStore = new ProjectStore(tmpDir);
    const reloaded = reloadedStore.getProject(project.id, mockOwner.id);
    expect(reloaded?.workspace.tasks.tasks.length).toBe(3);
    expect(reloaded?.workspace.tasks.tasks[1]?.status).toBe('done');
    expect(reloaded?.workspace.tasks.tasks[1]?.completedAt).toBeDefined();
  });

  it('rejects unauthorized users from updating workspace', () => {
    const project = projectStore.createProject(mockOwner, { name: 'Private Demo' });
    const stranger: UserProfile = {
      id: 'usr_stranger',
      username: 'stranger',
      displayName: 'Stranger',
      email: 'stranger@example.com',
      isGuest: false,
      avatarColor: '#3b82f6',
      createdAt: Date.now()
    };

    const res = projectStore.updateWorkspace(project.id, stranger, {
      notes: { content: 'Hacked notes' }
    });
    expect(res).toBeNull();
  });

  it('records chronological project activities and throttles rapid typing edits', () => {
    // 1. Creation generates project_created activity
    const project = projectStore.createProject(mockOwner, { name: 'Chronicle Project' });
    expect(project.activities.length).toBe(1);
    expect(project.activities[0].type).toBe('project_created');
    expect(project.activities[0].summary).toContain('created project');

    // 2. Collaborator added
    projectStore.addCollaborator(project.id, mockOwner.id, mockCollaborator);
    const pWithCollab = projectStore.getProject(project.id, mockOwner.id);
    expect(pWithCollab?.activities[0].type).toBe('collaborator_added');

    // 3. BPM change
    projectStore.updateWorkspace(project.id, mockCollaborator, {
      notes: { bpm: '128' }
    });
    const pBpm = projectStore.getProject(project.id, mockOwner.id);
    expect(pBpm?.activities[0].type).toBe('notes_bpm_changed');
    expect(pBpm?.activities[0].summary).toContain('128 BPM');

    // 4. Continuous typing consolidation: 3 rapid notes edits by same user within 10 min
    projectStore.updateWorkspace(project.id, mockOwner, {
      notes: { content: 'Intro chord' }
    });
    const pNotes1 = projectStore.getProject(project.id, mockOwner.id);
    const countBefore = pNotes1!.activities.length;

    projectStore.updateWorkspace(project.id, mockOwner, {
      notes: { content: 'Intro chords: F#m7 -> B9' }
    });
    projectStore.updateWorkspace(project.id, mockOwner, {
      notes: { content: 'Intro chords: F#m7 -> B9 -> Emaj7' }
    });
    const pNotes2 = projectStore.getProject(project.id, mockOwner.id);
    // Count should not increase three times because rapid edits consolidate!
    expect(pNotes2!.activities.length).toBe(countBefore);
    expect(pNotes2!.activities[0].type).toBe('notes_edited');

    // 5. Task creation & completion
    projectStore.updateWorkspace(project.id, mockCollaborator, {
      tasks: {
        tasks: [
          {
            id: 'task_voc',
            title: 'Record Lead Vocals',
            status: 'todo',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      }
    });
    let pTasks = projectStore.getProject(project.id, mockOwner.id);
    expect(pTasks?.activities[0].type).toBe('task_created');

    projectStore.updateWorkspace(project.id, mockOwner, {
      tasks: {
        tasks: [
          {
            id: 'task_voc',
            title: 'Record Lead Vocals',
            status: 'done',
            createdAt: Date.now(),
            completedAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      }
    });
    pTasks = projectStore.getProject(project.id, mockOwner.id);
    expect(pTasks?.activities[0].type).toBe('task_completed');
    expect(pTasks?.activities[0].summary).toContain('completed "Record Lead Vocals"');

    // 6. Verify disk persistence across store reload
    const reloadedStore = new ProjectStore(tmpDir);
    const reloaded = reloadedStore.getProject(project.id, mockOwner.id);
    expect(reloaded?.activities.length).toBeGreaterThan(4);
    expect(reloaded?.activities[0].type).toBe('task_completed');
  });

  it('strictly enforces role permissions: viewer is read-only, editor/collaborator can edit workspace, owner has admin', () => {
    const mockEditor: UserProfile = {
      id: 'user-editor',
      displayName: 'Audio Editor Alex',
      username: 'alexeditor',
      email: 'alex@music.com',
      avatarColor: '#10b981',
      isGuest: false,
      createdAt: Date.now()
    };

    const mockViewer: UserProfile = {
      id: 'user-viewer',
      displayName: 'Observer Olivia',
      username: 'oliviaviewer',
      email: 'olivia@music.com',
      avatarColor: '#6366f1',
      isGuest: false,
      createdAt: Date.now()
    };

    const project = projectStore.createProject(mockOwner, { name: 'Permission Master' });

    // 1. Owner adds collaborator with 'editor' role, and another with 'viewer' role
    const withEditor = projectStore.addCollaborator(project.id, mockOwner.id, mockEditor, 'editor');
    expect(withEditor).not.toBeNull();
    expect(projectStore.getUserRole(project.id, mockEditor.id)).toBe('editor');

    const withViewer = projectStore.addCollaborator(project.id, mockOwner.id, mockViewer, 'viewer');
    expect(withViewer).not.toBeNull();
    expect(projectStore.getUserRole(project.id, mockViewer.id)).toBe('viewer');

    // 2. Editor CAN modify workspace content (lyrics, notes, structure, tasks)
    const editorLyricsUpdate = projectStore.updateWorkspace(project.id, mockEditor, {
      lyrics: { content: 'Lyrics edited by editor Alex' }
    });
    expect(editorLyricsUpdate).not.toBeNull();
    expect(editorLyricsUpdate?.workspace.lyrics.content).toBe('Lyrics edited by editor Alex');

    // 3. Viewer CANNOT modify workspace content (returns null)
    const viewerLyricsUpdate = projectStore.updateWorkspace(project.id, mockViewer, {
      lyrics: { content: 'Malicious overwrite by viewer' }
    });
    expect(viewerLyricsUpdate).toBeNull();

    const viewerNotesUpdate = projectStore.updateWorkspace(project.id, mockViewer, {
      notes: { bpm: '160', content: 'Viewer note' }
    });
    expect(viewerNotesUpdate).toBeNull();

    const viewerStructureUpdate = projectStore.updateWorkspace(project.id, mockViewer, {
      structure: { sections: [{ id: 'sec_v', type: 'intro', name: 'Viewer Intro', updatedAt: Date.now() }] }
    });
    expect(viewerStructureUpdate).toBeNull();

    const viewerTaskUpdate = projectStore.updateWorkspace(project.id, mockViewer, {
      tasks: { tasks: [{ id: 'task_v', title: 'Viewer Task', status: 'todo', createdAt: Date.now(), updatedAt: Date.now() }] }
    });
    expect(viewerTaskUpdate).toBeNull();

    // Verify workspace was NOT modified by viewer attempts
    const afterViewerAttempts = projectStore.getProject(project.id, mockOwner.id);
    expect(afterViewerAttempts?.workspace.lyrics.content).toBe('Lyrics edited by editor Alex');
    expect(afterViewerAttempts?.workspace.notes.bpm).toBeUndefined();

    // 4. Viewer CANNOT modify project settings / metadata
    const viewerProjectUpdate = projectStore.updateProject(project.id, mockViewer.id, {
      name: 'Hacked Project Name',
      archived: true
    });
    expect(viewerProjectUpdate).toBeNull();

    // 5. Non-owner (editor / viewer / collaborator) CANNOT add collaborators or assign roles
    const mockNewMember: UserProfile = {
      id: 'user-new',
      displayName: 'New Guy',
      username: 'newguy',
      email: 'new@music.com',
      avatarColor: '#f59e0b',
      isGuest: false,
      createdAt: Date.now()
    };
    const unauthorizedAddByEditor = projectStore.addCollaborator(project.id, mockEditor.id, mockNewMember, 'viewer');
    expect(unauthorizedAddByEditor).toBeNull();

    const unauthorizedAddByViewer = projectStore.addCollaborator(project.id, mockViewer.id, mockNewMember, 'viewer');
    expect(unauthorizedAddByViewer).toBeNull();

    // 6. Non-owner CANNOT remove other collaborators
    const unauthorizedRemoveOther = projectStore.removeCollaborator(project.id, mockEditor.id, mockViewer.id);
    expect(unauthorizedRemoveOther).toBeNull();

    // 7. Non-owner CAN remove themselves (leave project)
    const editorLeaves = projectStore.removeCollaborator(project.id, mockEditor.id, mockEditor.id);
    expect(editorLeaves).not.toBeNull();
    expect(projectStore.hasAccess(project.id, mockEditor.id)).toBe(false);

    // 8. Non-owner CANNOT delete project
    const viewerDelete = projectStore.deleteProject(project.id, mockViewer.id);
    expect(viewerDelete).toBe(false);

    // 9. Owner CAN update collaborator role (e.g. promote viewer to editor)
    const promoted = projectStore.addCollaborator(project.id, mockOwner.id, mockViewer, 'editor');
    expect(promoted).not.toBeNull();
    expect(projectStore.getUserRole(project.id, mockViewer.id)).toBe('editor');

    // Now previously viewer (now editor) CAN update workspace
    const nowEditorUpdate = projectStore.updateWorkspace(project.id, mockViewer, {
      notes: { content: 'Olivia is now an editor and can edit notes' }
    });
    expect(nowEditorUpdate).not.toBeNull();
    expect(nowEditorUpdate?.workspace.notes.content).toContain('Olivia is now an editor');

    // 10. Owner CAN delete project
    const ownerDelete = projectStore.deleteProject(project.id, mockOwner.id);
    expect(ownerDelete).toBe(true);
  });

  it('fails and rolls back in-memory state when project persistence write fails', () => {
    const blockerFile = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blockerFile, 'blocking file');
    const unwritableDir = path.join(blockerFile, 'sub');

    const store = new ProjectStore(unwritableDir);

    // 1. createProject should throw on persistence failure and not retain project in memory
    expect(() => {
      store.createProject(mockOwner, { name: 'Failing Project' });
    }).toThrow();
    expect(store.listProjects(mockOwner.id).length).toBe(0);

    // 2. updateWorkspace should throw and rollback workspace changes if write fails
    const project = projectStore.createProject(mockOwner, { name: 'Rollback Demo' });
    const prevContent = project.workspace.notes.content;

    // Break the data file path
    (projectStore as any).dataFilePath = path.join(blockerFile, 'sub', 'jameet-projects.json');

    expect(() => {
      projectStore.updateWorkspace(project.id, mockOwner, {
        notes: { content: 'This should not be saved' }
      });
    }).toThrow();

    const projAfterFail = projectStore.getProject(project.id, mockOwner.id);
    expect(projAfterFail?.workspace.notes.content).toBe(prevContent);

    // 3. updateProject should throw and rollback
    expect(() => {
      projectStore.updateProject(project.id, mockOwner.id, { name: 'Hacked Project Name' });
    }).toThrow();
    expect(projectStore.getProject(project.id, mockOwner.id)?.name).toBe('Rollback Demo');

    // 4. deleteProject should throw and not delete project from memory if write fails
    expect(() => {
      projectStore.deleteProject(project.id, mockOwner.id);
    }).toThrow();
    expect(projectStore.getProject(project.id, mockOwner.id)).not.toBeNull();
  });

  it('keeps project ownership strictly authoritative through project.ownerId and rejects collaborator owner role', () => {
    const mockImpostor: UserProfile = {
      id: 'user-impostor',
      displayName: 'Impostor Ian',
      username: 'impostorian',
      email: 'ian@music.com',
      avatarColor: '#f97316',
      isGuest: false,
      createdAt: Date.now()
    };

    const project = projectStore.createProject(mockOwner, { name: 'Authoritative Owner Test' });

    // 1. Attempting to assign 'owner' role to collaborator via addCollaborator is rejected
    const tryOwnerRole = projectStore.addCollaborator(project.id, mockOwner.id, mockImpostor, 'owner' as any);
    expect(tryOwnerRole).toBeNull();
    expect(projectStore.hasAccess(project.id, mockImpostor.id)).toBe(false);

    // 2. Add impostor as editor
    const asEditor = projectStore.addCollaborator(project.id, mockOwner.id, mockImpostor, 'editor');
    expect(asEditor).not.toBeNull();
    expect(projectStore.isOwner(project.id, mockImpostor.id)).toBe(false);
    expect(projectStore.getUserRole(project.id, mockImpostor.id)).toBe('editor');

    // 3. Even if a collaborator somehow had role: 'owner' in raw project data, isOwner remains false
    const rawProject = projectStore.getProject(project.id, mockOwner.id)!;
    const impostorCollab = rawProject.collaborators.find(c => c.userId === mockImpostor.id)!;
    (impostorCollab as any).role = 'owner';

    // Verify isOwner still returns false because project.ownerId !== mockImpostor.id
    expect(projectStore.isOwner(project.id, mockImpostor.id)).toBe(false);
    expect(projectStore.getUserRole(project.id, mockImpostor.id)).not.toBe('owner');

    // Verify impostor CANNOT delete project
    expect(projectStore.deleteProject(project.id, mockImpostor.id)).toBe(false);

    // Verify impostor CANNOT add other collaborators
    const mockThirdUser: UserProfile = {
      id: 'user-third',
      displayName: 'Third User',
      username: 'thirduser',
      email: 'third@music.com',
      avatarColor: '#14b8a6',
      isGuest: false,
      createdAt: Date.now()
    };
    expect(projectStore.addCollaborator(project.id, mockImpostor.id, mockThirdUser, 'viewer')).toBeNull();

    // Verify impostor CANNOT remove other collaborators
    expect(projectStore.removeCollaborator(project.id, mockImpostor.id, mockOwner.id)).toBeNull();

    // 4. Verify disk reload sanitizes legacy owner role on collaborator
    (projectStore as any).saveToDisk();
    const reloadedStore = new ProjectStore(tmpDir);
    expect(reloadedStore.isOwner(project.id, mockImpostor.id)).toBe(false);
    expect(reloadedStore.getUserRole(project.id, mockImpostor.id)).toBe('collaborator');
  });
});




