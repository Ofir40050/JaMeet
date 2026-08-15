import { z } from 'zod';

export const meetingCodeSchema = z.string().trim().toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{8}$/, 'Enter an 8-character session code');
export const participantIdSchema = z.string().uuid();
export const audioModeSchema = z.enum(['talk', 'music']);
export type AudioMode = z.infer<typeof audioModeSchema>;
export const videoQualitySchema = z.enum(['low', 'standard', 'high']);
export type VideoQuality = z.infer<typeof videoQualitySchema>;
export const performanceModeSchema = z.enum(['low', 'balanced', 'quality']);
export type PerformanceMode = z.infer<typeof performanceModeSchema>;

export const usernameSchema = z.string().trim().min(3).max(30)
  .regex(/^[a-zA-Z0-9_]+$/, 'Username can contain only letters, numbers, and underscores');
export const emailSchema = z.string().trim().email('Enter a valid email address').toLowerCase();
export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters long');
export const displayNameSchema = z.string().trim().min(1, 'Display name cannot be empty').max(40);

export const userProfileSchema = z.object({
  id: z.string(),
  username: usernameSchema,
  email: emailSchema,
  displayName: displayNameSchema,
  isGuest: z.boolean().default(false),
  avatarColor: z.string().default('#06b6d4'),
  avatarUrl: z.string().optional(),
  location: z.string().max(80).optional(),
  role: z.string().max(60).optional(),
  primaryDaw: z.string().max(50).optional(),
  genres: z.array(z.string()).max(10).optional(),
  bio: z.string().max(500).optional(),
  website: z.string().max(120).optional(),
  socialHandle: z.string().max(60).optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int().optional()
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const participantIdentitySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  username: z.string().optional(),
  isGuest: z.boolean(),
  isHost: z.boolean(),
  avatarColor: z.string(),
  avatarUrl: z.string().optional(),
  role: z.string().optional(),
  location: z.string().optional(),
  primaryDaw: z.string().optional()
});
export type ParticipantIdentity = z.infer<typeof participantIdentitySchema>;

export const registerRequestSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  usernameOrEmail: z.string().trim().min(1),
  password: z.string().min(1)
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const updateProfileRequestSchema = z.object({
  displayName: displayNameSchema.optional(),
  avatarColor: z.string().optional(),
  avatarUrl: z.string().max(2000000).optional(), // data URL up to ~2MB
  location: z.string().max(80).optional(),
  role: z.string().max(60).optional(),
  primaryDaw: z.string().max(50).optional(),
  genres: z.array(z.string()).max(10).optional(),
  bio: z.string().max(500).optional(),
  website: z.string().max(120).optional(),
  socialHandle: z.string().max(60).optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: passwordSchema.optional()
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const guestAuthRequestSchema = z.object({
  displayName: displayNameSchema
});
export type GuestAuthRequest = z.infer<typeof guestAuthRequestSchema>;

export interface SessionSummaryEvent {
  id: string;
  timestamp: number;
  category: 'task' | 'note' | 'lyrics' | 'structure';
  action: string;
  description: string;
}

export interface FactualSessionSummary {
  id: string;
  sessionId: string;
  code: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  role: 'host' | 'participant';
  participants: Array<{
    displayName: string;
    username?: string;
    role?: string;
    isHost: boolean;
    isGuest: boolean;
    avatarColor?: string;
  }>;
  projectId?: string;
  projectName?: string;
  events: SessionSummaryEvent[];
  chatMessagesCount: number;
}

export const sessionHistoryItemSchema = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  code: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationSeconds: z.number().optional(),
  role: z.enum(['host', 'participant']),
  collaborator: z.object({
    id: z.string().optional(),
    displayName: z.string(),
    username: z.string().optional(),
    isGuest: z.boolean(),
    avatarColor: z.string().optional()
  }).nullable(),
  summary: z.custom<FactualSessionSummary>().optional()
});
export type SessionHistoryItem = z.infer<typeof sessionHistoryItemSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  user: userProfileSchema
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const audioSourceMetadataSchema = z.object({
  id: z.string().min(1).max(40),
  purpose: z.enum(['primary', 'voice', 'music']),
  mode: audioModeSchema,
  enabled: z.boolean(),
  channels: z.number().int().min(0).max(32).optional(),
  sampleRate: z.number().int().positive().optional()
});
export type AudioSourceMetadata = z.infer<typeof audioSourceMetadataSchema>;

