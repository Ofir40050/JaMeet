import { threeWayLineMergeDetailed } from '../core/workspaceMerge';

export interface NotesStateValues {
  content?: string;
  bpm?: string;
  key?: string;
}

export interface NotesReconciliationResult {
  content: string;
  bpm: string;
  key: string;
  hasUnresolvableConflict: boolean;
  bpmChangedRemotely: boolean;
  keyChangedRemotely: boolean;
  bpmChangedLocally: boolean;
  keyChangedLocally: boolean;
}

export function reconcileNotesWorkspace(
  base: NotesStateValues,
  local: NotesStateValues,
  remote: NotesStateValues
): NotesReconciliationResult {
  const baseContent = base.content || '';
  const localContent = local.content || '';
  const remoteContent = remote.content || '';

  const baseBpm = (base.bpm || '').trim();
  const localBpm = (local.bpm || '').trim();
  const remoteBpm = (remote.bpm || '').trim();

  const baseKey = (base.key || '').trim();
  const localKey = (local.key || '').trim();
  const remoteKey = (remote.key || '').trim();

  // 1. Text reconciliation using robust 3-way line merge
  const textMerge = threeWayLineMergeDetailed(baseContent, localContent, remoteContent);

  // 2. BPM reconciliation
  const bpmChangedLocally = localBpm !== baseBpm;
  const bpmChangedRemotely = remoteBpm !== baseBpm;
  let resolvedBpm = localBpm;
  let bpmConflict = false;

  if (bpmChangedLocally && bpmChangedRemotely) {
    if (localBpm === remoteBpm) {
      resolvedBpm = localBpm;
    } else {
      bpmConflict = true;
      resolvedBpm = localBpm;
    }
  } else if (bpmChangedRemotely) {
    resolvedBpm = remoteBpm;
  } else {
    resolvedBpm = localBpm;
  }

  // 3. Key reconciliation
  const keyChangedLocally = localKey !== baseKey;
  const keyChangedRemotely = remoteKey !== baseKey;
  let resolvedKey = localKey;
  let keyConflict = false;

  if (keyChangedLocally && keyChangedRemotely) {
    if (localKey === remoteKey) {
      resolvedKey = localKey;
    } else {
      keyConflict = true;
      resolvedKey = localKey;
    }
  } else if (keyChangedRemotely) {
    resolvedKey = remoteKey;
  } else {
    resolvedKey = localKey;
  }

  const hasUnresolvableConflict = textMerge.hasConflict || bpmConflict || keyConflict;

  return {
    content: textMerge.merged,
    bpm: resolvedBpm,
    key: resolvedKey,
    hasUnresolvableConflict,
    bpmChangedRemotely: !bpmConflict && bpmChangedRemotely,
    keyChangedRemotely: !keyConflict && keyChangedRemotely,
    bpmChangedLocally,
    keyChangedLocally
  };
}
