export interface Change {
  baseStart: number;
  baseEnd: number;
  lines: string[];
}

export function computeLcs(a: string[], b: string[]): Array<{ aIdx: number; bIdx: number }> {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp.push(new Array(n + 1).fill(0));
  }

  for (let i = 1; i <= m; i++) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    if (!row || !prevRow) continue;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }

  const matches: Array<{ aIdx: number; bIdx: number }> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    const prevRow = dp[i - 1];
    const currRow = dp[i];
    if (!prevRow || !currRow) break;
    if (a[i - 1] === b[j - 1]) {
      matches.push({ aIdx: i - 1, bIdx: j - 1 });
      i--;
      j--;
    } else if ((prevRow[j] ?? 0) >= (currRow[j - 1] ?? 0)) {
      i--;
    } else {
      j--;
    }
  }
  matches.reverse();
  return matches;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function getChanges(base: string[], target: string[]): Change[] {
  const matches = computeLcs(base, target);
  const changes: Change[] = [];
  let lastBase = 0;
  let lastTarget = 0;

  for (const m of matches) {
    if (m.aIdx > lastBase || m.bIdx > lastTarget) {
      changes.push({
        baseStart: lastBase,
        baseEnd: m.aIdx,
        lines: target.slice(lastTarget, m.bIdx)
      });
    }
    lastBase = m.aIdx + 1;
    lastTarget = m.bIdx + 1;
  }

  if (lastBase < base.length || lastTarget < target.length) {
    changes.push({
      baseStart: lastBase,
      baseEnd: base.length,
      lines: target.slice(lastTarget)
    });
  }

  return changes;
}

export function mergeIntervals(changesA: Change[], changesB: Change[], baseLength: number): Array<{ start: number; end: number }> {
  const allIntervals: Array<{ start: number; end: number }> = [];
  for (const c of changesA) allIntervals.push({ start: c.baseStart, end: c.baseEnd });
  for (const c of changesB) allIntervals.push({ start: c.baseStart, end: c.baseEnd });

  const first = allIntervals[0];
  if (!first) return [];

  allIntervals.sort((x, y) => x.start - y.start || x.end - y.end);

  const firstSorted = allIntervals[0];
  if (!firstSorted) return [];

  const merged: Array<{ start: number; end: number }> = [];
  let curr = { ...firstSorted };

  for (let i = 1; i < allIntervals.length; i++) {
    const next = allIntervals[i];
    if (!next) continue;
    if (next.start < curr.end || (next.start === curr.end && (next.start === next.end || curr.start === curr.end || next.start < baseLength))) {
      curr.end = Math.max(curr.end, next.end);
    } else {
      merged.push(curr);
      curr = { ...next };
    }
  }
  merged.push(curr);

  return merged;
}

export function reconstructSlice(base: string[], changes: Change[], start: number, end: number): string[] {
  const relevant = changes.filter((c) => c.baseStart >= start && c.baseEnd <= end);
  if (relevant.length === 0) {
    return base.slice(start, end);
  }

  const result: string[] = [];
  let currBase = start;

  for (const c of relevant) {
    if (c.baseStart > currBase) {
      result.push(...base.slice(currBase, c.baseStart));
    }
    result.push(...c.lines);
    currBase = c.baseEnd;
  }

  if (currBase < end) {
    result.push(...base.slice(currBase, end));
  }

  return result;
}

export interface ThreeWayMergeResult {
  merged: string;
  hasConflict: boolean;
}

/**
 * Intelligent 3-way non-destructive line merge for collaborative notes & text
 */
export function threeWayLineMergeDetailed(base: string, local: string, remote: string): ThreeWayMergeResult {
  if (local === remote) return { merged: local, hasConflict: false };
  if (local === base) return { merged: remote, hasConflict: false };
  if (remote === base) return { merged: local, hasConflict: false };

  const baseLines = base.split('\n');
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');

  const changesLocal = getChanges(baseLines, localLines);
  const changesRemote = getChanges(baseLines, remoteLines);

  const combinedIntervals = mergeIntervals(changesLocal, changesRemote, baseLines.length);

  const resultLines: string[] = [];
  let prevEnd = 0;
  let hasConflict = false;

  for (const interval of combinedIntervals) {
    if (interval.start > prevEnd) {
      resultLines.push(...baseLines.slice(prevEnd, interval.start));
    }

    const localSlice = reconstructSlice(baseLines, changesLocal, interval.start, interval.end);
    const remoteSlice = reconstructSlice(baseLines, changesRemote, interval.start, interval.end);
    const baseSlice = baseLines.slice(interval.start, interval.end);

    const localChanged = !arraysEqual(localSlice, baseSlice);
    const remoteChanged = !arraysEqual(remoteSlice, baseSlice);

    if (localChanged && remoteChanged) {
      if (arraysEqual(localSlice, remoteSlice)) {
        resultLines.push(...localSlice);
      } else if (interval.start === interval.end) {
        // Pure simultaneous boundary insertion: preserve distinct lines from both collaborators
        const combined = [...localSlice];
        for (const r of remoteSlice) {
          if (!combined.includes(r)) {
            combined.push(r);
          }
        }
        resultLines.push(...combined);
      } else {
        hasConflict = true;
        resultLines.push(...localSlice);
      }
    } else if (localChanged) {
      resultLines.push(...localSlice);
    } else if (remoteChanged) {
      resultLines.push(...remoteSlice);
    } else {
      resultLines.push(...baseSlice);
    }

    prevEnd = interval.end;
  }

  if (prevEnd < baseLines.length) {
    resultLines.push(...baseLines.slice(prevEnd));
  }

  return {
    merged: hasConflict ? local : resultLines.join('\n'),
    hasConflict
  };
}

export function threeWayLineMerge(base: string, local: string, remote: string): string {
  return threeWayLineMergeDetailed(base, local, remote).merged;
}
