import { resolve, dirname } from 'path';
import { readFileSync, existsSync } from 'fs';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

function htmlPartialsPlugin(): Plugin {
  const INCLUDE_REGEX = /<include\s+src=["']([^"']+)["']\s*(?:\/>|>[\s\S]*?<\/include>)/g;

  function processHtml(html: string, htmlFilePath: string): string {
    const baseDir = dirname(htmlFilePath);
    return html.replace(INCLUDE_REGEX, (_match, src) => {
      const filePath = resolve(baseDir, src);
      if (!existsSync(filePath)) {
        throw new Error(`[html-partials] File not found: ${src} (resolved to ${filePath})`);
      }
      const partialContent = readFileSync(filePath, 'utf-8');
      return processHtml(partialContent, filePath);
    });
  }

  return {
    name: 'vite-plugin-html-partials',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return processHtml(html, ctx.filename);
      }
    }
  };
}

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
    plugins: [htmlPartialsPlugin()],
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

