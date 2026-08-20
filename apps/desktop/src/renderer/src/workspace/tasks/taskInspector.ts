import type { ProjectTaskStage } from "@jameet/shared";
import { escapeHtml } from "../../core/htmlSecurity";
import { tasksState } from "./tasksUiState";
import type { ReadonlyTaskItem } from "./tasksTypes";

// ========================================================
// TASK INSPECTOR / DETAILS POPOVER
// ========================================================

export function openTaskInspector(task: ReadonlyTaskItem, anchorEl: HTMLElement): void {
  const tasksUiOptions = tasksState.tasksUiOptions;
  if (!tasksUiOptions) return;
  document.querySelectorAll(".reminders-inspector-popover").forEach((p) => p.remove());
  document.querySelectorAll(".task-context-menu").forEach((m) => m.remove());

  const popover = document.createElement("div");
  popover.className = "reminders-inspector-popover";

  const songs = tasksUiOptions.getSongs();
  const hasDate = Boolean(task.dueDate);
  const stageKey = task.stage || "general";

  const songOptionsHtml = `
    <option value="">No Track</option>
    ${songs
      .map(
        (s) => `
      <option value="${s.id}|${escapeHtml(s.title)}" ${s.id === task.songId ? "selected" : ""}>${escapeHtml(s.title)}</option>
    `
      )
      .join("")}
  `;

  popover.innerHTML = `
    <!-- Header: Title & Notes -->
    <div class="inspector-card">
      <input type="text" class="inspector-title-input" value="${escapeHtml(task.title)}" placeholder="Task title" maxlength="150" />
      <textarea class="inspector-notes-textarea" placeholder="Notes" rows="2">${escapeHtml(task.note || "")}</textarea>
    </div>

    <!-- Date & Time -->
    <div class="inspector-section-title">Date & Time</div>
    <div class="inspector-card">
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          <span>Date</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="date" class="inspector-date-input ${hasDate ? "" : "hidden"}" value="${escapeHtml(task.dueDate || "")}" />
          <label class="inspector-switch">
            <input type="checkbox" class="inspector-date-toggle" ${hasDate ? "checked" : ""} />
            <span class="inspector-slider"></span>
          </label>
        </div>
      </div>
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1z"/><line x1="4" x2="22" y1="22" y2="15"/></svg>
          <span>Priority</span>
        </div>
        <select class="inspector-select inspector-priority-select">
          <option value="none" ${task.priority === "none" || !task.priority ? "selected" : ""}>None</option>
          <option value="low" ${task.priority === "low" ? "selected" : ""}>Low</option>
          <option value="medium" ${task.priority === "medium" ? "selected" : ""}>Medium</option>
          <option value="high" ${task.priority === "high" ? "selected" : ""}>High</option>
          <option value="urgent" ${task.priority === "urgent" ? "selected" : ""}>Urgent</option>
        </select>
      </div>
    </div>

    <!-- Organization -->
    <div class="inspector-section-title">Organization</div>
    <div class="inspector-card">
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span>Track</span>
        </div>
        <select class="inspector-select inspector-song-select">
          ${songOptionsHtml}
        </select>
      </div>
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
          <span>Stage</span>
        </div>
        <select class="inspector-select inspector-stage-select">
          <option value="general" ${stageKey === "general" ? "selected" : ""}>General</option>
          <option value="writing" ${stageKey === "writing" ? "selected" : ""}>Writing</option>
          <option value="recording" ${stageKey === "recording" ? "selected" : ""}>Recording</option>
          <option value="arrangement" ${stageKey === "arrangement" ? "selected" : ""}>Arrangement</option>
          <option value="mix" ${stageKey === "mix" ? "selected" : ""}>Mix</option>
          <option value="mastering" ${stageKey === "mastering" ? "selected" : ""}>Mastering</option>
          <option value="revisions" ${stageKey === "revisions" ? "selected" : ""}>Revisions</option>
        </select>
      </div>
    </div>
  `;

  document.body.appendChild(popover);

  const canEdit = tasksUiOptions.canEdit();
  if (!canEdit) {
    popover.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach((el) => {
      el.disabled = true;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.readOnly = true;
      }
    });
    const slider = popover.querySelector<HTMLElement>(".inspector-slider");
    if (slider) slider.style.pointerEvents = "none";
  }

  const rect = anchorEl.getBoundingClientRect();
  const popoverWidth = 320;
  const popoverHeight = popover.offsetHeight || 380;
  let posX = rect.right + 10;
  let posY = rect.top - 20;

  if (posX + popoverWidth > window.innerWidth - 16) {
    posX = rect.left - popoverWidth - 10;
  }
  if (posX < 10) posX = 10;

  if (posY + popoverHeight > window.innerHeight - 16) {
    posY = window.innerHeight - popoverHeight - 16;
  }
  if (posY < 10) posY = 10;

  popover.style.left = `${posX}px`;
  popover.style.top = `${posY}px`;

  if (canEdit && tasksUiOptions) {
    const titleInput = popover.querySelector<HTMLInputElement>(".inspector-title-input");
    titleInput?.addEventListener("input", () => {
      tasksState.tasksUiOptions?.onCommitTaskField(task.id, { title: titleInput.value }, { rerender: true });
    });

    const notesTextarea = popover.querySelector<HTMLTextAreaElement>(".inspector-notes-textarea");
    notesTextarea?.addEventListener("input", () => {
      tasksState.tasksUiOptions?.onCommitTaskField(task.id, { note: notesTextarea.value }, { rerender: true });
    });

    const dateToggle = popover.querySelector<HTMLInputElement>(".inspector-date-toggle");
    const dateInput = popover.querySelector<HTMLInputElement>(".inspector-date-input");

    dateToggle?.addEventListener("change", () => {
      const currentOpts = tasksState.tasksUiOptions;
      if (!currentOpts) return;
      if (dateToggle.checked) {
        dateInput?.classList.remove("hidden");
        const today = new Date().toISOString().split("T")[0] || "";
        const newDue = dateInput?.value || today;
        if (dateInput) dateInput.value = newDue;
        currentOpts.onCommitTaskField(task.id, { dueDate: newDue }, { rerender: true });
      } else {
        dateInput?.classList.add("hidden");
        currentOpts.onCommitTaskField(task.id, { dueDate: null }, { rerender: true });
      }
    });

    dateInput?.addEventListener("change", () => {
      tasksState.tasksUiOptions?.onCommitTaskField(task.id, { dueDate: dateInput.value || null }, { rerender: true });
    });

    const prioritySelect = popover.querySelector<HTMLSelectElement>(".inspector-priority-select");
    prioritySelect?.addEventListener("change", () => {
      tasksState.tasksUiOptions?.onCommitTaskField(task.id, { priority: prioritySelect.value as any }, { rerender: true });
    });

    const songSelect = popover.querySelector<HTMLSelectElement>(".inspector-song-select");
    songSelect?.addEventListener("change", () => {
      const currentOpts = tasksState.tasksUiOptions;
      if (!currentOpts) return;
      const val = songSelect.value;
      if (!val) {
        currentOpts.onCommitTaskField(task.id, { songId: null, songTitle: null }, { rerender: true });
      } else {
        const [sId, sTitle] = val.split("|");
        currentOpts.onCommitTaskField(task.id, { songId: sId || null, songTitle: sTitle || null }, { rerender: true });
      }
    });

    const stageSelect = popover.querySelector<HTMLSelectElement>(".inspector-stage-select");
    stageSelect?.addEventListener("change", () => {
      const currentOpts = tasksState.tasksUiOptions;
      if (!currentOpts) return;
      const val = stageSelect.value as ProjectTaskStage;
      const stage = val === "general" ? null : val;
      currentOpts.onCommitTaskField(task.id, { stage }, { rerender: true });
    });
  }

  popover.addEventListener("click", (ev) => ev.stopPropagation());

  const closeHandler = (docEv: MouseEvent) => {
    if (!popover.contains(docEv.target as Node) && !anchorEl.contains(docEv.target as Node)) {
      popover.remove();
      document.removeEventListener("click", closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", closeHandler);
  }, 0);
}
