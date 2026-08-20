import { tasksState } from "./tasksUiState";
import type { ReadonlyTaskItem } from "./tasksTypes";

// ========================================================
// TASK CONTEXT MENU
// ========================================================

export function showTaskContextMenu(e: MouseEvent, task: ReadonlyTaskItem): void {
  const tasksUiOptions = tasksState.tasksUiOptions;
  if (!tasksUiOptions) return;
  e.preventDefault();
  e.stopPropagation();
  if (!tasksUiOptions.canEdit()) return;

  document.querySelectorAll(".task-context-menu").forEach((m) => m.remove());

  const menu = document.createElement("div");
  menu.className = "task-context-menu";

  const isDone = task.status === "done";

  menu.innerHTML = `
    <div class="task-context-item" data-action="toggle-status">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>${isDone ? "Mark as To Do" : "Mark as Done"}</span>
      </div>
    </div>
    <div class="task-context-item" data-action="duplicate">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        <span>Duplicate Task</span>
      </div>
    </div>
    <div class="task-context-item" data-action="copy">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/></svg>
        <span>Copy Title</span>
      </div>
    </div>
    <div class="task-context-divider"></div>
    <div class="task-context-item" data-action="add-subtask">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
        <span>Add Subtask</span>
      </div>
    </div>
    <div class="task-context-item" data-action="add-note">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        <span>${task.note && task.note.trim() ? "Edit Note" : "Add Note"}</span>
      </div>
    </div>
    <div class="task-context-divider"></div>
    <div class="task-context-item" data-action="due-today">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
        <span>Due Today</span>
      </div>
    </div>
    <div class="task-context-item" data-action="due-tomorrow">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
        <span>Due Tomorrow</span>
      </div>
    </div>
    ${task.dueDate ? `
      <div class="task-context-item" data-action="clear-due">
        <div class="task-context-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
          <span>Remove Due Date</span>
        </div>
      </div>
    ` : ""}
    <div class="task-context-divider"></div>
    <div class="task-context-item danger" data-action="delete">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span>Delete Task</span>
      </div>
    </div>
  `;

  document.body.appendChild(menu);

  const menuWidth = 180;
  const menuHeight = menu.offsetHeight || 260;
  let posX = e.clientX;
  let posY = e.clientY;

  if (posX + menuWidth > window.innerWidth - 10) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (posY + menuHeight > window.innerHeight - 10) {
    posY = window.innerHeight - menuHeight - 10;
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;

  menu.addEventListener("click", (ev) => {
    const currentOptions = tasksState.tasksUiOptions;
    if (!currentOptions) return;
    ev.stopPropagation();
    const item = (ev.target as HTMLElement).closest<HTMLElement>(".task-context-item");
    if (!item) return;
    const action = item.dataset.action;
    menu.remove();

    if (action === "toggle-status") {
      currentOptions.onToggleTaskStatus(task.id);
    } else if (action === "duplicate") {
      currentOptions.onDuplicateTask(task.id);
    } else if (action === "copy") {
      navigator.clipboard.writeText(task.title || "").catch(() => {});
    } else if (action === "add-subtask") {
      tasksState.currentSelectedTaskId = task.id;
      currentOptions.onAddSubtask(task.id, "New subtask");
      setTimeout(() => {
        const taskRow = document.querySelector(`.reminders-task-row[data-task-id="${task.id}"]`);
        const addInput = taskRow?.querySelector<HTMLInputElement>(".task-subtask-add-input");
        if (addInput) addInput.focus();
      }, 10);
    } else if (action === "add-note") {
      const initialNote = task.note || "Note...";
      currentOptions.onCommitTaskField(task.id, { note: initialNote }, { rerender: true });
    } else if (action === "due-today") {
      const today = new Date().toISOString().split("T")[0];
      currentOptions.onCommitTaskField(task.id, { dueDate: today }, { rerender: true });
    } else if (action === "due-tomorrow") {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
      currentOptions.onCommitTaskField(task.id, { dueDate: tomorrow }, { rerender: true });
    } else if (action === "clear-due") {
      currentOptions.onCommitTaskField(task.id, { dueDate: null }, { rerender: true });
    } else if (action === "delete") {
      currentOptions.onDeleteTask(task.id);
    }
  });

  const closeHandler = (docEv: MouseEvent) => {
    if (!menu.contains(docEv.target as Node)) {
      menu.remove();
      document.removeEventListener("click", closeHandler);
      document.removeEventListener("contextmenu", closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", closeHandler);
    document.addEventListener("contextmenu", closeHandler);
  }, 0);
}
