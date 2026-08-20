export interface SessionErrorModalOptions {
  title: string;
  message: string;
  detail?: string;
  type?: 'error' | 'warning' | 'info';
  actionLabel?: string;
  dismissLabel?: string;
  onAction?: () => void;
}

export interface SessionErrorParserCallbacks {
  onOpenSignIn?: () => void;
  onEnterSession?: () => void;
}

export function parseSessionError(
  error: unknown,
  callbacks?: SessionErrorParserCallbacks
): SessionErrorModalOptions {
  const raw = error instanceof Error ? error.message : String(error || '');
  const lower = raw.toLowerCase();

  if (
    lower.includes('access to jameet') ||
    lower.includes('access restricted') ||
    lower.includes('access_denied') ||
    lower.includes('entitlement') ||
    lower.includes('does not currently have access') ||
    lower.includes('not have access') ||
    lower.includes('permission to access')
  ) {
    return {
      title: 'Session Access Restricted',
      message: 'Your account does not currently have access to JaMeet sessions.',
      detail:
        'Creating and joining live studio sessions requires verified account access or an active plan. Please sign in or contact studio support.',
      type: 'warning',
      actionLabel: 'Sign In / Account',
      dismissLabel: 'Close',
      onAction: () => callbacks?.onOpenSignIn?.()
    };
  }

  if (lower.includes('beta has ended') || lower.includes('beta_ended')) {
    return {
      title: 'JaMeet Beta Has Ended',
      message:
        'The JaMeet public beta period has concluded. An active subscription is now required to create or join live studio sessions.',
      detail: 'Please sign in to manage your subscription or contact studio support.',
      type: 'warning',
      actionLabel: 'Sign In / Account',
      dismissLabel: 'Close',
      onAction: () => callbacks?.onOpenSignIn?.()
    };
  }

  if (
    lower.includes('auth_required') ||
    lower.includes('sign in required') ||
    lower.includes('authentication required')
  ) {
    return {
      title: 'Sign In Required',
      message: 'An active JaMeet account is required to create or join studio sessions.',
      detail:
        'Please sign in or create an account to start collaborating with low-latency audio.',
      type: 'info',
      actionLabel: 'Sign In',
      dismissLabel: 'Close',
      onAction: () => callbacks?.onOpenSignIn?.()
    };
  }

  if (
    lower.includes('xhr poll error') ||
    lower.includes('websocket') ||
    lower.includes('polling') ||
    lower.includes('transport') ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('econnrefused') ||
    lower.includes('timeout')
  ) {
    return {
      title: 'Server Connection Unavailable',
      message: 'Could not establish a connection to the JaMeet studio network.',
      detail:
        'Please check your internet connection or try again in a few moments. The studio server may be waking up or temporarily unavailable.',
      type: 'warning',
      actionLabel: 'Retry Connection',
      dismissLabel: 'Close',
      onAction: () => callbacks?.onEnterSession?.()
    };
  }

  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return {
      title: 'Device Access Blocked',
      message: 'Microphone or camera permissions are required to enter the live session.',
      detail:
        'Please grant microphone and camera permissions in System Settings (Privacy & Security), then try again.',
      type: 'warning',
      actionLabel: 'Try Again',
      dismissLabel: 'Close',
      onAction: () => callbacks?.onEnterSession?.()
    };
  }

  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return {
      title: 'Audio Device Not Found',
      message: 'No connected microphone or audio input device was found.',
      detail:
        'Please plug in your microphone or audio interface and ensure it appears under Voice Microphones.',
      type: 'error',
      actionLabel: 'Retry',
      dismissLabel: 'Close',
      onAction: () => callbacks?.onEnterSession?.()
    };
  }

  return {
    title: 'Unable to Start Session',
    message:
      raw && raw !== 'The selected device could not be opened.'
        ? raw
        : 'An unexpected error occurred while preparing your live session.',
    detail: 'Please check your studio device connections and try entering the session again.',
    type: 'error',
    actionLabel: 'Try Again',
    dismissLabel: 'Close',
    onAction: () => callbacks?.onEnterSession?.()
  };
}
