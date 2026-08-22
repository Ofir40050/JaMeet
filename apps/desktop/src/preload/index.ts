import { contextBridge, ipcRenderer } from 'electron';

const jameetApi = {
  getAppInfo: (): Promise<{ version: string; platform: string }> => ipcRenderer.invoke('get-app-info'),
  getInitialDeepLink: (): Promise<string | null> => ipcRenderer.invoke('get-initial-deep-link'),
  onDeepLink: (listener: (url: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => listener(url);
    ipcRenderer.on('deep-link', handler);
    return () => ipcRenderer.removeListener('deep-link', handler);
  },
  copyText: (value: string): Promise<void> => ipcRenderer.invoke('copy-text', value),
  openExternalUrl: (url: string): Promise<boolean> => ipcRenderer.invoke('open-external-url', url),
  listDisplaySources: (): Promise<Array<{ id: string; name: string; thumbnail: string }>> => ipcRenderer.invoke('list-display-sources'),
  selectDisplaySource: (id: string): boolean => ipcRenderer.sendSync('select-display-source', id),
  openSystemAudioSettings: (): Promise<void> => ipcRenderer.invoke('open-system-audio-settings'),
  setSystemSampleRate: (rate: number, deviceName?: string): Promise<boolean> => ipcRenderer.invoke('set-system-sample-rate', rate, deviceName),
  setSystemInputVolume: (volume: number): Promise<boolean> => ipcRenderer.invoke('set-system-input-volume', volume),
  getHardwareAudioDevices: (): Promise<Array<{ id: number; name: string; uid: string; inputChannels: number; outputChannels: number; sampleRate: number; defaultInput: boolean; defaultOutput: boolean; inputChannelNames?: string[]; outputChannelNames?: string[] }>> =>
    ipcRenderer.invoke('get-hardware-audio-devices'),
  listAudioApplications: (): Promise<Array<{ pid: number; name: string; bundleId: string; isDaw: boolean; category?: string; iconDataUrl?: string }>> =>
    ipcRenderer.invoke('list-audio-applications'),
  startAppAudioCapture: (target: number | string, channelRoute?: string): Promise<boolean> =>
    ipcRenderer.invoke('start-app-audio-capture', target, channelRoute),
  stopAppAudioCapture: (): Promise<boolean> =>
    ipcRenderer.invoke('stop-app-audio-capture'),
  onAppAudioChunk: (listener: (chunk: Uint8Array) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => listener(chunk);
    ipcRenderer.on('app-audio-chunk', handler);
    return () => ipcRenderer.removeListener('app-audio-chunk', handler);
  },
  onAppAudioStopped: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('app-audio-stopped', handler);
    return () => ipcRenderer.removeListener('app-audio-stopped', handler);
  },
  startHardwareAudioCapture: (deviceId?: string): Promise<boolean> =>
    ipcRenderer.invoke('start-hardware-audio-capture', deviceId),
  stopHardwareAudioCapture: (): Promise<boolean> =>
    ipcRenderer.invoke('stop-hardware-audio-capture'),
  onHardwareAudioChunk: (listener: (chunk: Uint8Array) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => listener(chunk);
    ipcRenderer.on('hardware-audio-chunk', handler);
    return () => ipcRenderer.removeListener('hardware-audio-chunk', handler);
  },
  onHardwareAudioStopped: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('hardware-audio-stopped', handler);
    return () => ipcRenderer.removeListener('hardware-audio-stopped', handler);
  },
  onHardwareDevicesChanged: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('hardware-devices-changed', handler);
    return () => ipcRenderer.removeListener('hardware-devices-changed', handler);
  },
  auth: {
    getSession: (): Promise<{ token?: string; user?: unknown } | null> => ipcRenderer.invoke('auth:get-session'),
    setSession: (session: { token: string; user: unknown }): Promise<boolean> => ipcRenderer.invoke('auth:set-session', session),
    clearSession: (): Promise<boolean> => ipcRenderer.invoke('auth:clear-session')
  },
  // Native ScreenCaptureKit Screen Capture (macOS)
  startNativeScreenCapture: (displayId?: number, options?: { fps?: number; width?: number; height?: number }): Promise<boolean> =>
    ipcRenderer.invoke('start-native-screen-capture', displayId, options),
  stopNativeScreenCapture: (): Promise<boolean> =>
    ipcRenderer.invoke('stop-native-screen-capture'),
  onNativeScreenCaptureFrame: (listener: (frame: { width: number; height: number; bytesPerRow: number; data: Uint8Array; timestamp: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, frame: { width: number; height: number; bytesPerRow: number; data: Uint8Array; timestamp: number }) => listener(frame);
    ipcRenderer.on('native-screen-capture-frame', handler);
    return () => ipcRenderer.removeListener('native-screen-capture-frame', handler);
  },
  onNativeScreenCaptureStopped: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('native-screen-capture-stopped', handler);
    return () => ipcRenderer.removeListener('native-screen-capture-stopped', handler);
  },
  // Presenter Mode Coordination
  enterPresenterMode: (initialState: unknown): Promise<boolean> =>
    ipcRenderer.invoke('enter-presenter-mode', initialState),
  exitPresenterMode: (): Promise<boolean> =>
    ipcRenderer.invoke('exit-presenter-mode'),
  showMainWindow: (): Promise<boolean> =>
    ipcRenderer.invoke('show-main-window'),
  updatePresenterState: (state: unknown): Promise<void> =>
    ipcRenderer.invoke('update-presenter-state', state),
  setPresenterMouseIgnore: (ignore: boolean): void =>
    ipcRenderer.send('set-presenter-mouse-ignore', ignore),
  sendPresenterAction: (action: string, data?: unknown): Promise<void> =>
    ipcRenderer.invoke('send-presenter-action', action, data),
  onPresenterAction: (listener: (action: string, data?: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string, data?: unknown) => listener(action, data);
    ipcRenderer.on('presenter-action', handler);
    return () => ipcRenderer.removeListener('presenter-action', handler);
  },
  onPresenterStateUpdate: (listener: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
    ipcRenderer.on('presenter-state-update', handler);
    return () => ipcRenderer.removeListener('presenter-state-update', handler);
  },
  sendPresenterVideoFrame: (frame: unknown): void =>
    ipcRenderer.send('presenter-video-frame', frame),
  onPresenterVideoFrame: (listener: (frame: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, frame: unknown) => listener(frame);
    ipcRenderer.on('presenter-video-frame', handler);
    return () => ipcRenderer.removeListener('presenter-video-frame', handler);
  },
  showScheduledNotification: (payload: { title: string; body: string; sessionId: string }): Promise<boolean> =>
    ipcRenderer.invoke('show-scheduled-notification', payload),
  onScheduledNotificationClicked: (listener: (sessionId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string) => listener(sessionId);
    ipcRenderer.on('scheduled-notification-clicked', handler);
    return () => ipcRenderer.removeListener('scheduled-notification-clicked', handler);
  },
  remoteVoiceBridge: {
    start: (): Promise<boolean> => ipcRenderer.invoke('start-remote-voice-bridge'),
    sendPcm: (data: Float32Array, isRouteActive: boolean): void =>
      ipcRenderer.send('send-remote-voice-pcm', data, isRouteActive),
    stop: (): Promise<boolean> => ipcRenderer.invoke('stop-remote-voice-bridge')
  },
  setMediaActive: (active: boolean): void => ipcRenderer.send('set-media-active', active),
  logger: {
    log: (entry: unknown): void => ipcRenderer.send('logger:log', entry),
    crash: (crashData: unknown): Promise<unknown> => ipcRenderer.invoke('logger:crash', crashData),
    getLogPaths: (): Promise<{ logDir: string; logFilePath: string; crashFilePath: string }> => ipcRenderer.invoke('logger:get-log-paths'),
    setSendCrashReports: (enabled: boolean): void => ipcRenderer.send('logger:set-send-crash-reports', enabled)
  },
  platform: process.platform
};

contextBridge.exposeInMainWorld('jameet', jameetApi);
contextBridge.exposeInMainWorld('musiczoom', jameetApi);
