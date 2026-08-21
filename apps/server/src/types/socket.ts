import type { ParticipantIdentity } from '@jameet/shared';
import type { SocketRateLimiter } from '../core/rate-limiter.js';

export type ProjectSubscription = {
  userId: string;
  authToken: string;
};

export type SocketData = {
  code?: string;
  participantId?: string;
  identity?: ParticipantIdentity;
  isWaiting?: boolean;
  limiter?: SocketRateLimiter;
  projectSubscriptions?: Map<string, ProjectSubscription>;
};
