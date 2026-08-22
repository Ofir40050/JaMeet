import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchServerVersionInfo,
  handleVersionCheckResult,
  checkAppVersion
} from './versionCheckController';

describe('versionCheckController', () => {
  const elements = new Map<string, any>();

  beforeEach(() => {
    elements.clear();

    const bannerClasses = new Set<string>(['hidden']);
    const dialogClasses = new Set<string>();

    const mockBanner = {
      id: 'update-available-banner',
      textContent: '',
      classList: {
        add: (c: string) => bannerClasses.add(c),
        remove: (c: string) => bannerClasses.delete(c),
        contains: (c: string) => bannerClasses.has(c)
      }
    };

    const mockDialog = {
      id: 'update-required-dialog',
      textContent: '',
      open: false,
      classList: {
        add: (c: string) => dialogClasses.add(c),
        remove: (c: string) => dialogClasses.delete(c),
        contains: (c: string) => dialogClasses.has(c)
      },
      showModal: vi.fn(function () {
        mockDialog.open = true;
      }),
      close: vi.fn(function () {
        mockDialog.open = false;
      })
    };

    elements.set('update-available-banner', mockBanner);
    elements.set('update-required-dialog', mockDialog);
    elements.set('update-banner-latest-version', { textContent: '' });
    elements.set('btn-update-banner-download', { onclick: null, click: function() { this.onclick?.(); } });
    elements.set('btn-update-banner-dismiss', { onclick: null, click: function() { this.onclick?.(); } });
    elements.set('update-required-current-version', { textContent: '' });
    elements.set('update-required-min-version', { textContent: '' });
    elements.set('btn-update-required-download', { onclick: null, click: function() { this.onclick?.(); } });

    (globalThis as any).document = {
      getElementById: (id: string) => elements.get(id) ?? null
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches version info from server /api/version', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        latestVersion: '0.2.0',
        minSupportedVersion: '0.1.0',
        downloadUrl: 'https://github.com/Ofir40050/JaMeet/releases'
      })
    } as any);

    const info = await fetchServerVersionInfo('https://server.jameet.test');
    expect(info).not.toBeNull();
    expect(info?.latestVersion).toBe('0.2.0');
    expect(info?.minSupportedVersion).toBe('0.1.0');
  });

  it('shows non-blocking banner when update is available and supported', () => {
    const banner = elements.get('update-available-banner')!;
    const onOpenExternal = vi.fn();

    handleVersionCheckResult(
      {
        status: 'update_available',
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        minSupportedVersion: '0.1.0',
        downloadUrl: 'https://github.com/Ofir40050/JaMeet/releases/tag/v0.2.0',
        isOutdated: true,
        isUnsupported: false
      },
      onOpenExternal
    );

    expect(banner.classList.contains('hidden')).toBe(false);
    expect(elements.get('update-banner-latest-version')?.textContent).toBe('v0.2.0');

    // Click download
    elements.get('btn-update-banner-download')?.click();
    expect(onOpenExternal).toHaveBeenCalledWith('https://github.com/Ofir40050/JaMeet/releases/tag/v0.2.0');

    // Click dismiss
    elements.get('btn-update-banner-dismiss')?.click();
    expect(banner.classList.contains('hidden')).toBe(true);
  });

  it('shows blocking dialog when client version is unsupported', () => {
    const dialog = elements.get('update-required-dialog')!;
    const banner = elements.get('update-available-banner')!;
    const onOpenExternal = vi.fn();

    handleVersionCheckResult(
      {
        status: 'unsupported_outdated',
        currentVersion: '0.1.0',
        latestVersion: '0.3.0',
        minSupportedVersion: '0.2.0',
        downloadUrl: 'https://github.com/Ofir40050/JaMeet/releases/tag/v0.3.0',
        isOutdated: true,
        isUnsupported: true
      },
      onOpenExternal
    );

    expect(dialog.showModal).toHaveBeenCalled();
    expect(banner.classList.contains('hidden')).toBe(true);
    expect(elements.get('update-required-current-version')?.textContent).toBe('v0.1.0');
    expect(elements.get('update-required-min-version')?.textContent).toBe('v0.2.0');

    elements.get('btn-update-required-download')?.click();
    expect(onOpenExternal).toHaveBeenCalledWith('https://github.com/Ofir40050/JaMeet/releases/tag/v0.3.0');
  });

  it('hides banners and modals when version is up to date', () => {
    const banner = elements.get('update-available-banner')!;
    const dialog = elements.get('update-required-dialog')!;
    dialog.open = true;

    handleVersionCheckResult({
      status: 'up_to_date',
      currentVersion: '0.2.0',
      latestVersion: '0.2.0',
      minSupportedVersion: '0.1.0',
      downloadUrl: 'https://github.com/Ofir40050/JaMeet/releases',
      isOutdated: false,
      isUnsupported: false
    });

    expect(banner.classList.contains('hidden')).toBe(true);
    expect(dialog.close).toHaveBeenCalled();
  });
});
