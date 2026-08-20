import type { ProjectTaskStage } from "@jameet/shared";
import { $ } from "../../core/dom";
import { renderTasksWorkspace } from "./tasksWorkspaceRenderer";
import { tasksState } from "./tasksUiState";

// ========================================================
// EVENT LISTENERS & FORM BINDINGS
// ========================================================

export function bindTasksEventListeners(): void {
  if (tasksState.listenersBound) return;
  tasksState.listenersBound = true;

  // Search Input Live Filter
  $("tasks-search-input")?.addEventListener("input", (e) => {
    tasksState.currentTasksSearchQuery = (e.target as HTMLInputElement).value.trim();
    const sessionSearch = $<HTMLInputElement>("session-tasks-search-input");
    if (sessionSearch && sessionSearch.value !== tasksState.currentTasksSearchQuery) sessionSearch.value = tasksState.currentTasksSearchQuery;
    renderTasksWorkspace();
  });

  $("session-tasks-search-input")?.addEventListener("input", (e) => {
    tasksState.currentTasksSearchQuery = (e.target as HTMLInputElement).value.trim();
    const mainSearch = $<HTMLInputElement>("tasks-search-input");
    if (mainSearch && mainSearch.value !== tasksState.currentTasksSearchQuery) mainSearch.value = tasksState.currentTasksSearchQuery;
    renderTasksWorkspace();
  });

  // Group By Select
  $("tasks-group-by")?.addEventListener("change", (e) => {
    tasksState.currentTasksGrouping = ((e.target as HTMLSelectElement).value as any) || "song";
    renderTasksWorkspace();
  });

  $("session-tasks-group-by")?.addEventListener("change", (e) => {
    tasksState.currentTasksGrouping = ((e.target as HTMLSelectElement).value as any) || "song";
    renderTasksWorkspace();
  });

  // Toggle Show/Hide Completed
  $("btn-tasks-toggle-completed")?.addEventListener("click", () => {
    tasksState.showCompletedTasks = !tasksState.showCompletedTasks;
    renderTasksWorkspace();
  });

  $("session-btn-tasks-toggle-completed")?.addEventListener("click", () => {
    tasksState.showCompletedTasks = !tasksState.showCompletedTasks;
    renderTasksWorkspace();
  });

  // Click on empty window background to collapse open task
  document.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    if (!target) return;
    if (target.closest(".reminders-task-row, .reminders-inspector-popover, .task-context-menu, .song-customizer-popover, select, option, .task-action-pill")) {
      return;
    }
    if (tasksState.currentSelectedTaskId !== null) {
      tasksState.currentSelectedTaskId = null;
      document.querySelectorAll(".reminders-task-row.is-selected").forEach((r) => r.classList.remove("is-selected"));
    }
  });

  // Create Task Form Submit (Main Workspace)
  $("form-create-task")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const tasksUiOptions = tasksState.tasksUiOptions;
    if (!tasksUiOptions) return;
    const titleInput = $<HTMLInputElement>("task-new-title");
    const songSelect = $<HTMLSelectElement>("task-new-song");
    const stageSelect = $<HTMLSelectElement>("task-new-stage");
    const assigneeSelect = $<HTMLSelectElement>("task-new-assignee");
    const dateInput = $<HTMLInputElement>("task-new-duedate");
    if (!titleInput) return;

    const title = titleInput.value.trim();
    if (!title) return;

    let aId: string | undefined;
    let aName: string | undefined;
    if (assigneeSelect && assigneeSelect.value) {
      const parts = assigneeSelect.value.split("|");
      aId = parts[0];
      aName = parts[1];
    }

    const songId = songSelect?.value || undefined;
    let songTitle: string | undefined;
    if (songId) {
      const songs = tasksUiOptions.getSongs();
      const matched = songs.find((s) => s.id === songId);
      songTitle = matched?.title;
    }

    const stageVal = stageSelect?.value as ProjectTaskStage | "general";
    const stage = stageVal && stageVal !== "general" ? stageVal : undefined;
    const dueDate = dateInput?.value || undefined;

    tasksUiOptions.onCreateTask({
      title,
      assigneeId: aId,
      assigneeName: aName,
      dueDate,
      songId,
      songTitle,
      stage
    });
    titleInput.value = "";
    titleInput.focus();
  });

  // Create Task Form Submit (In-Session Drawer)
  $("session-form-create-task")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const tasksUiOptions = tasksState.tasksUiOptions;
    if (!tasksUiOptions) return;
    const titleInput = $<HTMLInputElement>("session-task-new-title");
    const songSelect = $<HTMLSelectElement>("session-task-new-song");
    const stageSelect = $<HTMLSelectElement>("session-task-new-stage");
    const assigneeSelect = $<HTMLSelectElement>("session-task-new-assignee");
    const dateInput = $<HTMLInputElement>("session-task-new-duedate");
    if (!titleInput) return;

    const title = titleInput.value.trim();
    if (!title) return;

    let aId: string | undefined;
    let aName: string | undefined;
    if (assigneeSelect && assigneeSelect.value) {
      const parts = assigneeSelect.value.split("|");
      aId = parts[0];
      aName = parts[1];
    }

    const songId = songSelect?.value || undefined;
    let songTitle: string | undefined;
    if (songId) {
      const songs = tasksUiOptions.getSongs();
      const matched = songs.find((s) => s.id === songId);
      songTitle = matched?.title;
    }

    const stageVal = stageSelect?.value as ProjectTaskStage | "general";
    const stage = stageVal && stageVal !== "general" ? stageVal : undefined;
    const dueDate = dateInput?.value || undefined;

    tasksUiOptions.onCreateTask({
      title,
      assigneeId: aId,
      assigneeName: aName,
      dueDate,
      songId,
      songTitle,
      stage
    });
    titleInput.value = "";
    titleInput.focus();
  });

  // View Switcher Handlers
  $("btn-tasks-view-list")?.addEventListener("click", () => {
    tasksState.currentTasksViewMode = "list";
    renderTasksWorkspace();
  });

  $("session-btn-tasks-view-list")?.addEventListener("click", () => {
    tasksState.currentTasksViewMode = "list";
    renderTasksWorkspace();
  });

  $("btn-tasks-view-board")?.addEventListener("click", () => {
    tasksState.currentTasksViewMode = "board";
    renderTasksWorkspace();
  });

  $("session-btn-tasks-view-board")?.addEventListener("click", () => {
    tasksState.currentTasksViewMode = "board";
    renderTasksWorkspace();
  });

  // Filter Dropdown Handlers
  $("tasks-filter-song")?.addEventListener("change", (e) => {
    tasksState.currentTasksSongFilter = (e.target as HTMLSelectElement).value || "all";
    renderTasksWorkspace();
  });

  $("session-tasks-filter-song")?.addEventListener("change", (e) => {
    tasksState.currentTasksSongFilter = (e.target as HTMLSelectElement).value || "all";
    renderTasksWorkspace();
  });

  $("tasks-filter-stage")?.addEventListener("change", (e) => {
    tasksState.currentTasksStageFilter = (e.target as HTMLSelectElement).value || "all";
    renderTasksWorkspace();
  });

  $("session-tasks-filter-stage")?.addEventListener("change", (e) => {
    tasksState.currentTasksStageFilter = (e.target as HTMLSelectElement).value || "all";
    renderTasksWorkspace();
  });

  // View All Tasks from Overview
  $("btn-overview-view-tasks")?.addEventListener("click", () => {
    if (tasksState.tasksUiOptions?.onNavigateToTasksTab) {
      tasksState.tasksUiOptions.onNavigateToTasksTab();
    } else {
      const taskTabBtn = document.querySelector<HTMLButtonElement>('.project-tab-btn[data-tab="tasks"]');
      taskTabBtn?.click();
    }
  });
}
