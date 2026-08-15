#!/usr/bin/env node
const { spawn } = require('node:child_process');
const path = require('node:path');

const instanceId = process.argv[2] || '2';
const desktopDir = path.resolve(__dirname, '..');
const mainPath = path.join(desktopDir, 'out', 'main', 'index.js');
let electronPath;
try {
  electronPath = require('electron');
} catch {
  electronPath = 'electron';
}

const env = {
  ...process.env,
  JAMEET_INSTANCE: instanceId,
  ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173/'
};

console.log(`[JaMeet] Starting isolated desktop instance ${instanceId} (Profile: JaMeet-Instance-${instanceId})...`);

const child = spawn(electronPath, [mainPath, `--instance=${instanceId}`], {
  cwd: desktopDir,
  env,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  console.log(`[JaMeet] Instance ${instanceId} exited with code ${code ?? 0}`);
  process.exit(code ?? 0);
});
