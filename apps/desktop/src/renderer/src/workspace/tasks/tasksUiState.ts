import type { TasksUiOptions } from "./tasksTypes";

// ========================================================
// UI STATE (OWNED EXCLUSIVELY BY TASKS UI MODULE)
// ========================================================

export const tasksState = {
  currentTaskFilter: "all" as "all" | "todo" | "in_progress" | "done",
  currentTasksViewMode: "list" as "list" | "board",
  currentTasksSongFilter: "all" as string,
  currentTasksStageFilter: "all" as string,
  currentTasksGrouping: "song" as "song" | "stage" | "status" | "none",
  currentTasksSearchQuery: "" as string,
  showCompletedTasks: true as boolean,
  tasksCollapsedGroups: new Set<string>(),
  draggedTaskId: null as string | null,
  currentSelectedTaskId: null as string | null,
  currentTasksStatus: "saved" as "saving" | "saved" | "unsaved",
  tasksUiOptions: null as TasksUiOptions | null,
  listenersBound: false as boolean
};
