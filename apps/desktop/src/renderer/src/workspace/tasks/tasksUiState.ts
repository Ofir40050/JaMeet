import type {
  TasksUiOptions,
  TaskFilterType,
  TasksViewMode,
  TasksGroupingType,
  TasksStatusType
} from './tasksTypes';

// ========================================================
// UI STATE (OWNED EXCLUSIVELY BY TASKS UI MODULE)
// ========================================================

export const tasksState = {
  currentTaskFilter: 'all' as TaskFilterType,
  currentTasksViewMode: 'list' as TasksViewMode,
  currentTasksSongFilter: 'all' as string,
  currentTasksStageFilter: 'all' as string,
  currentTasksGrouping: 'song' as TasksGroupingType,
  currentTasksSearchQuery: '' as string,
  showCompletedTasks: true as boolean,
  tasksCollapsedGroups: new Set<string>(),
  draggedTaskId: null as string | null,
  currentSelectedTaskId: null as string | null,
  currentTasksStatus: 'saved' as TasksStatusType,
  tasksUiOptions: null as TasksUiOptions | null,
  listenersBound: false as boolean
};
