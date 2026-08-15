// ========================================================
// JaMeet Presenter Mode Coordinator & Native Frame Bridge
// ========================================================

export interface PresenterState {
  micMuted: boolean;
  camEnabled: boolean;
  mode: 'music' | 'talk';
  paused: boolean;
  pipVisible: boolean;
}

export type PresenterActionHandler = (action: string, data?: unknown) => void;

export interface NativeScreenFrame {
  width: number;
  height: number;
  bytesPerRow: number;
  data: Uint8Array;
  timestamp: number;
}

function getDesktopApi(): any {
  if (typeof window === 'undefined') return undefined;
  return (window as any).jameet || (window as any).musiczoom;
}

class PresenterManager {
  private active = false;
  private state: PresenterState = {
    micMuted: false,
    camEnabled: true,
    mode: 'music',
    paused: false,
    pipVisible: true
  };

  private actionHandler: PresenterActionHandler | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private generator: any = null;
  private writer: any = null;
  private customTrack: MediaStreamTrack | null = null;
  private remoteVideoStreaming = false;
  private participantCanvas: HTMLCanvasElement | null = null;
  private participantCanvasCtx: CanvasRenderingContext2D | null = null;
  private localParticipantCanvas: HTMLCanvasElement | null = null;
  private localParticipantCanvasCtx: CanvasRenderingContext2D | null = null;
  private localVideoEl: HTMLVideoElement | null = null;
  private remoteVideoEl: HTMLVideoElement | null = null;
  private participantName = 'Musician';
  private localParticipantName = 'You';
  private remoteAudioLevel = -60;
  private localAudioLevel = -60;

  private activeCaptureSessionId = 0;
  private frameListenerUnsubscribe: (() => void) | null = null;
  private stoppedListenerUnsubscribe: (() => void) | null = null;

