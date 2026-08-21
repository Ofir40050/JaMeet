import type { ProjectActivityItem, SessionSummaryEvent } from '@jameet/shared';

export function mapActivityToSessionSummaryEvent(act: ProjectActivityItem): SessionSummaryEvent | null {
  let category: 'task' | 'note' | 'lyrics' | 'structure' | null = null;
  let action = '';
  let description = '';

  if (act.type === 'task_created') {
    category = 'task';
    action = 'created';
    description = `Created task "${act.title}"`;
  } else if (act.type === 'task_completed') {
    category = 'task';
    action = 'completed';
    description = `Completed task "${act.title}"`;
  } else if (act.type === 'task_reopened') {
    category = 'task';
    action = 'reopened';
    description = `Reopened task "${act.title}"`;
  } else if (act.type === 'task_status_changed') {
    category = 'task';
    action = 'updated';
    description = `Updated status for task "${act.title}"`;
  } else if (act.type === 'task_assigned') {
    category = 'task';
    action = 'assigned';
    description = act.summary || `Assigned task "${act.title}"`;
  } else if (act.type === 'task_unassigned') {
    category = 'task';
    action = 'unassigned';
    description = act.summary || `Unassigned task "${act.title}"`;
  } else if (act.type === 'task_updated') {
    category = 'task';
    action = 'updated';
    description = act.summary || `Updated task "${act.title}"`;
  } else if (act.type === 'task_deleted') {
    category = 'task';
    action = 'deleted';
    description = `Deleted task "${act.title}"`;
  } else if (act.type === 'lyrics_doc_created') {
    category = 'lyrics';
    action = 'created';
    description = `Created lyrics document "${act.title}"`;
  } else if (act.type === 'lyrics_doc_renamed') {
    category = 'lyrics';
    action = 'renamed';
    description = `Renamed lyrics document to "${act.title}"`;
  } else if (act.type === 'lyrics_doc_deleted') {
    category = 'lyrics';
    action = 'deleted';
    description = `Deleted lyrics document "${act.title}"`;
  } else if (act.type === 'lyrics_edited') {
    category = 'lyrics';
    action = 'edited';
    description = `Updated Lyrics in "${act.title}"`;
  } else if (act.type === 'notes_edited') {
    category = 'note';
    action = 'edited';
    description = 'Updated Project Notes';
  } else if (act.type === 'notes_bpm_changed') {
    category = 'note';
    action = 'updated';
    description = act.title ? `Set tempo to ${act.title}` : (act.summary || 'Updated Project tempo');
  } else if (act.type === 'notes_key_changed') {
    category = 'note';
    action = 'updated';
    description = act.title ? `Changed key to ${act.title}` : (act.summary || 'Updated Project key');
  } else if (act.type === 'structure_changed') {
    category = 'structure';
    action = 'updated';
    description = 'Updated Song Structure arrangement';
  }

  if (!category) return null;
  return {
    id: act.id,
    timestamp: act.createdAt,
    category,
    action,
    description
  };
}
