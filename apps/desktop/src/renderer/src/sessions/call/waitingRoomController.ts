import type {
  MediaMetadata,
  MeetingAck,
  WaitingParticipantItem
} from '@jameet/shared';
import type { SignalingClient } from '@jameet/signaling-client';

export interface WaitingRoomControllerOptions {
  signaling: SignalingClient;
  participantId: string;
  getAuthToken: () => string | null;
  getGuestName: () => string;
  getMetadata: () => MediaMetadata;
  onRenderWaitingBanner: (waitingList: WaitingParticipantItem[]) => void;
  onInitializeActiveCall: (ack: MeetingAck) => Promise<void>;
}

export function initWaitingRoomController(options: WaitingRoomControllerOptions): void {
  options.signaling.on('waiting:update', (waitingList: WaitingParticipantItem[]) => {
    options.onRenderWaitingBanner(waitingList);
  });

  options.signaling.on('waiting:admitted', async (ack: MeetingAck) => {
    if (!ack.ok) return;
    const token = options.getAuthToken() || undefined;
    const guestName = options.getGuestName() || undefined;
    options.signaling.setResume(
      ack.code,
      options.participantId,
      options.getMetadata(),
      token,
      guestName,
      ack.reconnectToken
    );
    await options.onInitializeActiveCall(ack);
  });
}