  constructor() {
    const api = getDesktopApi();
    if (api?.onPresenterAction) {
      api.onPresenterAction((action: string, data?: unknown) => {
        if (this.actionHandler) {
          this.actionHandler(action, data);
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        void this.stopNativeCapture();
      });
    }
  }

  public setActionHandler(handler: PresenterActionHandler): void {
    this.actionHandler = handler;
  }

  public setRemoteVideoElement(el: HTMLVideoElement | null): void {
    this.remoteVideoEl = el;
  }

  public setLocalVideoElement(el: HTMLVideoElement | null): void {
    this.localVideoEl = el;
  }

  public setParticipantInfo(remoteName?: string, localName?: string, remoteAudioDb?: number, localAudioDb?: number): void {
    if (remoteName) this.participantName = remoteName;
    if (localName) this.localParticipantName = localName;
    if (typeof remoteAudioDb === 'number') this.remoteAudioLevel = remoteAudioDb;
    if (typeof localAudioDb === 'number') this.localAudioLevel = localAudioDb;
  }

  public isPresenterMode(): boolean {
    return this.active;
  }

  public getState(): PresenterState {
    return { ...this.state };
  }

  public updateState(partial: Partial<PresenterState>): void {
    this.state = { ...this.state, ...partial };
    const api = getDesktopApi();
    if (this.active && api?.updatePresenterState) {
      api.updatePresenterState(this.state);
    }
  }

  public isNativeCaptureActive(): boolean {
    return Boolean(this.frameListenerUnsubscribe || this.customTrack);
  }

  public getActiveCaptureSessionId(): number {
    return this.activeCaptureSessionId;
  }

  public startFloatingVideoFeed(): void {
    if (this.remoteVideoStreaming) return;
    this.remoteVideoStreaming = true;

    if (!this.participantCanvas) {
      this.participantCanvas = document.createElement('canvas');
      this.participantCanvas.width = 320;
      this.participantCanvas.height = 180;
      this.participantCanvasCtx = this.participantCanvas.getContext('2d', { alpha: false });
    }

    if (!this.localParticipantCanvas) {
      this.localParticipantCanvas = document.createElement('canvas');
      this.localParticipantCanvas.width = 320;
      this.localParticipantCanvas.height = 180;
      this.localParticipantCanvasCtx = this.localParticipantCanvas.getContext('2d', { alpha: false });
    }

    const sendFrame = () => {
      if (!this.remoteVideoStreaming || !this.active) return;

      const remoteVid = this.remoteVideoEl;
      const localVid = this.localVideoEl;

      const hasRemote = Boolean(remoteVid && remoteVid.readyState >= 2 && !remoteVid.paused && remoteVid.videoWidth > 0);
      const hasLocal = Boolean(localVid && localVid.readyState >= 2 && !localVid.paused && localVid.videoWidth > 0);

      let remoteDataUrl: string | undefined;
      let localDataUrl: string | undefined;

      if (hasRemote && this.participantCanvas && this.participantCanvasCtx && remoteVid) {
        try {
          this.participantCanvasCtx.drawImage(remoteVid, 0, 0, this.participantCanvas.width, this.participantCanvas.height);
          remoteDataUrl = this.participantCanvas.toDataURL('image/jpeg', 0.65);
        } catch {}
      }

      if (hasLocal && this.localParticipantCanvas && this.localParticipantCanvasCtx && localVid) {
        try {
          this.localParticipantCanvasCtx.drawImage(localVid, 0, 0, this.localParticipantCanvas.width, this.localParticipantCanvas.height);
          localDataUrl = this.localParticipantCanvas.toDataURL('image/jpeg', 0.65);
        } catch {}
      }

      const api = getDesktopApi();
      api?.sendPresenterVideoFrame?.({
        hasVideo: hasRemote,
        dataUrl: remoteDataUrl,
        participantName: this.participantName,
        audioLevel: this.remoteAudioLevel,

        hasRemoteVideo: hasRemote,
        remoteDataUrl,
        remoteName: this.participantName,
        remoteAudioLevel: this.remoteAudioLevel,

        hasLocalVideo: hasLocal,
        localDataUrl,
        localName: this.localParticipantName,
        localAudioLevel: this.localAudioLevel
      });

      if (this.remoteVideoStreaming && this.active) {
        setTimeout(sendFrame, 40); // 25 fps smooth dual feed
      }
    };

    sendFrame();
  }

  public stopFloatingVideoFeed(): void {
    this.remoteVideoStreaming = false;
  }

  private cleanupCaptureSession(sessionId?: number): void {
    if (sessionId !== undefined && sessionId !== this.activeCaptureSessionId) {
      return;
    }
    this.activeCaptureSessionId++;

    if (this.frameListenerUnsubscribe) {
      try {
        this.frameListenerUnsubscribe();
      } catch {}
      this.frameListenerUnsubscribe = null;
    }

    if (this.stoppedListenerUnsubscribe) {
      try {
        this.stoppedListenerUnsubscribe();
      } catch {}
      this.stoppedListenerUnsubscribe = null;
    }

    if (this.writer) {
      try {
        void this.writer.close();
      } catch {}
      this.writer = null;
    }

    if (this.generator) {
      try {
        this.generator.stop?.();
      } catch {}
      this.generator = null;
    }

    if (this.customTrack) {
      try {
        this.customTrack.stop();
      } catch {}
      this.customTrack = null;
    }

    this.canvas = null;
    this.canvasCtx = null;
  }

  /**
   * Initializes native ScreenCaptureKit capture stream on macOS.
   * Uses high-performance WebCodecs MediaStreamTrackGenerator with raw BGRX frames,
   * with optimized desynchronized Canvas captureStream fallback.
   */
  public async createScreenCaptureTrack(displayId?: number, options?: { fps?: number; width?: number; height?: number }): Promise<MediaStreamTrack> {
    // 1. Clean up any previous session/listeners/canvas/track
    this.cleanupCaptureSession();

    const currentSessionId = ++this.activeCaptureSessionId;
    const fps = options?.fps || 15;
    const targetWidth = options?.width || 1920;
    const targetHeight = options?.height || 1080;

    const hasWebCodecs = typeof (window as any).MediaStreamTrackGenerator !== 'undefined' && typeof (window as any).VideoFrame !== 'undefined';

    if (hasWebCodecs) {
      try {
        const generator = new (window as any).MediaStreamTrackGenerator({ kind: 'video' });
        const writer = generator.writable.getWriter();
        this.generator = generator;
        this.writer = writer;

        let isProcessing = false;
        let latestPendingFrame: NativeScreenFrame | null = null;

        const pumpFrame = async (frame: NativeScreenFrame) => {
          if (this.activeCaptureSessionId !== currentSessionId || !this.writer) return;

          if (isProcessing) {
            // Keep only latest pending frame to eliminate backlog and lag
            latestPendingFrame = frame;
            return;
          }

          isProcessing = true;
          try {
            const VideoFrameClass = (window as any).VideoFrame;
            const vf = new VideoFrameClass(frame.data, {
              format: 'BGRX',
              codedWidth: frame.width,
              codedHeight: frame.height,
              timestamp: (frame.timestamp || performance.now()) * 1000,
              layout: [{ offset: 0, stride: frame.bytesPerRow }]
            });
            await this.writer.write(vf);
            vf.close();
          } catch (err) {
            // Handle writer close or frame write interruption
          } finally {
            isProcessing = false;
            if (latestPendingFrame && this.activeCaptureSessionId === currentSessionId && this.writer) {
              const next = latestPendingFrame;
              latestPendingFrame = null;
              void pumpFrame(next);
            }
          }
        };

        const api = getDesktopApi();
        if (api?.onNativeScreenCaptureFrame) {
          this.frameListenerUnsubscribe = api.onNativeScreenCaptureFrame((frame: NativeScreenFrame) => {
            if (this.activeCaptureSessionId !== currentSessionId) return;
            void pumpFrame(frame);
          });
        }

        if (api?.onNativeScreenCaptureStopped) {
          this.stoppedListenerUnsubscribe = api.onNativeScreenCaptureStopped(() => {
            if (this.activeCaptureSessionId !== currentSessionId) return;
            const track = this.customTrack;
            const wasLive = Boolean(track && track.readyState !== 'ended');
            this.cleanupCaptureSession(currentSessionId);
            if (wasLive && track) {
              try {
                track.dispatchEvent(new Event('ended'));
              } catch {}
            }
          });
        }

        let started = false;
        try {
          if (api?.startNativeScreenCapture) {
            started = await api.startNativeScreenCapture(displayId, { fps, width: targetWidth, height: targetHeight });
          }
        } catch (err) {
          this.cleanupCaptureSession(currentSessionId);
          if (api?.stopNativeScreenCapture) {
            try { await api.stopNativeScreenCapture(); } catch {}
          }
          throw err;
        }

        if (!started || this.activeCaptureSessionId !== currentSessionId) {
          this.cleanupCaptureSession(currentSessionId);
          if (api?.stopNativeScreenCapture) {
            try { await api.stopNativeScreenCapture(); } catch {}
          }
          throw new Error('Native ScreenCaptureKit failed to start.');
        }

        this.customTrack = generator;

        const originalStop = generator.stop.bind(generator);
        generator.stop = () => {
          originalStop();
          if (this.activeCaptureSessionId === currentSessionId) {
            void this.stopNativeCapture();
          }
        };

        return generator;
      } catch (e) {
        console.warn('WebCodecs MediaStreamTrackGenerator failed, falling back to Canvas:', e);
        this.cleanupCaptureSession(currentSessionId);
      }
    }

    // High-performance Canvas Fallback (if WebCodecs generator is not available)
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) as CanvasRenderingContext2D;
    this.canvas = canvas;
    this.canvasCtx = ctx;

    let imgData: ImageData | null = null;
    let u32: Uint32Array | null = null;

    const fallbackApi = getDesktopApi();
    if (fallbackApi?.onNativeScreenCaptureFrame) {
      this.frameListenerUnsubscribe = fallbackApi.onNativeScreenCaptureFrame((frame: NativeScreenFrame) => {
        // Only deliver frames to the renderer if this session is currently active
        if (this.activeCaptureSessionId !== currentSessionId || !this.canvasCtx || !this.canvas) {
          return;
        }

        if (this.canvas.width !== frame.width || this.canvas.height !== frame.height || !imgData || !u32) {
          this.canvas.width = frame.width;
          this.canvas.height = frame.height;
          imgData = this.canvasCtx.createImageData(frame.width, frame.height);
          u32 = new Uint32Array(imgData.data.buffer);
        }

        // High-performance 32-bit pixel conversion (BGRA to RGBA)
        const src32 = new Uint32Array(frame.data.buffer, frame.data.byteOffset, Math.floor(frame.data.byteLength / 4));
        const totalPixels = Math.min(frame.width * frame.height, src32.length, u32.length);

        for (let p = 0; p < totalPixels; p++) {
          const val = src32[p] ?? 0;
          u32[p] = (val & 0x0000FF00) | 0xFF000000 | ((val & 0x00FF0000) >> 16) | ((val & 0x000000FF) << 16);
        }

        this.canvasCtx.putImageData(imgData, 0, 0);
      });
    }

    if (fallbackApi?.onNativeScreenCaptureStopped) {
      this.stoppedListenerUnsubscribe = fallbackApi.onNativeScreenCaptureStopped(() => {
        if (this.activeCaptureSessionId !== currentSessionId) return;
        const track = this.customTrack;
        const wasLive = Boolean(track && track.readyState !== 'ended');
        this.cleanupCaptureSession(currentSessionId);
        if (wasLive && track) {
          try {
            track.dispatchEvent(new Event('ended'));
          } catch {}
        }
      });
    }

    let started = false;
    try {
      if (fallbackApi?.startNativeScreenCapture) {
        started = await fallbackApi.startNativeScreenCapture(displayId, { fps, width: targetWidth, height: targetHeight });
      }
    } catch (err) {
      this.cleanupCaptureSession(currentSessionId);
      if (fallbackApi?.stopNativeScreenCapture) {
        try { await fallbackApi.stopNativeScreenCapture(); } catch {}
      }
      throw err;
    }

    if (!started || this.activeCaptureSessionId !== currentSessionId) {
      this.cleanupCaptureSession(currentSessionId);
      if (fallbackApi?.stopNativeScreenCapture) {
        try { await fallbackApi.stopNativeScreenCapture(); } catch {}
      }
      throw new Error('Native ScreenCaptureKit failed to start.');
    }

    let track: MediaStreamTrack | undefined;
    try {
      const stream = canvas.captureStream(fps);
      track = stream.getVideoTracks()[0];
    } catch (err) {
      this.cleanupCaptureSession(currentSessionId);
      if (fallbackApi?.stopNativeScreenCapture) {
        try { await fallbackApi.stopNativeScreenCapture(); } catch {}
      }
      throw err;
    }

    if (!track) {
      this.cleanupCaptureSession(currentSessionId);
      if (fallbackApi?.stopNativeScreenCapture) {
        try { await fallbackApi.stopNativeScreenCapture(); } catch {}
      }
      throw new Error('Canvas captureStream did not produce a video track.');
    }

    this.customTrack = track;

    const originalStop = track.stop.bind(track);
    track.stop = () => {
      originalStop();
      if (this.activeCaptureSessionId === currentSessionId) {
        void this.stopNativeCapture();
      }
    };

    return track;
  }

