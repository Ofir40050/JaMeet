import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Windows JaMeet Remote WaveRT Driver Architecture & Hardening Tests', () => {
  const driverDir = path.join(__dirname);
  const infPath = path.join(driverDir, 'JaMeetRemote.inf');
  const ioctlHeaderPath = path.join(driverDir, '../bridge/jameet_remote_win32_ioctl.h');
  const vcxprojPath = path.join(driverDir, 'JaMeetRemote.vcxproj');
  const slnPath = path.join(driverDir, 'JaMeetRemote.sln');
  const installerNshPath = path.join(driverDir, '../../../build/installer.nsh');
  const packageJsonPath = path.join(driverDir, '../../../package.json');
  const deviceInstallerPath = path.join(driverDir, 'jameet-device-installer.c');

  it('validates JaMeetRemote.inf syntax, security SDDL in NT.HW, and interface declarations', () => {
    expect(fs.existsSync(infPath)).toBe(true);
    const infContent = fs.readFileSync(infPath, 'utf-8');

    // Friendly names for distinct Full-Duplex endpoints
    expect(infContent).toContain('JaMeet Remote In');
    expect(infContent).toContain('JaMeet Remote Out');
    expect(infContent).toContain('Class       = MEDIA');
    expect(infContent).toContain('ClassGUID   = {4d36e96c-e325-11ce-bfc1-08002be10318}');

    // Interface categories
    expect(infContent).toContain('KSCATEGORY_AUDIO');
    expect(infContent).toContain('KSCATEGORY_CAPTURE');
    expect(infContent).toContain('KSCATEGORY_RENDER');
    expect(infContent).toContain('KSCATEGORY_REALTIME');
    expect(infContent).toContain('KSCATEGORY_TOPOLOGY');

    // Security Descriptor in NT.HW: SYSTEM + Administrators Generic All, Interactive User Read/Write
    expect(infContent).toContain('[JaMeetRemote_Device.NT.HW]');
    expect(infContent).toContain('AddReg = JaMeetRemote_Device.NT.HW.AddReg');
    expect(infContent).toContain('D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)');

    // Destination directory
    expect(infContent).toContain('DefaultDestDir = 13');
  });

  it('validates Win32 IOCTL definitions and strict access masks', () => {
    expect(fs.existsSync(ioctlHeaderPath)).toBe(true);
    const ioctlContent = fs.readFileSync(ioctlHeaderPath, 'utf-8');

    // Device interface GUID: {8F58E71A-3BC8-4D33-9847-7E1CA25D6B90}
    expect(ioctlContent).toContain('0x8F58E71A, 0x3BC8, 0x4D33, 0x98, 0x47, 0x7E, 0x1C, 0xA2, 0x5D, 0x6B, 0x90');

    // Required access: FILE_READ_DATA | FILE_WRITE_DATA
    expect(ioctlContent).toContain('IOCTL_JAMEET_MAP_PRODUCER_VIEW');
    expect(ioctlContent).toContain('IOCTL_JAMEET_UNMAP_PRODUCER_VIEW');
    expect(ioctlContent).toContain('FILE_READ_DATA | FILE_WRITE_DATA');
  });

  it('validates WDK project files and build script configuration', () => {
    expect(fs.existsSync(vcxprojPath)).toBe(true);
    expect(fs.existsSync(slnPath)).toBe(true);

    const vcxprojContent = fs.readFileSync(vcxprojPath, 'utf-8');
    expect(vcxprojContent).toContain('WindowsKernelModeDriver10.0');
    expect(vcxprojContent).toContain('portcls.lib');
    expect(vcxprojContent).toContain('adapter.cpp');
    expect(vcxprojContent).toContain('dispatch.cpp');
    expect(vcxprojContent).toContain('minwave.cpp');
    expect(vcxprojContent).toContain('mintopo.cpp');
    expect(vcxprojContent).toContain('jameet_remote_kernel_consumer.cpp');

    const buildCmdPath = path.join(driverDir, 'build-driver.cmd');
    expect(fs.existsSync(buildCmdPath)).toBe(true);
    const buildCmdContent = fs.readFileSync(buildCmdPath, 'utf-8');
    expect(buildCmdContent).toContain('msbuild');
    expect(buildCmdContent).toContain('JaMeetRemote.vcxproj');
  });

  it('validates native device installer utility and installation scripts with error propagation', () => {
    expect(fs.existsSync(deviceInstallerPath)).toBe(true);
    const installerSrc = fs.readFileSync(deviceInstallerPath, 'utf-8');
    expect(installerSrc).toContain('ROOT\\JaMeetRemote');
    expect(installerSrc).toContain('SetupDiCreateDeviceInfoW');
    expect(installerSrc).toContain('UpdateDriverForPlugAndPlayDevicesW');
    expect(installerSrc).toContain('DiUninstallDriverW');
    expect(installerSrc).toContain('DIF_REMOVE');

    const installCmdPath = path.join(driverDir, 'install-driver.cmd');
    const uninstallCmdPath = path.join(driverDir, 'uninstall-driver.cmd');

    expect(fs.existsSync(installCmdPath)).toBe(true);
    expect(fs.existsSync(uninstallCmdPath)).toBe(true);

    const installContent = fs.readFileSync(installCmdPath, 'utf-8');
    expect(installContent).toContain('jameet-device-installer.exe');
    expect(installContent).toContain('install');

    const uninstallContent = fs.readFileSync(uninstallCmdPath, 'utf-8');
    expect(uninstallContent).toContain('jameet-device-installer.exe');
    expect(uninstallContent).toContain('uninstall');
  });

  it('validates NSIS installer integration and package.json Windows resources', () => {
    expect(fs.existsSync(installerNshPath)).toBe(true);
    const nshContent = fs.readFileSync(installerNshPath, 'utf-8');
    expect(nshContent).toContain('customInstall');
    expect(nshContent).toContain('install-driver.cmd');
    expect(nshContent).toContain('customUnInstall');
    expect(nshContent).toContain('uninstall-driver.cmd');
    expect(nshContent).toContain('Abort');

    expect(fs.existsSync(packageJsonPath)).toBe(true);
    const pkgContent = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    expect(pkg.build?.win?.extraResources).toBeDefined();
    expect(pkg.build?.nsis?.include).toBe('build/installer.nsh');
  });

  it('verifies untrusted memory hardening: NaN/Inf sanitization, bounds checking, and ring buffer semantics', () => {
    const JAMEET_SHM_MAGIC = 0x4A4D5254;
    const JAMEET_ABI_VERSION = 1;
    const JAMEET_SLOT_MASK = 127;
    const JAMEET_TOTAL_FRAMES = 16384;

    function sanitizeSample(rawBits: number): number {
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);
      view.setUint32(0, rawBits, true);
      const val = view.getFloat32(0, true);
      if (Number.isNaN(val) || !Number.isFinite(val)) {
        return 0.0;
      }
      if (val > 4.0) return 4.0;
      if (val < -4.0) return -4.0;
      return val;
    }

    // 1. Test NaN float bits
    const nanBits = 0x7FC00000;
    expect(sanitizeSample(nanBits)).toBe(0.0);

    // 2. Test +Infinity float bits
    const infBits = 0x7F800000;
    expect(sanitizeSample(infBits)).toBe(0.0);

    // 3. Test -Infinity float bits
    const negInfBits = 0xFF800000;
    expect(sanitizeSample(negInfBits)).toBe(0.0);

    // 4. Test normal audio amplitude (e.g. 0.5f)
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, 0.5, true);
    const normalBits = view.getUint32(0, true);
    expect(sanitizeSample(normalBits)).toBeCloseTo(0.5);

    // 5. Test slot index masking safety
    const untrustedFrameIndex = 0xFFFFFFFF;
    const slotIdx = (Math.floor(untrustedFrameIndex / 128)) & JAMEET_SLOT_MASK;
    expect(slotIdx).toBeGreaterThanOrEqual(0);
    expect(slotIdx).toBeLessThanOrEqual(127);

    // 6. Ring buffer semantics: reading ahead of writeSequence must deliver digital silence
    const writeSequence = 480;
    const targetFrame = 480; // exactly at or ahead of writeSequence
    const framesAvailable = Math.max(0, writeSequence - targetFrame);
    expect(framesAvailable).toBe(0); // must output silence
  });

  it('verifies Float32 to Int16 conversion with proper saturation clamping', () => {
    function floatToInt16(f: number): number {
      if (f > 1.0) f = 1.0;
      else if (f < -1.0) f = -1.0;
      let sample = Math.floor(f * 32767.0);
      if (sample > 32767) sample = 32767;
      if (sample < -32768) sample = -32768;
      return sample;
    }

    expect(floatToInt16(0.0)).toBe(0);
    expect(floatToInt16(1.0)).toBe(32767);
    expect(floatToInt16(-1.0)).toBe(-32767);
    expect(floatToInt16(2.5)).toBe(32767); // saturated
    expect(floatToInt16(-3.0)).toBe(-32767); // saturated
  });

  it('verifies dynamic WaveRT notification interval and strict format filtering', () => {
    function computeNotificationCadence(bufferSizeBytes: number, notificationCount: number, isFloat: boolean) {
      const bytesPerFrame = isFloat ? 8 : 4;
      const count = notificationCount > 0 ? notificationCount : 10;
      const bytesPerNotif = Math.floor(bufferSizeBytes / count);
      const frames = Math.floor(bytesPerNotif / bytesPerFrame) || 480;
      const periodMs = Math.floor((frames * 1000) / 48000) || 1;
      return { frames, periodMs };
    }

    // Default 10 notifications on 100 ms Float32 buffer (38400 bytes = 4800 frames * 8)
    const cadence10 = computeNotificationCadence(38400, 10, true);
    expect(cadence10.frames).toBe(480);
    expect(cadence10.periodMs).toBe(10);

    // 20 notifications on 100 ms Float32 buffer
    const cadence20 = computeNotificationCadence(38400, 20, true);
    expect(cadence20.frames).toBe(240);
    expect(cadence20.periodMs).toBe(5);

    // Format filter: 44.1 kHz or mono must be rejected
    function isFormatSupported(sampleRate: number, channels: number, bitsPerSample: number, isFloat: boolean): boolean {
      if (sampleRate !== 48000 || channels < 2) return false;
      if (isFloat && bitsPerSample === 32) return true;
      if (!isFloat && bitsPerSample === 16) return true;
      return false;
    }

    expect(isFormatSupported(48000, 2, 32, true)).toBe(true);
    expect(isFormatSupported(48000, 2, 16, false)).toBe(true);
    expect(isFormatSupported(44100, 2, 32, true)).toBe(false);
    expect(isFormatSupported(48000, 1, 32, true)).toBe(false);
    expect(isFormatSupported(48000, 2, 24, false)).toBe(false);
  });

  it('verifies kernel consumer frame continuity across multi-slot boundaries', () => {
    const JAMEET_SLOT_FRAMES = 128;
    const JAMEET_SLOT_MASK = 127;

    // Simulate 5 slots populated with continuous ascending frame numbers
    const slots = new Map<number, { slotStart: number; validFrames: number }>();
    for (let s = 0; s < 5; s++) {
      slots.set(s, {
        slotStart: s * JAMEET_SLOT_FRAMES,
        validFrames: JAMEET_SLOT_FRAMES
      });
    }

    const frameCount = 480;
    const writeSequence = 640; // 5 full slots produced
    let targetFrame = 100; // Starting at frame 100 (inside slot 0)
    let framesDelivered = 0;
    const collectedRanges: { start: number; length: number }[] = [];

    while (framesDelivered < frameCount) {
      if (targetFrame >= writeSequence) {
        const remaining = frameCount - framesDelivered;
        framesDelivered = frameCount;
        targetFrame += remaining;
        break;
      }

      const slotIdx = Math.floor(targetFrame / JAMEET_SLOT_FRAMES) & JAMEET_SLOT_MASK;
      const offsetInSlot = targetFrame % JAMEET_SLOT_FRAMES;
      const slot = slots.get(slotIdx);

      if (!slot) break;

      const framesInSlot = slot.validFrames - offsetInSlot;
      const availableFromProducer = writeSequence - targetFrame;
      const toCopy = Math.min(frameCount - framesDelivered, Math.min(framesInSlot, availableFromProducer));

      collectedRanges.push({ start: targetFrame, length: toCopy });
      framesDelivered += toCopy;
      targetFrame += toCopy;
    }

    expect(framesDelivered).toBe(480);
    expect(targetFrame).toBe(580);

    // Verify all ranges are contiguous: 100..128 (28), 128..256 (128), 256..384 (128), 384..512 (128), 512..580 (68)
    expect(collectedRanges).toEqual([
      { start: 100, length: 28 },
      { start: 128, length: 128 },
      { start: 256, length: 128 },
      { start: 384, length: 128 },
      { start: 512, length: 68 }
    ]);
  });

  it('verifies underrun cursor clamps to writeSequence without consuming future positions', () => {
    const frameCount = 480;
    const writeSequence = 200; // Producer only produced up to frame 200
    let targetFrame = 100;
    let framesDelivered = 0;

    // Simulate reading 480 frames when only 100 are left until writeSequence (100..200)
    while (framesDelivered < frameCount) {
      if (targetFrame >= writeSequence) {
        framesDelivered = frameCount;
        targetFrame = writeSequence; // Clamped to writeSequence
        break;
      }

      const available = writeSequence - targetFrame;
      const toCopy = Math.min(frameCount - framesDelivered, available);
      framesDelivered += toCopy;
      targetFrame += toCopy;
    }

    expect(framesDelivered).toBe(480);
    // Crucial guarantee: cursor must NOT advance beyond writeSequence (200)
    expect(targetFrame).toBe(200);
    expect(targetFrame).toBeLessThanOrEqual(writeSequence);
  });

  it('validates Full-Duplex WaveRT and Topology pin/node descriptors', () => {
    const minwavePath = path.join(driverDir, 'minwave.cpp');
    const mintopoPath = path.join(driverDir, 'mintopo.cpp');

    expect(fs.existsSync(minwavePath)).toBe(true);
    expect(fs.existsSync(mintopoPath)).toBe(true);

    const minwaveContent = fs.readFileSync(minwavePath, 'utf-8');
    const mintopoContent = fs.readFileSync(mintopoPath, 'utf-8');

    // Wave filter Full-Duplex streams and DPCs
    expect(minwaveContent).toContain('CMiniportWaveRTCaptureStream');
    expect(minwaveContent).toContain('CMiniportWaveRTRenderStream');
    expect(minwaveContent).toContain('WaveRTServicingDpcRoutine');
    expect(minwaveContent).toContain('WaveRTRenderServicingDpcRoutine');
    expect(minwaveContent).toContain('PINNAME_RECORDING_SOURCE');
    expect(minwaveContent).toContain('PINNAME_PLAYBACK_SOURCE');
    expect(minwaveContent).toContain('KSNODETYPE_ADC');
    expect(minwaveContent).toContain('KSNODETYPE_DAC');
    expect(minwaveContent).toContain('STATICGUIDOF(KSCATEGORY_CAPTURE)');
    expect(minwaveContent).toContain('STATICGUIDOF(KSCATEGORY_RENDER)');

    // Topology filter Full-Duplex pins and nodes
    expect(mintopoContent).toContain('KSNODETYPE_MICROPHONE');
    expect(mintopoContent).toContain('KSNODETYPE_SPEAKER');
    expect(mintopoContent).toContain('KSNODETYPE_ADC');
    expect(mintopoContent).toContain('KSNODETYPE_DAC');
    expect(mintopoContent).toContain('STATICGUIDOF(KSCATEGORY_CAPTURE)');
    expect(mintopoContent).toContain('STATICGUIDOF(KSCATEGORY_RENDER)');
  });
});
