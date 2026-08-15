import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('JaMeet Remote Bridge (Phase 1 Native Bridge)', () => {
  it('compiles and passes all native C bridge test suites on supported platforms', () => {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      // Windows WDM / WaveRT will have dedicated driver test harnesses in Phase 4
      return;
    }

    const bridgeDir = __dirname;
    const testBinary = join(tmpdir(), `test_jameet_remote_bridge_${Date.now()}`);

    const sourceFiles = [
      join(bridgeDir, 'jameet_remote_bridge.c'),
      join(bridgeDir, 'jameet_remote_transport_memory.c'),
      join(bridgeDir, 'jameet_remote_transport_posix.c'),
      join(bridgeDir, 'test_jameet_remote_bridge.c')
    ];

    const quotedSources = sourceFiles.map((f) => `"${f}"`).join(' ');
    const compileCmd = `clang -O2 -Wall -Wextra -pthread ${quotedSources} -o "${testBinary}"`;

    // Compile native C test binary
    expect(() => {
      execSync(compileCmd, { stdio: 'pipe' });
    }).not.toThrow();

    // Execute native test binary
    const output = execSync(`"${testBinary}"`, { stdio: 'pipe', encoding: 'utf-8' });

    expect(output).toContain('[PASS] test_abi_layout');
    expect(output).toContain('[PASS] test_basic_read_write');
    expect(output).toContain('[PASS] test_fractional_and_multislot');
    expect(output).toContain('[PASS] test_dual_bank_publication');
    expect(output).toContain('[PASS] test_generation_epoch_resync_and_sanitization');
    expect(output).toContain('[PASS] test_producer_reattachment_without_memset');
    expect(output).toContain('[PASS] test_inactivity_and_heartbeat');
    expect(output).toContain('[PASS] test_multithreaded_concurrency');
    expect(output).toContain('[PASS] test_posix_shm_geometry_and_lifetime');
    expect(output).toContain('[PASS] test_buffer_overrun_catchup');
    expect(output).toContain('All Phase 1 Bridge Tests Passed Successfully!');
  });
});
