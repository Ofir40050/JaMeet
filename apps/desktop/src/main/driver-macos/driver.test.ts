import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';

describe('JaMeet Remote macOS Driver (Phase 2 AudioServerPlugIn)', () => {
  it('compiles, packages driver bundle, and passes all native driver test suites on macOS', () => {
    if (process.platform !== 'darwin') {
      // AudioServerPlugIn is macOS-specific; Windows WDM/WaveRT driver tested in Phase 4
      return;
    }

    const driverDir = __dirname;
    const bridgeDir = join(driverDir, '..', 'bridge');

    // 1. Build and verify driver bundle via build script
    const buildScript = join(driverDir, 'build-driver.sh');
    const outDir = join(tmpdir(), `jameet_driver_test_${Date.now()}`);

    expect(() => {
      execSync(`"${buildScript}" "${outDir}"`, { stdio: 'pipe' });
    }).not.toThrow();

    const driverBundle = join(outDir, 'JaMeetRemote.driver');
    const plistPath = join(driverBundle, 'Contents', 'Info.plist');
    const binaryPath = join(driverBundle, 'Contents', 'MacOS', 'JaMeetRemote');

    expect(existsSync(driverBundle)).toBe(true);
    expect(existsSync(plistPath)).toBe(true);
    expect(existsSync(binaryPath)).toBe(true);

    const plistContent = readFileSync(plistPath, 'utf-8');
    expect(plistContent).toContain('com.jameet.audio.driver.JaMeetRemote');
    expect(plistContent).toContain('JaMeet Remote');
    expect(plistContent).toContain('JaMeetRemote_Create');
    expect(plistContent).toContain('443ABAB8-E7B3-491A-B985-BEB9187030DB');

    // 2. Compile and execute native AudioServerPlugIn test suite
    const testBinary = join(tmpdir(), `test_jameet_remote_driver_${Date.now()}`);
    const sourceFiles = [
      join(driverDir, 'JaMeetRemoteDriver.c'),
      join(bridgeDir, 'jameet_remote_bridge.c'),
      join(bridgeDir, 'jameet_remote_transport_posix.c'),
      join(driverDir, 'test_jameet_remote_driver.c')
    ];

    const quotedSources = sourceFiles.map((f) => `"${f}"`).join(' ');
    const compileCmd = `clang -O2 -Wall -Wextra -framework CoreFoundation -framework CoreAudio -I"${driverDir}" -I"${bridgeDir}" ${quotedSources} -o "${testBinary}"`;

    expect(() => {
      execSync(compileCmd, { stdio: 'pipe' });
    }).not.toThrow();

    const output = execSync(`"${testBinary}"`, { stdio: 'pipe', encoding: 'utf-8' });

    expect(output).toContain('[PASS] test_driver_factory_and_com_lifecycle');
    expect(output).toContain('[PASS] test_driver_buffer_properties_and_configuration_changes');
    expect(output).toContain('[PASS] test_driver_period_aligned_clock');
    expect(output).toContain('[PASS] test_client_bounds_and_independent_cursors');
    expect(output).toContain('[PASS] test_background_discovery_for_running_client');
    expect(output).toContain('[PASS] test_driver_coreaudio_hal_property_compliance');
    expect(output).toContain('All Phase 2 AudioServerPlugIn Tests Passed Successfully!');
  });
});
