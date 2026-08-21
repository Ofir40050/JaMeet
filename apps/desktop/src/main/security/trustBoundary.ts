import { app, shell, WebContents } from 'electron';

/**
 * Validates whether a URL or origin belongs to a trusted JaMeet renderer origin.
 * Trusted origins include:
 * - Production bundled origins: jameet-app://bundle/... and legacy musiczoom-app://bundle/...
 * - Development origins (only when ELECTRON_RENDERER_URL is set or in unpackaged development):
 *   http://localhost:*, http://127.0.0.1:*, or exact ELECTRON_RENDERER_URL origin.
 */
export function isTrustedOrigin(urlStr?: string | null): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol === 'jameet-app:' || parsed.protocol === 'musiczoom-app:') {
      return parsed.hostname === 'bundle' || parsed.host === 'bundle';
    }
    // Allow local development server only when configured or during dev
    if (process.env.ELECTRON_RENDERER_URL || (app && !app.isPackaged)) {
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          return true;
        }
        if (process.env.ELECTRON_RENDERER_URL) {
          try {
            const devUrl = new URL(process.env.ELECTRON_RENDERER_URL);
            if (parsed.origin === devUrl.origin) {
              return true;
            }
          } catch {
            // ignore invalid dev url format
          }
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Checks if a URL has an explicitly allowed external web protocol (HTTP/HTTPS)
 * for safe delegation to the operating system browser. Reject all other schemes.
 */
export function isAllowedExternalUrl(urlStr?: string | null): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Validates that an incoming IPC event was dispatched from an authoritative
 * trusted JaMeet renderer frame.
 *
 * Rules:
 * 1. If event.senderFrame exists and has a non-empty URL, it is authoritative.
 *    If trusted, allowed. If untrusted, rejected immediately without fallback.
 * 2. Only if senderFrame is genuinely missing, null, or has an empty URL,
 *    fall back to event.sender.getURL() for early window lifecycle compatibility.
 */
export function isTrustedSender(event?: { senderFrame?: { url?: string | null } | null; sender?: { getURL?: () => string } | null } | null): boolean {
  if (!event) return false;

  // Authoritative frame URL check
  if (event.senderFrame && typeof event.senderFrame.url === 'string' && event.senderFrame.url.trim() !== '') {
    return isTrustedOrigin(event.senderFrame.url.trim());
  }

  // Early lifecycle fallback when senderFrame is missing or empty
  if (event.sender && typeof event.sender.getURL === 'function') {
    const senderUrl = event.sender.getURL();
    if (senderUrl && typeof senderUrl === 'string' && senderUrl.trim() !== '') {
      return isTrustedOrigin(senderUrl.trim());
    }
  }

  return false;
}

/**
 * Configures navigation restrictions, redirect protection, and window open denial
 * on a WebContents instance to enforce the renderer trust boundary.
 */
export function setupWebContentsSecurity(contents: WebContents): void {
  if (!contents || contents.isDestroyed()) return;

  // Prevent top-level navigation to untrusted content
  contents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedOrigin(navigationUrl)) {
      event.preventDefault();
      console.warn(`[Security] Blocked will-navigate to untrusted URL: ${navigationUrl}`);
    }
  });

  // Prevent navigation redirects from escaping the trusted origin
  contents.on('will-redirect', (event, redirectUrl) => {
    if (!isTrustedOrigin(redirectUrl)) {
      event.preventDefault();
      console.warn(`[Security] Blocked will-redirect to untrusted URL: ${redirectUrl}`);
    }
  });

  // Prevent subframes / iframes from navigating to untrusted origins
  contents.on('will-frame-navigate', (event) => {
    const targetUrl = (event as unknown as { url: string }).url;
    if (!isTrustedOrigin(targetUrl)) {
      event.preventDefault();
      console.warn(`[Security] Blocked will-frame-navigate to untrusted URL: ${targetUrl}`);
    }
  });

  // Block creation of in-app browser windows (window.open, target="_blank")
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      // Only delegate explicitly allowed HTTP/HTTPS URLs to the OS browser
      void shell.openExternal(url).catch((err) => {
        console.warn('[Security] Failed to open external URL in system browser:', err);
      });
    } else {
      console.warn(`[Security] Blocked window creation for disallowed scheme or untrusted URL: ${url}`);
    }
    return { action: 'deny' };
  });
}
