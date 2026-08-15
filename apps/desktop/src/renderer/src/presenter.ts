// ========================================================
// MusicZoom Presenter Mode Coordinator & Native Frame Bridge
// ========================================================

export interface PresenterState {
  micMuted: boolean;
  camEnabled: boolean;
  mode: 'music' | 'talk';
  paused: boolean;
  pipVisible: boolean;
}

export type PresenterActionHandler = (action: string, data?: unknown) => void;

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
  private remoteVideoStreaming = false;
  private participantCanvas: HTMLCanvasElement | null = null;
  private participantCanvasCtx: CanvasRenderingContext2D | null = null;
  private localParticipantCanvas: HTMLCanvasElement | null = null;
  private localParticipantCanvasCtx: CanvasRenderingContext2D | null = null;
  private localVideoEl: HTMLVideoElement | null = null;
  private participantName = 'Musician';
  private localParticipantName = 'You';
  private remoteAudioLevel = -60;
  private localAudioLevel = -60;

  constructor() {
    if (typeof window !== 'undefined' && window.musiczoom?.onPresenterAction) {
      window.musiczoom.onPresenterAction((action, data) => {
        if (this.actionHandler) {
          this.actionHandler(action, data);
        }
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
    if (this.active && window.musiczoom?.updatePresenterState) {
      window.musiczoom.updatePresenterState(this.state);
    }
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

      window.musiczoom?.sendPresenterVideoFrame?.({
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

  /**
   * Initializes native ScreenCaptureKit capture stream on macOS.
   * Uses high-performance Canvas captureStream fed by native SCContentFilter frames.
   */
  public async createScreenCaptureTrack(displayId?: number, options?: { fps?: number; width?: number; height?: number }): Promise<MediaStreamTrack> {
    const fps = options?.fps || 15;
    const targetWidth = options?.width || 1920;
    const targetHeight = options?.height || 1080;

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) as CanvasRenderingContext2D;
    this.canvas = canvas;
    this.canvasCtx = ctx;

    let imgData: ImageData | null = null;
    let u32: Uint32Array | null = null;

    window.musiczoom.onNativeScreenCaptureFrame((frame) => {
      if (!this.canvasCtx || !this.canvas) return;

      if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
        this.canvas.width = frame.width;
        this.canvas.height = frame.height;
        imgData = this.canvasCtx.createImageData(frame.width, frame.height);
        u32 = new Uint32Array(imgData.data.buffer);
      } else if (!imgData || !u32) {
        imgData = this.canvasCtx.createImageData(frame.width, frame.height);
        u32 = new Uint32Array(imgData.data.buffer);
      }

      // High-performance 32-bit pixel conversion (BGRA to RGBA)
      const src32 = new Uint32Array(frame.data.buffer, frame.data.byteOffset, Math.floor(frame.data.byteLength / 4));
      const totalPixels = Math.min(frame.width * frame.height, src32.length, u32.length);

      for (let p = 0; p < totalPixels; p++) {
        const val = src32[p];
        const b = val & 0xFF;
        const g = (val >> 8) & 0xFF;
        const r = (val >> 16) & 0xFF;
        const a = 0xFF;
        u32[p] = (a << 24) | (b << 16) | (g << 8) | r;
      }

      this.canvasCtx.putImageData(imgData, 0, 0);
    });

    const started = await window.musiczoom.startNativeScreenCapture(displayId, { fps, width: targetWidth, height: targetHeight });
    if (!started) {
      throw new Error('Native ScreenCaptureKit failed to start.');
    }

    const stream = canvas.captureStream(fps);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error('Canvas captureStream did not produce a video track.');
    }

    this.customTrack = track;
    return track;
  }

  public async stopNativeCapture(): Promise<void> {
    if (window.musiczoom?.stopNativeScreenCapture) {
      await window.musiczoom.stopNativeScreenCapture();
    }
    if (this.writer) {
      try { await this.writer.close(); } catch {}
      this.writer = null;
    }
    if (this.generator) {
      this.generator.stop?.();
      this.generator = null;
    }
    if (this.customTrack) {
      this.customTrack.stop();
      this.customTrack = null;
    }
    this.canvas = null;
    this.canvasCtx = null;
  }

  public async enterPresenterMode(initialState?: Partial<PresenterState>): Promise<void> {
    this.active = true;
    if (initialState) {
      this.state = { ...this.state, ...initialState };
    }

    if (window.musiczoom?.enterPresenterMode) {
      await window.musiczoom.enterPresenterMode(this.state);
    }
    this.startFloatingVideoFeed();
  }

  public async exitPresenterMode(): Promise<void> {
    this.active = false;
    this.stopFloatingVideoFeed();
    if (document.pictureInPictureElement) {
      try { await document.exitPictureInPicture(); } catch {}
    }
    if (window.musiczoom?.exitPresenterMode) {
      await window.musiczoom.exitPresenterMode();
    }
  }

  public async showMainWindow(): Promise<void> {
    if (window.musiczoom?.showMainWindow) {
      await window.musiczoom.showMainWindow();
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
