import { initWaitingRoomUi } from './waitingRoomUi';

export interface WaitingRoomUiControllerOptions {
  onAdmitParticipant: (participantId: string) => Promise<any>;
}

export function initWaitingRoomUiController(options: WaitingRoomUiControllerOptions): void {
  initWaitingRoomUi({
    onAdmit: async (participantId) => {
      return options.onAdmitParticipant(participantId);
    }
  });
}
