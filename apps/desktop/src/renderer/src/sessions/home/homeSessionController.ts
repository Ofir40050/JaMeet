import { normalizeMeetingCode, meetingCodeSchema, type UserProfile } from '@jameet/shared';
import { $, setMessage } from '../../core/dom';

export interface HomeSessionControllerOptions {
  getUser: () => UserProfile | null | undefined;
  onOpenAuthView: (tab: 'login' | 'register') => void;
  onPrepareStudio: (action: { type: 'create' } | { type: 'join'; code: string }) => Promise<void> | void;
  onEnumerateAndPopulate: () => Promise<void>;
  onOpenSettings: (section: 'audio') => void;
  onSetPendingJoinCode: (code: string) => void;
  getDeviceErrorMessage: (error: unknown) => string;
}

export function initHomeSessionController(options: HomeSessionControllerOptions): void {
  $('create-button')?.addEventListener('click', () => {
    if (!options.getUser()) {
      options.onOpenAuthView('login');
      return;
    }
    void options.onPrepareStudio({ type: 'create' });
  });

  $('home-settings-button')?.addEventListener('click', async () => {
    try {
      await options.onEnumerateAndPopulate();
      options.onOpenSettings('audio');
    } catch (error) {
      setMessage('home-error', options.getDeviceErrorMessage(error), true);
    }
  });

  $('join-button')?.addEventListener('click', () => {
    const input = $<HTMLInputElement>('join-code');
    const code = normalizeMeetingCode(input?.value || '');
    const parsed = meetingCodeSchema.safeParse(code);
    if (!parsed.success) {
      return setMessage('home-error', 'Enter a valid 8-character session code.', true);
    }
    if (!options.getUser()) {
      options.onSetPendingJoinCode(code);
      options.onOpenAuthView('login');
      return;
    }
    void options.onPrepareStudio({ type: 'join', code });
  });

  $<HTMLInputElement>('join-code')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      $('join-button')?.click();
    }
  });
}
