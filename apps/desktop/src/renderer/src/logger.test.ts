import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RendererLogger } from './logger';

describe('RendererLogger & Crash Handling', () => {
  let testRendererLogger: RendererLogger;

  beforeEach(() => {
    testRendererLogger = new RendererLogger();
    (global as any).window = {
      addEventListener: vi.fn(),
      jameet: {
        logger: {
          log: vi.fn(),
          crash: vi.fn()
        }
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('silently handles rejected promises from api.logger.crash without causing unhandled rejections', async () => {
    const mockReject = vi.fn().mockRejectedValue(new Error('IPC channel destroyed during quit'));
    (global as any).window.jameet.logger.crash = mockReject;

    // Must not throw synchronously or cause an unhandled promise rejection
    expect(() => {
      testRendererLogger.recordCrash({
        reason: 'Unhandled WebGL rendering failure',
        error: new Error('WebGL context lost')
      });
    }).not.toThrow();

    expect(mockReject).toHaveBeenCalled();

    // Allow promise microtasks to run and verify rejection was caught
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('formats, sanitizes, and forwards structured log entries to desktop main process', () => {
    const mockLog = vi.fn();
    (global as any).window.jameet.logger.log = mockLog;

    testRendererLogger.setSessionContext('SESSION12', 'sess-456');
    const entry = testRendererLogger.info('session_joined', 'Joined room with password=SecretPassword123', {
      role: 'participant'
    });

    expect(entry.sessionCode).toBe('SESSION12');
    expect(entry.sessionId).toBe('sess-456');
    expect(entry.message).not.toContain('SecretPassword123');
    expect(entry.message).toContain('password=[REDACTED]');
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({
      event: 'session_joined',
      sessionCode: 'SESSION12'
    }));
  });

  it('initializes window error and unhandledrejection handlers', () => {
    const addEventListenerSpy = vi.fn();
    (global as any).window.addEventListener = addEventListenerSpy;

    testRendererLogger.initGlobalErrorHandling();

    expect(addEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
  });
});
