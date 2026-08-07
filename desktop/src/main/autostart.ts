import { app } from 'electron';

/**
 * Windows login-item integration. Uses Electron's native login-item settings
 * (registry Run key on Windows), so no third-party launcher is required.
 */
export const autostart = {
  async isEnabled(): Promise<boolean> {
    return app.getLoginItemSettings().openAtLogin;
  },
  async set(enabled: boolean, hidden = true): Promise<void> {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: hidden });
  },
};
