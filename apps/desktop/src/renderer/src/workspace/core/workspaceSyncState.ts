// Snapshot of last confirmed server state for 3-way merging and baseline tracking
let lastSyncedLyrics = '';
let lastSyncedNotes = '';
let lastSyncedNotesBpm = '';
let lastSyncedNotesKey = '';

export function getLastSyncedLyrics(): string {
  return lastSyncedLyrics;
}

export function setLastSyncedLyrics(val: string): void {
  lastSyncedLyrics = val;
}

export function getLastSyncedNotes(): string {
  return lastSyncedNotes;
}

export function setLastSyncedNotes(val: string): void {
  lastSyncedNotes = val;
}

export function getLastSyncedNotesBpm(): string {
  return lastSyncedNotesBpm;
}

export function setLastSyncedNotesBpm(val: string): void {
  lastSyncedNotesBpm = val;
}

export function getLastSyncedNotesKey(): string {
  return lastSyncedNotesKey;
}

export function setLastSyncedNotesKey(val: string): void {
  lastSyncedNotesKey = val;
}

export function setLastSyncedNotesValues(vals: {
  content?: string;
  bpm?: string;
  key?: string;
}): void {
  if (vals.content !== undefined) lastSyncedNotes = vals.content;
  if (vals.bpm !== undefined) lastSyncedNotesBpm = vals.bpm;
  if (vals.key !== undefined) lastSyncedNotesKey = vals.key;
}

export function setAllLastSyncedValues(vals: {
  lyrics?: string;
  notes?: string;
  bpm?: string;
  key?: string;
}): void {
  if (vals.lyrics !== undefined) lastSyncedLyrics = vals.lyrics;
  if (vals.notes !== undefined) lastSyncedNotes = vals.notes;
  if (vals.bpm !== undefined) lastSyncedNotesBpm = vals.bpm;
  if (vals.key !== undefined) lastSyncedNotesKey = vals.key;
}
