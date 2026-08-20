let currentWorkspaceContextGen = 0;
let lyricsEditGen = 0;
let lyricsSaveGen = 0;
let notesEditGen = 0;
let notesSaveGen = 0;
let structureEditGen = 0;
let structureSaveGen = 0;
let tasksEditGen = 0;
let tasksSaveGen = 0;

export function getWorkspaceContextGen(): number {
  return currentWorkspaceContextGen;
}

export function isWorkspaceContextGenCurrent(gen: number): boolean {
  return gen === currentWorkspaceContextGen;
}

export function resetWorkspaceGenerations(): number {
  currentWorkspaceContextGen++;
  lyricsEditGen = 0;
  lyricsSaveGen = 0;
  notesEditGen = 0;
  notesSaveGen = 0;
  structureEditGen = 0;
  structureSaveGen = 0;
  tasksEditGen = 0;
  tasksSaveGen = 0;
  return currentWorkspaceContextGen;
}

// Lyrics generations
export function getLyricsEditGen(): number {
  return lyricsEditGen;
}
export function getLyricsSaveGen(): number {
  return lyricsSaveGen;
}
export function incrementLyricsEditGen(): number {
  return ++lyricsEditGen;
}
export function incrementLyricsSaveGen(): number {
  return ++lyricsSaveGen;
}
export function setLyricsSaveGen(gen: number): void {
  lyricsSaveGen = gen;
}

// Notes generations
export function getNotesEditGen(): number {
  return notesEditGen;
}
export function getNotesSaveGen(): number {
  return notesSaveGen;
}
export function incrementNotesEditGen(): number {
  return ++notesEditGen;
}
export function incrementNotesSaveGen(): number {
  return ++notesSaveGen;
}
export function setNotesSaveGen(gen: number): void {
  notesSaveGen = gen;
}

// Structure generations
export function getStructureEditGen(): number {
  return structureEditGen;
}
export function getStructureSaveGen(): number {
  return structureSaveGen;
}
export function incrementStructureEditGen(): number {
  return ++structureEditGen;
}
export function incrementStructureSaveGen(): number {
  return ++structureSaveGen;
}
export function setStructureSaveGen(gen: number): void {
  structureSaveGen = gen;
}

// Tasks generations
export function getTasksEditGen(): number {
  return tasksEditGen;
}
export function getTasksSaveGen(): number {
  return tasksSaveGen;
}
export function incrementTasksEditGen(): number {
  return ++tasksEditGen;
}
export function incrementTasksSaveGen(): number {
  return ++tasksSaveGen;
}
export function setTasksSaveGen(gen: number): void {
  tasksSaveGen = gen;
}
