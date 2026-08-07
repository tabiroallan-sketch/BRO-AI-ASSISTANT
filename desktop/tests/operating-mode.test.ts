import { describe, expect, it } from 'vitest';
import { planModeTransition } from '../src/main/operating-mode.js';
import { OPERATING_MODES } from '../src/shared/desktop-api.js';

describe('planModeTransition', () => {
  it('maps desktop mode to the main window on the dashboard', () => {
    expect(planModeTransition('desktop')).toEqual({
      mode: 'desktop',
      route: '/dashboard',
      showMain: true,
      hideMain: false,
      showOverlay: false,
    });
  });

  it('maps overlay mode to the floating window and hides the main one', () => {
    expect(planModeTransition('overlay')).toEqual({
      mode: 'overlay',
      route: null,
      showMain: false,
      hideMain: true,
      showOverlay: true,
    });
  });

  it('maps voice mode to the main window on the voice surface', () => {
    expect(planModeTransition('voice')).toEqual({
      mode: 'voice',
      route: '/voice',
      showMain: true,
      hideMain: false,
      showOverlay: false,
    });
  });

  it('normalizes unknown input to desktop', () => {
    expect(planModeTransition('console')).toEqual({
      mode: 'desktop',
      route: '/dashboard',
      showMain: true,
      hideMain: false,
      showOverlay: false,
    });
    expect(planModeTransition(undefined)).toEqual({
      mode: 'desktop',
      route: '/dashboard',
      showMain: true,
      hideMain: false,
      showOverlay: false,
    });
    expect(planModeTransition({})).toEqual({
      mode: 'desktop',
      route: '/dashboard',
      showMain: true,
      hideMain: false,
      showOverlay: false,
    });
  });

  it('covers every known mode', () => {
    for (const mode of OPERATING_MODES) {
      const plan = planModeTransition(mode);
      expect(plan.mode).toBe(mode);
      expect(plan.route === null || typeof plan.route === 'string').toBe(true);
      expect(typeof plan.showMain).toBe('boolean');
      expect(typeof plan.hideMain).toBe('boolean');
      expect(typeof plan.showOverlay).toBe('boolean');
    }
  });
});
