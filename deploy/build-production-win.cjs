#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoDir = path.resolve(__dirname, '..');

function getValidatedSignalingUrl(rawUrl) {
  const defaultUrl = 'https://jameet-jwi8.onrender.com';
  const url = (rawUrl !== undefined && rawUrl !== null && rawUrl.trim() !== '') ? rawUrl.trim() : defaultUrl;

  if (!url.startsWith('https://')) {
    console.error('Set PRODUCTION_SIGNALING_URL to the deployed HTTPS signaling origin.');
    return null;
  }

  return url.replace(/\/+$/, '');
}

function verifyBundleContainsUrl(assetsDir, searchUrl) {
  if (!fs.existsSync(assetsDir)) {
    return false;
  }

  const entries = fs.readdirSync(assetsDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(assetsDir, entry.name);
    if (entry.isDirectory()) {
      if (verifyBundleContainsUrl(fullPath, searchUrl)) {
        return true;
      }
    } else if (entry.isFile()) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes(searchUrl)) {
          return true;
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return false;
}

function buildProductionWin(envOverride = {}) {
  const signalingUrl = getValidatedSignalingUrl(
    envOverride.PRODUCTION_SIGNALING_URL !== undefined
      ? envOverride.PRODUCTION_SIGNALING_URL
      : process.env.PRODUCTION_SIGNALING_URL
  );

  if (!signalingUrl) {
    process.exit(1);
  }

  const env = {
    ...process.env,
    ...envOverride,
    VITE_SIGNALING_URL: signalingUrl,
    VITE_ICE_TRANSPORT_POLICY: 'all'
  };

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['run', 'package:win', '-w', '@musiczoom/desktop'], {
    cwd: repoDir,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32'
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const assetsDir = path.join(repoDir, 'apps', 'desktop', 'out', 'renderer', 'assets');
  if (!verifyBundleContainsUrl(assetsDir, signalingUrl)) {
    console.error('Production signaling URL was not found in the renderer bundle.');
    process.exit(1);
  }

  console.log('Production Windows x64 NSIS installer created in apps/desktop/release/.');
  console.log(`Baked signaling origin: ${signalingUrl}`);
}

if (require.main === module) {
  buildProductionWin();
}

module.exports = {
  getValidatedSignalingUrl,
  verifyBundleContainsUrl,
  buildProductionWin
};
