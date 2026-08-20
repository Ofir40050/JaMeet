export class WorkspaceConflictError extends Error {
  readonly code = 'WORKSPACE_CONFLICT';
  readonly area: 'lyrics' | 'notes' | 'structure' | 'tasks';
  readonly currentRevision: number;
  readonly baseRevision?: number;

  constructor(
    area: 'lyrics' | 'notes' | 'structure' | 'tasks',
    currentRevision: number,
    baseRevision?: number
  ) {
    super(
      `Workspace conflict in ${area}: server revision is ${currentRevision}, but client provided base revision ${baseRevision}.`
    );
    this.name = 'WorkspaceConflictError';
    this.area = area;
    this.currentRevision = currentRevision;
    this.baseRevision = baseRevision;
  }
}

export class ProjectLimitError extends Error {
  readonly code: string;
  constructor(message: string, code = 'PROJECT_LIMIT_EXCEEDED') {
    super(message);
    this.name = 'ProjectLimitError';
    this.code = code;
  }
}

export class WorkspaceLimitError extends Error {
  readonly code: string;
  readonly area: 'lyrics' | 'notes' | 'structure' | 'tasks';
  constructor(area: 'lyrics' | 'notes' | 'structure' | 'tasks', message: string, code = 'WORKSPACE_LIMIT_EXCEEDED') {
    super(message);
    this.name = 'WorkspaceLimitError';
    this.area = area;
    this.code = code;
  }
}
