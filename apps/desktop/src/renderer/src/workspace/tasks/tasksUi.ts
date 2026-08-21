import { tasksState } from "./tasksUiState";
import { bindTasksEventListeners } from "./tasksEvents";
import { renderTasksWorkspace } from "./tasksWorkspaceUi";
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
  setTasksStatus,
  getTasksStatus,
  applyTasksPermissions
} from "./taskFormatters";

export { renderTasksWorkspace } from "./tasksWorkspaceUi";

// ========================================================
// INITIALIZATION
// ========================================================

export function initTasksUi(options: TasksUiOptions): void {
  tasksState.tasksUiOptions = options;
  bindTasksEventListeners();
}
