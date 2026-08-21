import type { ProjectTaskItem } from '@jameet/shared';

export function mutateDuplicateTask(
  tasks: ProjectTaskItem[],
  taskId: string,
  newTaskId: string,
  generateSubtaskId: (index: number) => string,
  now: number = Date.now()
): ProjectTaskItem | null {
  const index = tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return null;
  const original = tasks[index];
  if (!original) return null;
  const copy: ProjectTaskItem = {
    ...original,
    id: newTaskId,
    title: `${original.title} (Copy)`,
    createdAt: now,
    updatedAt: now,
    subtasks: Array.isArray(original.subtasks)
      ? original.subtasks.map((st, i) => ({
          id: generateSubtaskId(i),
          title: st.title,
          done: st.done
        }))
      : []
  };
  tasks.splice(index + 1, 0, copy);
  return copy;
}
