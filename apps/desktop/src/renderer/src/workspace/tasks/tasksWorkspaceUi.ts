import { $, setText } from "../../core/dom";
import { escapeHtml } from "../../core/htmlSecurity";
import { renderTasksIntoList } from "./taskListUi";
import { renderBoard } from "./taskBoardUi";
import { tasksState } from "./tasksUiState";

export function renderTasksWorkspace(): void {
  const tasksUiOptions = tasksState.tasksUiOptions;
  if (!tasksUiOptions) return;
  const tasks = tasksUiOptions.getTasks();
  const songs = tasksUiOptions.getSongs();
  const collaborators = tasksUiOptions.getCollaborators();
  const canEdit = tasksUiOptions.canEdit();

  const totalCount = tasks.length;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
  const todoCount = tasks.filter((t) => t.status === "todo").length;
  const remainingCount = totalCount - doneCount;

  // 1. Update Apple Reminders Hero Title & Stats
  setText("tasks-hero-counter", remainingCount.toString());
  setText("session-tasks-hero-counter", remainingCount.toString());
  setText("tasks-completed-summary", `${doneCount} Completed`);
  setText("session-tasks-completed-summary", `${doneCount} Completed`);
  setText("tab-tasks-count", remainingCount.toString());
  setText("session-tasks-summary", `${remainingCount} Remaining · ${doneCount} Done`);

  const toggleDoneBtn = $("btn-tasks-toggle-completed");
  if (toggleDoneBtn) {
    toggleDoneBtn.textContent = tasksState.showCompletedTasks ? "Hide" : "Show";
  }
  const sessionToggleDoneBtn = $("session-btn-tasks-toggle-completed");
  if (sessionToggleDoneBtn) {
    sessionToggleDoneBtn.textContent = tasksState.showCompletedTasks ? "Hide" : "Show";
  }

  // 2. Populate assignee selector on creation bar
  const createAssigneeSelect = $<HTMLSelectElement>("task-new-assignee");
  const sessionAssigneeSelect = $<HTMLSelectElement>("session-task-new-assignee");
  let opts = '<option value="">Unassigned</option>';
  for (const c of collaborators) {
    const cName = c.displayName || c.username || "Collaborator";
    const label = c.isOwner ? `${cName} (Owner)` : cName;
    opts += `<option value="${c.userId}|${escapeHtml(cName)}">${escapeHtml(label)}</option>`;
  }
  if (createAssigneeSelect) {
    const currentVal = createAssigneeSelect.value;
    createAssigneeSelect.innerHTML = opts;
    if (currentVal) createAssigneeSelect.value = currentVal;
  }
  if (sessionAssigneeSelect) {
    const currentSessionVal = sessionAssigneeSelect.value;
    sessionAssigneeSelect.innerHTML = opts;
    if (currentSessionVal) sessionAssigneeSelect.value = currentSessionVal;
  }

  // 3. Populate song selector on creation bar
  const createSongSelect = $<HTMLSelectElement>("task-new-song");
  const sessionSongSelect = $<HTMLSelectElement>("session-task-new-song");
  let songOpts = '<option value="">All Tracks</option>';
  songs.forEach((s, i) => {
    songOpts += `<option value="${s.id}">${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
  });
  if (createSongSelect) {
    const curSongVal = createSongSelect.value;
    createSongSelect.innerHTML = songOpts;
    if (curSongVal && songs.some((s) => s.id === curSongVal)) createSongSelect.value = curSongVal;
  }
  if (sessionSongSelect) {
    const curSongVal = sessionSongSelect.value;
    sessionSongSelect.innerHTML = songOpts;
    if (curSongVal && songs.some((s) => s.id === curSongVal)) sessionSongSelect.value = curSongVal;
  }

  // 4. Update track filter dropdown on header bar
  const filterSongSelect = $<HTMLSelectElement>("tasks-filter-song");
  const sessionFilterSongSelect = $<HTMLSelectElement>("session-tasks-filter-song");
  let filterSongOpts = '<option value="all">All Tracks</option>';
  songs.forEach((s, i) => {
    filterSongOpts += `<option value="${s.id}" ${tasksState.currentTasksSongFilter === s.id ? "selected" : ""}>${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
  });
  if (filterSongSelect) filterSongSelect.innerHTML = filterSongOpts;
  if (sessionFilterSongSelect) sessionFilterSongSelect.innerHTML = filterSongOpts;

  // 5. Update stage & group by filter dropdowns
  const filterStageSelect = $<HTMLSelectElement>("tasks-filter-stage");
  const sessionFilterStageSelect = $<HTMLSelectElement>("session-tasks-filter-stage");
  if (filterStageSelect) filterStageSelect.value = tasksState.currentTasksStageFilter;
  if (sessionFilterStageSelect) sessionFilterStageSelect.value = tasksState.currentTasksStageFilter;

  const groupBySelect = $<HTMLSelectElement>("tasks-group-by");
  const sessionGroupBySelect = $<HTMLSelectElement>("session-tasks-group-by");
  if (groupBySelect) groupBySelect.value = tasksState.currentTasksGrouping;
  if (sessionGroupBySelect) sessionGroupBySelect.value = tasksState.currentTasksGrouping;

  // 6. Update view switcher buttons
  const btnList = $("btn-tasks-view-list");
  const btnBoard = $("btn-tasks-view-board");
  if (btnList && btnBoard) {
    btnList.classList.toggle("active", tasksState.currentTasksViewMode === "list");
    btnBoard.classList.toggle("active", tasksState.currentTasksViewMode === "board");
  }
  const sessionBtnList = $("session-btn-tasks-view-list");
  const sessionBtnBoard = $("session-btn-tasks-view-board");
  if (sessionBtnList && sessionBtnBoard) {
    sessionBtnList.classList.toggle("active", tasksState.currentTasksViewMode === "list");
    sessionBtnBoard.classList.toggle("active", tasksState.currentTasksViewMode === "board");
  }

  // 7. Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (!tasksState.showCompletedTasks && t.status === "done") return false;
    if (tasksState.currentTaskFilter !== "all" && t.status !== tasksState.currentTaskFilter) return false;
    if (tasksState.currentTasksSongFilter !== "all" && t.songId !== tasksState.currentTasksSongFilter) return false;
    if (tasksState.currentTasksStageFilter !== "all" && (t.stage || "general") !== tasksState.currentTasksStageFilter) return false;
    if (tasksState.currentTasksSearchQuery) {
      const q = tasksState.currentTasksSearchQuery.toLowerCase();
      const titleMatch = t.title.toLowerCase().includes(q);
      const noteMatch = t.note?.toLowerCase().includes(q);
      const assigneeMatch = t.assigneeName?.toLowerCase().includes(q);
      const songMatch = t.songTitle?.toLowerCase().includes(q);
      if (!titleMatch && !noteMatch && !assigneeMatch && !songMatch) return false;
    }
    return true;
  });

  const listContainer = $("project-tasks-list");
  const boardContainer = $("project-tasks-board");
  const emptyEl = $("project-tasks-empty");
  const sessionListContainer = $("session-tasks-list");
  const sessionBoardContainer = $("session-tasks-board");
  const sessionEmptyEl = $("session-tasks-empty");

  if (emptyEl) {
    emptyEl.classList.toggle("hidden", filteredTasks.length > 0);
  }
  if (sessionEmptyEl) {
    sessionEmptyEl.classList.toggle("hidden", filteredTasks.length > 0);
  }

  if (listContainer && boardContainer) {
    listContainer.classList.toggle("hidden", tasksState.currentTasksViewMode !== "list");
    boardContainer.classList.toggle("hidden", tasksState.currentTasksViewMode !== "board");
  }
  if (sessionListContainer && sessionBoardContainer) {
    sessionListContainer.classList.toggle("hidden", tasksState.currentTasksViewMode !== "list");
    sessionBoardContainer.classList.toggle("hidden", tasksState.currentTasksViewMode !== "board");
  }

  // 8. Render List View
  if (listContainer) renderTasksIntoList(listContainer, filteredTasks, songs);
  if (sessionListContainer) renderTasksIntoList(sessionListContainer, filteredTasks, songs);

  // 9. Render Board View
  if (boardContainer || sessionBoardContainer) {
    renderBoard(filteredTasks, songs);
  }

  // 10. Render Overview Tasks Preview Card
  const overviewListEl = $("overview-tasks-list");
  if (overviewListEl) {
    overviewListEl.innerHTML = "";
    const pendingTasks = tasks.filter((t) => t.status !== "done");
    setText("overview-tasks-count", pendingTasks.length.toString());

    if (pendingTasks.length === 0) {
      overviewListEl.innerHTML = `
        <div class="projects-empty" style="padding: 16px;">
          <p style="margin: 0; font-size: 12.5px; color: #94a3b8;">${tasks.length > 0 ? "All production tasks are completed! 🎉" : "No tasks added yet. Click All Tasks to start tracking your to-dos."}</p>
        </div>
      `;
    } else {
      pendingTasks.slice(0, 5).forEach((task) => {
        const item = document.createElement("div");
        item.className = `overview-task-item status-${task.status || "todo"}`;
        const assigneeBadge = task.assigneeName ? `<span class="overview-task-assignee">${escapeHtml(task.assigneeName)}</span>` : "";
        const dueBadge = task.dueDate ? `<span class="overview-task-due">Due ${escapeHtml(task.dueDate)}</span>` : "";
        item.innerHTML = `
          <button type="button" class="reminders-check-btn" title="Mark as Done">
            ${task.status === "done" ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>' : ""}
          </button>
          <span class="overview-task-title">${escapeHtml(task.title)}</span>
          ${assigneeBadge}
          ${dueBadge}
        `;
        item.querySelector(".reminders-check-btn")?.addEventListener("click", (e) => {
          e.stopPropagation();
          tasksUiOptions?.onToggleTaskStatus(task.id);
        });
        overviewListEl.appendChild(item);
      });
    }
  }
}