  public async stopNativeCapture(): Promise<void> {
    this.cleanupCaptureSession();
    const api = getDesktopApi();
    if (api?.stopNativeScreenCapture) {
      try {
        await api.stopNativeScreenCapture();
      } catch {}
    }
  }

  public async enterPresenterMode(initialState?: Partial<PresenterState>): Promise<void> {
    this.active = true;
    if (initialState) {
      this.state = { ...this.state, ...initialState };
    }

    const api = getDesktopApi();
    if (api?.enterPresenterMode) {
      await api.enterPresenterMode(this.state);
    }
    this.startFloatingVideoFeed();
  }

  public async exitPresenterMode(): Promise<void> {
    this.active = false;
    this.stopFloatingVideoFeed();
    if (document.pictureInPictureElement) {
      try { await document.exitPictureInPicture(); } catch {}
    }
    const api = getDesktopApi();
    if (api?.exitPresenterMode) {
      await api.exitPresenterMode();
    }
  }

  public async showMainWindow(): Promise<void> {
    const api = getDesktopApi();
    if (api?.showMainWindow) {
      await api.showMainWindow();
    }
  }

  public async toggleRemoteVideoPiP(): Promise<void> {
    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
        this.updateState({ pipVisible: false });
      } catch {}
    } else {
      await this.requestRemoteVideoPiP();
    }
  }

  private async requestRemoteVideoPiP(): Promise<void> {
    if (!this.remoteVideoEl || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement !== this.remoteVideoEl) {
        await this.remoteVideoEl.requestPictureInPicture();
        this.updateState({ pipVisible: true });
      }
    } catch (err) {
      console.warn('Picture-in-Picture could not be started automatically:', err);
    }
  }
}

export const presenter = new PresenterManager();