export const mediaMetadataSchema = z.object({
  audioSources: z.array(audioSourceMetadataSchema).max(4),
  cameraEnabled: z.boolean(),
  outgoingVideoQuality: videoQualitySchema.optional(),
  preferredReceiveVideoQuality: videoQualitySchema.optional(),
  sharingScreen: z.boolean().optional(),
  audioOnly: z.boolean().optional(),
  performanceMode: performanceModeSchema.optional()
});
export type MediaMetadata = z.infer<typeof mediaMetadataSchema>;

export const projectCollaboratorRoleSchema = z.enum(['owner', 'collaborator', 'editor', 'viewer']);
export type ProjectCollaboratorRole = z.infer<typeof projectCollaboratorRoleSchema>;

export const projectCollaboratorSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  username: z.string(),
  email: z.string().optional(),
  avatarColor: z.string().default('#06b6d4'),
  role: projectCollaboratorRoleSchema.default('collaborator'),
  addedAt: z.number()
});
export type ProjectCollaborator = z.infer<typeof projectCollaboratorSchema>;

export const projectSessionItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationSeconds: z.number().optional(),
  role: z.enum(['host', 'participant']),
  collaborator: z.object({
    id: z.string().optional(),
    displayName: z.string(),
    username: z.string().optional(),
    isGuest: z.boolean(),
    avatarColor: z.string().optional()
  }).nullable()
});
export type ProjectSessionItem = z.infer<typeof projectSessionItemSchema>;

export const lyricsDocumentSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(80).default('Main Lyrics'),
  content: z.string().default(''),
  updatedAt: z.number().default(0),
  updatedBy: z.string().optional(),
  updatedByName: z.string().optional()
});
export type LyricsDocument = z.infer<typeof lyricsDocumentSchema>;

export const projectWorkspaceLyricsSchema = z.object({
  activeDocumentId: z.string().optional(),
  documents: z.array(lyricsDocumentSchema).default([]),
  content: z.string().default(''),
  updatedAt: z.number().default(0),
  updatedBy: z.string().optional(),
  updatedByName: z.string().optional()
});
export type ProjectWorkspaceLyrics = z.infer<typeof projectWorkspaceLyricsSchema>;

export const projectWorkspaceNotesSchema = z.object({
  content: z.string().default(''),
  bpm: z.string().optional(),
  key: z.string().optional(),
  updatedAt: z.number().default(0),
  updatedBy: z.string().optional(),
  updatedByName: z.string().optional()
});
export type ProjectWorkspaceNotes = z.infer<typeof projectWorkspaceNotesSchema>;

export const songSectionTypeSchema = z.enum([
  'intro',
  'verse',
  'pre-chorus',
  'chorus',
  'post-chorus',
  'hook',
  'bridge',
  'breakdown',
  'solo',
  'outro',
  'custom'
]);
export type SongSectionType = z.infer<typeof songSectionTypeSchema>;

export const songSectionItemSchema = z.object({
  id: z.string(),
  type: songSectionTypeSchema.default('verse'),
  name: z.string().trim().min(1).max(80).default('Verse'),
  bars: z.number().int().min(1).max(256).optional(),
  note: z.string().trim().max(300).optional(),
  color: z.string().optional(),
  updatedAt: z.number().default(0)
});
export type SongSectionItem = z.infer<typeof songSectionItemSchema>;

export const projectWorkspaceStructureSchema = z.object({
  sections: z.array(songSectionItemSchema).default([]),
  updatedAt: z.number().default(0),
  updatedBy: z.string().optional(),
  updatedByName: z.string().optional()
});
export const projectTaskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
export type ProjectTaskStatus = z.infer<typeof projectTaskStatusSchema>;

export const projectTaskItemSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1, 'Task title is required').max(150),
  status: projectTaskStatusSchema.default('todo'),
  assigneeId: z.string().optional(),
  assigneeName: z.string().optional(),
  note: z.string().trim().max(500).optional(),
  dueDate: z.string().optional(),
  createdAt: z.number().default(0),
  completedAt: z.number().optional(),
  updatedAt: z.number().default(0)
});
export type ProjectTaskItem = z.infer<typeof projectTaskItemSchema>;

