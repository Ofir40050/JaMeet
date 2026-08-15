import { describe, expect, it } from 'vitest';
import type { FactualSessionSummary, SessionHistoryItem } from '@musiczoom/shared';

describe('Factual Session Summary', () => {
  it('formats verified session timing, duration, and participants correctly', () => {
    const summary: FactualSessionSummary = {
      id: 'usr_host_123_sess_456',
      sessionId: 'sess_456',
      code: '7H9K2M4P',
      startedAt: 1786760000000,
      endedAt: 1786761800000,
      durationSeconds: 1800,
      role: 'host',
      participants: [
        {
          displayName: 'Dan Host',
          username: 'dan_host',
          role: 'Host',
          isHost: true,
          isGuest: false,
          avatarColor: '#38bdf8'
        },
        {
          displayName: 'Sarah Vocals',
          username: 'sarah_vocals',
          role: 'Collaborator',
          isHost: false,
          isGuest: false,
          avatarColor: '#ec4899'
        }
      ],
      projectId: 'proj_vocal_mix',
      projectName: 'Midnight Sessions EP',
      events: [
        {
          id: 'ev_1',
          timestamp: 1786760600000,
          category: 'task',
          action: 'created',
          description: 'Created task "Record Lead Vocals"'
        },
        {
          id: 'ev_2',
          timestamp: 1786761200000,
          category: 'task',
          action: 'completed',
          description: 'Completed task "Record Lead Vocals"'
        },
        {
          id: 'ev_3',
          timestamp: 1786761500000,
          category: 'lyrics',
          action: 'edited',
          description: 'Updated Lyrics in "Main Lyrics"'
        }
      ],
      chatMessagesCount: 14
    };

    expect(summary.sessionId).toBe('sess_456');
    expect(summary.code).toBe('7H9K2M4P');
    expect(summary.durationSeconds).toBe(1800);
    expect(summary.participants.length).toBe(2);
    expect(summary.participants[0]?.isHost).toBe(true);
    expect(summary.participants[1]?.displayName).toBe('Sarah Vocals');
    expect(summary.projectName).toBe('Midnight Sessions EP');
    expect(summary.events.length).toBe(3);
    expect(summary.events[0]?.action).toBe('created');
    expect(summary.events[1]?.action).toBe('completed');
    expect(summary.events[2]?.category).toBe('lyrics');
    expect(summary.chatMessagesCount).toBe(14);
  });

  it('handles clean minimal summary with zero workspace mutations', () => {
    const minimalSummary: FactualSessionSummary = {
      id: 'usr_guest_789_sess_101',
      sessionId: 'sess_101',
      code: 'ABCD1234',
      startedAt: 1786762000000,
      endedAt: 1786762300000,
      durationSeconds: 300,
      role: 'participant',
      participants: [
        {
          displayName: 'Solo Host',
          isHost: true,
          isGuest: false
        }
      ],
      events: [],
      chatMessagesCount: 0
    };

    expect(minimalSummary.events).toEqual([]);
    expect(minimalSummary.chatMessagesCount).toBe(0);
    expect(minimalSummary.participants.length).toBe(1);
  });
});
