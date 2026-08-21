import { $ } from "../../core/dom";
import { tasksState } from "./tasksUiState";

// ========================================================
// STATUS BADGES & HELPERS
// ========================================================

export function setTasksStatus(status: "saving" | "saved" | "unsaved"): void {
  tasksState.currentTasksStatus = status;
  const label = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Save failed";
  const badge = $("project-tasks-status");
  if (badge) {
    badge.className = `workspace-status-badge ${status}`;
    badge.innerHTML = `<span class="status-dot"></span> ${label}`;
  }
  const sessionStatus = $("session-workspace-status");
  if (sessionStatus) {
    sessionStatus.className = `workspace-status-badge ${status}`;
    sessionStatus.innerHTML = `<span class="status-dot"></span> ${label}`;
  }
}

export function getTasksStatus(): "saving" | "saved" | "unsaved" {
  return tasksState.currentTasksStatus;
}

export function formatShortDate(d: string): string {
  try {
    const parts = d.split("-");
    if (parts.length === 3) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const month = months[parseInt(parts[1], 10) - 1] || parts[1];
      const day = parseInt(parts[2], 10);
      return `${month} ${day}`;
    }
  } catch {
    // ignore
  }
  return d;
}

// ========================================================
// PERMISSIONS
// ========================================================

export function applyTasksPermissions(canEdit: boolean): void {
  const taskInput = $<HTMLInputElement>("new-task-input");
  const taskAddBtn = $<HTMLButtonElement>("btn-add-task");
  const taskNewRow = document.querySelector<HTMLElement>(".reminders-new-task-row") || taskInput?.closest<HTMLElement>(".reminders-new-task-bar");
  if (taskNewRow) {
    taskNewRow.style.display = canEdit ? "" : "none";
  }
  if (taskInput) {
    taskInput.disabled = !canEdit;
    taskInput.placeholder = canEdit ? "Add a task or production reminder…" : "View only mode";
  }
  if (taskAddBtn) taskAddBtn.disabled = !canEdit;

  const sessionTaskInput = $<HTMLInputElement>("session-new-task-input");
  const sessionTaskAddBtn = $<HTMLButtonElement>("session-btn-add-task");
  const sessionTaskNewRow = sessionTaskInput?.closest<HTMLElement>(".session-tasks-creation-bar");
  if (sessionTaskNewRow) {
    sessionTaskNewRow.style.display = canEdit ? "" : "none";
  }
  if (sessionTaskInput) {
    sessionTaskInput.disabled = !canEdit;
    sessionTaskInput.placeholder = canEdit ? "Add a task…" : "View only";
  }
  if (sessionTaskAddBtn) sessionTaskAddBtn.disabled = !canEdit;

  document.querySelectorAll<HTMLElement>(".reminders-task-row, .drawer-task-card").forEach((row) => {
    if (!canEdit) {
      row.removeAttribute("draggable");
      row.querySelectorAll<HTMLButtonElement>(".reminders-check-btn, .task-subtask-check").forEach((b) => {
        b.disabled = true;
        b.style.cursor = "default";
        b.title = "View only mode";
      });
      row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach((el) => {
        el.disabled = true;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.readOnly = true;
      });
      row.querySelectorAll<HTMLElement>(".btn-del, .task-subtasks-add-row, .task-subtask-del").forEach((el) => {
        el.style.display = "none";
      });
    }
  });
}