export const projectWorkspaceTasksSchema = z.object({
  tasks: z.array(projectTaskItemSchema).default([]),
  updatedAt: z.number().default(0),
  updatedBy: z.string().optional(),
  updatedByName: z.string().optional()
});
export type ProjectWorkspaceTasks = z.infer<typeof projectWorkspaceTasksSchema>;

export const projectWorkspaceSchema = z.object({
  lyrics: projectWorkspaceLyricsSchema.default({
    activeDocumentId: 'doc-main',
    documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 }],
    content: '',
    updatedAt: 0
  }),
  notes: projectWorkspaceNotesSchema.default({ content: '', updatedAt: 0 }),
  structure: projectWorkspaceStructureSchema.default({ sections: [], updatedAt: 0 }),
  tasks: projectWorkspaceTasksSchema.default({ tasks: [], updatedAt: 0 })
});
export type ProjectWorkspace = z.infer<typeof projectWorkspaceSchema>;

export const projectActivityTypeSchema = z.enum([
  'project_created',
  'lyrics_doc_created',
  'lyrics_doc_renamed',
  'lyrics_edited',
  'notes_edited',
  'notes_bpm_changed',
  'notes_key_changed',
  'structure_changed',
  'task_created',
  'task_assigned',
  'task_status_changed',
  'task_completed',
  'task_reopened',
  'task_deleted',
  'collaborator_added',
  'collaborator_removed',
  'session_started',
  'session_completed'
]);
export type ProjectActivityType = z.infer<typeof projectActivityTypeSchema>;

export const projectActivityItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: projectActivityTypeSchema,
  userId: z.string(),
  userDisplayName: z.string(),
  userUsername: z.string(),
  userAvatarColor: z.string().optional(),
  title: z.string(),
  summary: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number()
});
export type ProjectActivityItem = z.infer<typeof projectActivityItemSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, 'Project name cannot be empty').max(60),
  description: z.string().trim().max(300).optional(),
  ownerId: z.string(),
  ownerDisplayName: z.string(),
  ownerUsername: z.string(),
  ownerAvatarColor: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastActivityAt: z.number(),
  archived: z.boolean().default(false),
  collaborators: z.array(projectCollaboratorSchema).default([]),
  sessions: z.array(projectSessionItemSchema).default([]),
  sessionCount: z.number().int().default(0),
  activities: z.array(projectActivityItemSchema).default([]),
  workspace: projectWorkspaceSchema.default({
    lyrics: {
      activeDocumentId: 'doc-main',
      documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 }],
      content: '',
      updatedAt: 0
    },
    notes: { content: '', updatedAt: 0 },
    structure: { sections: [], updatedAt: 0 },
    tasks: { tasks: [], updatedAt: 0 }
  }),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(60),
  description: z.string().trim().max(300).optional(),
  collaboratorUsernames: z.array(z.string()).optional()
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).optional(),
  archived: z.boolean().optional()
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const updateProjectWorkspaceRequestSchema = z.object({
  lyrics: z.object({
    activeDocumentId: z.string().optional(),
    documents: z.array(lyricsDocumentSchema).optional(),
    content: z.string().optional(),
    documentId: z.string().optional(),
    title: z.string().optional()
  }).optional(),
  notes: z.object({
    content: z.string().optional(),
    bpm: z.string().optional(),
    key: z.string().optional()
  }).optional(),
  structure: z.object({
    sections: z.array(songSectionItemSchema).optional()
  }).optional(),
  tasks: z.object({
    tasks: z.array(projectTaskItemSchema).optional()
  }).optional()
});
export type UpdateProjectWorkspaceRequest = z.infer<typeof updateProjectWorkspaceRequestSchema>;

export const addCollaboratorRequestSchema = z.object({
  usernameOrEmail: z.string().trim().min(1, 'Username or email is required'),
  role: projectCollaboratorRoleSchema.default('collaborator')
});
export type AddCollaboratorRequest = z.infer<typeof addCollaboratorRequestSchema>;

