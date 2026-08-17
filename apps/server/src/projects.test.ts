import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from './projects.js';
import type { UserProfile } from '@jameet/shared';

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

  it('initializes normally with an empty store when the projects file does not exist', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-empty-proj-'));
    try {
      const projectsPath = path.join(emptyDir, 'jameet-projects.json');
      expect(fs.existsSync(projectsPath)).toBe(false);

      const store = new ProjectStore(emptyDir);
      expect(store.listProjects('user-1')).toEqual([]);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('fails initialization and stops server startup when an existing projects file is corrupted or unreadable', () => {
    const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-corrupt-proj-'));
    try {
      const projectsPath = path.join(corruptDir, 'jameet-projects.json');
      const corruptContent = '{"projects": [broken corrupted json...';
      fs.writeFileSync(projectsPath, corruptContent, 'utf-8');

      // Must throw rather than silently resetting the project store
      expect(() => new ProjectStore(corruptDir)).toThrow(/Failed to load project datastore/i);

      // Verify the corrupted file was preserved untouched
      expect(fs.readFileSync(projectsPath, 'utf-8')).toBe(corruptContent);
    } finally {
      fs.rmSync(corruptDir, { recursive: true, force: true });
    }
  });

  it('fails initialization when the projects datastore root is not an object or is an array', () => {
    const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-root-proj-'));
    try {
      const projectsPath = path.join(corruptDir, 'jameet-projects.json');

      fs.writeFileSync(projectsPath, JSON.stringify([]), 'utf-8');
      expect(() => new ProjectStore(corruptDir)).toThrow(/root must be an object/i);

      fs.writeFileSync(projectsPath, JSON.stringify('plain-string'), 'utf-8');
      expect(() => new ProjectStore(corruptDir)).toThrow(/root must be an object/i);

      fs.writeFileSync(projectsPath, JSON.stringify(12345), 'utf-8');
      expect(() => new ProjectStore(corruptDir)).toThrow(/root must be an object/i);

      fs.writeFileSync(projectsPath, JSON.stringify(null), 'utf-8');
      expect(() => new ProjectStore(corruptDir)).toThrow(/root must be an object/i);
    } finally {
      fs.rmSync(corruptDir, { recursive: true, force: true });
    }
  });

  it('fails initialization when the projects field is missing or not an array', () => {
    const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-field-proj-'));
    try {
      const projectsPath = path.join(corruptDir, 'jameet-projects.json');

      // Missing projects field
      fs.writeFileSync(projectsPath, JSON.stringify({ version: 1 }), 'utf-8');
      expect(() => new ProjectStore(corruptDir)).toThrow(/'projects' field must be an array/i);

      // Invalid projects type: string
      fs.writeFileSync(projectsPath, JSON.stringify({ projects: 'invalid' }), 'utf-8');
      expect(() => new ProjectStore(corruptDir)).toThrow(/'projects' field must be an array/i);

      // Invalid projects type: object
      fs.writeFileSync(projectsPath, JSON.stringify({ projects: {} }), 'utf-8');
      expect(() => new ProjectStore(corruptDir)).toThrow(/'projects' field must be an array/i);

      // Invalid projects type: null
      fs.writeFileSync(projectsPath, JSON.stringify({ projects: null }), 'utf-8');
      expect(() => new ProjectStore(corruptDir)).toThrow(/'projects' field must be an array/i);
    } finally {
      fs.rmSync(corruptDir, { recursive: true, force: true });
    }
  });

  it('loads successfully when projects datastore has valid projects array', () => {
    const validDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-valid-proj-'));
    try {
      const projectsPath = path.join(validDir, 'jameet-projects.json');
      fs.writeFileSync(projectsPath, JSON.stringify({ version: 1, projects: [] }), 'utf-8');

      const store = new ProjectStore(validDir);
      expect(store.listProjects('user-1')).toEqual([]);
    } finally {
      fs.rmSync(validDir, { recursive: true, force: true });
    }
  });

  it('omits email address when creating or adding collaborators to projects', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-collab-email-test-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-1',
        displayName: 'Owner User',
        username: 'owner',
        email: 'owner@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: Date.now()
      };
      const collab: UserProfile = {
        id: 'collab-1',
        displayName: 'Collab User',
        username: 'collab',
        email: 'private_collab@music.com',
        avatarColor: '#06b6d4',
        isGuest: false,
        createdAt: Date.now()
      };

      const project = store.createProject(owner, { name: 'Email Privacy Song' }, [collab]);
      expect(project.collaborators[0].userId).toBe('collab-1');
      expect((project.collaborators[0] as any).email).toBeUndefined();
      expect('email' in project.collaborators[0]).toBe(false);

      const addedMember: UserProfile = {
        id: 'collab-2',
        displayName: 'Added Member',
        username: 'addedmember',
        email: 'another_secret@music.com',
        avatarColor: '#10b981',
        isGuest: false,
        createdAt: Date.now()
      };
      const updated = store.addCollaborator(project.id, owner.id, addedMember, 'editor');
      expect(updated).not.toBeNull();
      const addedCollab = updated!.collaborators.find((c) => c.userId === 'collab-2')!;
      expect(addedCollab).toBeDefined();
      expect((addedCollab as any).email).toBeUndefined();
      expect('email' in addedCollab).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('normalizes and strips legacy collaborator email addresses when loading existing datastores from disk', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-legacy-email-proj-'));
    try {
      const projectsPath = path.join(legacyDir, 'jameet-projects.json');
      const legacyData = {
        version: 1,
        projects: [
          {
            id: 'legacy-proj-1',
            name: 'Legacy Project',
            ownerId: 'owner-1',
            ownerDisplayName: 'Owner',
            ownerUsername: 'owner',
            ownerAvatarColor: '#6366f1',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastActivityAt: Date.now(),
            archived: false,
            collaborators: [
              {
                userId: 'collab-1',
                displayName: 'Collaborator One',
                username: 'collab1',
                email: 'exposed_legacy@music.com',
                avatarColor: '#06b6d4',
                role: 'editor',
                addedAt: Date.now()
              }
            ],
            sessions: [],
            sessionCount: 0,
            activities: []
          }
        ]
      };
      fs.writeFileSync(projectsPath, JSON.stringify(legacyData), 'utf-8');

      const store = new ProjectStore(legacyDir);
      const loaded = store.getProject('legacy-proj-1', 'owner-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.collaborators.length).toBe(1);
      expect(loaded!.collaborators[0].userId).toBe('collab-1');
      expect(loaded!.collaborators[0].displayName).toBe('Collaborator One');
      expect(loaded!.collaborators[0].username).toBe('collab1');
      expect(loaded!.collaborators[0].role).toBe('editor');
      expect((loaded!.collaborators[0] as any).email).toBeUndefined();
      expect('email' in loaded!.collaborators[0]).toBe(false);
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it('validates task assignees server-authoritatively and derives assigneeName from project members', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-task-assignee-test-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-task-1',
        displayName: 'Real Owner Name',
        username: 'realowner',
        email: 'owner@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: Date.now()
      };
      const collab: UserProfile = {
        id: 'collab-task-1',
        displayName: 'Real Collab Name',
        username: 'realcollab',
        email: 'collab@music.com',
        avatarColor: '#06b6d4',
        isGuest: false,
        createdAt: Date.now()
      };

      const project = store.createProject(owner, { name: 'Task Assignee Project' }, [collab]);

      // 1. Reject task assignment to an invalid user ID (stranger)
      const invalidAssigneeUpdate = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            {
              id: 'task-1',
              title: 'Mix Track',
              status: 'todo',
              assigneeId: 'stranger-user-id-999',
              assigneeName: 'Fake Stranger Name',
              createdAt: Date.now(),
              updatedAt: Date.now()
            }
          ]
        }
      });
      expect(invalidAssigneeUpdate).toBeNull();

      // 2. Accept assignment to owner and derive server-authoritative owner name (ignoring client spoofed name)
      const validOwnerAssign = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            {
              id: 'task-1',
              title: 'Mix Track',
              status: 'todo',
              assigneeId: owner.id,
              assigneeName: 'Spoofed Owner Name',
              createdAt: Date.now(),
              updatedAt: Date.now()
            }
          ]
        }
      });
      expect(validOwnerAssign).not.toBeNull();
      expect(validOwnerAssign!.workspace.tasks.tasks[0].assigneeId).toBe(owner.id);
      expect(validOwnerAssign!.workspace.tasks.tasks[0].assigneeName).toBe('Real Owner Name');

      // 3. Accept assignment to collaborator and derive server-authoritative collaborator name
      const validCollabAssign = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            {
              id: 'task-1',
              title: 'Mix Track',
              status: 'todo',
              assigneeId: collab.id,
              assigneeName: 'Spoofed Collab Name',
              createdAt: Date.now(),
              updatedAt: Date.now()
            }
          ]
        }
      });
      expect(validCollabAssign).not.toBeNull();
      expect(validCollabAssign!.workspace.tasks.tasks[0].assigneeId).toBe(collab.id);
      expect(validCollabAssign!.workspace.tasks.tasks[0].assigneeName).toBe('Real Collab Name');

      // 4. Unassigning task clears both assigneeId and assigneeName
      const unassignUpdate = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            {
              id: 'task-1',
              title: 'Mix Track',
              status: 'todo',
              assigneeId: undefined,
              assigneeName: 'Old Stale Name',
              createdAt: Date.now(),
              updatedAt: Date.now()
            }
          ]
        }
      });
      expect(unassignUpdate).not.toBeNull();
      expect(unassignUpdate!.workspace.tasks.tasks[0].assigneeId).toBeUndefined();
      expect(unassignUpdate!.workspace.tasks.tasks[0].assigneeName).toBeUndefined();

      // 5. Atomic validation: Attempt combined update with notes, lyrics, structure, and invalid task assignee
      const beforeState = JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)));
      const failedCombinedUpdate = store.updateWorkspace(project.id, owner, {
        notes: { content: 'Modified Notes Text', bpm: '140' },
        lyrics: { content: 'Modified Lyrics Text' },
        structure: { sections: [{ id: 'sec-1', name: 'Chorus', bars: 8, color: '#f59e0b', order: 0 }] },
        tasks: {
          tasks: [
            {
              id: 'task-bad',
              title: 'Illegal Task',
              status: 'todo',
              assigneeId: 'unauthorized-user-999',
              createdAt: Date.now(),
              updatedAt: Date.now()
            }
          ]
        }
      });
      expect(failedCombinedUpdate).toBeNull();

      // Ensure no in-memory workspace properties, timestamps, or activities were mutated
      const afterState = JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)));
      expect(afterState).toEqual(beforeState);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('enforces server-authoritative attribution metadata for lyrics documents array updates', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-lyrics-attrib-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-lyr-1',
        displayName: 'Owner Alice',
        username: 'alice',
        email: 'alice@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: 1000
      };
      const editor: UserProfile = {
        id: 'editor-lyr-1',
        displayName: 'Editor Bob',
        username: 'bob',
        email: 'bob@music.com',
        avatarColor: '#10b981',
        isGuest: false,
        createdAt: 2000
      };

      const project = store.createProject(owner, { name: 'Lyrics Attrib Song' }, [editor]);

      // Initial doc created by owner
      const initialDoc = project.workspace.lyrics.documents[0];
      const initialUpdatedAt = initialDoc.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Editor creates doc-2
      const createdDoc2 = store.updateWorkspace(project.id, editor, {
        lyrics: {
          documentId: 'doc-2',
          title: 'Bridge Draft',
          content: 'Original bridge words'
        }
      });
      const doc2Before = createdDoc2?.workspace.lyrics.documents.find((d) => d.id === 'doc-2')!;
      expect(doc2Before.updatedBy).toBe(editor.id);
      expect(doc2Before.updatedByName).toBe(editor.displayName);
      const doc2UpdatedAt = doc2Before.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Editor sends documents array with:
      // 1. doc-main UNCHANGED with spoofed metadata
      // 2. doc-2 MODIFIED content with spoofed metadata
      // 3. doc-3 NEW with spoofed metadata
      const updateTime = Date.now();
      const updatedWorkspace = store.updateWorkspace(project.id, editor, {
        lyrics: {
          documents: [
            {
              id: 'doc-main',
              title: 'Main Lyrics',
              content: '',
              updatedAt: 99999999,
              updatedBy: 'spoofed-hacker-id',
              updatedByName: 'Spoofed Hacker'
            },
            {
              id: 'doc-2',
              title: 'Bridge Draft',
              content: 'Brand new bridge lines',
              updatedAt: 88888888,
              updatedBy: 'spoofed-hacker-id',
              updatedByName: 'Spoofed Hacker'
            },
            {
              id: 'doc-3',
              title: 'Outro Draft',
              content: 'Fade out chords and vocal adlibs',
              updatedAt: 77777777,
              updatedBy: 'spoofed-hacker-id',
              updatedByName: 'Spoofed Hacker'
            }
          ]
        }
      });

      expect(updatedWorkspace).not.toBeNull();
      const docs = updatedWorkspace!.workspace.lyrics.documents;
      expect(docs.length).toBe(3);

      // doc-main is unchanged: must PRESERVE original server metadata
      const doc1After = docs.find((d) => d.id === 'doc-main')!;
      expect(doc1After.updatedAt).toBe(initialUpdatedAt);
      expect(doc1After.updatedBy).toBe(initialDoc.updatedBy);
      expect(doc1After.updatedByName).toBe(initialDoc.updatedByName);

      // doc-2 was modified: must derive metadata from editor and server time >= updateTime
      const doc2After = docs.find((d) => d.id === 'doc-2')!;
      expect(doc2After.content).toBe('Brand new bridge lines');
      expect(doc2After.updatedBy).toBe(editor.id);
      expect(doc2After.updatedByName).toBe(editor.displayName);
      expect(doc2After.updatedAt).toBeGreaterThanOrEqual(updateTime);
      expect(doc2After.updatedAt).not.toBe(88888888);

      // doc-3 was newly introduced: must derive metadata from editor and server time >= updateTime
      const doc3After = docs.find((d) => d.id === 'doc-3')!;
      expect(doc3After.title).toBe('Outro Draft');
      expect(doc3After.content).toBe('Fade out chords and vocal adlibs');
      expect(doc3After.updatedBy).toBe(editor.id);
      expect(doc3After.updatedByName).toBe(editor.displayName);
      expect(doc3After.updatedAt).toBeGreaterThanOrEqual(updateTime);
      expect(doc3After.updatedAt).not.toBe(77777777);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves valid activeDocumentId and restores fallback document on lyrics document deletion', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-lyrics-del-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-lyr-del',
        displayName: 'Owner Alice',
        username: 'alice',
        email: 'alice@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: 1000
      };

      const project = store.createProject(owner, { name: 'Lyrics Delete Song' });

      // 1. Create doc-2 and make it active
      store.updateWorkspace(project.id, owner, {
        lyrics: {
          documentId: 'doc-2',
          title: 'Chorus Draft',
          content: 'Chorus melody lyrics',
          activeDocumentId: 'doc-2'
        }
      });
      const projAfterAdd = store.getProject(project.id, owner.id)!;
      expect(projAfterAdd.workspace.lyrics.documents.length).toBe(2);
      expect(projAfterAdd.workspace.lyrics.activeDocumentId).toBe('doc-2');
      expect(projAfterAdd.workspace.lyrics.content).toBe('Chorus melody lyrics');

      // 2. Delete doc-2 by providing documents array containing only doc-main
      const projAfterDelete = store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            {
              id: 'doc-main',
              title: 'Main Lyrics',
              content: 'Main verses text'
            }
          ]
        }
      })!;

      expect(projAfterDelete.workspace.lyrics.documents.length).toBe(1);
      expect(projAfterDelete.workspace.lyrics.documents[0].id).toBe('doc-main');
      // activeDocumentId must point to doc-main, not the deleted doc-2
      expect(projAfterDelete.workspace.lyrics.activeDocumentId).toBe('doc-main');
      expect(projAfterDelete.workspace.lyrics.content).toBe('Main verses text');

      // 3. Delete all documents by passing empty documents array: fallback document must be restored with empty content
      const projAfterEmpty = store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: []
        }
      })!;

      expect(projAfterEmpty.workspace.lyrics.documents.length).toBe(1);
      expect(projAfterEmpty.workspace.lyrics.documents[0].id).toBe('doc-main');
      expect(projAfterEmpty.workspace.lyrics.documents[0].content).toBe('');
      expect(projAfterEmpty.workspace.lyrics.activeDocumentId).toBe('doc-main');
      expect(projAfterEmpty.workspace.lyrics.content).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects workspace updates containing empty or duplicate task IDs without mutating state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-task-id-val-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-task-id-1',
        displayName: 'Owner Alice',
        username: 'alice',
        email: 'alice@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: 1000
      };

      const project = store.createProject(owner, { name: 'Task ID Validation Song' });

      // Baseline state
      const beforeState = JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)));

      // 1. Reject empty task ID
      const emptyIdRes = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: '', title: 'Empty ID Task', status: 'todo' }
          ]
        }
      });
      expect(emptyIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 2. Reject whitespace-only task ID
      const wsIdRes = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: '   ', title: 'Whitespace ID Task', status: 'todo' }
          ]
        }
      });
      expect(wsIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 3. Reject duplicate task IDs
      const dupIdRes = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'First Task', status: 'todo' },
            { id: 'task-1', title: 'Duplicate ID Task', status: 'in_progress' }
          ]
        }
      });
      expect(dupIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 4. Accept valid unique task IDs
      const validRes = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'First Task', status: 'todo' },
            { id: 'task-2', title: 'Second Task', status: 'todo' }
          ]
        }
      });
      expect(validRes).not.toBeNull();
      expect(validRes?.workspace.tasks.tasks.length).toBe(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects workspace updates containing empty or duplicate structure section IDs without mutating state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-sec-id-val-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-sec-id-1',
        displayName: 'Owner Alice',
        username: 'alice',
        email: 'alice@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: 1000
      };

      const project = store.createProject(owner, { name: 'Structure ID Validation Song' });

      // Baseline state
      const beforeState = JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)));

      // 1. Reject empty section ID
      const emptyIdRes = store.updateWorkspace(project.id, owner, {
        structure: {
          sections: [
            { id: '', type: 'verse', name: 'Verse 1', bars: 8 }
          ]
        }
      });
      expect(emptyIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 2. Reject whitespace-only section ID
      const wsIdRes = store.updateWorkspace(project.id, owner, {
        structure: {
          sections: [
            { id: '   ', type: 'verse', name: 'Verse 1', bars: 8 }
          ]
        }
      });
      expect(wsIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 3. Reject duplicate section IDs
      const dupIdRes = store.updateWorkspace(project.id, owner, {
        structure: {
          sections: [
            { id: 'sec-1', type: 'verse', name: 'Verse 1', bars: 8 },
            { id: 'sec-1', type: 'chorus', name: 'Chorus', bars: 16 }
          ]
        }
      });
      expect(dupIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 4. Accept valid unique section IDs
      const validRes = store.updateWorkspace(project.id, owner, {
        structure: {
          sections: [
            { id: 'sec-1', type: 'verse', name: 'Verse 1', bars: 8 },
            { id: 'sec-2', type: 'chorus', name: 'Chorus', bars: 16 }
          ]
        }
      });
      expect(validRes).not.toBeNull();
      expect(validRes?.workspace.structure.sections.length).toBe(2);
      expect(validRes?.workspace.structure.sections[0].id).toBe('sec-1');
      expect(validRes?.workspace.structure.sections[1].id).toBe('sec-2');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects workspace updates containing empty or duplicate lyrics document IDs without mutating state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-doc-id-val-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-doc-id-1',
        displayName: 'Owner Alice',
        username: 'alice',
        email: 'alice@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: 1000
      };

      const project = store.createProject(owner, { name: 'Lyrics ID Validation Song' });

      // Baseline state
      const beforeState = JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)));

      // 1. Reject empty document ID
      const emptyIdRes = store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            { id: '', title: 'Empty Doc', content: 'Empty ID' }
          ]
        }
      });
      expect(emptyIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 2. Reject whitespace-only document ID
      const wsIdRes = store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            { id: '   ', title: 'Whitespace Doc', content: 'Whitespace ID' }
          ]
        }
      });
      expect(wsIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 3. Reject duplicate document IDs
      const dupIdRes = store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            { id: 'doc-main', title: 'Main Draft', content: 'Main words' },
            { id: 'doc-main', title: 'Duplicate Draft', content: 'Duplicate words' }
          ]
        }
      });
      expect(dupIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 4. Accept valid unique document IDs
      const validRes = store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            { id: 'doc-main', title: 'Main Draft', content: 'Main words' },
            { id: 'doc-draft-2', title: 'Acoustic Draft', content: 'Acoustic words' }
          ]
        }
      });
      expect(validRes).not.toBeNull();
      expect(validRes?.workspace.lyrics.documents.length).toBe(2);
      expect(validRes?.workspace.lyrics.documents[0].id).toBe('doc-main');
      expect(validRes?.workspace.lyrics.documents[1].id).toBe('doc-draft-2');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects workspace updates containing empty or whitespace-only lyrics documentId without mutating state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-target-doc-val-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-target-doc-1',
        displayName: 'Owner Alice',
        username: 'alice',
        email: 'alice@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: 1000
      };

      const project = store.createProject(owner, { name: 'Target Doc ID Validation Song' });

      // Baseline state
      const beforeState = JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)));

      // 1. Reject empty documentId
      const emptyDocIdRes = store.updateWorkspace(project.id, owner, {
        lyrics: {
          documentId: '',
          title: 'New Document Title',
          content: 'Some lyrics content'
        }
      });
      expect(emptyDocIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 2. Reject whitespace-only documentId
      const wsDocIdRes = store.updateWorkspace(project.id, owner, {
        lyrics: {
          documentId: '   \t  ',
          title: 'Whitespace Document Title',
          content: 'Some lyrics content'
        }
      });
      expect(wsDocIdRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 3. Accept valid documentId and trim whitespace
      const validDocIdRes = store.updateWorkspace(project.id, owner, {
        lyrics: {
          documentId: '  doc-trimmed-1  ',
          title: 'Trimmed Document Title',
          content: 'Trimmed lyrics content'
        }
      });
      expect(validDocIdRes).not.toBeNull();
      expect(validDocIdRes?.workspace.lyrics.documents.length).toBe(2);
      expect(validDocIdRes?.workspace.lyrics.documents.find((d) => d.id === 'doc-trimmed-1')).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records task_status_changed activity when task status changes between todo and in_progress', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-task-status-act-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-task-act-1',
        displayName: 'Owner Alice',
        username: 'alice',
        email: 'alice@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: 1000
      };

      const project = store.createProject(owner, { name: 'Task Status Activity Song' });

      // 1. Create a task in 'todo' status
      const p1 = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Master Audio Track', status: 'todo' }
          ]
        }
      })!;
      expect(p1.activities[0].type).toBe('task_created');

      // 2. Change status from 'todo' to 'in_progress' -> records task_status_changed
      const p2 = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Master Audio Track', status: 'in_progress' }
          ]
        }
      })!;
      expect(p2.activities[0].type).toBe('task_status_changed');
      expect(p2.activities[0].summary).toBe('Owner Alice marked "Master Audio Track" as in progress');
      expect(p2.activities[0].userId).toBe(owner.id);

      // 3. Change status from 'in_progress' back to 'todo' -> records task_status_changed
      const p3 = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Master Audio Track', status: 'todo' }
          ]
        }
      })!;
      expect(p3.activities[0].type).toBe('task_status_changed');
      expect(p3.activities[0].summary).toBe('Owner Alice marked "Master Audio Track" as to-do');

      // 4. Change status from 'todo' to 'done' -> records task_completed
      const p4 = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Master Audio Track', status: 'done' }
          ]
        }
      })!;
      expect(p4.activities[0].type).toBe('task_completed');

      // 5. Change status from 'done' to 'in_progress' -> records task_reopened
      const p5 = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Master Audio Track', status: 'in_progress' }
          ]
        }
      })!;
      expect(p5.activities[0].type).toBe('task_reopened');

      // 6. Update without changing status or content -> does NOT record duplicate activity
      const p6 = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Master Audio Track', status: 'in_progress' }
          ]
        }
      })!;
      // Latest activity remains task_reopened from previous update
      expect(p6.activities[0].type).toBe('task_reopened');
      expect(p6.activities.length).toBe(p5.activities.length);

      // 7. Change assignee AND change status between in_progress and todo -> records task_assigned (higher priority)
      const p7 = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Master Audio Track', status: 'todo', assigneeId: owner.id }
          ]
        }
      })!;
      expect(p7.activities[0].type).toBe('task_assigned');
      expect(p7.activities[0].summary).toBe('Owner Alice assigned "Master Audio Track" to Owner Alice');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects workspace updates containing invalid task dueDate values without mutating state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-task-due-val-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'owner-task-due-1',
        displayName: 'Owner Alice',
        username: 'alice',
        email: 'alice@music.com',
        avatarColor: '#6366f1',
        isGuest: false,
        createdAt: 1000
      };

      const project = store.createProject(owner, { name: 'Task Due Date Validation Song' });

      // Baseline state
      const beforeState = JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)));

      // 1. Reject malicious HTML / script in dueDate
      const xssDueRes = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Vocal Track', status: 'todo', dueDate: '<script>alert(1)</script>' }
          ]
        }
      });
      expect(xssDueRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 2. Reject non-ISO date formats
      const slashDueRes = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Vocal Track', status: 'todo', dueDate: '08/25/2026' }
          ]
        }
      });
      expect(slashDueRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 3. Reject invalid calendar dates (e.g. Feb 31)
      const feb31DueRes = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Vocal Track', status: 'todo', dueDate: '2026-02-31' }
          ]
        }
      });
      expect(feb31DueRes).toBeNull();
      expect(JSON.parse(JSON.stringify(store.getProject(project.id, owner.id)))).toEqual(beforeState);

      // 4. Accept valid YYYY-MM-DD date and absent dueDate
      const validDueRes = store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Vocal Track', status: 'todo', dueDate: '  2026-08-25  ' },
            { id: 'task-2', title: 'Mix Track', status: 'todo' }
          ]
        }
      });
      expect(validDueRes).not.toBeNull();
      expect(validDueRes?.workspace.tasks.tasks[0].dueDate).toBe('2026-08-25');
      expect(validDueRes?.workspace.tasks.tasks[1].dueDate).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records notes_bpm_changed and notes_key_changed activities when BPM or Key is cleared', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-notes-clear-test-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'usr_owner_clear',
        username: 'owner_clear',
        displayName: 'Project Owner',
        email: 'owner_clear@test.com',
        avatarColor: '#2563eb',
        createdAt: Date.now()
      };
      const project = store.createProject(owner, { name: 'Clear BPM Key Project' });

      // Initially set BPM and Key
      store.updateWorkspace(project.id, owner, {
        notes: { bpm: '124', key: 'E Minor' }
      });
      const pWithValues = store.getProject(project.id, owner.id);
      expect(pWithValues?.activities[0].type).toBe('notes_key_changed');
      expect(pWithValues?.activities[0].summary).toContain('E Minor');
      expect(pWithValues?.activities[1].type).toBe('notes_bpm_changed');
      expect(pWithValues?.activities[1].summary).toContain('124 BPM');

      const countBefore = pWithValues?.activities.length || 0;

      // Updating with same values should not record new activity
      store.updateWorkspace(project.id, owner, {
        notes: { bpm: '124', key: 'E Minor' }
      });
      const pUnchanged = store.getProject(project.id, owner.id);
      expect(pUnchanged?.activities.length).toBe(countBefore);

      // Clear BPM
      store.updateWorkspace(project.id, owner, {
        notes: { bpm: '' }
      });
      const pBpmCleared = store.getProject(project.id, owner.id);
      expect(pBpmCleared?.workspace.notes.bpm).toBe('');
      expect(pBpmCleared?.activities[0].type).toBe('notes_bpm_changed');
      expect(pBpmCleared?.activities[0].summary).toContain('cleared Project tempo');
      expect(pBpmCleared?.activities[0].userId).toBe(owner.id);

      // Clearing already-cleared BPM should not record new activity
      const countAfterBpmClear = pBpmCleared?.activities.length || 0;
      store.updateWorkspace(project.id, owner, {
        notes: { bpm: '   ' }
      });
      expect(store.getProject(project.id, owner.id)?.activities.length).toBe(countAfterBpmClear);

      // Clear Key
      store.updateWorkspace(project.id, owner, {
        notes: { key: '' }
      });
      const pKeyCleared = store.getProject(project.id, owner.id);
      expect(pKeyCleared?.workspace.notes.key).toBe('');
      expect(pKeyCleared?.activities[0].type).toBe('notes_key_changed');
      expect(pKeyCleared?.activities[0].summary).toContain('cleared Project key');
      expect(pKeyCleared?.activities[0].userId).toBe(owner.id);

      // Clearing already-cleared Key should not record new activity
      const countAfterKeyClear = pKeyCleared?.activities.length || 0;
      store.updateWorkspace(project.id, owner, {
        notes: { key: '' }
      });
      expect(store.getProject(project.id, owner.id)?.activities.length).toBe(countAfterKeyClear);

      // Initially set Notes content
      store.updateWorkspace(project.id, owner, {
        notes: { content: 'Bridge: Am -> D7 -> G' }
      });
      const pWithContent = store.getProject(project.id, owner.id);
      expect(pWithContent?.workspace.notes.content).toBe('Bridge: Am -> D7 -> G');
      expect(pWithContent?.activities[0].type).toBe('notes_edited');
      expect(pWithContent?.activities[0].summary).toContain('updated Project Notes');

      const countBeforeContentClear = pWithContent?.activities.length || 0;

      // Updating with same content should not record new activity
      store.updateWorkspace(project.id, owner, {
        notes: { content: 'Bridge: Am -> D7 -> G' }
      });
      expect(store.getProject(project.id, owner.id)?.activities.length).toBe(countBeforeContentClear);

      // Clear Notes content
      store.updateWorkspace(project.id, owner, {
        notes: { content: '   ' }
      });
      const pContentCleared = store.getProject(project.id, owner.id);
      expect(pContentCleared?.workspace.notes.content).toBe('   ');
      expect(pContentCleared?.activities[0].type).toBe('notes_edited');
      expect(pContentCleared?.activities[0].summary).toContain('cleared Project Notes');
      expect(pContentCleared?.activities[0].userId).toBe(owner.id);

      // Clearing already-cleared Notes content should not record new activity
      const countAfterContentClear = pContentCleared?.activities.length || 0;
      store.updateWorkspace(project.id, owner, {
        notes: { content: '' }
      });
      expect(store.getProject(project.id, owner.id)?.activities.length).toBe(countAfterContentClear);

      // Re-populate notes
      store.updateWorkspace(project.id, owner, {
        notes: { content: 'Outro chords' }
      });
      const pOutro = store.getProject(project.id, owner.id);
      expect(pOutro?.activities[0].type).toBe('notes_edited');
      expect(pOutro?.activities[0].summary).toContain('updated Project Notes');

      // Update that differs ONLY by trailing whitespace should record updated activity
      store.updateWorkspace(project.id, owner, {
        notes: { content: 'Outro chords\n' }
      });
      const pOutroWs = store.getProject(project.id, owner.id);
      expect(pOutroWs?.workspace.notes.content).toBe('Outro chords\n');
      expect(pOutroWs?.activities[0].type).toBe('notes_edited');
      expect(pOutroWs?.activities[0].summary).toContain('updated Project Notes');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records task_unassigned activity when task changes from assigned to unassigned', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-task-unassign-test-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'usr_owner_unassign',
        username: 'owner_unassign',
        displayName: 'Owner User',
        email: 'owner_unassign@test.com',
        avatarColor: '#2563eb',
        createdAt: Date.now()
      };
      const collab: UserProfile = {
        id: 'usr_collab_unassign',
        username: 'collab_unassign',
        displayName: 'Collab User',
        email: 'collab_unassign@test.com',
        avatarColor: '#10b981',
        createdAt: Date.now()
      };

      const project = store.createProject(owner, { name: 'Task Unassign Project' });
      store.addCollaborator(project.id, owner.id, collab, 'editor');

      // 1. Create an assigned task
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Record Bass', status: 'todo', assigneeId: collab.id }
          ]
        }
      });
      const p1 = store.getProject(project.id, owner.id);
      expect(p1?.activities[0].type).toBe('task_created');

      // 2. Unassign task
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Record Bass', status: 'todo', assigneeId: undefined }
          ]
        }
      });
      const p2 = store.getProject(project.id, owner.id);
      expect(p2?.workspace.tasks.tasks[0].assigneeId).toBeUndefined();
      expect(p2?.workspace.tasks.tasks[0].assigneeName).toBeUndefined();
      expect(p2?.activities[0].type).toBe('task_unassigned');
      expect(p2?.activities[0].summary).toContain('unassigned "Record Bass"');
      expect(p2?.activities[0].userId).toBe(owner.id);

      const countAfterUnassign = p2?.activities.length || 0;

      // 3. Updating an already unassigned task without assigning does not record unassigned activity
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Record Bass', status: 'todo' }
          ]
        }
      });
      expect(store.getProject(project.id, owner.id)?.activities.length).toBe(countAfterUnassign);

      // 4. Reassign task to collaborator -> records task_assigned
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Record Bass', status: 'todo', assigneeId: collab.id }
          ]
        }
      });
      const pReassigned = store.getProject(project.id, owner.id);
      expect(pReassigned?.activities[0].type).toBe('task_assigned');
      expect(pReassigned?.activities[0].summary).toContain('assigned "Record Bass" to Collab User');

      // 5. Unassign and change status to in_progress in same update -> unassigned takes priority over status change
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Record Bass', status: 'in_progress', assigneeId: undefined }
          ]
        }
      });
      const pUnassignStatus = store.getProject(project.id, owner.id);
      expect(pUnassignStatus?.activities[0].type).toBe('task_unassigned');

      // 6. Complete task while also unassigning -> completed takes top priority
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 'task-1', title: 'Record Bass', status: 'done', assigneeId: undefined }
          ]
        }
      });
      const pComplete = store.getProject(project.id, owner.id);
      expect(pComplete?.activities[0].type).toBe('task_completed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records structure_changed only on actual Song Structure arrangement changes and ignores no-ops or timestamp updates', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-structure-noop-test-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'usr_owner_struct',
        username: 'owner_struct',
        displayName: 'Structure Owner',
        email: 'owner_struct@test.com',
        avatarColor: '#2563eb',
        createdAt: Date.now()
      };

      const project = store.createProject(owner, { name: 'Structure No-Op Test' });

      // 1. Initial structure setup (add sections -> records structure_changed)
      store.updateWorkspace(project.id, owner, {
        structure: {
          sections: [
            { id: 'sec-intro', type: 'intro', name: 'Intro', bars: 8, note: 'Guitar riff', color: '#6366f1', updatedAt: 1000 },
            { id: 'sec-verse1', type: 'verse', name: 'Verse 1', bars: 16, note: 'Vocals enter', color: '#10b981', updatedAt: 1000 }
          ]
        }
      });
      const p1 = store.getProject(project.id, owner.id);
      expect(p1?.activities[0].type).toBe('structure_changed');
      const countAfterSetup = p1?.activities.length || 0;

      // 2. No-op update with identical sections (different updatedAt timestamp metadata only) -> should NOT record activity
      store.updateWorkspace(project.id, owner, {
        structure: {
          sections: [
            { id: 'sec-intro', type: 'intro', name: 'Intro', bars: 8, note: 'Guitar riff', color: '#6366f1', updatedAt: 5000 },
            { id: 'sec-verse1', type: 'verse', name: 'Verse 1', bars: 16, note: 'Vocals enter', color: '#10b981', updatedAt: 5000 }
          ]
        }
      });
      const p2 = store.getProject(project.id, owner.id);
      expect(p2?.activities.length).toBe(countAfterSetup);

      // 3. Reordering sections -> records structure_changed
      store.updateWorkspace(project.id, owner, {
        structure: {
          sections: [
            { id: 'sec-verse1', type: 'verse', name: 'Verse 1', bars: 16, note: 'Vocals enter', color: '#10b981', updatedAt: 6000 },
            { id: 'sec-intro', type: 'intro', name: 'Intro', bars: 8, note: 'Guitar riff', color: '#6366f1', updatedAt: 6000 }
          ]
        }
      });
      const p3 = store.getProject(project.id, owner.id);
      expect(p3?.activities.length).toBe(countAfterSetup + 1);
      expect(p3?.activities[0].type).toBe('structure_changed');

      // 4. Modifying section bars -> records structure_changed
      store.updateWorkspace(project.id, owner, {
        structure: {
          sections: [
            { id: 'sec-verse1', type: 'verse', name: 'Verse 1', bars: 32, note: 'Vocals enter', color: '#10b981', updatedAt: 7000 },
            { id: 'sec-intro', type: 'intro', name: 'Intro', bars: 8, note: 'Guitar riff', color: '#6366f1', updatedAt: 7000 }
          ]
        }
      });
      const p4 = store.getProject(project.id, owner.id);
      expect(p4?.activities.length).toBe(countAfterSetup + 2);
      expect(p4?.activities[0].type).toBe('structure_changed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records task_updated on title, note, or dueDate changes and ignores metadata-only or order changes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-task-updated-test-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'usr_owner_t_upd',
        username: 'owner_t_upd',
        displayName: 'Task Update Owner',
        email: 'owner_t_upd@test.com',
        avatarColor: '#2563eb',
        createdAt: Date.now()
      };
      const project = store.createProject(owner, { name: 'Task Update Test' });

      // 1. Initial tasks setup
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 't1', title: 'Record Keys', status: 'todo', note: 'Use Rhodes preset', dueDate: '2026-09-01', createdAt: 1000, updatedAt: 1000 },
            { id: 't2', title: 'Record Bass', status: 'todo', createdAt: 1000, updatedAt: 1000 }
          ]
        }
      });
      const p1 = store.getProject(project.id, owner.id);
      expect(p1?.activities.length).toBe(3); // project_created + 2 task_created
      const baseCount = p1?.activities.length || 0;

      // 2. Metadata change only (createdAt, updatedAt, completedAt) -> should NOT record task_updated
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 't1', title: 'Record Keys', status: 'todo', note: 'Use Rhodes preset', dueDate: '2026-09-01', createdAt: 5000, updatedAt: 9000 },
            { id: 't2', title: 'Record Bass', status: 'todo', createdAt: 5000, updatedAt: 9000 }
          ]
        }
      });
      const p2 = store.getProject(project.id, owner.id);
      expect(p2?.activities.length).toBe(baseCount);

      // 3. Task ordering change only -> should NOT record task_updated
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 't2', title: 'Record Bass', status: 'todo', createdAt: 5000, updatedAt: 9000 },
            { id: 't1', title: 'Record Keys', status: 'todo', note: 'Use Rhodes preset', dueDate: '2026-09-01', createdAt: 5000, updatedAt: 9000 }
          ]
        }
      });
      const p3 = store.getProject(project.id, owner.id);
      expect(p3?.activities.length).toBe(baseCount);

      // 4. Change task title -> records task_updated
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 't2', title: 'Record Bass (5-string)', status: 'todo' },
            { id: 't1', title: 'Record Keys', status: 'todo', note: 'Use Rhodes preset', dueDate: '2026-09-01' }
          ]
        }
      });
      const p4 = store.getProject(project.id, owner.id);
      expect(p4?.activities.length).toBe(baseCount + 1);
      expect(p4?.activities[0].type).toBe('task_updated');
      expect(p4?.activities[0].summary).toContain('updated task "Record Bass (5-string)"');

      // 5. Change task note -> records task_updated
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 't2', title: 'Record Bass (5-string)', status: 'todo' },
            { id: 't1', title: 'Record Keys', status: 'todo', note: 'Use Wurli preset instead', dueDate: '2026-09-01' }
          ]
        }
      });
      const p5 = store.getProject(project.id, owner.id);
      expect(p5?.activities.length).toBe(baseCount + 2);
      expect(p5?.activities[0].type).toBe('task_updated');
      expect(p5?.activities[0].summary).toContain('updated task "Record Keys"');

      // 6. Change task dueDate -> records task_updated
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 't2', title: 'Record Bass (5-string)', status: 'todo' },
            { id: 't1', title: 'Record Keys', status: 'todo', note: 'Use Wurli preset instead', dueDate: '2026-09-15' }
          ]
        }
      });
      const p6 = store.getProject(project.id, owner.id);
      expect(p6?.activities.length).toBe(baseCount + 3);
      expect(p6?.activities[0].type).toBe('task_updated');

      // 7. Change title AND status between todo and in_progress in same update -> task_status_changed takes priority
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 't2', title: 'Record Bass (Final)', status: 'in_progress' },
            { id: 't1', title: 'Record Keys', status: 'todo', note: 'Use Wurli preset instead', dueDate: '2026-09-15' }
          ]
        }
      });
      const p7 = store.getProject(project.id, owner.id);
      expect(p7?.activities.length).toBe(baseCount + 4);
      expect(p7?.activities[0].type).toBe('task_status_changed');

      // 8. Change title AND complete task -> task_completed takes priority
      store.updateWorkspace(project.id, owner, {
        tasks: {
          tasks: [
            { id: 't2', title: 'Record Bass (Done)', status: 'done' },
            { id: 't1', title: 'Record Keys', status: 'todo', note: 'Use Wurli preset instead', dueDate: '2026-09-15' }
          ]
        }
      });
      const p8 = store.getProject(project.id, owner.id);
      expect(p8?.activities.length).toBe(baseCount + 5);
      expect(p8?.activities[0].type).toBe('task_completed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records lyrics_doc_deleted activity when lyrics documents are removed', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-lyrics-del-test-'));
    try {
      const store = new ProjectStore(tmpDir);
      const owner: UserProfile = {
        id: 'usr_owner_lyr_del',
        username: 'owner_lyr_del',
        displayName: 'Lyrics Owner',
        email: 'owner_lyr_del@test.com',
        avatarColor: '#2563eb',
        createdAt: Date.now()
      };
      const project = store.createProject(owner, { name: 'Lyrics Delete Test' });

      // 1. Create multiple lyrics documents
      store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            { id: 'doc-main', title: 'Main Lyrics', content: 'Verse 1 text' },
            { id: 'doc-bridge-draft', title: 'Bridge Draft', content: 'Bridge idea' },
            { id: 'doc-outro-draft', title: 'Outro Draft', content: 'Outro idea' }
          ]
        }
      });
      const p1 = store.getProject(project.id, owner.id);
      const countAfterSetup = p1?.activities.length || 0;

      // 2. Remove one document (Bridge Draft)
      store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            { id: 'doc-main', title: 'Main Lyrics', content: 'Verse 1 text' },
            { id: 'doc-outro-draft', title: 'Outro Draft', content: 'Outro idea' }
          ]
        }
      });
      const p2 = store.getProject(project.id, owner.id);
      expect(p2?.workspace.lyrics.documents.length).toBe(2);
      expect(p2?.activities.length).toBe(countAfterSetup + 1);
      expect(p2?.activities[0].type).toBe('lyrics_doc_deleted');
      expect(p2?.activities[0].summary).toContain('deleted lyrics draft "Bridge Draft"');
      expect(p2?.activities[0].userId).toBe(owner.id);
      expect(p2?.activities[0].title).toBe('Bridge Draft');

      // 3. Reordering documents without removing any -> should NOT record lyrics_doc_deleted
      store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            { id: 'doc-outro-draft', title: 'Outro Draft', content: 'Outro idea' },
            { id: 'doc-main', title: 'Main Lyrics', content: 'Verse 1 text' }
          ]
        }
      });
      const p3 = store.getProject(project.id, owner.id);
      expect(p3?.activities.length).toBe(countAfterSetup + 1);

      // 4. Pass empty documents array -> triggers fallback for Main Lyrics, removes Outro Draft
      store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: []
        }
      });
      const p4 = store.getProject(project.id, owner.id);
      expect(p4?.workspace.lyrics.documents.length).toBe(1);
      expect(p4?.workspace.lyrics.documents[0].id).toBe('doc-main');
      expect(p4?.activities.length).toBe(countAfterSetup + 2);
      expect(p4?.activities[0].type).toBe('lyrics_doc_deleted');
      expect(p4?.activities[0].summary).toContain('deleted lyrics draft "Outro Draft"');

      // 5. Setup 2 documents again
      store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            { id: 'doc-main', title: 'Main Lyrics', content: 'Main text' },
            { id: 'doc-chorus', title: 'Chorus Draft', content: 'Chorus text' }
          ]
        }
      });
      const p5 = store.getProject(project.id, owner.id);
      const countBeforeCombinedUpdate = p5?.activities.length || 0;

      // 6. Update with documents array omitting doc-chorus, but targeting doc-chorus via documentId
      store.updateWorkspace(project.id, owner, {
        lyrics: {
          documents: [
            { id: 'doc-main', title: 'Main Lyrics', content: 'Main text' }
          ],
          documentId: 'doc-chorus',
          content: 'Chorus updated content'
        }
      });
      const p6 = store.getProject(project.id, owner.id);
      expect(p6?.workspace.lyrics.documents.some((d) => d.id === 'doc-chorus')).toBe(true);
      // lyrics_doc_deleted should NOT have been recorded for doc-chorus
      const deletedActivities = p6?.activities.slice(0, (p6?.activities.length || 0) - countBeforeCombinedUpdate)
        .filter((a) => a.type === 'lyrics_doc_deleted');
      expect(deletedActivities?.length).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});




