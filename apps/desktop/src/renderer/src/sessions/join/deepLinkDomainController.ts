import type { UserProfile } from '@jameet/shared';
import { initDeepLinkController } from './deepLinkController';

export interface DeepLinkDomainControllerOptions {
  isInCall: () => boolean;
  getUser: () => UserProfile | null;
  onSetPendingJoinCode: (code: string) => void;
  onOpenAuthView: (mode: 'login' | 'register') => void;
  onPrepareStudio: (options: { type: 'join'; code: string }) => Promise<void>;
}

export function initDeepLinkDomainController(options: DeepLinkDomainControllerOptions): void {
  initDeepLinkController({
    isInCall: () => options.isInCall(),
    getUser: () => options.getUser(),
    onSetPendingJoinCode: (code) => {
      options.onSetPendingJoinCode(code);
    },
    onOpenAuthView: (mode) => {
      options.onOpenAuthView(mode);
    },
    onPrepareStudio: async (opts) => {
      await options.onPrepareStudio(opts);
    }
  });
}
