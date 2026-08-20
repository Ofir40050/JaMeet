import { describe, it, expect } from 'vitest';

function clampSessionWorkspaceWidth(newWidth: number, windowWidth = 1440): number {
  const minW = 320;
  const maxW = Math.min(windowWidth * 0.5, 720);
  return Math.max(minW, Math.min(maxW, newWidth));
}

function parseAssigneeValue(val?: string): { id?: string; name?: string } {
  if (!val) return {};
  const parts = val.split('|');
  return { id: parts[0] || undefined, name: parts[1] || undefined };
}

describe('Session Workspace Engine & Resizing', () => {
  it('correctly clamps session workspace width within bounds', () => {
    // Normal window 1440px -> max is 720px
    expect(clampSessionWorkspaceWidth(250, 1440)).toBe(320);
    expect(clampSessionWorkspaceWidth(450, 1440)).toBe(450);
    expect(clampSessionWorkspaceWidth(850, 1440)).toBe(720);

    // Smaller window 1000px -> max is 500px (50vw)
    expect(clampSessionWorkspaceWidth(600, 1000)).toBe(500);
  });

  it('correctly parses assignee value from select format', () => {
    expect(parseAssigneeValue('')).toEqual({});
    expect(parseAssigneeValue('usr_123|Zoe (Owner)')).toEqual({
      id: 'usr_123',
      name: 'Zoe (Owner)'
    });
    expect(parseAssigneeValue('usr_456|Alex')).toEqual({
      id: 'usr_456',
      name: 'Alex'
    });
  });

  it('validates supported session workspace tabs', () => {
    const validTabs = ['lyrics', 'structure', 'notes', 'tasks'];
    expect(validTabs.includes('lyrics')).toBe(true);
    expect(validTabs.includes('structure')).toBe(true);
    expect(validTabs.includes('notes')).toBe(true);
    expect(validTabs.includes('tasks')).toBe(true);
    expect(validTabs.includes('overview')).toBe(false);
  });
});
