import { describe, it, expect } from 'vitest';

/**
 * Mirror of the 3-way line merge algorithm used in main.ts
 */
function threeWayLineMerge(base: string, local: string, remote: string): string {
  if (local === remote) return local;
  if (local === base) return remote;
  if (remote === base) return local;

  if (local.startsWith(base) && base.length > 0) {
    const appended = local.slice(base.length);
    return remote + appended;
  }
  if (remote.startsWith(base) && base.length > 0) {
    const appended = remote.slice(base.length);
    return local + appended;
  }

  const baseLines = base.split('\n');
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');

  const resultLines: string[] = [];

  let bIdx = 0, lIdx = 0, rIdx = 0;

  while (lIdx < localLines.length || rIdx < remoteLines.length) {
    const bLine = bIdx < baseLines.length ? baseLines[bIdx] : undefined;
    const lLine = lIdx < localLines.length ? localLines[lIdx] : undefined;
    const rLine = rIdx < remoteLines.length ? remoteLines[rIdx] : undefined;

    if (lLine === rLine) {
      if (lLine !== undefined) resultLines.push(lLine);
      bIdx++; lIdx++; rIdx++;
    } else if (lLine === bLine) {
      if (rLine !== undefined) resultLines.push(rLine);
      bIdx++; lIdx++; rIdx++;
    } else if (rLine === bLine) {
      if (lLine !== undefined) resultLines.push(lLine);
      bIdx++; lIdx++; rIdx++;
    } else {
      if (lLine !== undefined) resultLines.push(lLine);
      if (rLine !== undefined && rLine !== lLine && !localLines.includes(rLine)) {
        resultLines.push(rLine);
      }
      bIdx++; lIdx++; rIdx++;
    }
  }

  return resultLines.join('\n');
}

describe('threeWayLineMerge for Collaborative Lyrics & Notes', () => {
  it('returns remote when local is unchanged', () => {
    const base = '[Verse 1]\nLine 1';
    const local = '[Verse 1]\nLine 1';
    const remote = '[Verse 1]\nLine 1 updated';
    expect(threeWayLineMerge(base, local, remote)).toBe('[Verse 1]\nLine 1 updated');
  });

  it('returns local when remote is unchanged', () => {
    const base = '[Verse 1]\nLine 1';
    const local = '[Verse 1]\nLine 1 local edit';
    const remote = '[Verse 1]\nLine 1';
    expect(threeWayLineMerge(base, local, remote)).toBe('[Verse 1]\nLine 1 local edit');
  });

  it('merges simultaneous additions by two collaborators without losing lines', () => {
    const base = '[Verse 1]\nWalking in the rain';
    const local = '[Verse 1]\nWalking in the rain\n[Chorus]\nSun comes shining through';
    const remote = '[Verse 1]\nWalking in the rain\nLost inside the night';
    const merged = threeWayLineMerge(base, local, remote);

    expect(merged).toContain('[Verse 1]');
    expect(merged).toContain('Walking in the rain');
    expect(merged).toContain('Lost inside the night');
    expect(merged).toContain('[Chorus]');
    expect(merged).toContain('Sun comes shining through');
  });

  it('handles appending text concurrently', () => {
    const base = 'Intro melody';
    const local = 'Intro melody\nVerse 1 written by Dan';
    const remote = 'Intro melody\nChords: C G Am F';
    const merged = threeWayLineMerge(base, local, remote);

    expect(merged).toContain('Intro melody');
    expect(merged).toContain('Verse 1 written by Dan');
  });
});
