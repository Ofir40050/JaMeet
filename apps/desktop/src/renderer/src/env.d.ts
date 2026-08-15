/// <reference types="vite/client" />

export interface NativeScreenFrame {
  width: number;
  height: number;
  bytesPerRow: number;
  data: Uint8Array;
  timestamp: number;
}

export interface JaMeetDesktopApi {
  getInitialDeepLink(): Promise<string | null>;
  onDeepLink(listener: (url: string) => void): () => void;
  copyText(value: string): Promise<void>;
  listDisplaySources(): Promise<Array<{ id: string; name: string; thumbnail: string }>>;
  selectDisplaySource(id: string): boolean;
  openSystemAudioSettings(): Promise<void>;
  setSystemSampleRate(rate: number, deviceName?: string): Promise<boolean>;
  setSystemInputVolume(volume: number): Promise<boolean>;
  getHardwareAudioDevices(): Promise<Array<{ id: number; name: string; uid: string; inputChannels: number; outputChannels: number; sampleRate: number; defaultInput: boolean; defaultOutput: boolean; inputChannelNames?: string[]; outputChannelNames?: string[] }>>;
  listAudioApplications(): Promise<Array<{ pid: number; name: string; bundleId: string; isDaw: boolean; category?: string; iconDataUrl?: string }>>;
  startAppAudioCapture(target: number | string, channelRoute?: string): Promise<boolean>;
  stopAppAudioCapture(): Promise<boolean>;
  onAppAudioChunk(listener: (chunk: Uint8Array) => void): () => void;
  onAppAudioStopped(listener: () => void): () => void;
  startHardwareAudioCapture(deviceId?: string): Promise<boolean>;
  stopHardwareAudioCapture(): Promise<boolean>;
  onHardwareAudioChunk(listener: (chunk: Uint8Array) => void): () => void;
  onHardwareAudioStopped(listener: () => void): () => void;
  auth: {
    getSession(): Promise<{ token?: string; user?: any; guestDisplayName?: string } | null>;
    setSession(session: { token?: string; user?: any; guestDisplayName?: string }): Promise<boolean>;
    clearSession(): Promise<boolean>;
  };
  startNativeScreenCapture(displayId?: number, options?: { fps?: number; width?: number; height?: number }): Promise<boolean>;
  stopNativeScreenCapture(): Promise<boolean>;
  onNativeScreenCaptureFrame(listener: (frame: NativeScreenFrame) => void): () => void;
  onNativeScreenCaptureStopped(listener: () => void): () => void;
  enterPresenterMode(initialState: unknown): Promise<boolean>;
  exitPresenterMode(): Promise<boolean>;
  showMainWindow(): Promise<boolean>;
  updatePresenterState(state: unknown): Promise<void>;
  setPresenterMouseIgnore(ignore: boolean): void;
  sendPresenterAction(action: string, data?: unknown): Promise<void>;
  onPresenterAction(listener: (action: string, data?: unknown) => void): () => void;
  onPresenterStateUpdate(listener: (state: unknown) => void): () => void;
  sendPresenterVideoFrame(frame: unknown): void;
  onPresenterVideoFrame(listener: (frame: unknown) => void): () => void;
  showScheduledNotification(payload: { title: string; body: string; sessionId: string }): Promise<boolean>;
  onScheduledNotificationClicked(listener: (sessionId: string) => void): () => void;
  platform: string;
  [key: string]: any;
}

declare global {
  interface Window {
    jameet: JaMeetDesktopApi;
    musiczoom: JaMeetDesktopApi;
  }

  interface HTMLMediaElement {
    setSinkId?(sinkId: string): Promise<void>;
  }
}

export {};
