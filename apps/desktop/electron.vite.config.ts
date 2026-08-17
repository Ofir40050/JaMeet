import { resolve } from 'path';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@jameet/shared']
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['@jameet/shared']
      }
    }
  },
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
