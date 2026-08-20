import * as projectsApi from '../projects/core/projects';
import { setScheduledApiBase } from '../sessions/scheduled/scheduledApi';

const DEFAULT_PROD_SIGNALING_URL = 'https://jameet-jwi8.onrender.com';
const DEFAULT_DEV_SIGNALING_URL = 'http://localhost:3000';
const PARTICIPANT_STORAGE_KEY = 'jameet-participant';
const LEGACY_PARTICIPANT_STORAGE_KEY = 'musiczoom-participant';

export function resolveSignalingUrl(): string {
  return (
    import.meta.env.VITE_SIGNALING_URL ||
    (import.meta.env.PROD ? DEFAULT_PROD_SIGNALING_URL : DEFAULT_DEV_SIGNALING_URL)
  ).replace(/\/+$/, '');
}

export function initApiBases(url: string = resolveSignalingUrl()): string {
  projectsApi.setApiBase(url);
  setScheduledApiBase(url);
  return url;
}

export function initParticipantId(): string {
  const existing =
    typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(PARTICIPANT_STORAGE_KEY) ?? sessionStorage.getItem(LEGACY_PARTICIPANT_STORAGE_KEY)
      : null;
  const participantId = existing ?? crypto.randomUUID();
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(PARTICIPANT_STORAGE_KEY, participantId);
  }
  return participantId;
}

export const signalingUrl = initApiBases(resolveSignalingUrl());
export const participantId = initParticipantId();
