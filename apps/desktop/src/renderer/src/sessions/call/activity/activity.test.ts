import { describe, it, expect } from 'vitest';
import type { ProjectActivityItem } from '@jameet/shared';
import { formatRelativeTime } from '../../../core/dateTimeFormatters';
import { filterActivities, getActivityIconSvg } from './activity';

describe('Project Activity Engine & Helpers', () => {
  it('correctly calculates human-readable relative timestamps', () => {
    const baseNow = 1755150000000;
    expect(formatRelativeTime(baseNow - 10_000, baseNow)).toBe('Just now');
    expect(formatRelativeTime(baseNow - 5 * 60 * 1000, baseNow)).toBe('5m ago');
    expect(formatRelativeTime(baseNow - 2 * 3600 * 1000, baseNow)).toBe('2h ago');
    expect(formatRelativeTime(baseNow - 24 * 3600 * 1000, baseNow)).toBe('Yesterday');
    expect(formatRelativeTime(baseNow - 3 * 24 * 3600 * 1000, baseNow)).toBe('3d ago');
  });

  it('filters activities across summary, collaborator name, title, and type', () => {
    const sampleActivities: ProjectActivityItem[] = [
      {
        id: 'act_1',
        projectId: 'p1',
        type: 'lyrics_edited',
        userId: 'u1',
        userDisplayName: 'Zoe',
        userUsername: 'zoe',
        title: 'Main Lyrics',
        summary: 'Zoe edited Main Lyrics',
        createdAt: 1000
      },
      {
        id: 'act_2',
        projectId: 'p1',
        type: 'notes_key_changed',
        userId: 'u2',
        userDisplayName: 'ofir',
        userUsername: 'ofir',
        title: 'A Minor',
        summary: 'ofir changed key to A Minor',
        createdAt: 2000
      },
      {
        id: 'act_3',
        projectId: 'p1',
        type: 'task_completed',
        userId: 'u1',
        userDisplayName: 'Zoe',
        userUsername: 'zoe',
        title: 'Record Final Vocals',
        summary: 'Zoe completed "Record Final Vocals"',
        createdAt: 3000
      }
    ];

    expect(filterActivities(sampleActivities, '').length).toBe(3);
    expect(filterActivities(sampleActivities, 'zoe').length).toBe(2);
    expect(filterActivities(sampleActivities, 'key').length).toBe(1);
    expect(filterActivities(sampleActivities, 'Record Final Vocals').length).toBe(1);
    expect(filterActivities(sampleActivities, 'nonexistent').length).toBe(0);
  });

  it('preserves activity ordering with newest events first', () => {
    const activities: ProjectActivityItem[] = [
      {
        id: 'act_newest',
        projectId: 'p1',
        type: 'task_completed',
        userId: 'u1',
        userDisplayName: 'Alex',
        userUsername: 'alex',
        title: 'Send Master',
        summary: 'Alex completed "Send Master"',
        createdAt: 5000
      },
      {
        id: 'act_older',
        projectId: 'p1',
        type: 'project_created',
        userId: 'u1',
        userDisplayName: 'Alex',
        userUsername: 'alex',
        title: 'Hit Song',
        summary: 'Alex created project "Hit Song"',
        createdAt: 1000
      }
    ];

    expect(activities[0].id).toBe('act_newest');
    expect(activities[0].createdAt).toBeGreaterThan(activities[1].createdAt);
  });

  it('returns valid svg icons for all activity types', () => {
    expect(getActivityIconSvg('project_created')).toContain('<svg');
    expect(getActivityIconSvg('lyrics_doc_created')).toContain('<svg');
    expect(getActivityIconSvg('lyrics_doc_renamed')).toContain('<svg');
    expect(getActivityIconSvg('lyrics_doc_deleted')).toContain('<svg');
    expect(getActivityIconSvg('lyrics_edited')).toContain('<svg');
    expect(getActivityIconSvg('notes_key_changed')).toContain('<svg');
    expect(getActivityIconSvg('structure_changed')).toContain('<svg');
    expect(getActivityIconSvg('task_completed')).toContain('<svg');
    expect(getActivityIconSvg('task_unassigned')).toContain('<svg');
    expect(getActivityIconSvg('task_updated')).toContain('<svg');
    expect(getActivityIconSvg('collaborator_added')).toContain('<svg');
    expect(getActivityIconSvg('session_started')).toContain('<svg');
  });
});
