export interface SessionTimerOptions {
  isInCall: () => boolean;
  onSetCallStatus: (status: string) => void;
}

let timerOptions: SessionTimerOptions | null = null;
let sessionStartTime = 0;
let sessionTimerHandle: number | undefined;

export function initSessionTimer(options: SessionTimerOptions): void {
  timerOptions = options;
}

export function getSessionStartTime(): number {
  return sessionStartTime;
}

export function startSessionTimer(): void {
  stopSessionTimer();
  sessionStartTime = Date.now();
  if (timerOptions) {
    timerOptions.onSetCallStatus('00:00');
  }
  sessionTimerHandle = window.setInterval(() => {
    if (!timerOptions || !timerOptions.isInCall()) return;
    const elapsedSec = Math.floor((Date.now() - sessionStartTime) / 1000);
    const m = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const s = (elapsedSec % 60).toString().padStart(2, '0');
    timerOptions.onSetCallStatus(`${m}:${s}`);
  }, 1000);
}

export function stopSessionTimer(): void {
  if (sessionTimerHandle) {
    window.clearInterval(sessionTimerHandle);
    sessionTimerHandle = undefined;
  }
}
