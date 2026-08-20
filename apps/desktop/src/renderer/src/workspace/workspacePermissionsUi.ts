import { $ } from '../core/dom';
import { applyLyricsPermissions } from './lyricsUi';
import { applyNotesPermissions } from './notesUi';
import { applyTasksPermissions } from './tasksUi';
import { applyStructurePermissions } from './structureUi';

export interface WorkspacePermissionsOptions {
  canEdit: boolean;
  isOwner: boolean;
}

export function applyWorkspacePermissionsPresentation(options: WorkspacePermissionsOptions): void {
  const { canEdit, isOwner } = options;

  // 1. Lyrics editor & formatting toolbar
  applyLyricsPermissions(canEdit);

  // 2. Notes & BPM / Key inputs
  applyNotesPermissions(canEdit);

  // 3. Tasks inputs, rows & actions
  applyTasksPermissions(canEdit);

  // 4. Structure controls & cards
  applyStructurePermissions(canEdit);

  // 5. Song creation and toolbar actions
  for (const songBtnId of [
    'btn-overview-new-song',
    'btn-quick-new-song',
    'btn-open-new-song-modal',
    'btn-session-new-song',
    'btn-song-studio-add-song',
    'btn-song-studio-rename-song',
    'btn-song-studio-delete-song'
  ]) {
    const el = $(songBtnId);
    if (el) el.style.display = canEdit ? '' : 'none';
  }

  // 6. Collaborator add buttons (Only owner)
  const addCollabHero = $('btn-project-add-collab');
  if (addCollabHero) addCollabHero.style.display = isOwner ? '' : 'none';
  const addCollabTab = $('btn-project-add-collab-tab');
  if (addCollabTab) addCollabTab.style.display = isOwner ? '' : 'none';
}
