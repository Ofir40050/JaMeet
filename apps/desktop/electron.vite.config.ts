import { resolve } from 'path';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          presenter: resolve(__dirname, 'src/renderer/presenter-toolbar.html'),
          presenterVideo: resolve(__dirname, 'src/renderer/presenter-video.html')
        }
      }
    }
  }
});
