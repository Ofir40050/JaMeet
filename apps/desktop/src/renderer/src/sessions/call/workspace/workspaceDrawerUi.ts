import { $ } from '../../../core/dom';

export interface WorkspaceDrawerUiOptions {
  getProjectName: () => string | undefined;
  hasActiveProject: () => boolean;
  onSyncWorkspaceInputs: () => void;
  onRenderTasksWorkspace: () => void;
  onRenderStructureWorkspace: () => void;
  onUpdateLyricsPagination: () => void;
  setSessionChatOpen: (open: boolean) => void;
  setOnChatOpenCallback: (cb: () => void) => void;
}

let sessionWorkspaceOpen = false;
let isResizingDrawer = false;
let resizeStartX = 0;
let resizeStartWidth = 400;
let drawerOptions: WorkspaceDrawerUiOptions | null = null;

export function initWorkspaceDrawerUi(options: WorkspaceDrawerUiOptions): void {
  drawerOptions = options;

  // Initialize saved workspace width
  try {
    const savedDrawerWidth = parseInt(
      localStorage.getItem('jameet-session-workspace-width') ||
      localStorage.getItem('musiczoom-session-workspace-width') ||
      '540',
      10
    );
    if (savedDrawerWidth && savedDrawerWidth >= 340 && savedDrawerWidth <= 1400) {
      document.documentElement.style.setProperty('--session-drawer-width', `${savedDrawerWidth}px`);
    }
  } catch {
    // ignore
  }

  // In-Session Workspace Drawer Toggle
  $('toggle-session-workspace')?.addEventListener('click', () => {
    setSessionWorkspaceOpen(!sessionWorkspaceOpen);
  });

  $('btn-close-session-workspace')?.addEventListener('click', () => {
    setSessionWorkspaceOpen(false);
  });

  options.setOnChatOpenCallback(() => {
    setSessionWorkspaceOpen(false);
  });

  // In-Session Drawer Tabs
  document.querySelectorAll<HTMLButtonElement>('.drawer-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.drawerTab;
      if (!tab) return;
      document.querySelectorAll<HTMLButtonElement>('.drawer-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      $('drawer-panel-lyrics')?.classList.toggle('hidden', tab !== 'lyrics');
      $('drawer-panel-structure')?.classList.toggle('hidden', tab !== 'structure');
      $('drawer-panel-notes')?.classList.toggle('hidden', tab !== 'notes');
      $('drawer-panel-tasks')?.classList.toggle('hidden', tab !== 'tasks');

      // Hide top track selector bar specifically in Tasks tab
      $('session-drawer-song-bar')?.classList.toggle('hidden', tab === 'tasks');

      if (tab === 'tasks') {
        options.onRenderTasksWorkspace();
      } else if (tab === 'structure') {
        options.onRenderStructureWorkspace();
      } else if (tab === 'lyrics') {
        options.onUpdateLyricsPagination();
      }
      try {
        localStorage.setItem('jameet-session-workspace-tab', tab);
      } catch {
        // ignore
      }
    });
  });

  // Resizable Session Workspace Panel
  $('session-workspace-resize-handle')?.addEventListener('mousedown', (e) => {
    isResizingDrawer = true;
    resizeStartX = e.clientX;
    const drawer = $('session-workspace-drawer');
    resizeStartWidth = drawer?.getBoundingClientRect().width || 400;
    drawer?.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizingDrawer) return;
    const deltaX = resizeStartX - e.clientX; // Dragging left increases width
    const maxW = Math.max(900, Math.min(window.innerWidth - 60, 1400));
    const newWidth = Math.max(340, Math.min(maxW, resizeStartWidth + deltaX));
    document.documentElement.style.setProperty('--session-drawer-width', `${Math.round(newWidth)}px`);
  });

  window.addEventListener('mouseup', () => {
    if (!isResizingDrawer) return;
    isResizingDrawer = false;
    $('session-workspace-drawer')?.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const currentWidth = $('session-workspace-drawer')?.getBoundingClientRect().width;
    if (currentWidth) {
      try {
        const w = Math.round(currentWidth).toString();
        localStorage.setItem('jameet-session-workspace-width', w);
      } catch {
        // ignore
      }
    }
  });
}

export function isSessionWorkspaceOpen(): boolean {
  return sessionWorkspaceOpen;
}

export function setSessionWorkspaceOpen(open: boolean): void {
  sessionWorkspaceOpen = open;
  $('session-workspace-drawer')?.classList.toggle('hidden', !open);
  $('toggle-session-workspace')?.classList.toggle('active', open);
  $('call-view')?.classList.toggle('has-drawer-open', open);

  if (open && drawerOptions) {
    // Close Session Chat if open so they never overlap
    drawerOptions.setSessionChatOpen(false);

    const titleEl = $('session-workspace-project-name');
    const projectName = drawerOptions.getProjectName();
    if (titleEl && drawerOptions.hasActiveProject()) {
      titleEl.textContent = projectName || 'Project Workspace';
    }
    drawerOptions.onSyncWorkspaceInputs();

    // Restore saved workspace tab
    const savedTab = localStorage.getItem('jameet-session-workspace-tab') || localStorage.getItem('musiczoom-session-workspace-tab') || 'lyrics';
    const targetTabBtn = document.querySelector<HTMLButtonElement>(`.drawer-tab-btn[data-drawer-tab="${savedTab}"]`);
    if (targetTabBtn) {
      targetTabBtn.click();
    }
  }
}
