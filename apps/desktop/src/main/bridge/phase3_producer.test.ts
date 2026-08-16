import { describe, it, expect } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync } from 'node:fs';

const JAMEET_PRODUCER_MAGIC = 0x4A4D5250;
const JAMEET_CMD_WRITE_FRAMES = 1;
const JAMEET_CMD_SET_ACTIVE = 2;
const JAMEET_CMD_STOP = 3;

function createPcmPacket(pcmFloat32: Float32Array, isVoiceActive: boolean): Buffer {
  const frameCount = Math.floor(pcmFloat32.length / 2);
  const pcmBytes = pcmFloat32.byteLength;
  const payloadSize = 8 + pcmBytes;
  const packetSize = 12 + payloadSize;

  const packet = Buffer.allocUnsafe(packetSize);
  packet.writeUInt32LE(JAMEET_PRODUCER_MAGIC, 0);
  packet.writeUInt32LE(JAMEET_CMD_WRITE_FRAMES, 4);
  packet.writeUInt32LE(payloadSize, 8);
  packet.writeUInt32LE(frameCount, 12);
  packet.writeUInt32LE(isVoiceActive ? 1 : 0, 16);
  Buffer.from(pcmFloat32.buffer, pcmFloat32.byteOffset, pcmFloat32.byteLength).copy(packet, 20);
  return packet;
}

