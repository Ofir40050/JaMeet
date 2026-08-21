import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  getValidatedSignalingUrl,
  verifyBundleContainsUrl
} from '../../../../deploy/build-production-win.cjs';

describe('Windows Production Packaging Flow', () => {
  describe('getValidatedSignalingUrl', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('returns default production URL when rawUrl is undefined or empty', () => {
      expect(getValidatedSignalingUrl(undefined)).toBe('https://jameet-jwi8.onrender.com');
      expect(getValidatedSignalingUrl('')).toBe('https://jameet-jwi8.onrender.com');
      expect(getValidatedSignalingUrl('   ')).toBe('https://jameet-jwi8.onrender.com');
    });

    it('returns normalized custom HTTPS URL without trailing slashes', () => {
      expect(getValidatedSignalingUrl('https://signal.mycompany.com')).toBe('https://signal.mycompany.com');
      expect(getValidatedSignalingUrl('https://signal.mycompany.com/')).toBe('https://signal.mycompany.com');
      expect(getValidatedSignalingUrl('https://signal.mycompany.com///')).toBe('https://signal.mycompany.com');
    });

    it('rejects non-HTTPS URLs and logs error message', () => {
      expect(getValidatedSignalingUrl('http://insecure.signal.com')).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Set PRODUCTION_SIGNALING_URL to the deployed HTTPS signaling origin.');

      expect(getValidatedSignalingUrl('ws://insecure.signal.com')).toBeNull();
      expect(getValidatedSignalingUrl('signal.mycompany.com')).toBeNull();
    });
  });

  describe('verifyBundleContainsUrl', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns true when signaling URL exists in bundle assets file', () => {
      const subDir = path.join(tempDir, 'nested');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'index.js'), 'const signaling = "https://custom.signal.com";');

      expect(verifyBundleContainsUrl(tempDir, 'https://custom.signal.com')).toBe(true);
    });

    it('returns false when signaling URL does not exist in any file', () => {
      fs.writeFileSync(path.join(tempDir, 'index.js'), 'const signaling = "https://other.signal.com";');

      expect(verifyBundleContainsUrl(tempDir, 'https://custom.signal.com')).toBe(false);
    });

    it('returns false if directory does not exist', () => {
      expect(verifyBundleContainsUrl(path.join(tempDir, 'non-existent'), 'https://custom.signal.com')).toBe(false);
    });
  });
});
