import type { ProjectTaskStage, ProjectTaskStatus } from "@jameet/shared";
import { escapeHtml } from "../../core/htmlSecurity";
import { SONG_ICONS, SONG_COLORS, STAGE_CONFIG } from "./tasksConstants";
import { formatShortDate } from "./taskFormatters";
import { showTaskContextMenu } from "./taskContextMenuUi";
import { openTaskInspector } from "./taskInspectorUi";
import { tasksState } from "./tasksUiState";
import type { ReadonlyTaskItem, ReadonlySongItem } from "./tasksTypes";

export function renderListCard(task: ReadonlyTaskItem): HTMLElement {
  const tasksUiOptions = tasksState.tasksUiOptions;
  const songs = tasksUiOptions ? tasksUiOptions.getSongs() : [];
  const collaborators = tasksUiOptions ? tasksUiOptions.getCollaborators() : [];
  const canEdit = tasksUiOptions ? tasksUiOptions.canEdit() : false;

  const isSelected = tasksState.currentSelectedTaskId === task.id;
  const row = document.createElement("div");
  row.className = `reminders-task-row status-${task.status || "todo"}${isSelected ? " is-selected" : ""}`;
  row.dataset.taskId = task.id;
  row.setAttribute("draggable", "true");

  let toggleIcon = "";
  if (task.status === "done") {
    toggleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  }

  // Unified Assignee Dropdown Pill
  let assigneeOpts = '<option value="">Unassigned</option>';
  for (const c of collaborators) {
    const cName = c.displayName || c.username || "Collaborator";
    const isSelectedAssignee = task.assigneeId === c.userId;
    assigneeOpts += `<option value="${c.userId}|${escapeHtml(cName)}" ${isSelectedAssignee ? "selected" : ""}>${escapeHtml(cName)}</option>`;
  }
  const assigneeHtml = `
    <select class="task-action-pill task-assignee-select" title="Assignee">
      ${assigneeOpts}
    </select>
  `;

  // Unified Due Date Pill
  const dueHtml = `
    <input type="date" class="task-action-pill task-due-input" value="${escapeHtml(task.dueDate || "")}" title="Due Date" />
  `;

  // Unified Stage Dropdown Pill
  const stageKey = task.stage || "general";
  const stageBadgeHtml = `
    <select class="task-action-pill task-stage-select" title="Stage">
      <option value="general" ${stageKey === "general" ? "selected" : ""}>Stage: General</option>
      <option value="writing" ${stageKey === "writing" ? "selected" : ""}>Stage: Writing</option>
      <option value="recording" ${stageKey === "recording" ? "selected" : ""}>Stage: Recording</option>
      <option value="arrangement" ${stageKey === "arrangement" ? "selected" : ""}>Stage: Arrangement</option>
      <option value="mix" ${stageKey === "mix" ? "selected" : ""}>Stage: Mix</option>
      <option value="mastering" ${stageKey === "mastering" ? "selected" : ""}>Stage: Mastering</option>
      <option value="revisions" ${stageKey === "revisions" ? "selected" : ""}>Stage: Revisions</option>
    </select>
  `;

  // Unified Track Dropdown Pill
  let songPillHtml = "";
  if (songs.length > 0) {
    let sOpts = '<option value="">Track: None</option>';
    songs.forEach((s, i) => {
      const isSongSelected = task.songId === s.id;
      sOpts += `<option value="${s.id}|${escapeHtml(s.title || `Song ${i + 1}`)}" ${isSongSelected ? "selected" : ""}>${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
    });
    songPillHtml = `
      <select class="task-action-pill task-song-select" title="Linked Track">
        ${sOpts}
      </select>
    `;
  }

  // Subtasks checklist HTML
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const doneSubs = subtasks.filter((s) => s.done).length;

  row.innerHTML = `
    <div class="reminders-task-main">
      <button type="button" class="reminders-check-btn" title="${task.status === "done" ? "Reopen task" : "Mark as Done"}">
        ${toggleIcon}
      </button>
      <input type="text" class="reminders-task-title-input" value="${escapeHtml(task.title)}" placeholder="Task" maxlength="150" />
      <div class="reminders-task-right">
        ${task.dueDate ? `<span class="task-meta-badge due-badge">${escapeHtml(formatShortDate(task.dueDate))}</span>` : ""}
        <button type="button" class="reminders-info-btn" title="Task Details">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
      </div>
    </div>

    <div class="task-subtasks-block">
      ${subtasks.length > 0 ? `
        <div class="task-subtasks-list">
          ${subtasks.map((st) => `
            <div class="task-subtask-item ${st.done ? "done" : ""}" data-subtask-id="${st.id}">
              <button type="button" class="task-subtask-check ${st.done ? "done" : ""}" title="${st.done ? "Mark undone" : "Mark done"}">
                <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <input type="text" class="task-subtask-text-input" value="${escapeHtml(st.title)}" maxlength="120" />
              <button type="button" class="task-subtask-del" title="Delete subtask">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          `).join("")}
        </div>
      ` : ""}
      <div class="task-subtasks-add-row">
        <span class="subtask-add-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        </span>
        <input type="text" class="task-subtask-add-input" placeholder="Add subtask..." maxlength="120" />
        ${subtasks.length > 0 ? `
          <span class="task-subtasks-counter-pill"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polyline points="20 6 9 17 4 12"/></svg><span>${doneSubs}/${subtasks.length}</span></span>
        ` : ""}
      </div>
    </div>

    <div class="reminders-task-details">
      <div class="task-note-inner">
        <textarea class="task-note-textarea" placeholder="Notes" rows="1">${escapeHtml(task.note || "")}</textarea>
      </div>
      <div class="reminders-task-meta-actions">
        ${stageBadgeHtml}
        ${songPillHtml}
        ${assigneeHtml}
        ${dueHtml}
      </div>
    </div>
  `;

  // Wiring Row Events
  row.querySelector(".reminders-check-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    tasksUiOptions?.onToggleTaskStatus(task.id);
  });

  // Stage Change
  row.querySelector<HTMLSelectElement>(".task-stage-select")?.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value as ProjectTaskStage;
    const stage = val === "general" ? null : val;
    if (tasksState.currentTasksGrouping === "stage") {
      tasksState.currentSelectedTaskId = task.id;
    }
    tasksUiOptions?.onCommitTaskField(task.id, { stage }, { rerender: tasksState.currentTasksGrouping === "stage" });
  });

  // Track Change
  row.querySelector<HTMLSelectElement>(".task-song-select")?.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    let sId: string | null = null;
    let sTitle: string | null = null;
    if (val) {
      const parts = val.split("|");
      sId = parts[0] ?? null;
      sTitle = parts[1] ?? null;
    }
    if (tasksState.currentTasksGrouping === "song") {
      tasksState.currentSelectedTaskId = task.id;
    }
    tasksUiOptions?.onCommitTaskField(task.id, { songId: sId, songTitle: sTitle }, { rerender: tasksState.currentTasksGrouping === "song" });
  });

  // Assignee Change
  row.querySelector<HTMLSelectElement>(".task-assignee-select")?.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    let aId: string | null = null;
    let aName: string | null = null;
    if (val) {
      const parts = val.split("|");
      aId = parts[0] ?? null;
      aName = parts[1] ?? null;
    }
    tasksUiOptions?.onCommitTaskField(task.id, { assigneeId: aId, assigneeName: aName });
  });

  // Due Date Change
  row.querySelector<HTMLInputElement>(".task-due-input")?.addEventListener("change", (e) => {
    const due = (e.target as HTMLInputElement).value || null;
    const rightArea = row.querySelector(".reminders-task-right");
    if (rightArea) {
      let badge = rightArea.querySelector(".due-badge");
      if (due) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "task-meta-badge due-badge";
          rightArea.insertBefore(badge, rightArea.querySelector(".reminders-info-btn"));
        }
        badge.textContent = formatShortDate(due);
      } else if (badge) {
        badge.remove();
      }
    }
    tasksUiOptions?.onCommitTaskField(task.id, { dueDate: due });
  });

  const titleInput = row.querySelector<HTMLInputElement>(".reminders-task-title-input");
  titleInput?.addEventListener("focus", () => {
    tasksState.currentSelectedTaskId = task.id;
  });
  titleInput?.addEventListener("input", (e) => {
    tasksUiOptions?.onLiveUpdateTaskField(task.id, { title: (e.target as HTMLInputElement).value });
  });
  titleInput?.addEventListener("blur", () => {
    const trimmed = titleInput.value.trim() || "Untitled Task";
    tasksUiOptions?.onCommitTaskField(task.id, { title: trimmed }, { immediateFlush: true });
  });

  // Subtask events
  row.querySelectorAll<HTMLElement>(".task-subtask-item").forEach((stItem) => {
    const sId = stItem.dataset.subtaskId;
    if (!sId) return;
    stItem.querySelector(".task-subtask-check")?.addEventListener("click", (e) => {
      e.stopPropagation();
      tasksState.currentSelectedTaskId = task.id;
      tasksUiOptions?.onToggleSubtask(task.id, sId);
    });
    stItem.querySelector(".task-subtask-del")?.addEventListener("click", (e) => {
      e.stopPropagation();
      tasksState.currentSelectedTaskId = task.id;
      tasksUiOptions?.onDeleteSubtask(task.id, sId);
    });

    const subInput = stItem.querySelector<HTMLInputElement>(".task-subtask-text-input");
    subInput?.addEventListener("focus", () => {
      tasksState.currentSelectedTaskId = task.id;
    });
    subInput?.addEventListener("input", (e) => {
      tasksUiOptions?.onLiveUpdateSubtask(task.id, sId, (e.target as HTMLInputElement).value);
    });
    subInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const addInput = row.querySelector<HTMLInputElement>(".task-subtask-add-input");
        if (addInput) {
          addInput.focus();
        }
      }
    });
  });

  const subtaskAddInput = row.querySelector<HTMLInputElement>(".task-subtask-add-input");
  subtaskAddInput?.addEventListener("focus", () => {
    tasksState.currentSelectedTaskId = task.id;
  });
  subtaskAddInput?.addEventListener("keydown", (ke) => {
    if (ke.key === "Enter") {
      ke.preventDefault();
      const text = subtaskAddInput.value.trim();
      if (text) {
        tasksState.currentSelectedTaskId = task.id;
        tasksUiOptions?.onAddSubtask(task.id, text);
        subtaskAddInput.value = "";
        setTimeout(() => {
          const taskRow = document.querySelector(`.reminders-task-row[data-task-id="${task.id}"]`);
          const addInput = taskRow?.querySelector<HTMLInputElement>(".task-subtask-add-input");
          if (addInput) addInput.focus();
        }, 10);
      }
    }
  });

  // Note textarea
  const noteTextarea = row.querySelector<HTMLTextAreaElement>(".task-note-textarea");
  if (noteTextarea) {
    const resizeNote = () => {
      noteTextarea.style.height = "auto";
      noteTextarea.style.height = `${Math.max(20, noteTextarea.scrollHeight)}px`;
    };
    setTimeout(resizeNote, 0);

    noteTextarea.addEventListener("focus", () => {
      tasksState.currentSelectedTaskId = task.id;
    });

    noteTextarea.addEventListener("input", () => {
      resizeNote();
      tasksUiOptions?.onLiveUpdateTaskField(task.id, { note: noteTextarea.value });
    });

    noteTextarea.addEventListener("blur", () => {
      const trimmed = noteTextarea.value.trim() || null;
      tasksUiOptions?.onCommitTaskField(task.id, { note: trimmed }, { immediateFlush: true });
    });
  }

  // Expand on Click / Selection
  row.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".reminders-check-btn, .reminders-info-btn, .task-subtask-check, .task-subtask-del")) {
      tasksState.currentSelectedTaskId = task.id;
      document.querySelectorAll(".reminders-task-row.is-selected").forEach((r) => {
        if (r !== row) r.classList.remove("is-selected");
      });
      row.classList.add("is-selected");
    }
  });

  // Info Button (Apple Reminders Inspector)
  const infoBtn = row.querySelector<HTMLButtonElement>(".reminders-info-btn");
  infoBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    openTaskInspector(task, infoBtn);
  });

  // Right-Click Context Menu
  row.addEventListener("contextmenu", (e) => {
    showTaskContextMenu(e, task);
  });

  // Drag and Drop
  row.addEventListener("dragstart", (e) => {
    tasksState.draggedTaskId = task.id;
    row.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", task.id);
      e.dataTransfer.effectAllowed = "move";
    }
  });

  row.addEventListener("dragend", () => {
    tasksState.draggedTaskId = null;
    row.classList.remove("dragging");
    document.querySelectorAll(".reminders-task-row").forEach((r) => r.classList.remove("drag-over-top", "drag-over-bottom"));
    document.querySelectorAll(".reminders-group-section").forEach((s) => s.classList.remove("drag-over"));
  });

  row.addEventListener("dragover", (e) => {
    if (!tasksState.draggedTaskId || tasksState.draggedTaskId === task.id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const rect = row.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      row.classList.add("drag-over-top");
      row.classList.remove("drag-over-bottom");
    } else {
      row.classList.add("drag-over-bottom");
      row.classList.remove("drag-over-top");
    }
  });

  row.addEventListener("dragleave", () => {
    row.classList.remove("drag-over-top", "drag-over-bottom");
  });

  row.addEventListener("drop", (e) => {
    if (!tasksState.draggedTaskId || tasksState.draggedTaskId === task.id || !tasksUiOptions) return;
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("drag-over-top", "drag-over-bottom");

    const rect = row.getBoundingClientRect();
    const insertAfter = e.clientY >= rect.top + rect.height / 2;

    let inheritedChanges: { songId?: string | null; songTitle?: string | null; stage?: ProjectTaskStage | null; status?: ProjectTaskStatus } | undefined;
    if (tasksState.currentTasksGrouping === "song") {
      inheritedChanges = { songId: task.songId || null, songTitle: task.songTitle || null };
    } else if (tasksState.currentTasksGrouping === "stage") {
      inheritedChanges = { stage: task.stage || null };
    } else if (tasksState.currentTasksGrouping === "status") {
      inheritedChanges = { status: task.status || "todo" };
    }

    tasksState.currentSelectedTaskId = tasksState.draggedTaskId;
    tasksUiOptions.onReorderTasks(tasksState.draggedTaskId, task.id, insertAfter, inheritedChanges);
  });

  if (!canEdit) {
    row.removeAttribute("draggable");
    const checkBtn = row.querySelector<HTMLButtonElement>(".reminders-check-btn");
    if (checkBtn) {
      checkBtn.disabled = true;
      checkBtn.style.cursor = "default";
      checkBtn.title = "View only mode";
    }
    row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach((el) => {
      el.disabled = true;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.readOnly = true;
    });
    row.querySelectorAll<HTMLElement>(".btn-del, .task-subtasks-add-row, .task-subtask-del").forEach((el) => {
      el.style.display = "none";
    });
    row.querySelectorAll<HTMLButtonElement>(".task-subtask-check").forEach((el) => {
      el.disabled = true;
    });
  }

  return row;
}

export function renderGroupSection(group: {
  id: string;
  title: string;
  iconKey?: string;
  colorHex?: string;
  iconSvg?: string;
  tasks: readonly ReadonlyTaskItem[];
  songRef?: ReadonlySongItem;
  defaultSongId?: string;
  defaultStage?: ProjectTaskStage;
}): HTMLElement {
  const tasksUiOptions = tasksState.tasksUiOptions;
  const songs = tasksUiOptions ? tasksUiOptions.getSongs() : [];
  const section = document.createElement("div");
  section.className = `reminders-group-section ${tasksState.tasksCollapsedGroups.has(group.id) ? "collapsed" : ""}`;
  section.dataset.groupId = group.id;

  const defaultMusicIcon = SONG_ICONS["music"];
  if (!defaultMusicIcon) return section;

  const iconKey = group.songRef?.icon || group.iconKey || "music";
  const colorHex = group.songRef?.color || group.colorHex || "#f43f5e";
  const iconSvg = SONG_ICONS[iconKey]?.svg || group.iconSvg || defaultMusicIcon.svg;

  const header = document.createElement("div");
  header.className = "reminders-group-header";
  header.innerHTML = `
    <div class="reminders-group-title-wrap">
      <span class="reminders-group-icon" style="color: ${colorHex};">
        ${iconSvg}
      </span>
      <h3 class="reminders-group-title">${escapeHtml(group.title)}</h3>
      <span class="reminders-group-count">${group.tasks.length}</span>
    </div>
    <div class="reminders-group-actions-right">
      <span class="reminders-group-chevron">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </span>
    </div>
  `;

  // Icon button click: open Customizer Popover
  const iconBtn = header.querySelector<HTMLButtonElement>(".reminders-group-icon-btn");
  if (iconBtn && group.songRef) {
    iconBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".song-customizer-popover").forEach((p) => p.remove());

      const popover = document.createElement("div");
      popover.className = "song-customizer-popover";
      popover.innerHTML = `
        <div class="song-customizer-section-title">Track Icon</div>
        <div class="song-customizer-icons-grid">
          ${Object.entries(SONG_ICONS)
            .map(
              ([k, ic]) => `
            <button type="button" class="song-customizer-icon-item ${k === iconKey ? "active" : ""}" data-icon-key="${k}" title="${escapeHtml(ic.label)}">
              ${ic.svg}
            </button>
          `
            )
            .join("")}
        </div>
        <div class="song-customizer-section-title" style="margin-top: 4px;">Track Color</div>
        <div class="song-customizer-colors-grid">
          ${SONG_COLORS.map(
            (c) => `
            <button type="button" class="song-customizer-color-dot ${c.hex === colorHex ? "active" : ""}" data-color-hex="${c.hex}" title="${escapeHtml(c.name)}" style="background: ${c.hex};">
            </button>
          `
          ).join("")}
        </div>
      `;

      popover.addEventListener("click", (pe) => pe.stopPropagation());

      popover.querySelectorAll<HTMLButtonElement>(".song-customizer-icon-item").forEach((iBtn) => {
        iBtn.addEventListener("click", () => {
          const chosenKey = iBtn.dataset.iconKey;
          if (chosenKey && group.songRef && tasksUiOptions) {
            tasksUiOptions.onUpdateSongCustomization(group.songRef.id, { icon: chosenKey });
          }
        });
      });

      popover.querySelectorAll<HTMLButtonElement>(".song-customizer-color-dot").forEach((cBtn) => {
        cBtn.addEventListener("click", () => {
          const chosenHex = cBtn.dataset.colorHex;
          if (chosenHex && group.songRef && tasksUiOptions) {
            tasksUiOptions.onUpdateSongCustomization(group.songRef.id, { color: chosenHex });
          }
        });
      });

      section.appendChild(popover);

      const closeHandler = (docEv: MouseEvent) => {
        if (!popover.contains(docEv.target as Node) && docEv.target !== iconBtn) {
          popover.remove();
          document.removeEventListener("click", closeHandler);
        }
      };
      setTimeout(() => document.addEventListener("click", closeHandler), 0);
    });
  }

  header.addEventListener("click", () => {
    if (tasksState.tasksCollapsedGroups.has(group.id)) {
      tasksState.tasksCollapsedGroups.delete(group.id);
      section.classList.remove("collapsed");
    } else {
      tasksState.tasksCollapsedGroups.add(group.id);
      section.classList.add("collapsed");
    }
  });

  const itemsContainer = document.createElement("div");
  itemsContainer.className = "reminders-group-items";
  group.tasks.forEach((t) => itemsContainer.appendChild(renderListCard(t)));

  // Inline Quick Add Row at bottom of section
  const quickAddRow = document.createElement("div");
  quickAddRow.className = "reminders-quick-add-row";
  quickAddRow.innerHTML = `
    <span class="reminders-dashed-circle"></span>
    <input type="text" class="reminders-quick-add-input" placeholder="" maxlength="150" />
  `;

  const quickInput = quickAddRow.querySelector<HTMLInputElement>(".reminders-quick-add-input");
  quickInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = quickInput.value.trim();
      if (val && tasksUiOptions) {
        let songTitle: string | undefined;
        if (group.defaultSongId && songs) {
          const s = songs.find((x) => x.id === group.defaultSongId);
          songTitle = s?.title;
        }
        tasksUiOptions.onCreateTask({
          title: val,
          songId: group.defaultSongId,
          songTitle,
          stage: group.defaultStage
        });
        quickInput.value = "";
      }
    }
  });

  // Section-level Drag & Drop Target
  section.addEventListener("dragover", (e) => {
    if (!tasksState.draggedTaskId) return;
    e.preventDefault();
    section.classList.add("drag-over");
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });

  section.addEventListener("dragleave", (e) => {
    if (!section.contains(e.relatedTarget as Node)) {
      section.classList.remove("drag-over");
    }
  });

  section.addEventListener("drop", (e) => {
    if (!tasksState.draggedTaskId || !tasksUiOptions) return;
    e.preventDefault();
    section.classList.remove("drag-over");

    let songId: string | null | undefined;
    let songTitle: string | null | undefined;
    if (group.defaultSongId !== undefined) {
      if (group.defaultSongId === "") {
        songId = null;
        songTitle = null;
      } else {
        songId = group.defaultSongId;
        const s = songs.find((x) => x.id === group.defaultSongId);
        songTitle = s?.title;
      }
    }

    let stage: ProjectTaskStage | null | undefined;
    if (group.defaultStage !== undefined) {
      stage = group.defaultStage === "general" ? null : group.defaultStage;
    }

    tasksState.currentSelectedTaskId = tasksState.draggedTaskId;
    tasksUiOptions.onMoveTaskToGroup(tasksState.draggedTaskId, { songId, songTitle, stage });
  });

  section.appendChild(header);
  section.appendChild(itemsContainer);
  section.appendChild(quickAddRow);
  return section;
}

export function renderTasksIntoList(
  container: HTMLElement,
  filteredTasks: readonly ReadonlyTaskItem[],
  songs: readonly ReadonlySongItem[]
): void {
  container.innerHTML = "";

  if (tasksState.currentTasksGrouping === "song") {
    // Group by track
    const defaultTrackPalette = ["#f43f5e", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ec4899", "#f97316"];
    const trackGroups: {
      id: string;
      title: string;
      iconKey?: string;
      colorHex?: string;
      iconSvg?: string;
      tasks: readonly ReadonlyTaskItem[];
      songRef?: ReadonlySongItem;
      defaultSongId?: string;
    }[] = [];

    const defaultMusicIcon = SONG_ICONS["music"];
    const tagIcon = SONG_ICONS["tag"];
    if (!defaultMusicIcon || !tagIcon) return;

    for (let idx = 0; idx < songs.length; idx++) {
      const s = songs[idx];
      if (!s) continue;
      const sTasks = filteredTasks.filter((t) => t.songId === s.id);
      const paletteColor = defaultTrackPalette[idx % defaultTrackPalette.length];
      const color = s.color || paletteColor;
      if (!color) continue;
      const iconKey = s.icon || "music";
      const iconDef = SONG_ICONS[iconKey] || defaultMusicIcon;
      trackGroups.push({
        id: `song_${s.id}`,
        title: s.title || `Song ${idx + 1}`,
        songRef: s,
        iconKey,
        colorHex: color,
        iconSvg: iconDef.svg,
        tasks: sTasks,
        defaultSongId: s.id
      });
    }

    const unassignedTasks = filteredTasks.filter((t) => !t.songId || !songs.some((s) => s.id === t.songId));
    trackGroups.push({
      id: "song_general",
      title: "General Tasks",
      iconKey: "tag",
      colorHex: "#94a3b8",
      iconSvg: tagIcon.svg,
      tasks: unassignedTasks,
      defaultSongId: ""
    });

    trackGroups.forEach((grp) => {
      container.appendChild(renderGroupSection(grp));
    });
  } else if (tasksState.currentTasksGrouping === "stage") {
    const stageKeys: ProjectTaskStage[] = ["writing", "recording", "arrangement", "mix", "mastering", "revisions", "general"];
    const stageColors: Record<ProjectTaskStage, string> = {
      writing: "#8b5cf6",
      recording: "#f43f5e",
      arrangement: "#06b6d4",
      mix: "#f59e0b",
      mastering: "#10b981",
      revisions: "#ec4899",
      general: "#94a3b8"
    };
    stageKeys.forEach((stg) => {
      const stgTasks = filteredTasks.filter((t) => (t.stage || "general") === stg);
      const cfg = STAGE_CONFIG[stg] || STAGE_CONFIG.general;
      container.appendChild(
        renderGroupSection({
          id: `stage_${stg}`,
          title: cfg.label,
          colorHex: stageColors[stg] || "#94a3b8",
          iconSvg: cfg.iconSvg,
          tasks: stgTasks,
          defaultStage: stg === "general" ? undefined : stg
        })
      );
    });
  } else if (tasksState.currentTasksGrouping === "status") {
    const statusGroups: { id: string; title: string; status: ProjectTaskStatus; colorHex: string; iconSvg: string }[] = [
      {
        id: "status_todo",
        title: "To Do",
        status: "todo",
        colorHex: "#94a3b8",
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
      },
      {
        id: "status_in_progress",
        title: "In Progress",
        status: "in_progress",
        colorHex: "#f59e0b",
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
      },
      {
        id: "status_done",
        title: "Done",
        status: "done",
        colorHex: "#10b981",
        iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      }
    ];
    statusGroups.forEach((grp) => {
      const sTasks = filteredTasks.filter((t) => t.status === grp.status);
      container.appendChild(
        renderGroupSection({
          id: grp.id,
          title: grp.title,
          colorHex: grp.colorHex,
          iconSvg: grp.iconSvg,
          tasks: sTasks
        })
      );
    });
  } else {
    // Flat list
    filteredTasks.forEach((t) => container.appendChild(renderListCard(t)));
  }
}
