import { describe, it, expect } from 'vitest';

describe('ScreenCaptureKit Main Process Pipeline Framing & Backlog Mitigation', () => {
  function createFrameBuffer(width: number, height: number, bytesPerRow: number, timestamp: number, payloadByte: number = 0xAA): Buffer {
    const payloadLength = bytesPerRow * height;
    const buf = Buffer.alloc(24 + payloadLength);
    
    // Header
    buf[0] = 0x4D; // 'M'
    buf[1] = 0x5A; // 'Z'
    buf[2] = 0x46; // 'F'
    buf[3] = 0x52; // 'R'
    buf.writeUInt32LE(width, 4);
    buf.writeUInt32LE(height, 8);
    buf.writeUInt32LE(bytesPerRow, 12);
    buf.writeUInt32LE(payloadLength, 16);
    buf.writeUInt32LE(timestamp, 20);

    // Payload
    buf.fill(payloadByte, 24);
    return buf;
  }

  function simulateMainProcessStream(chunksInput: Buffer[]) {
    let chunks: Buffer[] = [];
    let totalBuffered = 0;
    const emittedFrames: Array<{ width: number; height: number; bytesPerRow: number; data: Buffer; timestamp: number }> = [];

    function readByte(offset: number): number {
      let cur = 0;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (!c) continue;
        if (offset < cur + c.length) {
          return c[offset - cur] ?? 0;
        }
        cur += c.length;
      }
      return 0;
    }

    function readUInt32(offset: number): number {
      let cur = 0;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (!c) continue;
        if (offset < cur + c.length) {
          const local = offset - cur;
          if (local + 4 <= c.length) {
            return c.readUInt32LE(local);
          }
          const b = Buffer.allocUnsafe(4);
          for (let j = 0; j < 4; j++) {
            b[j] = readByte(offset + j);
          }
          return b.readUInt32LE(0);
        }
        cur += c.length;
      }
      return 0;
    }

    function consumeBytes(count: number): Buffer {
      if (count <= 0) return Buffer.alloc(0);
      const firstChunk = chunks[0];
      if (chunks.length === 1 && firstChunk && firstChunk.length === count) {
        const buf = firstChunk;
        chunks = [];
        totalBuffered = 0;
        return buf;
      }
      if (chunks.length === 1 && firstChunk && firstChunk.length > count) {
        const buf = firstChunk.subarray(0, count);
        chunks[0] = firstChunk.subarray(count);
        totalBuffered -= count;
        return buf;
      }
      const result = Buffer.allocUnsafe(count);
      let copied = 0;
      while (copied < count && chunks.length > 0) {
        const head = chunks[0];
        if (!head) {
          chunks.shift();
          continue;
        }
        const needed = count - copied;
        if (head.length <= needed) {
          head.copy(result, copied);
          copied += head.length;
          chunks.shift();
        } else {
          head.copy(result, copied, 0, needed);
          chunks[0] = head.subarray(needed);
          copied += needed;
        }
      }
      totalBuffered -= count;
      return result;
    }

    for (const chunk of chunksInput) {
      chunks.push(chunk);
      totalBuffered += chunk.length;

      let latestFrame: {
        width: number;
        height: number;
        bytesPerRow: number;
        data: Buffer;
        timestamp: number;
      } | null = null;

      while (totalBuffered >= 24) {
        const m0 = readByte(0);
        const m1 = readByte(1);
        const m2 = readByte(2);
        const m3 = readByte(3);
        if (m0 !== 0x4D || m1 !== 0x5A || m2 !== 0x46 || m3 !== 0x52) {
          let found = -1;
          for (let o = 1; o <= totalBuffered - 4; o++) {
            if (readByte(o) === 0x4D && readByte(o + 1) === 0x5A && readByte(o + 2) === 0x46 && readByte(o + 3) === 0x52) {
              found = o;
              break;
            }
          }
          if (found !== -1) {
            consumeBytes(found);
          } else {
            if (totalBuffered > 3) {
              consumeBytes(totalBuffered - 3);
            }
            break;
          }
          continue;
        }

        const width = readUInt32(4);
        const height = readUInt32(8);
        const bytesPerRow = readUInt32(12);
        const payloadLength = readUInt32(16);
        const timestamp = readUInt32(20);

        const totalFrameSize = 24 + payloadLength;
        if (totalBuffered < totalFrameSize) {
          break;
        }

        const frameRaw = consumeBytes(totalFrameSize);
        const frameData = frameRaw.subarray(24);

        latestFrame = {
          width,
          height,
          bytesPerRow,
          data: frameData,
          timestamp
        };
      }

      if (latestFrame) {
        emittedFrames.push(latestFrame);
      }
    }

    return { emittedFrames, remainingBuffered: totalBuffered };
  }

  it('correctly reassembles a single frame split across multiple small chunks', () => {
    const fullFrame = createFrameBuffer(100, 100, 400, 1000, 0x42);
    
    // Split into 50-byte chunks
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < fullFrame.length; offset += 50) {
      chunks.push(fullFrame.subarray(offset, Math.min(fullFrame.length, offset + 50)));
    }

    const { emittedFrames, remainingBuffered } = simulateMainProcessStream(chunks);

    expect(emittedFrames.length).toBe(1);
    const frame0 = emittedFrames[0];
    expect(frame0?.width).toBe(100);
    expect(frame0?.height).toBe(100);
    expect(frame0?.bytesPerRow).toBe(400);
    expect(frame0?.timestamp).toBe(1000);
    expect(frame0?.data.length).toBe(40000);
    expect(frame0?.data[0]).toBe(0x42);
    expect(remainingBuffered).toBe(0);
  });

  it('drops intermediate stale frames when multiple frames arrive in a single batch (backlog mitigation)', () => {
    const frame1 = createFrameBuffer(64, 64, 256, 1001, 0x01);
    const frame2 = createFrameBuffer(64, 64, 256, 1002, 0x02);
    const frame3 = createFrameBuffer(64, 64, 256, 1003, 0x03);

    // Combine all 3 frames into a single chunk batch
    const batchChunk = Buffer.concat([frame1, frame2, frame3]);

    const { emittedFrames, remainingBuffered } = simulateMainProcessStream([batchChunk]);

    // Only the latest frame (frame3) should be emitted to IPC
    expect(emittedFrames.length).toBe(1);
    const emitted0 = emittedFrames[0];
    expect(emitted0?.timestamp).toBe(1003);
    expect(emitted0?.data[0]).toBe(0x03);
    expect(remainingBuffered).toBe(0);
  });

  it('recovers and resynchronizes to magic header if junk bytes appear in stream', () => {
    const junk = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
    const validFrame = createFrameBuffer(10, 10, 40, 5000, 0x99);

    const stream = Buffer.concat([junk, validFrame]);
    const { emittedFrames, remainingBuffered } = simulateMainProcessStream([stream]);

    expect(emittedFrames.length).toBe(1);
    const recovered0 = emittedFrames[0];
    expect(recovered0?.timestamp).toBe(5000);
    expect(recovered0?.width).toBe(10);
    expect(recovered0?.data[0]).toBe(0x99);
    expect(remainingBuffered).toBe(0);
  });

  describe('Native ScreenCaptureKit Startup Failure & State Consistency', () => {
    it('handles synchronous spawn failure cleanly without ReferenceError and preserves consistent state', () => {
      let activeProcess: any = null;
      let activeSessionId = 0;

      function simulateStartCapture(shouldThrowOnSpawn: boolean): boolean {
        activeSessionId++;
        const currentSessionId = ++activeSessionId;

        let child: any = null;
        try {
          if (shouldThrowOnSpawn) {
            throw new Error('spawn ENOENT');
          }
          child = {
            stdout: { removeAllListeners: () => {} },
            stderr: { removeAllListeners: () => {} },
            removeAllListeners: () => {},
            kill: () => {}
          };
          activeProcess = child;
          return true;
        } catch (err) {
          if (currentSessionId === activeSessionId) {
            if (child) {
              try {
                child.stdout?.removeAllListeners();
                child.stderr?.removeAllListeners();
                child.removeAllListeners();
                child.kill('SIGTERM');
              } catch {}
            }
            if (activeProcess === child) {
              activeProcess = null;
            }
          }
          return false;
        }
      }

      const result = simulateStartCapture(true);
      expect(result).toBe(false);
      expect(activeProcess).toBeNull();
    });

    it('cleans up spawned child process and resets active process state when subsequent setup fails', () => {
      let activeProcess: any = null;
      let activeSessionId = 0;
      let killed = false;
      let listenersRemoved = false;

      function simulateStartCaptureWithSetupFailure(): boolean {
        activeSessionId++;
        const currentSessionId = ++activeSessionId;

        let child: any = null;
        try {
          child = {
            stdout: { removeAllListeners: () => { listenersRemoved = true; } },
            stderr: { removeAllListeners: () => {} },
            removeAllListeners: () => {},
            kill: () => { killed = true; }
          };
          activeProcess = child;
          // Simulate error thrown during stream / buffer initialization
          throw new Error('Buffer allocation failure');
        } catch (err) {
          if (currentSessionId === activeSessionId) {
            if (child) {
              try {
                child.stdout?.removeAllListeners();
                child.stderr?.removeAllListeners();
                child.removeAllListeners();
                child.kill('SIGTERM');
              } catch {}
            }
            if (activeProcess === child) {
              activeProcess = null;
            }
          }
          return false;
        }
      }

      const result = simulateStartCaptureWithSetupFailure();
      expect(result).toBe(false);
      expect(killed).toBe(true);
      expect(listenersRemoved).toBe(true);
      expect(activeProcess).toBeNull();
    });

    it('prevents superseded startup request from spawning or setting active process', async () => {
      let activeProcess: any = null;
      let activeSessionId = 0;

      let spawnCount = 0;
      let killedCount = 0;

      function createMockChild(id: string) {
        return {
          id,
          stdout: { removeAllListeners: () => {} },
          stderr: { removeAllListeners: () => {} },
          removeAllListeners: () => {},
          kill: (sig?: string) => {
            if (sig === 'SIGTERM') killedCount++;
          }
        };
      }

      async function simulateStartCaptureAsync(delayMs: number, id: string): Promise<boolean> {
        activeSessionId++;
        const currentSessionId = ++activeSessionId;

        // Async preparation step (dynamic import / compile / fs checks)
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        if (currentSessionId !== activeSessionId) {
          return false;
        }

        let child: any = null;
        try {
          if (currentSessionId !== activeSessionId) {
            return false;
          }
          child = createMockChild(id);
          spawnCount++;

          if (currentSessionId !== activeSessionId) {
            try {
              child.stdout?.removeAllListeners();
              child.stderr?.removeAllListeners();
              child.removeAllListeners();
              child.kill('SIGTERM');
            } catch {}
            return false;
          }

          activeProcess = child;
          return true;
        } catch (err) {
          if (child) {
            try {
              child.stdout?.removeAllListeners();
              child.stderr?.removeAllListeners();
              child.removeAllListeners();
              child.kill('SIGTERM');
            } catch {}
          }
          if (currentSessionId === activeSessionId && activeProcess === child) {
            activeProcess = null;
          }
          return false;
        }
      }

      // Start slow request A (50ms delay) and faster request B (10ms delay)
      const promiseA = simulateStartCaptureAsync(50, 'child-A');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const promiseB = simulateStartCaptureAsync(10, 'child-B');

      const [resA, resB] = await Promise.all([promiseA, promiseB]);

      // Request A was superseded before spawning -> returns false, spawnCount is 1 (only B spawned)
      expect(resA).toBe(false);
      expect(resB).toBe(true);
      expect(spawnCount).toBe(1);
      expect(activeProcess).not.toBeNull();
      expect(activeProcess.id).toBe('child-B');
    });

    it('kills and cleans up child process if superseded immediately after spawn without overwriting newer process', () => {
      let activeProcess: any = null;
      let activeSessionId = 0;
      let killedA = false;

      // 1. Session A starts
      activeSessionId++;
      const sessionIdA = ++activeSessionId;

      // 2. Session B starts and supersedes session A
      activeSessionId++;
      const sessionIdB = ++activeSessionId;
      const childB = { id: 'child-B', kill: () => {} };
      activeProcess = childB;

      // 3. Stale session A completes spawn
      let childA: any = null;
      function finishStaleSessionA(): boolean {
        childA = {
          id: 'child-A',
          stdout: { removeAllListeners: () => {} },
          stderr: { removeAllListeners: () => {} },
          removeAllListeners: () => {},
          kill: (sig?: string) => { if (sig === 'SIGTERM') killedA = true; }
        };

        if (sessionIdA !== activeSessionId) {
          try {
            childA.stdout?.removeAllListeners();
            childA.stderr?.removeAllListeners();
            childA.removeAllListeners();
            childA.kill('SIGTERM');
          } catch {}
          return false;
        }

        activeProcess = childA;
        return true;
      }

      const resA = finishStaleSessionA();
      expect(resA).toBe(false);
      expect(killedA).toBe(true);
      // Active process must still be childB from the newer session!
      expect(activeProcess).toBe(childB);
      expect(activeProcess.id).toBe('child-B');
    });
  });
});
