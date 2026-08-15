/// <reference types="vite/client" />

declare global {
  interface Window {
    musiczoom: {
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
      platform: string;
    };
  }

  interface HTMLMediaElement {
    setSinkId?(sinkId: string): Promise<void>;
  }
}

export {};
