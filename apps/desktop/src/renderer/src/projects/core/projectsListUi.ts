import type { Project, UserProfile } from '@jameet/shared';
import { formatRelativeTime } from '../../core/dateTimeFormatters';
import { escapeHtml, safeAvatarColor } from '../../core/htmlSecurity';
import { icons } from '../../core/icons';
import { $ } from '../../core/dom';

export interface ProjectsListUiOptions {
  onOpenProject: (projectId: string) => void;
}

let defaultOnOpenProject: ((projectId: string) => void) | undefined;

export function initProjectsListUi(opts: ProjectsListUiOptions): void {
  defaultOnOpenProject = opts.onOpenProject;
}

export function createProjectCard(
  project: Project,
  user: UserProfile | null,
  onOpenProject: (projectId: string) => void = defaultOnOpenProject!
): HTMLElement {
  const card = document.createElement('div');
  card.className = `project-card${project.archived ? ' archived' : ''}`;
  card.dataset.projectId = project.id;

  const collabCount = project.collaborators.length;
  const sessionCount = project.sessionCount || project.sessions?.length || 0;
  const lastActivity = formatRelativeTime(project.lastActivityAt);

  // Collaborator avatars (show up to 4)
  let collabAvatarsHtml = '';
  const showCollabs = project.collaborators.slice(0, 4);
  for (const c of showCollabs) {
    const ini = c.displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
    const safeBg = safeAvatarColor(c.avatarColor, '#38bdf8');
    collabAvatarsHtml += `<div class="project-card-avatar" style="background-color: ${safeBg};" title="${escapeHtml(c.displayName)} (@${escapeHtml(c.username)})">${escapeHtml(ini)}</div>`;
  }
  if (collabCount > 4) {
    collabAvatarsHtml += `<div class="project-card-avatar project-card-avatar-overflow">+${collabCount - 4}</div>`;
  }

  card.innerHTML = `
    <div class="project-card-header">
      <h4 class="project-card-title">${escapeHtml(project.name)}</h4>
      ${project.archived ? `<span class="project-card-pill badge-archived">${icons.archive({ size: 11 })} <span>Archived</span></span>` : ''}
    </div>
    <div class="project-card-meta">
      <div class="project-card-meta-item"><span class="meta-icon">${icons.clock({ size: 13 })}</span> <span>${escapeHtml(lastActivity)}</span></div>
      <div class="project-card-meta-item"><span class="meta-icon">${icons.headphones({ size: 13 })}</span> <span>${sessionCount} session${sessionCount !== 1 ? 's' : ''}</span></div>
      ${collabCount > 0 ? `<div class="project-card-meta-item"><span class="meta-icon">${icons.users({ size: 13 })}</span> <span>${collabCount} member${collabCount !== 1 ? 's' : ''}</span></div>` : ''}
    </div>
    <div class="project-card-footer">
      <div class="project-card-collaborators">${collabAvatarsHtml}</div>
      <span class="project-card-open-hint"><span>Open Project</span> <span class="btn-arrow">${icons.arrowRight({ size: 13 })}</span></span>
    </div>
  `;

  if (onOpenProject) {
    card.addEventListener('click', () => onOpenProject(project.id));
  }

  return card;
}

export function renderProjectsGrid(
  projects: Project[],
  user: UserProfile | null,
  onOpenProject: (projectId: string) => void = defaultOnOpenProject!
): void {
  const grid = $('projects-grid');
  const empty = $('projects-empty');
  const count = $('projects-count');
  if (!grid) return;

  if (count) count.textContent = String(projects.length);

  if (!projects.length) {
    grid.replaceChildren();
    grid.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  grid.classList.remove('hidden');
  grid.replaceChildren();

  for (const project of projects) {
    grid.appendChild(createProjectCard(project, user, onOpenProject));
  }
}
