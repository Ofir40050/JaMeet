import { tasksState } from "./tasksUiState";
import { bindTasksEventListeners } from "./tasksEvents";
import { renderTasksWorkspace } from "./tasksWorkspaceRenderer";
import type { TasksUiOptions } from "./tasksTypes";

// ========================================================
// PUBLIC RE-EXPORTS (PRESERVING EXACT IMPORT COMPATIBILITY)
// ========================================================

export type {
  ReadonlySubtaskItem,
  ReadonlyTaskItem,
  ReadonlySongItem,
  TaskCollaboratorOption,
  CreateTaskData,
  TaskFieldUpdate,
  TasksUiOptions
} from "./tasksTypes";

export { SONG_ICONS, SONG_COLORS, STAGE_CONFIG } from "./tasksConstants";

export {
  formatShortDate,
  setTasksStatus,
  getTasksStatus,
  applyTasksPermissions
} from "./tasksFormatting";

export { renderTasksWorkspace } from "./tasksWorkspaceRenderer";

// ========================================================
// INITIALIZATION
// ========================================================

export function initTasksUi(options: TasksUiOptions): void {
  tasksState.tasksUiOptions = options;
  bindTasksEventListeners();
}
