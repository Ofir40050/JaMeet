import type { ProjectTaskStatus } from "@jameet/shared";
import { $, setText } from "../../core/dom";
import { escapeHtml } from "../../core/htmlSecurity";
import { STAGE_CONFIG } from "./tasksConstants";
import { formatShortDate } from "./tasksFormatting";
import { showTaskContextMenu } from "./taskContextMenu";
import { tasksState } from "./tasksUiState";
import type { ReadonlyTaskItem, ReadonlySongItem } from "./tasksTypes";

// ========================================================
// KANBAN BOARD RENDERING
// ========================================================

export function renderBoardCard(task: ReadonlyTaskItem, songs: readonly ReadonlySongItem[]): HTMLElement {
  const card = document.createElement("div");
  card.className = `board-task-card status-${task.status || "todo"}`;
  card.dataset.taskId = task.id;
  card.setAttribute("draggable", "true");

  const stageKey = task.stage || "general";
  const stageCfg = STAGE_CONFIG[stageKey] || STAGE_CONFIG.general;
  const stageBadgeHtml = `<span class="task-stage-badge stage-${stageKey}">${stageCfg.iconSvg}<span>${escapeHtml(stageCfg.label)}</span></span>`;

  const linkedSong = songs.find((s) => s.id === task.songId);
  const songPillHtml = linkedSong
    ? `<span class="task-track-badge"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span>${escapeHtml(linkedSong.title || "Song")}</span></span>`
    : "";

  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  let subtasksPillHtml = "";
  if (subtasks.length > 0) {
    const doneSubs = subtasks.filter((s) => s.done).length;
    subtasksPillHtml = `<span class="task-subtasks-counter-pill"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polyline points="20 6 9 17 4 12"/></svg><span>${doneSubs}/${subtasks.length}</span></span>`;
  }

  const assigneeInitial = task.assigneeName ? task.assigneeName.charAt(0).toUpperCase() : "";
  const assigneeHtml = task.assigneeName
    ? `<span class="board-card-assignee"><span class="task-meta-avatar">${escapeHtml(assigneeInitial)}</span><span>${escapeHtml(task.assigneeName)}</span></span>`
    : `<span class="board-card-assignee unassigned"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg><span>Unassigned</span></span>`;

  const dueHtml = task.dueDate
    ? `<span class="board-card-due" title="Due date"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg><span>${escapeHtml(formatShortDate(task.dueDate))}</span></span>`
    : "";

  card.innerHTML = `
    <div class="board-card-top-row">
      <span class="board-card-title">${escapeHtml(task.title)}</span>
    </div>
    <div class="board-card-meta-row">
      ${stageBadgeHtml}
      ${songPillHtml}
      ${assigneeHtml}
      ${dueHtml}
      ${subtasksPillHtml}
    </div>
  `;

  card.addEventListener("dragstart", (e) => {
    tasksState.draggedTaskId = task.id;
    card.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", task.id);
    }
  });

  card.addEventListener("dragend", () => {
    tasksState.draggedTaskId = null;
    card.classList.remove("dragging");
    document.querySelectorAll(".board-column").forEach((col) => col.classList.remove("drag-over"));
  });

  // Right-click Context Menu
  card.addEventListener("contextmenu", (e) => {
    showTaskContextMenu(e, task);
  });

  return card;
}

export function renderBoard(filteredTasks: readonly ReadonlyTaskItem[], songs: readonly ReadonlySongItem[]): void {
  const populateBoardInto = (
    todoEl: HTMLElement | null,
    inProgEl: HTMLElement | null,
    doneEl: HTMLElement | null,
    todoCountId: string,
    inProgCountId: string,
    doneCountId: string
  ) => {
    if (!todoEl || !inProgEl || !doneEl) return;
    todoEl.innerHTML = "";
    inProgEl.innerHTML = "";
    doneEl.innerHTML = "";

    const boardTasks = filteredTasks;
    const todoTasks = boardTasks.filter((t) => t.status === "todo");
    const inProgTasks = boardTasks.filter((t) => t.status === "in_progress");
    const doneTasks = boardTasks.filter((t) => t.status === "done");

    setText(todoCountId, todoTasks.length.toString());
    setText(inProgCountId, inProgTasks.length.toString());
    setText(doneCountId, doneTasks.length.toString());

    todoTasks.forEach((t) => todoEl.appendChild(renderBoardCard(t, songs)));
    inProgTasks.forEach((t) => inProgEl.appendChild(renderBoardCard(t, songs)));
    doneTasks.forEach((t) => doneEl.appendChild(renderBoardCard(t, songs)));
  };

  populateBoardInto(
    $("board-cards-todo"),
    $("board-cards-in_progress"),
    $("board-cards-done"),
    "board-count-todo",
    "board-count-in_progress",
    "board-count-done"
  );

  populateBoardInto(
    $("session-board-cards-todo"),
    $("session-board-cards-in_progress"),
    $("session-board-cards-done"),
    "session-board-count-todo",
    "session-board-count-in_progress",
    "session-board-count-done"
  );

  document.querySelectorAll<HTMLElement>(".board-column").forEach((col) => {
    const status = col.dataset.status as ProjectTaskStatus;
    if (!status) return;

    col.ondragover = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      col.classList.add("drag-over");
    };

    col.ondragleave = () => {
      col.classList.remove("drag-over");
    };

    col.ondrop = (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const taskId = tasksState.draggedTaskId || e.dataTransfer?.getData("text/plain");
      if (taskId && tasksState.tasksUiOptions) {
        tasksState.tasksUiOptions.onUpdateTaskStatus(taskId, status);
      }
    };
  });
}
