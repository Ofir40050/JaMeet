import type { SignalingClient } from '@jameet/signaling-client';

export interface SessionConnectionOptions {
  signaling: SignalingClient;
  isInCall: () => boolean;
  onSetCallStatus: (status: string) => void;
}

export function initSessionConnection(options: SessionConnectionOptions): void {
  options.signaling.on('disconnect', () => {
    if (options.isInCall()) {
      options.onSetCallStatus('Signaling reconnecting…');
    }
  });

  options.signaling.on('connect', () => {
    if (options.isInCall()) {
      options.onSetCallStatus('Reconnecting session…');
    }
  });
}
