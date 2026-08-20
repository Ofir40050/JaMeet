import type { Project, UserProfile } from '@jameet/shared';
import { formatRelativeTime } from './projects';
import { icons } from './icons';
import { $, setText } from './dom';

export function renderProjectHeader(project: Project, user: UserProfile | null): void {
  const isOwner = user?.id === project.ownerId;

  // Breadcrumb
  setText('project-view-name-crumb', project.name);

  // Hero
  setText('project-title', project.name);
  const myCollabEntry = project.collaborators?.find((c) => c.userId === user?.id);
  const myRole = isOwner ? 'owner' : (myCollabEntry?.role || 'editor');
  const isViewer = myRole === 'viewer';

  const roleBadge = $('project-role-badge');
  if (roleBadge) {
    if (project.archived) {
      roleBadge.innerHTML = `${icons.archive({ size: 14 })} <span>Archived</span>`;
      roleBadge.className = 'project-status-pill badge-archived';
    } else if (isOwner) {
      roleBadge.innerHTML = `${icons.crown({ size: 14 })} <span>Owner</span>`;
      roleBadge.className = 'project-status-pill badge-owner';
    } else if (isViewer) {
      roleBadge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> <span>View Only</span>`;
      roleBadge.className = 'project-status-pill badge-viewer';
    } else {
      roleBadge.innerHTML = `${icons.users({ size: 14 })} <span>Editor</span>`;
      roleBadge.className = 'project-status-pill badge-collab';
    }
  }

  const descEl = $('project-description');
  if (descEl) {
    descEl.textContent = project.description || '';
    descEl.classList.toggle('hidden', !project.description);
  }
  setText(
    'project-created-date',
    new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  );
  setText('project-last-activity', formatRelativeTime(project.lastActivityAt));

  const sessionCountNum = project.sessions?.length || project.sessionCount || 0;
  const totalMembersNum = 1 + (project.collaborators?.length || 0);

  setText('project-session-count', String(sessionCountNum));
  setText('tab-sessions-count', String(sessionCountNum));
  setText('project-collaborators-count', String(totalMembersNum));
  setText('tab-collab-count', String(totalMembersNum));
  setText('project-owner-name', project.ownerDisplayName);

  // Archive button text
  const archiveBtn = $('btn-project-archive');
  if (archiveBtn) {
    archiveBtn.innerHTML = `${icons.archive({ size: 15 })} <span>${project.archived ? 'Unarchive Project' : 'Archive Project'}</span>`;
  }

  // Show/hide owner-only controls
  const menuBtn = $('btn-project-menu');
  if (menuBtn) menuBtn.classList.toggle('hidden', !isOwner);
  const addCollabBtn = $('btn-project-add-collab');
  if (addCollabBtn) addCollabBtn.classList.toggle('hidden', !isOwner);
  const addCollabTabBtn = $('btn-project-add-collab-tab');
  if (addCollabTabBtn) addCollabTabBtn.classList.toggle('hidden', !isOwner);
}
