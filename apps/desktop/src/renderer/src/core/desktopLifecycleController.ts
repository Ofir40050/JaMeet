export interface DesktopLifecycleOptions {
  onDeviceChange: () => void;
  onBeforeUnload: () => void;
  onHandleDeepLink: (url: string) => void;
}

export function initDesktopLifecycle(options: DesktopLifecycleOptions): void {
  navigator.mediaDevices?.addEventListener('devicechange', () => {
    options.onDeviceChange();
  });

  window.addEventListener('beforeunload', () => {
    options.onBeforeUnload();
  });

  const desktopBridge =
    typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;

  desktopBridge?.onDeepLink?.((url: string) => {
    options.onHandleDeepLink(url);
  });

  void desktopBridge?.getInitialDeepLink?.().then((url: string | null | undefined) => {
    if (url) {
      options.onHandleDeepLink(url);
    }
  });
}
