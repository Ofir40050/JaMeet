import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTrustedOrigin, isAllowedExternalUrl, isTrustedSender, setupWebContentsSecurity } from './trustBoundary';
import { shell } from 'electron';

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined)
  }
}));

describe('Electron Renderer Trust Boundary & Sender Validation', () => {
  const originalEnvUrl = process.env.ELECTRON_RENDERER_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ELECTRON_RENDERER_URL;
  });

  afterEach(() => {
    if (originalEnvUrl !== undefined) {
      process.env.ELECTRON_RENDERER_URL = originalEnvUrl;
    } else {
      delete process.env.ELECTRON_RENDERER_URL;
    }
  });

  describe('isTrustedOrigin', () => {
    it('accepts production bundled app origins', () => {
      expect(isTrustedOrigin('jameet-app://bundle/index.html')).toBe(true);
      expect(isTrustedOrigin('jameet-app://bundle/presenter-toolbar.html')).toBe(true);
      expect(isTrustedOrigin('jameet-app://bundle/presenter-video.html')).toBe(true);
      expect(isTrustedOrigin('musiczoom-app://bundle/index.html')).toBe(true);
    });

    it('rejects untrusted custom protocol hosts even if pathname contains bundle', () => {
      expect(isTrustedOrigin('jameet-app://evil/bundle')).toBe(false);
      expect(isTrustedOrigin('jameet-app://evil-host/index.html')).toBe(false);
      expect(isTrustedOrigin('musiczoom-app://untrusted/bundle/index.html')).toBe(false);
      expect(isTrustedOrigin('musiczoom-app://untrusted/page.html')).toBe(false);
    });

    it('rejects malicious external web origins and dangerous protocols', () => {
      expect(isTrustedOrigin('https://evil.com')).toBe(false);
      expect(isTrustedOrigin('http://attacker.org/phishing')).toBe(false);
      expect(isTrustedOrigin('javascript:alert(1)')).toBe(false);
      expect(isTrustedOrigin('data:text/html,<h1>Hacked</h1>')).toBe(false);
      expect(isTrustedOrigin('file:///etc/passwd')).toBe(false);
      expect(isTrustedOrigin('blob:http://evil.com/uuid')).toBe(false);
      expect(isTrustedOrigin(null)).toBe(false);
      expect(isTrustedOrigin(undefined)).toBe(false);
      expect(isTrustedOrigin('')).toBe(false);
    });

    it('accepts localhost/127.0.0.1 in development mode', () => {
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
      expect(isTrustedOrigin('http://localhost:5173')).toBe(true);
      expect(isTrustedOrigin('http://localhost:5173/index.html')).toBe(true);
      expect(isTrustedOrigin('http://127.0.0.1:5173')).toBe(true);
      expect(isTrustedOrigin('http://localhost:3000')).toBe(true);
      expect(isTrustedOrigin('http://evil.com')).toBe(false);
    });
  });

  describe('isAllowedExternalUrl', () => {
    it('allows valid HTTPS and HTTP web links for OS browser delegation', () => {
      expect(isAllowedExternalUrl('https://jameet.com/docs')).toBe(true);
      expect(isAllowedExternalUrl('https://github.com/Ofir40050/JaMeet')).toBe(true);
      expect(isAllowedExternalUrl('http://example.com/help')).toBe(true);
    });

    it('rejects non-web, dangerous, or arbitrary schemes from being launched', () => {
      expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
      expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
      expect(isAllowedExternalUrl('data:text/html,<script>evil()</script>')).toBe(false);
      expect(isAllowedExternalUrl('calc.exe')).toBe(false);
      expect(isAllowedExternalUrl('custom-cmd://format-c')).toBe(false);
      expect(isAllowedExternalUrl('')).toBe(false);
      expect(isAllowedExternalUrl(null)).toBe(false);
      expect(isAllowedExternalUrl(undefined)).toBe(false);
    });
  });

  describe('isTrustedSender', () => {
    it('accepts trusted packaged senderFrame', () => {
      const validEvent = {
        senderFrame: { url: 'jameet-app://bundle/index.html' }
      };
      expect(isTrustedSender(validEvent)).toBe(true);
    });

    it('validates empty/missing senderFrame with trusted sender WebContents fallback', () => {
      const nullFrameEvent = {
        senderFrame: null,
        sender: { getURL: () => 'jameet-app://bundle/index.html' }
      };
      expect(isTrustedSender(nullFrameEvent as any)).toBe(true);

      const emptyFrameEvent = {
        senderFrame: { url: '' },
        sender: { getURL: () => 'jameet-app://bundle/index.html' }
      };
      expect(isTrustedSender(emptyFrameEvent as any)).toBe(true);

      const whitespaceFrameEvent = {
        senderFrame: { url: '   ' },
        sender: { getURL: () => 'jameet-app://bundle/index.html' }
      };
      expect(isTrustedSender(whitespaceFrameEvent as any)).toBe(true);
    });

    it('strictly rejects untrusted senderFrame even when top-level sender WebContents is trusted', () => {
      const maliciousSubframeEvent = {
        senderFrame: { url: 'https://evil.com/exploit.html' },
        sender: { getURL: () => 'jameet-app://bundle/index.html' }
      };
      expect(isTrustedSender(maliciousSubframeEvent as any)).toBe(false);

      const maliciousCustomProtocolEvent = {
        senderFrame: { url: 'jameet-app://evil/bundle' },
        sender: { getURL: () => 'jameet-app://bundle/index.html' }
      };
      expect(isTrustedSender(maliciousCustomProtocolEvent as any)).toBe(false);
    });

    it('rejects external HTTPS sender', () => {
      const httpsEvent = {
        senderFrame: { url: 'https://attacker.com/malicious.html' },
        sender: { getURL: () => 'https://attacker.com/malicious.html' }
      };
      expect(isTrustedSender(httpsEvent as any)).toBe(false);
    });

    it('rejects IPC events when senderFrame and sender are missing, null, or untrusted', () => {
      expect(isTrustedSender(null)).toBe(false);
      expect(isTrustedSender(undefined)).toBe(false);
      expect(isTrustedSender({})).toBe(false);
      expect(isTrustedSender({ senderFrame: null })).toBe(false);
      expect(isTrustedSender({ senderFrame: { url: '' } })).toBe(false);
      expect(isTrustedSender({ senderFrame: null, sender: { getURL: () => 'https://evil.com' } } as any)).toBe(false);
      expect(isTrustedSender({ senderFrame: null, sender: null } as any)).toBe(false);
    });
  });

  describe('setupWebContentsSecurity', () => {
    it('prevents navigation to untrusted URLs on will-navigate', () => {
      const listeners: Record<string, Function> = {};
      const mockWebContents = {
        isDestroyed: () => false,
        on: vi.fn((event: string, handler: Function) => {
          listeners[event] = handler;
        }),
        setWindowOpenHandler: vi.fn()
      } as any;

      setupWebContentsSecurity(mockWebContents);

      expect(listeners['will-navigate']).toBeDefined();

      const preventDefault = vi.fn();
      listeners['will-navigate']?.({ preventDefault }, 'https://evil.com/phishing');
      expect(preventDefault).toHaveBeenCalled();

      const preventDefaultAllowed = vi.fn();
      listeners['will-navigate']?.({ preventDefault: preventDefaultAllowed }, 'jameet-app://bundle/presenter-toolbar.html');
      expect(preventDefaultAllowed).not.toHaveBeenCalled();
    });

    it('prevents navigation redirects to untrusted URLs on will-redirect', () => {
      const listeners: Record<string, Function> = {};
      const mockWebContents = {
        isDestroyed: () => false,
        on: vi.fn((event: string, handler: Function) => {
          listeners[event] = handler;
        }),
        setWindowOpenHandler: vi.fn()
      } as any;

      setupWebContentsSecurity(mockWebContents);

      expect(listeners['will-redirect']).toBeDefined();

      const preventDefault = vi.fn();
      listeners['will-redirect']?.({ preventDefault }, 'https://evil.com/redirect-target');
      expect(preventDefault).toHaveBeenCalled();

      const preventDefaultAllowed = vi.fn();
      listeners['will-redirect']?.({ preventDefault: preventDefaultAllowed }, 'jameet-app://bundle/index.html');
      expect(preventDefaultAllowed).not.toHaveBeenCalled();
    });

    it('prevents subframe / iframe navigation to untrusted URLs on will-frame-navigate', () => {
      const listeners: Record<string, Function> = {};
      const mockWebContents = {
        isDestroyed: () => false,
        on: vi.fn((event: string, handler: Function) => {
          listeners[event] = handler;
        }),
        setWindowOpenHandler: vi.fn()
      } as any;

      setupWebContentsSecurity(mockWebContents);

      expect(listeners['will-frame-navigate']).toBeDefined();

      const preventDefault = vi.fn();
      listeners['will-frame-navigate']?.({ preventDefault, url: 'https://evil.com/iframe' });
      expect(preventDefault).toHaveBeenCalled();

      const preventDefaultAllowed = vi.fn();
      listeners['will-frame-navigate']?.({ preventDefault: preventDefaultAllowed, url: 'jameet-app://bundle/presenter-video.html' });
      expect(preventDefaultAllowed).not.toHaveBeenCalled();
    });

    it('denies in-app window creation and opens allowed external URLs in OS browser', () => {
      let openHandler: (details: { url: string }) => { action: string } = () => ({ action: 'allow' });
      const mockWebContents = {
        isDestroyed: () => false,
        on: vi.fn(),
        setWindowOpenHandler: vi.fn((fn) => {
          openHandler = fn;
        })
      } as any;

      setupWebContentsSecurity(mockWebContents);

      // Safe HTTPS link -> denied in Electron, delegated to shell.openExternal
      const resHttps = openHandler({ url: 'https://jameet.com/privacy' });
      expect(resHttps).toEqual({ action: 'deny' });
      expect(shell.openExternal).toHaveBeenCalledWith('https://jameet.com/privacy');

      // Disallowed dangerous scheme -> denied, NOT delegated to shell.openExternal
      vi.mocked(shell.openExternal).mockClear();
      const resDangerous = openHandler({ url: 'javascript:alert(1)' });
      expect(resDangerous).toEqual({ action: 'deny' });
      expect(shell.openExternal).not.toHaveBeenCalled();
    });
  });
});