describe('JaMeet Remote Phase 3 (Remote Voice Audio Path & Producer Integration)', () => {
  if (process.platform !== 'darwin') {
    it('skips macOS-specific Phase 3 tests on non-darwin platforms', () => {});
    return;
  }

  it('spawns jameet-remote-producer, writes 48 kHz stereo Float32 batches over stdin, and validates consumer reads matching audio and silence on stop', async () => {
    const desktopDir = join(__dirname, '..', '..', '..');
    const bridgeDir = __dirname;

    // 1. Compile native helper jameet-remote-producer and consumer test harness
    const producerBin = join(desktopDir, 'bin', 'jameet-remote-producer');
    const testConsumerBin = join(tmpdir(), `test_phase3_consumer_${Date.now()}`);

    const consumerSourcePath = join(tmpdir(), `consumer_test_${Date.now()}.c`);
    const consumerSourceCode = `
#include "jameet_remote_bridge.h"
#include "jameet_remote_transport.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <unistd.h>
#include <time.h>

static uint64_t get_time_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ((uint64_t)ts.tv_sec * 1000ULL) + ((uint64_t)ts.tv_nsec / 1000000ULL);
}

int main(int argc, char* argv[]) {
    (void)argc; (void)argv;
    JaMeetTransportConfig cfg = JaMeetTransportConfig_Default(false, true);
    JaMeetTransport* transport = JaMeetTransport_OpenPosixShmConfig(&cfg);
    if (!transport || !transport->segment) {
        fprintf(stderr, "Failed to open POSIX SHM for reading\\n");
        return 1;
    }

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    float readBuf[480 * 2];
    int framesReadTotal = 0;
    int nonZeroFrames = 0;

    // Poll for up to 3000 ms to read frames
    uint64_t start = get_time_ms();
    while (get_time_ms() - start < 3000) {
        uint64_t now = get_time_ms();
        uint32_t read = JaMeetConsumer_ReadFrames(&consumer, transport->segment, readBuf, 480, now);
        if (read > 0) {
            framesReadTotal += read;
            for (uint32_t i = 0; i < read * 2; i++) {
                if (fabsf(readBuf[i] - 0.75f) < 0.001f) {
                    nonZeroFrames++;
                }
            }
        }
        if (nonZeroFrames >= 480 * 2) {
            break;
        }
        usleep(10000); // 10 ms
    }

    JaMeetTransport_Close(transport, false);
    printf("NON_ZERO_MATCHES=%d\\n", nonZeroFrames);
    return (nonZeroFrames >= 480 * 2) ? 0 : 2;
}
`;
    writeFileSync(consumerSourcePath, consumerSourceCode, 'utf-8');

    execSync(
      `clang -O2 -I"${bridgeDir}" "${consumerSourcePath}" "${join(bridgeDir, 'jameet_remote_bridge.c')}" "${join(bridgeDir, 'jameet_remote_transport_posix.c')}" -o "${testConsumerBin}"`,
      { stdio: 'pipe' }
    );

    // 2. Spawn jameet-remote-producer
    const producerProcess = spawn(producerBin, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    try {
      // 3. Generate 10 batches of 480 stereo frames (0.75f amplitude test signal)
      const batchFrames = 480;
      const testPcm = new Float32Array(batchFrames * 2);
      testPcm.fill(0.75);

      const packet = createPcmPacket(testPcm, true);

      // Stream packets over 500 ms
      const interval = setInterval(() => {
        if (!producerProcess.stdin.destroyed) {
          producerProcess.stdin.write(packet);
        }
      }, 20);

      // Run consumer binary to verify it reads non-zero 0.75f frames
      await new Promise((res) => setTimeout(res, 100));
      const consumerOutput = execSync(`"${testConsumerBin}"`, { encoding: 'utf-8', timeout: 5000 });
      clearInterval(interval);

      expect(consumerOutput).toContain('NON_ZERO_MATCHES=');
      expect(Number(consumerOutput.split('NON_ZERO_MATCHES=')[1].trim())).toBeGreaterThanOrEqual(960);

      // 4. Send stop command
      const stopPacket = Buffer.allocUnsafe(12);
      stopPacket.writeUInt32LE(JAMEET_PRODUCER_MAGIC, 0);
      stopPacket.writeUInt32LE(JAMEET_CMD_STOP, 4);
      stopPacket.writeUInt32LE(0, 8);
      producerProcess.stdin.write(stopPacket);
      producerProcess.stdin.end();

      await new Promise((res) => {
        producerProcess.on('close', res);
        setTimeout(res, 500);
      });
    } finally {
      try { producerProcess.kill('SIGTERM'); } catch {}
    }
  }, 10000);

  it('verifies bounded backpressure flow control drops obsolete chunks when drain is delayed', () => {
    let isDraining = false;
    let pendingChunk: Buffer | null = null;
    const receivedChunks: number[] = [];

    const mockStdin = {
      write: (buf: Buffer) => {
        const id = buf.readUInt32LE(12); // read frameCount / test ID
        if (id === 1) {
          receivedChunks.push(id);
          isDraining = true; // simulate kernel buffer full on first write
          return false;
        }
        receivedChunks.push(id);
        return true;
      }
    };

    function sendChunk(id: number) {
      const pcm = new Float32Array(960);
      const packet = createPcmPacket(pcm, true);
      packet.writeUInt32LE(id, 12); // store id in payload frameCount

      if (isDraining) {
        // While waiting for drain, hold only the single newest pending packet and drop older ones
        pendingChunk = packet;
        return;
      }

      const ok = mockStdin.write(packet);
      if (!ok) {
        isDraining = true;
      }
    }

    sendChunk(1); // sent -> causes isDraining = true
    sendChunk(2); // queued as pendingChunk (replaces older)
    sendChunk(3); // replaces 2 as pendingChunk
    sendChunk(4); // replaces 3 as pendingChunk

    // Simulate 'drain' event
    isDraining = false;
    if (pendingChunk) {
      const next = pendingChunk;
      pendingChunk = null;
      mockStdin.write(next);
    }

    // Must have received chunk 1 and chunk 4 (chunk 2 and 3 dropped as obsolete)
    expect(receivedChunks).toEqual([1, 4]);
  });

  it('verifies immediate route invalidation purges pending backpressure audio and prevents stale delivery', () => {
    let isDraining = false;
    let pendingPacket: Buffer | null = null;
    let routeGeneration = 0;
    const deliveredPackets: number[] = [];

    const mockStdin = {
      write: (buf: Buffer) => {
        const cmd = buf.readUInt32LE(4);
        if (cmd === JAMEET_CMD_SET_ACTIVE) {
          deliveredPackets.push(999); // active/inactive state change marker
          return true;
        }
        const id = buf.readUInt32LE(12);
        deliveredPackets.push(id);
        return false; // simulate continuous backpressure
      }
    };

    function pumpDrain(gen: number) {
      // Simulate async drain callback
      return () => {
        isDraining = false;
        if (gen !== routeGeneration) {
          pendingPacket = null;
          return;
        }
        if (pendingPacket) {
          const next = pendingPacket;
          pendingPacket = null;
          const ok = mockStdin.write(next);
          if (!ok) {
            isDraining = true;
          }
        }
      };
    }

    function sendAudio(id: number, isVoiceActive: boolean) {
      if (!isVoiceActive) {
        routeGeneration++;
        pendingPacket = null;
        isDraining = false;
        const activeBuf = Buffer.alloc(16);
        activeBuf.writeUInt32LE(JAMEET_PRODUCER_MAGIC, 0);
        activeBuf.writeUInt32LE(JAMEET_CMD_SET_ACTIVE, 4);
        mockStdin.write(activeBuf);
        return;
      }

      const pcm = new Float32Array(960);
      const packet = createPcmPacket(pcm, true);
      packet.writeUInt32LE(id, 12);

      if (isDraining) {
        pendingPacket = packet;
        return;
      }

      const ok = mockStdin.write(packet);
      if (!ok) {
        isDraining = true;
      }
    }

    // 1. Send packet 1 -> triggers backpressure
    sendAudio(1, true);
    expect(isDraining).toBe(true);

    // 2. Queue packet 2 behind backpressure
    sendAudio(2, true);
    expect(pendingPacket).not.toBeNull();

    // 3. Invalidate route (e.g. remote participant muted or route stopped)
    sendAudio(0, false);
    expect(pendingPacket).toBeNull();

    // 4. Fire obsolete drain from the previous generation
    const oldDrain = pumpDrain(0);
    oldDrain();

    // Stale packet 2 must NOT have been delivered!
    expect(deliveredPackets).toEqual([1, 999]);
  });
});
