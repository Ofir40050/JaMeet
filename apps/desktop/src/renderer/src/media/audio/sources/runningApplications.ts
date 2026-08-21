export interface RunningAudioApp {
  pid: number;
  name: string;
  bundleId: string;
  isDaw: boolean;
  category?: string;
  iconDataUrl?: string;
}

let cachedRunningApps: RunningAudioApp[] = [];

export function getCachedRunningApps(): RunningAudioApp[] {
  return cachedRunningApps;
}

export function setCachedRunningApps(apps: RunningAudioApp[]): void {
  cachedRunningApps = apps;
}

export async function fetchRunningAudioApps(): Promise<RunningAudioApp[]> {
  const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
  if (desktopApi?.listAudioApplications) {
    cachedRunningApps = await desktopApi.listAudioApplications().catch(() => []);
  }
  return cachedRunningApps;
}
