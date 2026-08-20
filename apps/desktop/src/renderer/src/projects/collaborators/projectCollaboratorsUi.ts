import type { Project, UserProfile } from '@jameet/shared';
import { safeAvatarColor, escapeHtml } from '../../core/htmlSecurity';
import { applyAvatarToElement } from '../../auth/profile/profileUi';
import { icons } from '../../core/icons';
import { $ } from '../../core/dom';

export interface ProjectCollaboratorsUiOptions {
  onUpdateRole?: (collaboratorUserId: string, newRole: string) => Promise<void>;
  onRemoveCollaborator?: (collaboratorUserId: string) => void | Promise<void>;
}

export function createCollaboratorItem(
  member: {
    userId: string;
    displayName: string;
    username: string;
    avatarColor: string;
    avatarUrl?: string;
    role: 'owner' | 'editor' | 'viewer' | 'collaborator';
  },
  isOwner: boolean,
  options?: ProjectCollaboratorsUiOptions
): HTMLElement {
  const isMemberOwner = member.role === 'owner';
  const isViewer = member.role === 'viewer';
  const isEditor = member.role === 'editor' || member.role === 'collaborator';

  let roleHtml = '';
  if (isMemberOwner) {
    roleHtml = `<span class="collab-role-badge role-owner">${icons.crown({ size: 12 })} <span>Owner</span></span>`;
  } else if (isOwner) {
    roleHtml = `
      <div class="collab-role-select-wrap">
        <select class="collab-role-dropdown" data-user-id="${escapeHtml(member.userId)}" aria-label="Permission Level">
          <option value="editor" ${isEditor ? 'selected' : ''}>Editor (Can Edit)</option>
          <option value="viewer" ${isViewer ? 'selected' : ''}>Viewer (View Only)</option>
        </select>
      </div>
    `;
  } else {
    roleHtml = `
      <span class="collab-role-badge ${isViewer ? 'role-viewer' : 'role-editor'}">
        <span>${isViewer ? 'Viewer' : 'Editor'}</span>
      </span>
    `;
  }

  const item = document.createElement('div');
  item.className = 'collab-item';
  item.innerHTML = `
    <div class="collab-avatar"></div>
    <div class="collab-info">
      <div class="collab-name">${escapeHtml(member.displayName)}</div>
      <div class="collab-username">@${escapeHtml(member.username)}</div>
    </div>
    ${roleHtml}
    ${isOwner && !isMemberOwner ? `<button class="collab-remove-btn" data-user-id="${escapeHtml(member.userId)}" title="Remove member">${icons.x({ size: 14 })}</button>` : ''}
  `;
  const avatarEl = item.querySelector<HTMLElement>('.collab-avatar');
  applyAvatarToElement(avatarEl, member.displayName, member.avatarColor, member.avatarUrl);

  const roleDropdown = item.querySelector<HTMLSelectElement>('.collab-role-dropdown');
  if (roleDropdown && options?.onUpdateRole) {
    roleDropdown.addEventListener('change', async (e) => {
      e.stopPropagation();
      const targetRole = roleDropdown.value;
      try {
        roleDropdown.disabled = true;
        await options.onUpdateRole!(member.userId, targetRole);
      } finally {
        roleDropdown.disabled = false;
      }
    });
  }

  const removeBtn = item.querySelector<HTMLButtonElement>('.collab-remove-btn');
  if (removeBtn && options?.onRemoveCollaborator) {
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void options.onRemoveCollaborator!(member.userId);
    });
  }

  return item;
}

export function renderProjectCollaborators(
  project: Project | null,
  user: UserProfile | null,
  options?: ProjectCollaboratorsUiOptions
): void {
  if (!project) return;
  const listOverview = $('project-collaborators-list');
  const listFull = $('project-collaborators-full-list');

  const isOwner = user?.id === project.ownerId;
  const ownerAvatarUrl = project.ownerId === user?.id ? user?.avatarUrl : (project as any).ownerAvatarUrl;
  const allMembers = [
    {
      userId: project.ownerId,
      displayName: project.ownerDisplayName,
      username: project.ownerUsername,
      avatarColor: safeAvatarColor(project.ownerAvatarColor, '#f59e0b'),
      avatarUrl: ownerAvatarUrl,
      role: 'owner' as const,
      addedAt: project.createdAt
    },
    ...project.collaborators.map((c) => ({
      ...c,
      avatarUrl: c.userId === user?.id ? user?.avatarUrl : (c as any).avatarUrl
    }))
  ];

  const buildItems = (container: HTMLElement | null) => {
    if (!container) return;
    container.replaceChildren();

    for (const member of allMembers) {
      container.appendChild(createCollaboratorItem(member, isOwner, options));
    }
  };

  buildItems(listOverview);
  buildItems(listFull);
}
