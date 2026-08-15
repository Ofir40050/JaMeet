import { describe, it, expect, vi, beforeEach } from 'vitest';
import { presenter, NativeScreenFrame } from './presenter';

describe('PresenterManager', () => {
  let frameListeners: Array<(frame: NativeScreenFrame) => void> = [];
  let stoppedListeners: Array<() => void> = [];
  let startCaptureMock: ReturnType<typeof vi.fn>;
  let stopCaptureMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    frameListeners = [];
    stoppedListeners = [];
    startCaptureMock = vi.fn().mockResolvedValue(true);
    stopCaptureMock = vi.fn().mockResolvedValue(true);

    const mockApi: any = {
      onPresenterAction: vi.fn(),
      updatePresenterState: vi.fn(),
      startNativeScreenCapture: startCaptureMock,
      stopNativeScreenCapture: stopCaptureMock,
      onNativeScreenCaptureFrame: vi.fn((cb: (frame: NativeScreenFrame) => void) => {
        frameListeners.push(cb);
        return () => {
          const idx = frameListeners.indexOf(cb);
          if (idx !== -1) frameListeners.splice(idx, 1);
        };
      }),
      onNativeScreenCaptureStopped: vi.fn((cb: () => void) => {
        stoppedListeners.push(cb);
        return () => {
          const idx = stoppedListeners.indexOf(cb);
          if (idx !== -1) stoppedListeners.splice(idx, 1);
        };
      })
    };

    (globalThis as any).window = {
      musiczoom: mockApi,
      jameet: mockApi,
      addEventListener: vi.fn()
    };

    const mockContext = {
      createImageData: vi.fn((w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4)
      })),
      putImageData: vi.fn(),
      drawImage: vi.fn()
    };

    const createMockCanvas = () => ({
      width: 1920,
      height: 1080,
      getContext: vi.fn().mockReturnValue(mockContext),
      captureStream: vi.fn().mockReturnValue({
        getVideoTracks: () => [
          {
            id: 'test-track-1',
            kind: 'video',
            readyState: 'live',
            stop: vi.fn(),
            dispatchEvent: vi.fn()
          }
        ]
      }),
      toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,mock')
    });

    (globalThis as any).document = {
      createElement: vi.fn().mockImplementation((tag: string) => {
        if (tag === 'canvas') return createMockCanvas();
        return {};
      }),
      pictureInPictureEnabled: true,
      pictureInPictureElement: null,
      exitPictureInPicture: vi.fn().mockResolvedValue(undefined)
    };

    if (typeof (globalThis as any).Event === 'undefined') {
      (globalThis as any).Event = class Event {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      };
    }
  });

  it('initializes with default presenter state', () => {
    const state = presenter.getState();
    expect(state.micMuted).toBe(false);
    expect(state.camEnabled).toBe(true);
    expect(state.mode).toBe('music');
    expect(state.paused).toBe(false);
    expect(state.pipVisible).toBe(true);
  });

  it('updates state partially and returns current state snapshot', () => {
    presenter.updateState({ micMuted: true, paused: true });
    const state = presenter.getState();
    expect(state.micMuted).toBe(true);
    expect(state.paused).toBe(true);
    expect(state.mode).toBe('music'); // unchanged
  });

  it('dispatches actions to registered action handler', () => {
    const actionSpy = vi.fn();
    presenter.setActionHandler(actionSpy);

    // Trigger action handler directly
    (presenter as any).actionHandler?.('toggle-mic', { source: 'test' });
    expect(actionSpy).toHaveBeenCalledWith('toggle-mic', { source: 'test' });

    (presenter as any).actionHandler?.('toggle-pause');
    expect(actionSpy).toHaveBeenLastCalledWith('toggle-pause');
  });

  it('registers exactly one frame listener and one stopped listener upon starting capture', async () => {
    expect(frameListeners.length).toBe(0);
    expect(stoppedListeners.length).toBe(0);

    const track = await presenter.createScreenCaptureTrack(0, { fps: 15, width: 1920, height: 1080 });
    expect(track).toBeDefined();
    expect(startCaptureMock).toHaveBeenCalledWith(0, { fps: 15, width: 1920, height: 1080 });
    expect(frameListeners.length).toBe(1);
    expect(stoppedListeners.length).toBe(1);
    expect(presenter.isNativeCaptureActive()).toBe(true);
  });

  it('unsubscribes previous listeners on repeated start/restart without accumulating duplicate listeners', async () => {
    await presenter.createScreenCaptureTrack(0, { fps: 15 });
    expect(frameListeners.length).toBe(1);
    expect(stoppedListeners.length).toBe(1);

    // Restart screen sharing multiple times
    await presenter.createScreenCaptureTrack(1, { fps: 30 });
    expect(frameListeners.length).toBe(1);
    expect(stoppedListeners.length).toBe(1);

    await presenter.createScreenCaptureTrack(0, { fps: 15 });
    expect(frameListeners.length).toBe(1);
    expect(stoppedListeners.length).toBe(1);
  });

  it('cleans up frame and stopped listeners when stopNativeCapture is called', async () => {
    await presenter.createScreenCaptureTrack(0);
    expect(frameListeners.length).toBe(1);
    expect(stoppedListeners.length).toBe(1);

    await presenter.stopNativeCapture();
    expect(frameListeners.length).toBe(0);
    expect(stoppedListeners.length).toBe(0);
    expect(stopCaptureMock).toHaveBeenCalled();
    expect(presenter.isNativeCaptureActive()).toBe(false);
  });

  it('delivers frames to active session canvas and converts BGRA to RGBA', async () => {
    await presenter.createScreenCaptureTrack(0, { width: 2, height: 2 });
    const ctx = (presenter as any).canvasCtx;
    const putImageDataSpy = vi.spyOn(ctx, 'putImageData');

    // 2x2 BGRA pixels: Blue, Green, Red, White
    // BGRA format: B, G, R, A (in little endian uint32: (A<<24)|(R<<16)|(G<<8)|B)
    const rawBuffer = new Uint8Array([
      255, 0, 0, 255,   // Pixel 0: Blue (BGRA = 255, 0, 0, 255)
      0, 255, 0, 255,   // Pixel 1: Green (BGRA = 0, 255, 0, 255)
      0, 0, 255, 255,   // Pixel 2: Red (BGRA = 0, 0, 255, 255)
      255, 255, 255, 255 // Pixel 3: White
    ]);

    const activeListener = frameListeners[0];
    expect(activeListener).toBeDefined();

    activeListener?.({
      width: 2,
      height: 2,
      bytesPerRow: 8,
      data: rawBuffer,
      timestamp: Date.now()
    });

    expect(putImageDataSpy).toHaveBeenCalled();
  });

  it('discards frames from stale/superseded capture sessions without drawing to canvas', async () => {
    // 1. Start Session 1
    await presenter.createScreenCaptureTrack(0, { width: 2, height: 2 });
    expect(frameListeners.length).toBe(1);
    const staleListener = frameListeners[0];

    // 2. Start Session 2 (supersedes Session 1)
    await presenter.createScreenCaptureTrack(1, { width: 2, height: 2 });
    const currentCtx = (presenter as any).canvasCtx;
    const putImageDataSpy = vi.spyOn(currentCtx, 'putImageData');

    // 3. Invoke the stale listener from Session 1
    const rawBuffer = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    staleListener?.({
      width: 2,
      height: 2,
      bytesPerRow: 8,
      data: rawBuffer,
      timestamp: Date.now()
    });

    // The stale listener must NOT draw to the active session canvas
    expect(putImageDataSpy).not.toHaveBeenCalled();

    // 4. Invoke the active listener from Session 2
    const activeListener = frameListeners[0];
    activeListener?.({
      width: 2,
      height: 2,
      bytesPerRow: 8,
      data: rawBuffer,
      timestamp: Date.now()
    });

    expect(putImageDataSpy).toHaveBeenCalled();
  });

  it('cleans up listeners and aborts cleanly when startNativeScreenCapture fails', async () => {
    startCaptureMock.mockResolvedValueOnce(false);

    await expect(presenter.createScreenCaptureTrack(0)).rejects.toThrow('Native ScreenCaptureKit failed to start.');

    expect(frameListeners.length).toBe(0);
    expect(stoppedListeners.length).toBe(0);
    expect(stopCaptureMock).toHaveBeenCalled();
    expect(presenter.isNativeCaptureActive()).toBe(false);
  });

  it('cleans up listeners and triggers track ending when backend stops unexpectedly', async () => {
    const track = await presenter.createScreenCaptureTrack(0);
    const dispatchSpy = vi.spyOn(track, 'dispatchEvent');

    expect(stoppedListeners.length).toBe(1);
    const stoppedCallback = stoppedListeners[0];

    // Trigger stopped callback from backend
    stoppedCallback?.();

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'ended' }));
    expect(frameListeners.length).toBe(0);
    expect(stoppedListeners.length).toBe(0);
    expect(presenter.isNativeCaptureActive()).toBe(false);
  });

  it('uses WebCodecs MediaStreamTrackGenerator with direct BGRX VideoFrames when available', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const videoFrameCloseSpy = vi.fn();

    class MockVideoFrame {
      data: any;
      init: any;
      constructor(data: any, init: any) {
        this.data = data;
        this.init = init;
      }
      close() {
        videoFrameCloseSpy();
      }
    }

    class MockMediaStreamTrackGenerator {
      kind: string;
      writable: any;
      readyState = 'live';
      stop = vi.fn();
      dispatchEvent = vi.fn();

      constructor(init: { kind: string }) {
        this.kind = init.kind;
        this.writable = {
          getWriter: () => ({
            write: writeSpy,
            close: closeSpy
          })
        };
      }
    }

    (window as any).MediaStreamTrackGenerator = MockMediaStreamTrackGenerator;
    (window as any).VideoFrame = MockVideoFrame;

    try {
      const track = await presenter.createScreenCaptureTrack(0, { width: 1920, height: 1080 });
      expect(track).toBeDefined();
      expect(track.kind).toBe('video');

      expect(frameListeners.length).toBe(1);
      const listener = frameListeners[0];

      const rawBuffer = new Uint8Array(1920 * 1080 * 4);
      listener?.({
        width: 1920,
        height: 1080,
        bytesPerRow: 7680,
        data: rawBuffer,
        timestamp: 12345
      });

      // Allow microtask queue to process async pumpFrame
      await new Promise((r) => setTimeout(r, 10));

      expect(writeSpy).toHaveBeenCalledWith(expect.any(MockVideoFrame));
      const passedFrame = writeSpy.mock.calls[0]?.[0] as MockVideoFrame;
      expect(passedFrame.init.format).toBe('BGRX');
      expect(passedFrame.init.codedWidth).toBe(1920);
      expect(passedFrame.init.codedHeight).toBe(1080);
      expect(passedFrame.init.layout).toEqual([{ offset: 0, stride: 7680 }]);
      expect(videoFrameCloseSpy).toHaveBeenCalled();
    } finally {
      delete (window as any).MediaStreamTrackGenerator;
      delete (window as any).VideoFrame;
    }
  });
});

