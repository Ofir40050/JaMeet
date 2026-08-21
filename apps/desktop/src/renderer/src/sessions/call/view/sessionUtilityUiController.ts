import { initCallShortcutsUi } from '../controls/callShortcutsUi';
import { initGuestJoinController } from '../../../auth/guestJoinController';

export interface SessionUtilityUiControllerOptions {
  onOpenSignIn: () => void;
  onSetGuestName: (name: string) => void;
  onPrepareStudio: (action: { type: 'join'; code: string }) => void;
}

export function initSessionUtilityUiController(options: SessionUtilityUiControllerOptions): void {
  initCallShortcutsUi();
  initGuestJoinController({
    onOpenSignIn: () => {
      options.onOpenSignIn();
    },
    onSetGuestName: (name) => {
      options.onSetGuestName(name);
    },
    onPrepareStudio: (action) => {
      options.onPrepareStudio(action);
    }
  });
}