export const createMeetingSchema = z.object({
  participantId: participantIdSchema,
  authToken: z.string().optional(),
  guestDisplayName: z.string().optional(),
  projectId: z.string().optional(),
  waitingRoomEnabled: z.boolean().optional(),
  media: mediaMetadataSchema
});
export type CreateMeetingRequest = z.infer<typeof createMeetingSchema>;

export const joinMeetingSchema = z.object({
  code: meetingCodeSchema,
  participantId: participantIdSchema,
  authToken: z.string().optional(),
  guestDisplayName: z.string().optional(),
  media: mediaMetadataSchema
});
export type JoinMeetingRequest = z.infer<typeof joinMeetingSchema>;

export const signalDescriptionSchema = z.object({
  code: meetingCodeSchema,
  description: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1) })
});
export const signalCandidateSchema = z.object({
  code: meetingCodeSchema,
  candidate: z.object({
    candidate: z.string(),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
    usernameFragment: z.string().nullable().optional()
  }).nullable()
});
export const meetingActionSchema = z.object({
  code: meetingCodeSchema,
  action: z.unknown().optional()
});
export type MeetingAction = z.infer<typeof meetingActionSchema>;
export const mediaUpdateSchema = z.object({ code: meetingCodeSchema, media: mediaMetadataSchema });

export type MeetingRole = 'host' | 'guest';
export type IceServerConfig = { urls: string | string[]; username?: string; credential?: string };
export type MeetingErrorCode = 'INVALID_CODE' | 'ROOM_FULL' | 'ROOM_LOCKED' | 'NOT_IN_ROOM' | 'BAD_REQUEST' | 'SERVER_ERROR' | 'UNAUTHORIZED';

export type MeetingAck =
  | {
      ok: true;
      code: string;
      role: MeetingRole;
      waiting?: boolean;
      locked?: boolean;
      iceServers: IceServerConfig[];
      peerPresent: boolean;
      peerMedia?: MediaMetadata;
      peerParticipantId?: string;
      identity: ParticipantIdentity;
      hostIdentity: ParticipantIdentity;
      peerIdentity?: ParticipantIdentity;
      projectId?: string;
    }
  | { ok: false; code: MeetingErrorCode; message: string };

export function normalizeMeetingCode(value: string): string {
  const deepLink = value.match(/^(?:jameet|musiczoom):\/\/join\/([a-z0-9]+)/i) || value.match(/\/join\/([a-z0-9]+)/i);
  return (deepLink?.[1] ?? value).replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export const sessionChatMessageSchema = z.object({
  id: z.string(),
  senderId: z.string(),
  senderName: z.string(),
  text: z.string().trim().min(1).max(2000),
  timestamp: z.number().int()
});
export type SessionChatMessage = z.infer<typeof sessionChatMessageSchema>;

export const sendChatMessageSchema = z.object({
  code: meetingCodeSchema,
  text: z.string().trim().min(1).max(2000)
});
export type SendChatMessageRequest = z.infer<typeof sendChatMessageSchema>;

export const waitingParticipantItemSchema = z.object({
  participantId: participantIdSchema,
  identity: participantIdentitySchema,
  joinedAt: z.number().int()
});
export type WaitingParticipantItem = z.infer<typeof waitingParticipantItemSchema>;

export const admitParticipantSchema = z.object({
  code: meetingCodeSchema,
  participantId: participantIdSchema
});
export type AdmitParticipantRequest = z.infer<typeof admitParticipantSchema>;

export const lockMeetingSchema = z.object({
  code: meetingCodeSchema,
  locked: z.boolean()
});
export type LockMeetingRequest = z.infer<typeof lockMeetingSchema>;

export const removeParticipantSchema = z.object({
  code: meetingCodeSchema,
  participantId: participantIdSchema
});
export type RemoveParticipantRequest = z.infer<typeof removeParticipantSchema>;

export interface ScheduledSession {
  id: string;
  userId: string;
  title: string;
  scheduledAt: string; // ISO 8601 UTC string
  createdAt: number;
  updatedAt: number;
}

export const createScheduledSessionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  scheduledAt: z.string().datetime()
});
export type CreateScheduledSessionRequest = z.infer<typeof createScheduledSessionSchema>;

export const updateScheduledSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  scheduledAt: z.string().datetime().optional()
});
export type UpdateScheduledSessionRequest = z.infer<typeof updateScheduledSessionSchema>;





