import { app, ipcMain } from 'electron';
import type { ChildProcess } from 'node:child_process';
import { getNativeBinaryPath } from '../binaryUtils';
import { isTrustedSender } from '../trustBoundary';

let remoteVoiceProducerProcess: ChildProcess | null = null;
let isRemoteVoiceProducerDraining = false;
let pendingRemoteVoicePcmPacket: Buffer | null = null;
let remoteVoiceRouteGeneration = 0;
let remoteVoiceBridgeStartupId = 0;

const JAMEET_PRODUCER_MAGIC = 0x4A4D5250;
const JAMEET_CMD_WRITE_FRAMES = 1;

export function isRemoteVoiceActive(): boolean {
  return Boolean(remoteVoiceProducerProcess);
}

export function stopRemoteVoiceProducer(): void {
  remoteVoiceBridgeStartupId++;
  remoteVoiceRouteGeneration++;
  pendingRemoteVoicePcmPacket = null;
  isRemoteVoiceProducerDraining = false;

  if (remoteVoiceProducerProcess) {
    const proc = remoteVoiceProducerProcess;
    remoteVoiceProducerProcess = null;
    try {
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.removeAllListeners();
      if (proc.stdin) {
        try { proc.stdin.destroy(); } catch {}
      }
      try {
        if (!proc.killed) proc.kill('SIGTERM');
      } catch {}
    } catch {}
  }
}

function pumpDrainBackpressure(producer: ChildProcess, generation: number): void {
  producer.stdin?.once('drain', () => {
    isRemoteVoiceProducerDraining = false;
    // If route was stopped or producer changed, drop pending audio immediately
    if (
      generation !== remoteVoiceRouteGeneration ||
      remoteVoiceProducerProcess !== producer ||
      !producer.stdin ||
      producer.stdin.destroyed
    ) {
      pendingRemoteVoicePcmPacket = null;
      return;
    }

    if (pendingRemoteVoicePcmPacket) {
      const nextPacket = pendingRemoteVoicePcmPacket;
      pendingRemoteVoicePcmPacket = null;
      const ok = producer.stdin.write(nextPacket);
      if (!ok) {
        isRemoteVoiceProducerDraining = true;
        pumpDrainBackpressure(producer, generation);
      }
    }
  });
}

function writePcmToRemoteVoiceProducer(
  producer: ChildProcess,
  pcmFloat32: Float32Array,
  isVoiceActive: boolean
): void {
  if (!producer || !producer.stdin || producer.stdin.destroyed) return;

  if (!isVoiceActive) {
    stopRemoteVoiceProducer();
    return;
  }

  const frameCount = Math.floor(pcmFloat32.length / 2);
  const pcmBytes = pcmFloat32.byteLength;
  const payloadSize = 8 + pcmBytes;
  const packetSize = 12 + payloadSize;

  const packet = Buffer.allocUnsafe(packetSize);
  packet.writeUInt32LE(JAMEET_PRODUCER_MAGIC, 0);
  packet.writeUInt32LE(JAMEET_CMD_WRITE_FRAMES, 4);
  packet.writeUInt32LE(payloadSize, 8);
  packet.writeUInt32LE(frameCount, 12);
  packet.writeUInt32LE(1, 16);
  Buffer.from(pcmFloat32.buffer, pcmFloat32.byteOffset, pcmFloat32.byteLength).copy(packet, 20);

  if (isRemoteVoiceProducerDraining) {
    // While waiting for drain, hold at most the single newest batch and discard older batches
    pendingRemoteVoicePcmPacket = packet;
    return;
  }

  const ok = producer.stdin.write(packet);
  if (!ok) {
    isRemoteVoiceProducerDraining = true;
    pumpDrainBackpressure(producer, remoteVoiceRouteGeneration);
  }
}

export function registerRemoteVoiceIpc(): void {
  ipcMain.handle('start-remote-voice-bridge', async (event) => {
    if (!isTrustedSender(event)) return false;
    if (process.platform !== 'darwin' && process.platform !== 'win32') return false;

    const requestId = ++remoteVoiceBridgeStartupId;

    if (remoteVoiceProducerProcess && !remoteVoiceProducerProcess.killed) return true;

    const { spawn, execSync } = await import('child_process');
    const { join } = await import('path');
    const { existsSync, chmodSync } = await import('fs');

    if (requestId !== remoteVoiceBridgeStartupId) return false;
    if (remoteVoiceProducerProcess && !remoteVoiceProducerProcess.killed) return true;

    const binPath = getNativeBinaryPath('jameet-remote-producer');
    const srcPath = join(__dirname, '../../src/main/bridge/jameet-remote-producer.c');
    const bridgeDir = join(__dirname, '../../src/main/bridge');

    if (!existsSync(binPath) && !app.isPackaged && existsSync(srcPath)) {
      try {
        execSync(
          `mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreFoundation -I"${bridgeDir}" "${srcPath}" "${join(bridgeDir, 'jameet_remote_bridge.c')}" "${join(bridgeDir, 'jameet_remote_transport_posix.c')}" -o "${binPath}"`
        );
      } catch (e) {
        console.error('Failed to compile jameet-remote-producer:', e);
      }
    }

    if (requestId !== remoteVoiceBridgeStartupId) return false;

    if (!existsSync(binPath)) {
      console.error(`jameet-remote-producer binary not found: ${binPath}`);
      return false;
    }
    try { chmodSync(binPath, 0o755); } catch {}

    if (requestId !== remoteVoiceBridgeStartupId) return false;

    try {
      const child = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

      if (requestId !== remoteVoiceBridgeStartupId) {
        try {
          if (!child.killed) child.kill('SIGTERM');
        } catch {}
        return false;
      }

      if (remoteVoiceProducerProcess && remoteVoiceProducerProcess !== child) {
        try {
          if (!remoteVoiceProducerProcess.killed) remoteVoiceProducerProcess.kill('SIGTERM');
        } catch {}
      }

      remoteVoiceProducerProcess = child;
      remoteVoiceRouteGeneration++;
      isRemoteVoiceProducerDraining = false;
      pendingRemoteVoicePcmPacket = null;

      child.stderr?.on('data', (data: Buffer) => {
        console.log('[JaMeetProducer]', data.toString().trim());
      });

      child.on('close', () => {
        if (remoteVoiceProducerProcess === child) {
          remoteVoiceProducerProcess = null;
          pendingRemoteVoicePcmPacket = null;
          isRemoteVoiceProducerDraining = false;
        }
      });

      child.on('error', (err) => {
        console.error('[JaMeetProducer] Error:', err);
        if (remoteVoiceProducerProcess === child) {
          remoteVoiceProducerProcess = null;
          pendingRemoteVoicePcmPacket = null;
          isRemoteVoiceProducerDraining = false;
        }
      });

      return true;
    } catch (err) {
      if (requestId === remoteVoiceBridgeStartupId) {
        console.error('[JaMeetProducer] Spawn error:', err);
      }
      return false;
    }
  });

  ipcMain.on('send-remote-voice-pcm', (event, pcmData: Float32Array, isRouteActive: boolean) => {
    if (!isTrustedSender(event)) return;
    if (remoteVoiceProducerProcess) {
      writePcmToRemoteVoiceProducer(remoteVoiceProducerProcess, pcmData, isRouteActive);
    }
  });

  ipcMain.handle('stop-remote-voice-bridge', async (event) => {
    if (!isTrustedSender(event)) return false;
    stopRemoteVoiceProducer();
    return true;
  });
}
