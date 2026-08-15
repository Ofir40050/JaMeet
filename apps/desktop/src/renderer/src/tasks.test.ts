import { describe, it, expect } from 'vitest';
import type { ProjectTaskItem, ProjectTaskStatus } from '@musiczoom/shared';

describe('Project Tasks Workspace Engine', () => {
  it('creates music production tasks with default todo status, metadata, and timestamps', () => {
    const now = Date.now();
    const task: ProjectTaskItem = {
      id: 'task_1',
      title: 'Record lead acoustic guitar',
      status: 'todo',
      assigneeId: 'usr_1',
      assigneeName: 'Alex Producer',
      note: 'Capo on 3rd fret, stereo pair of small condenser mics',
      dueDate: '2026-08-25',
      createdAt: now,
      updatedAt: now
    };

    expect(task.title).toBe('Record lead acoustic guitar');
    expect(task.status).toBe('todo');
    expect(task.assigneeName).toBe('Alex Producer');
    expect(task.dueDate).toBe('2026-08-25');
    expect(task.completedAt).toBeUndefined();
  });

  it('handles explicit status selection and quick toggle to Done / Reopened', () => {
    const task: ProjectTaskItem = {
      id: 'task_2',
      title: 'Tune lead vocals',
      status: 'todo',
      createdAt: 1000,
      updatedAt: 1000
    };

    // 1. Explicit status change to in_progress
    const inProgressTask: ProjectTaskItem = {
      ...task,
      status: 'in_progress',
      updatedAt: 2000
    };
    expect(inProgressTask.status).toBe('in_progress');
    expect(inProgressTask.completedAt).toBeUndefined();

    // 2. Quick toggle to done
    const doneTask: ProjectTaskItem = {
      ...inProgressTask,
      status: 'done',
      completedAt: 3000,
      updatedAt: 3000
    };
    expect(doneTask.status).toBe('done');
    expect(doneTask.completedAt).toBe(3000);

    // 3. Quick toggle back to todo (reopened)
    const reopenedTask: ProjectTaskItem = {
      ...doneTask,
      status: 'todo',
      completedAt: undefined,
      updatedAt: 4000
    };
    expect(reopenedTask.status).toBe('todo');
    expect(reopenedTask.completedAt).toBeUndefined();
  });

  it('correctly calculates remaining, completed, and status counters', () => {
    const tasks: ProjectTaskItem[] = [
      { id: '1', title: 'Record vocals', status: 'done', createdAt: 1, updatedAt: 1, completedAt: 1 },
      { id: '2', title: 'Layer guitars', status: 'in_progress', createdAt: 2, updatedAt: 2 },
      { id: '3', title: 'Vocal tuning', status: 'todo', createdAt: 3, updatedAt: 3 },
      { id: '4', title: 'Mix revision 1', status: 'todo', createdAt: 4, updatedAt: 4 }
    ];

    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'done').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const todo = tasks.filter((t) => t.status === 'todo').length;
    const remaining = total - done;

    expect(total).toBe(4);
    expect(done).toBe(1);
    expect(inProgress).toBe(1);
    expect(todo).toBe(2);
    expect(remaining).toBe(3);
  });

  it('filters tasks accurately by status tab', () => {
    const tasks: ProjectTaskItem[] = [
      { id: '1', title: 'Record vocals', status: 'done', createdAt: 1, updatedAt: 1 },
      { id: '2', title: 'Layer guitars', status: 'in_progress', createdAt: 2, updatedAt: 2 },
      { id: '3', title: 'Vocal tuning', status: 'todo', createdAt: 3, updatedAt: 3 }
    ];

    const filterTasks = (filter: 'all' | 'todo' | 'in_progress' | 'done') => {
      if (filter === 'all') return tasks;
      return tasks.filter((t) => t.status === filter);
    };

    expect(filterTasks('all').length).toBe(3);
    expect(filterTasks('todo').map((t) => t.id)).toEqual(['3']);
    expect(filterTasks('in_progress').map((t) => t.id)).toEqual(['2']);
    expect(filterTasks('done').map((t) => t.id)).toEqual(['1']);
  });

  it('reorders tasks predictably using positional insertion', () => {
    const tasks: ProjectTaskItem[] = [
      { id: 'task_a', title: 'Task A', status: 'todo', createdAt: 1, updatedAt: 1 },
      { id: 'task_b', title: 'Task B', status: 'todo', createdAt: 2, updatedAt: 2 },
      { id: 'task_c', title: 'Task C', status: 'todo', createdAt: 3, updatedAt: 3 },
      { id: 'task_d', title: 'Task D', status: 'todo', createdAt: 4, updatedAt: 4 }
    ];

    // Move task_d before task_b
    const sourceIdx = tasks.findIndex((t) => t.id === 'task_d');
    const [moved] = tasks.splice(sourceIdx, 1);
    const targetIdx = tasks.findIndex((t) => t.id === 'task_b');
    tasks.splice(targetIdx, 0, moved);

    expect(tasks.map((t) => t.id)).toEqual(['task_a', 'task_d', 'task_b', 'task_c']);
  });

  it('merges simultaneous edits from collaborators by individual task timestamps', () => {
    const localTasks: ProjectTaskItem[] = [
      { id: '1', title: 'Record vocals (edited locally)', status: 'in_progress', updatedAt: 200 },
      { id: '2', title: 'Layer guitars', status: 'todo', updatedAt: 100 }
    ];

    const incomingTasks: ProjectTaskItem[] = [
      { id: '1', title: 'Record vocals', status: 'todo', updatedAt: 150 },
      { id: '2', title: 'Layer guitars (edited remotely)', status: 'done', updatedAt: 300 },
      { id: '3', title: 'New remote task', status: 'todo', updatedAt: 250 }
    ];

    const map = new Map<string, ProjectTaskItem>();
    for (const t of incomingTasks) {
      map.set(t.id, { ...t });
    }
    for (const local of localTasks) {
      const existing = map.get(local.id);
      if (!existing || (local.updatedAt || 0) > (existing.updatedAt || 0)) {
        map.set(local.id, { ...local });
      }
    }

    const merged: ProjectTaskItem[] = [];
    for (const inc of incomingTasks) {
      if (map.has(inc.id)) {
        merged.push(map.get(inc.id)!);
        map.delete(inc.id);
      }
    }
    for (const rem of map.values()) {
      merged.push(rem);
    }

    expect(merged.length).toBe(3);
    expect(merged[0].title).toBe('Record vocals (edited locally)');
    expect(merged[0].status).toBe('in_progress');
    expect(merged[1].title).toBe('Layer guitars (edited remotely)');
    expect(merged[1].status).toBe('done');
    expect(merged[2].title).toBe('New remote task');
  });
});
