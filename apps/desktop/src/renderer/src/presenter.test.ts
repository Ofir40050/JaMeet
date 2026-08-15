import { describe, it, expect, vi } from 'vitest';
import { presenter } from './presenter';

describe('PresenterManager', () => {
  it('initializes with default presenter state', () => {
    const state = presenter.getState();
    expect(state.micMuted).toBe(false);
    expect(state.camEnabled).toBe(true);
    expect(state.mode).toBe('music');
    expect(state.paused).toBe(false);
    expect(state.pipVisible).toBe(true);
  });

  it('updates state partially and returns current state snapshot', () => {
    presenter.updateState({ micMuted: true, paused: true });
    const state = presenter.getState();
    expect(state.micMuted).toBe(true);
    expect(state.paused).toBe(true);
    expect(state.mode).toBe('music'); // unchanged
  });

  it('dispatches actions to registered action handler', () => {
    const actionSpy = vi.fn();
    presenter.setActionHandler(actionSpy);

    // Trigger action handler directly
    (presenter as any).actionHandler?.('toggle-mic', { source: 'test' });
    expect(actionSpy).toHaveBeenCalledWith('toggle-mic', { source: 'test' });

    (presenter as any).actionHandler?.('toggle-pause');
    expect(actionSpy).toHaveBeenLastCalledWith('toggle-pause');
  });
});
